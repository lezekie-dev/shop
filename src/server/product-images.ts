/**
 * Téléversement et gestion des visuels produits (chantier H, lot 2C).
 *
 * ┌───────────────────────────────────────────────────────────────────┐
 * │ C'est ici que vivent les décisions de sécurité du téléversement.  │
 * │ Chaque contrôle indique l'attaque qu'il bloque — un contrôle dont  │
 * │ on ne sait plus ce qu'il protège finit par être retiré par        │
 * │ quelqu'un qui le croit inutile.                                   │
 * └───────────────────────────────────────────────────────────────────┘
 *
 * STOCKAGE : volume local, décision D7 du PO. Les fichiers vont sous
 * `public/uploads/products/` (donc dans l'arborescence sauvegardée avec la
 * base), et sont servis à l'URL `/uploads/products/<fichier>`. Aucun bucket,
 * aucun service tiers : « aucun compte tiers » est une contrainte du projet.
 *
 * CONSÉQUENCE DE DÉPLOIEMENT À CONNAÎTRE : les fichiers téléversés après le
 * build vivent dans `public/uploads/`, pas dans `.next/standalone/public/`.
 * Si la production démarre le serveur *standalone* généré par le build, ce
 * répertoire doit être un volume monté et servi — sinon le rendu retombe sur
 * le repli de `ProductVisual` (aucune fiche ne casse, mais la photo ne
 * s'affiche pas). Si la production démarre avec `next start` depuis la racine
 * du projet, rien à faire.
 *
 * Cette couche est la SEULE à écrire sur le disque et en base pour un visuel.
 * Les routes API ne font que parser la requête et traduire le résultat.
 */

import { mkdir, statfs, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  extensionForMime,
  looksLikeSvg,
  readImageDimensions,
  sanitizeImage,
  sniffImageMime,
  type AllowedImageMime,
} from "@/domain/image-format";
import { reorderIds, type ImageMove } from "@/domain/product-images";
import { prisma } from "@/lib/db";
import { newId } from "@/lib/ids";
import { writeAuditLog } from "@/server/audit-log";

// ─────────────────────────────────────────────────────────────────────
// Limites — chacune est un choix, pas un défaut
// ─────────────────────────────────────────────────────────────────────

/**
 * Taille maximale d'un fichier : 5 Mo.
 *
 * POURQUOI 5 Mo : c'est le plafond posé par le brief PO (§3.5) et il couvre
 * largement le besoin réel. Une photo d'iPhone pèse 2 à 4 Mo, un JPEG d'APN
 * 4 à 8 Mo mais le marchand cible prend ses photos au téléphone. Au-delà de
 * 5 Mo, deux problèmes se cumulent sur un VPS modeste : la requête multipart
 * est tamponnée en mémoire par Next avant qu'on puisse la valider, et chaque
 * dérivé d'image (next/image) redimensionne cette source. 5 Mo borne les deux.
 */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/**
 * Marge de tolérance sur l'en-tête `Content-Length` : l'enveloppe multipart
 * ajoute des frontières et le champ `alt`, soit quelques centaines d'octets.
 */
export const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

/** Visuels maximum par produit (AC du brief : « jusqu'à 6 visuels »). */
export const MAX_IMAGES_PER_PRODUCT = 6;

/**
 * Plafond de pixels par image : 40 mégapixels.
 *
 * POURQUOI CE CONTRÔLE EXISTE : c'est la protection contre la « bombe de
 * décompression ». Un PNG de 40 ko peut annoncer 60 000 × 60 000 pixels ; au
 * décodage, cela réclame des gigaoctets et fait tomber le conteneur — la
 * taille du fichier compressé ne dit RIEN du nombre de pixels. 40 Mpx laisse
 * passer un boîtier expert (8 000 × 5 000) et refuse l'absurde. Le contrôle a
 * lieu AVANT tout décodage, sur les dimensions lues dans l'en-tête.
 */
export const MAX_IMAGE_PIXELS = 40_000_000;

/**
 * Côté maximum, en pixels. Complète le plafond de pixels pour les cas
 * dégénérés (une image de 12 000 × 3 pixels passe le plafond de pixels mais
 * n'est pas une photo de produit).
 */
export const MAX_IMAGE_SIDE = 12_000;

/**
 * Côté minimum : 32 pixels. En dessous, le visuel est inutilisable dans une
 * grille de catalogue (une vignette de 8 × 8 px n'affiche rien d'identifiable).
 * Le refus est expliqué à la marchande, qui peut alors choisir une autre photo.
 */
export const MIN_IMAGE_SIDE = 32;

/**
 * Quota global de stockage des téléversements : 500 Mo par défaut,
 * surchargeable par `QUOTA_UPLOADS_MB` (nom imposé par le brief PO §3.5).
 *
 * POURQUOI DEUX GARDE-FOUS PLUTÔT QU'UN (risque R6 : « téléversement =
 * remplissage de disque ») :
 *  - le quota compte la somme des `sizeBytes` en base — il répond à « la
 *    boutique a-t-elle atteint son budget de photos ? » et il est indépendant
 *    de l'état du disque ;
 *  - la vérification d'espace disque libre répond à « reste-t-il de la place
 *    sur le VPS ? », qui peut manquer pour une raison SANS RAPPORT (logs,
 *    sauvegardes, base). Un quota seul laisserait passer le téléversement qui
 *    remplit le disque à 100 %, et c'est la base qui tombe avec le site.
 * Les deux refus sont actionnables (message qui dit quoi faire).
 */
export const DEFAULT_QUOTA_MB = 500;

/**
 * Espace disque qu'on refuse de franchir : 200 Mo. Le seuil est volontairement
 * au-dessus de zéro — PostgreSQL a besoin de place pour ses WAL, et un disque
 * plein ne casse pas seulement les images, il casse les commandes.
 */
export const DISK_RESERVE_BYTES = 200 * 1024 * 1024;

/** Préfixe d'URL public des fichiers téléversés. */
export const UPLOADS_URL_PREFIX = "/uploads/products";

/** Segment de chemin local correspondant, sous la racine du projet. */
const UPLOADS_LOCAL_SEGMENTS = ["public", "uploads", "products"] as const;

/** Extensions d'image que le serveur statique de Next sait typer. */
const ALLOWED_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp"]);

// ─────────────────────────────────────────────────────────────────────
// Résultats typés
// ─────────────────────────────────────────────────────────────────────

/** Visuel prêt à afficher (aucun objet Prisma brut ne fuit vers l'UI). */
export interface ProductImageDto {
  id: string;
  url: string;
  alt: string;
  position: number;
  width: number | null;
  height: number | null;
  mimeType: string | null;
  sizeBytes: number | null;
  /** `true` pour la position 0 : c'est elle qui s'affiche partout. */
  isCover: boolean;
  /**
   * `true` si le fichier n'a pas été téléversé par la boutique (visuel de
   * démonstration référencé par URL, cf. commentaire du schéma) : dans ce cas
   * il n'y a pas de fichier local à supprimer, et la taille est inconnue.
   */
  isExternal: boolean;
}

/** Refus : statut HTTP + code stable + message destiné à la marchande. */
export interface OperationFailure {
  ok: false;
  status: number;
  code: string;
  error: string;
}

/** Succès d'une opération unitaire. */
export type OperationOutcome<T> = { ok: true; value: T } | OperationFailure;

function fail(status: number, code: string, error: string): OperationFailure {
  return { ok: false, status, code, error };
}

// ─────────────────────────────────────────────────────────────────────
// Chemins et quota
// ─────────────────────────────────────────────────────────────────────

/**
 * Racine locale des téléversements.
 *
 * `UPLOADS_DIR` permet de la déplacer (volume monté en production, répertoire
 * temporaire en test). Elle est lue à CHAQUE appel et non au chargement du
 * module : sans cela, un test ne pourrait pas la rediriger avant le premier
 * import, et un déploiement ne pourrait pas la changer sans rebuild.
 */
export function resolveUploadRoot(): string {
  const configured = process.env.UPLOADS_DIR;
  if (configured && configured.trim() !== "") return path.resolve(configured);
  return path.join(process.cwd(), ...UPLOADS_LOCAL_SEGMENTS);
}

/** URL publique d'un fichier, à partir de son seul nom. */
export function publicUrlFor(fileName: string): string {
  return `${UPLOADS_URL_PREFIX}/${fileName}`;
}

/** Quota configuré, en octets. Une valeur illisible retombe sur le défaut. */
export function uploadQuotaBytes(): number {
  const raw = process.env.QUOTA_UPLOADS_MB;
  const megabytes = raw === undefined ? Number.NaN : Number.parseInt(raw, 10);
  const effective =
    Number.isFinite(megabytes) && megabytes > 0 ? megabytes : DEFAULT_QUOTA_MB;
  return effective * 1024 * 1024;
}

/** Espace disque libre, ou `null` si le système ne sait pas répondre. */
async function freeDiskBytes(directory: string): Promise<number | null> {
  try {
    const stats = await statfs(directory);
    return Number(stats.bavail) * Number(stats.bsize);
  } catch {
    // Système de fichiers exotique : on ne bloque pas la marchande pour un
    // contrôle qu'on ne sait pas faire. Le quota, lui, s'applique toujours.
    return null;
  }
}

/** Consommation de stockage, pour l'affichage du quota dans l'administration. */
export interface UploadsUsage {
  usedBytes: number;
  quotaBytes: number;
  fileCount: number;
  /** `true` quand il ne reste plus de place : l'UI le dit AVANT le refus. */
  saturated: boolean;
}

export async function getUploadsUsage(): Promise<UploadsUsage> {
  const aggregate = await prisma.productImage.aggregate({
    where: { sizeBytes: { not: null } },
    _sum: { sizeBytes: true },
    _count: true,
  });
  const usedBytes = aggregate._sum.sizeBytes ?? 0;
  const quotaBytes = uploadQuotaBytes();
  return {
    usedBytes,
    quotaBytes,
    fileCount: aggregate._count,
    saturated: usedBytes >= quotaBytes,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Lecture
// ─────────────────────────────────────────────────────────────────────

function toDto(row: {
  id: string;
  url: string;
  alt: string;
  position: number;
  width: number | null;
  height: number | null;
  mimeType: string | null;
  sizeBytes: number | null;
}): ProductImageDto {
  return {
    id: row.id,
    url: row.url,
    alt: row.alt,
    position: row.position,
    width: row.width,
    height: row.height,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    isCover: row.position === 0,
    // Un visuel téléversé porte toujours un `sizeBytes` (cf. createProductImage) ;
    // au contraire, un visuel d'URL externe n'a ni mimeType ni taille. C'est ce
    // qui distingue les deux, et donc ce qui décide si on a un fichier à
    // supprimer sur le disque.
    isExternal: row.sizeBytes === null,
  };
}

/** Visuels d'un produit, dans l'ordre d'affichage. */
export async function listProductImages(productId: string): Promise<ProductImageDto[]> {
  const rows = await prisma.productImage.findMany({
    where: { productId },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      url: true,
      alt: true,
      position: true,
      width: true,
      height: true,
      mimeType: true,
      sizeBytes: true,
    },
  });
  return rows.map(toDto);
}

// ─────────────────────────────────────────────────────────────────────
// Validation du contenu téléversé
// ─────────────────────────────────────────────────────────────────────

/** Ce que la validation d'un fichier produit quand elle réussit. */
interface ValidatedUpload {
  mime: AllowedImageMime;
  extension: string;
  width: number;
  height: number;
  /** Octets réécrits : ce sont EUX qui partiront sur le disque. */
  sanitized: Uint8Array;
}

/**
 * Valide puis assainit un fichier téléversé. Ne touche ni au disque ni à la
 * base : c'est une fonction de décision, donc directement testable.
 *
 * L'ordre des contrôles est du moins coûteux au plus coûteux, et le plafond de
 * pixels passe AVANT l'assainissement (qui parcourt tout le fichier).
 */
export function validateUploadBytes(bytes: Uint8Array): OperationOutcome<ValidatedUpload> {
  // 1. Fichier vide. Un `multipart` bien formé peut transporter 0 octet (le
  //    champ « file » d'un formulaire avec un input vidé) : sans ce test on
  //    créerait un visuel cassé.
  if (bytes.length === 0) {
    return fail(400, "FICHIER_VIDE", "Le fichier reçu est vide. Choisissez une photo.");
  }

  // 2. Taille. Contrôle refait ici et pas seulement sur `Content-Length` :
  //    un client peut mentir sur la longueur annoncée. Celui-ci porte sur les
  //    octets réellement reçus.
  if (bytes.length > MAX_UPLOAD_BYTES) {
    const mo = (bytes.length / (1024 * 1024)).toFixed(1);
    return fail(
      413,
      "TAILLE_DEPASSEE",
      `Photo trop lourde : ${mo} Mo. La limite est de 5 Mo. Réduisez la photo ` +
        `(par exemple en l'envoyant par messagerie puis en la réenregistrant) ou ` +
        `baissez la qualité de l'appareil photo.`,
    );
  }

  // 3. Type RÉEL, lu dans les octets de signature. Ni l'extension du nom de
  //    fichier, ni l'en-tête `Content-Type` du multipart ne sont consultés :
  //    les deux sont contrôlés par le client, donc falsifiables. C'est le
  //    contrôle qui empêche de faire passer un HTML ou un SVG pour une image.
  const mime = sniffImageMime(bytes);
  if (mime === null) {
    if (looksLikeSvg(bytes)) {
      return fail(
        415,
        "TYPE_NON_SUPPORTE",
        "Le format SVG n'est pas accepté : un fichier SVG peut contenir du code " +
          "qui s'exécuterait dans la boutique. Envoyez une photo JPEG, PNG ou WebP.",
      );
    }
    return fail(
      415,
      "TYPE_NON_SUPPORTE",
      "Ce fichier n'est pas une image au format accepté (JPEG, PNG ou WebP). " +
        "Vérifiez que vous envoyez bien une photo et non un document ou une vidéo.",
    );
  }

  // 4. Dimensions réelles, lues dans l'en-tête (jamais en décodant l'image :
  //    décoder pour connaître les dimensions, c'est déjà subir la bombe).
  const dimensions = readImageDimensions(bytes, mime);
  if (dimensions === null) {
    return fail(
      400,
      "IMAGE_CORROMPUE",
      "L'image est illisible : son en-tête est incomplet ou endommagé. " +
        "Essayez de l'ouvrir puis de la réenregistrer avant de l'envoyer.",
    );
  }

  // 5. Bombe de décompression. Refus AVANT tout parcours des pixels.
  if (dimensions.width * dimensions.height > MAX_IMAGE_PIXELS) {
    return fail(
      413,
      "DIMENSIONS_EXCESSIVES",
      `Image trop grande (${dimensions.width} × ${dimensions.height} pixels). ` +
        `La limite est de 40 mégapixels — largement au-delà d'une photo de téléphone.`,
    );
  }

  if (dimensions.width > MAX_IMAGE_SIDE || dimensions.height > MAX_IMAGE_SIDE) {
    return fail(
      413,
      "DIMENSIONS_EXCESSIVES",
      `Image trop grande (${dimensions.width} × ${dimensions.height} pixels). ` +
        `Le côté le plus long ne doit pas dépasser ${MAX_IMAGE_SIDE} pixels.`,
    );
  }

  if (dimensions.width < MIN_IMAGE_SIDE || dimensions.height < MIN_IMAGE_SIDE) {
    return fail(
      400,
      "DIMENSIONS_INSUFFISANTES",
      `Image trop petite (${dimensions.width} × ${dimensions.height} pixels). ` +
        `Il faut au moins ${MIN_IMAGE_SIDE} pixels de côté pour que la photo soit ` +
        `lisible dans le catalogue.`,
    );
  }

  // 6. Assainissement : les octets écrits sur le disque ne sont pas ceux reçus.
  return {
    ok: true,
    value: {
      mime,
      extension: extensionForMime(mime),
      width: dimensions.width,
      height: dimensions.height,
      sanitized: sanitizeImage(bytes, mime),
    },
  };
}

/**
 * Validation du texte alternatif. Non négociable (AC) : un visuel sans
 * alternative textuelle est invisible pour un lecteur d'écran, et un catalogue
 * e-commerce en est déjà plein. On refuse l'enregistrement plutôt que de
 * laisser passer un `alt` vide « pour aller plus vite ».
 */
export function validateAlt(raw: string): OperationOutcome<string> {
  const alt = raw.trim();
  if (alt === "") {
    return fail(
      400,
      "ALT_MANQUANT",
      "La description de la photo est obligatoire. Décrivez ce qu'on voit " +
        "(par exemple : « T-shirt blanc en coton, vu de face »). Ce texte est lu " +
        "aux personnes malvoyantes et s'affiche si la photo ne charge pas.",
    );
  }
  if (alt.length > 200) {
    return fail(
      400,
      "ALT_TROP_LONG",
      "La description de la photo est trop longue (200 caractères maximum).",
    );
  }
  return { ok: true, value: alt };
}

// ─────────────────────────────────────────────────────────────────────
// Téléversement
// ─────────────────────────────────────────────────────────────────────

/**
 * Nom de fichier généré par le serveur.
 *
 * POURQUOI JAMAIS LE NOM DU CLIENT : un nom fourni par le client peut contenir
 * `../../../../etc/cron.d/x`, une séquence nulle, un chemin Windows, ou un nom
 * qui écrase un fichier existant. On génère donc un identifiant CUID2 (imprévisible,
 * non énumérable) et on ne garde du client STRICTEMENT RIEN — pas même
 * l'extension, qui est déduite du type détecté. Le seul rôle de l'extension
 * finale est de donner au serveur statique le bon `Content-Type`.
 */
function generateFileName(extension: string): string {
  return `${newId()}.${extension}`;
}

/** Vérifie qu'un nom de fichier est bien de la forme `<cuid>.<ext attendue>`. */
export function isSafeGeneratedFileName(fileName: string): boolean {
  if (fileName.includes("/") || fileName.includes("\\") || fileName.includes("..")) return false;
  const parts = fileName.split(".");
  if (parts.length !== 2) return false;
  const [base, extension] = parts as [string, string];
  if (!/^[a-z0-9]{8,64}$/i.test(base)) return false;
  return ALLOWED_EXTENSIONS.has(extension.toLowerCase());
}

/** Supprime un fichier sans faire échouer l'appelant s'il est déjà absent. */
async function removeFileQuietly(absolutePath: string): Promise<void> {
  try {
    await unlink(absolutePath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      console.error("[product-images] suppression de fichier impossible", absolutePath, error);
    }
  }
}

export interface CreateProductImageInput {
  productId: string;
  bytes: Uint8Array;
  alt: string;
  /** Auteur de l'action, pour le journal d'audit. */
  userId: string;
  /**
   * Nom de fichier annoncé par le client. Il n'est JAMAIS utilisé comme chemin
   * (cf. `generateFileName`) : il est seulement recopié dans le journal
   * d'audit, pour pouvoir retrouver l'origine d'une photo litigieuse.
   */
  originalName?: string;
}

/**
 * Enregistre un visuel : valide, vérifie les quotas, écrit le fichier, crée la
 * ligne en base et journalise l'action.
 *
 * ORDRE DES OPÉRATIONS, ET POURQUOI : le fichier est écrit AVANT la ligne en
 * base. Si l'écriture disque échoue, aucune ligne orpheline n'est créée. Si
 * c'est la base qui échoue, le fichier est supprimé dans le `catch` — jamais
 * l'inverse (une ligne en base pointant vers un fichier absent afficherait une
 * image cassée en vitrine, ce qui est pire qu'un fichier orphelin).
 */
export async function createProductImage(
  input: CreateProductImageInput,
): Promise<OperationOutcome<ProductImageDto>> {
  const alt = validateAlt(input.alt);
  if (!alt.ok) return alt;

  const validated = validateUploadBytes(input.bytes);
  if (!validated.ok) return validated;
  const { mime, extension, width, height, sanitized } = validated.value;

  const product = await prisma.product.findUnique({
    where: { id: input.productId },
    select: { id: true, name: true },
  });
  if (!product) {
    return fail(404, "PRODUIT_INTROUVABLE", "Ce produit n'existe pas (ou plus).");
  }

  // Plafond par produit : borne la page produit ET limite l'ampleur d'un abus
  // (6 fichiers × 5 Mo = 30 Mo maximum pour un seul produit).
  const existingCount = await prisma.productImage.count({
    where: { productId: input.productId },
  });
  if (existingCount >= MAX_IMAGES_PER_PRODUCT) {
    return fail(
      409,
      "LIMITE_VISUELS",
      `Ce produit a déjà ${MAX_IMAGES_PER_PRODUCT} photos, c'est le maximum. ` +
        `Supprimez une photo pour en ajouter une autre.`,
    );
  }

  // Quota global (base) : c'est le garde-fou « budget photos de la boutique ».
  const usage = await prisma.productImage.aggregate({
    where: { sizeBytes: { not: null } },
    _sum: { sizeBytes: true },
  });
  const usedBytes = usage._sum.sizeBytes ?? 0;
  const quotaBytes = uploadQuotaBytes();
  if (usedBytes + sanitized.length > quotaBytes) {
    const usedMo = (usedBytes / (1024 * 1024)).toFixed(1);
    const quotaMo = (quotaBytes / (1024 * 1024)).toFixed(0);
    return fail(
      507,
      "QUOTA_DEPASSE",
      `Espace photos saturé : ${usedMo} Mo utilisés sur ${quotaMo} Mo. ` +
        `Supprimez des photos inutilisées, ou augmentez la limite ` +
        `(variable QUOTA_UPLOADS_MB) depuis l'hébergement.`,
    );
  }

  const root = resolveUploadRoot();
  await mkdir(root, { recursive: true, mode: 0o755 });

  // Quota disque (système de fichiers) : voir le commentaire de
  // DEFAULT_QUOTA_MB — le quota en base ne protège pas d'un disque rempli par
  // autre chose. Réserve de 200 Mo, et non « 0 octet libre ».
  const free = await freeDiskBytes(root);
  if (free !== null && free - sanitized.length < DISK_RESERVE_BYTES) {
    return fail(
      507,
      "ESPACE_DISQUE",
      "Espace disque insuffisant sur le serveur pour enregistrer cette photo. " +
        "Prévenez l'hébergeur : le disque est presque plein et cela peut aussi " +
        "empêcher les commandes d'être enregistrées.",
    );
  }

  const fileName = generateFileName(extension);
  const absolutePath = path.join(root, fileName);

  try {
    // `flag: "wx"` = échec si le fichier existe déjà. Avec un identifiant
    // généré, une collision est improbable — mais si elle arrivait, mieux vaut
    // une erreur qu'un écrasement silencieux du visuel d'un autre produit.
    await writeFile(absolutePath, sanitized, { flag: "wx", mode: 0o644 });
  } catch (error) {
    console.error("[product-images] écriture du fichier impossible", absolutePath, error);
    return fail(500, "ECRITURE_IMPOSSIBLE", "Impossible d'enregistrer la photo sur le serveur.");
  }

  const url = publicUrlFor(fileName);

  try {
    const created = await prisma.$transaction(async (tx) => {
      // La position est calculée DANS la transaction : deux téléversements
      // simultanés ne peuvent pas se voir attribuer le même rang.
      const highest = await tx.productImage.findFirst({
        where: { productId: input.productId },
        orderBy: { position: "desc" },
        select: { position: true },
      });
      const position = (highest?.position ?? -1) + 1;

      const image = await tx.productImage.create({
        data: {
          productId: input.productId,
          url,
          alt: alt.value,
          position,
          width,
          height,
          mimeType: mime,
          sizeBytes: sanitized.length,
        },
        select: {
          id: true,
          url: true,
          alt: true,
          position: true,
          width: true,
          height: true,
          mimeType: true,
          sizeBytes: true,
        },
      });

      await writeAuditLog(tx, {
        userId: input.userId,
        action: "product.image.upload",
        entity: "ProductImage",
        entityId: image.id,
        diff: {
          productId: input.productId,
          productName: product.name,
          url,
          mimeType: mime,
          sizeBytes: sanitized.length,
          width,
          height,
          // Nom annoncé par le client : consigné pour la traçabilité, jamais
          // utilisé comme chemin (cf. `generateFileName`).
          originalName: input.originalName ?? null,
        },
      });

      return image;
    });

    return { ok: true, value: toDto(created) };
  } catch (error) {
    // La ligne n'existe pas : on ne laisse pas traîner le fichier qu'on vient
    // d'écrire. Sans ce nettoyage, chaque échec DB laisserait un orphelin, et
    // c'est exactement ainsi qu'un disque se remplit sans qu'on s'en aperçoive.
    await removeFileQuietly(absolutePath);
    console.error("[product-images] création en base impossible", error);
    return fail(500, "ENREGISTREMENT_IMPOSSIBLE", "Impossible d'enregistrer la photo.");
  }
}

// ─────────────────────────────────────────────────────────────────────
// Réordonnancement
// ─────────────────────────────────────────────────────────────────────

/**
 * Réordonne les visuels d'un produit : monter, descendre, ou désigner la photo
 * principale (position 0).
 *
 * STRATÉGIE FACE À `@@unique([productId, position])` : on ne déplace jamais une
 * ligne « à sa place finale » directement — un échange direct ferait cohabiter
 * deux lignes sur le même rang le temps d'une instruction, et la contrainte
 * rejetterait l'écriture. On réécrit donc TOUT l'ordre en deux passes dans une
 * seule transaction :
 *   1. tous les visuels reçoivent un rang temporaire NÉGATIF (`-(index+1)`) —
 *      uniques entre eux par construction, et impossibles à confondre avec un
 *      rang définitif qui est toujours ≥ 0 ;
 *   2. tous reçoivent leur rang définitif (`index`), à un moment où plus aucune
 *      ligne n'occupe de rang positif.
 * Aucune passe intermédiaire ne peut donc violer la contrainte. Effet de bord
 * voulu : l'opération COMPACTE les rangs (0..n-1), il ne peut pas subsister de
 * trou dans l'ordre d'affichage.
 */
export async function moveProductImage(input: {
  productId: string;
  imageId: string;
  move: ImageMove;
  userId: string;
}): Promise<OperationOutcome<ProductImageDto[]>> {
  const image = await prisma.productImage.findFirst({
    where: { id: input.imageId, productId: input.productId },
    select: { id: true, alt: true, position: true },
  });
  if (!image) {
    return fail(404, "VISUEL_INTROUVABLE", "Cette photo n'existe plus pour ce produit.");
  }

  try {
    await prisma.$transaction(async (tx) => {
      const rows = await tx.productImage.findMany({
        where: { productId: input.productId },
        orderBy: [{ position: "asc" }, { createdAt: "asc" }],
        select: { id: true },
      });
      const current = rows.map((row) => row.id);
      const next = reorderIds(current, input.imageId, input.move);

      // Passe 1 — rangs temporaires négatifs.
      for (let index = 0; index < next.length; index += 1) {
        await tx.productImage.update({
          where: { id: next[index]! },
          data: { position: -(index + 1) },
        });
      }
      // Passe 2 — rangs définitifs.
      for (let index = 0; index < next.length; index += 1) {
        await tx.productImage.update({
          where: { id: next[index]! },
          data: { position: index },
        });
      }

      await writeAuditLog(tx, {
        userId: input.userId,
        action: "product.image.reorder",
        entity: "ProductImage",
        entityId: input.imageId,
        diff: { productId: input.productId, move: input.move, order: next },
      });
    });
  } catch (error) {
    console.error("[product-images] réordonnancement impossible", error);
    return fail(500, "REORDONNANCEMENT_IMPOSSIBLE", "Impossible de changer l'ordre des photos.");
  }

  return { ok: true, value: await listProductImages(input.productId) };
}

// ─────────────────────────────────────────────────────────────────────
// Description (alt)
// ─────────────────────────────────────────────────────────────────────

/** Modifie la description d'un visuel existant. L'`alt` reste obligatoire. */
export async function updateProductImageAlt(input: {
  productId: string;
  imageId: string;
  alt: string;
  userId: string;
}): Promise<OperationOutcome<ProductImageDto[]>> {
  const alt = validateAlt(input.alt);
  if (!alt.ok) return alt;

  const image = await prisma.productImage.findFirst({
    where: { id: input.imageId, productId: input.productId },
    select: { id: true },
  });
  if (!image) {
    return fail(404, "VISUEL_INTROUVABLE", "Cette photo n'existe plus pour ce produit.");
  }

  await prisma.$transaction(async (tx) => {
    await tx.productImage.update({
      where: { id: input.imageId },
      data: { alt: alt.value },
    });
    await writeAuditLog(tx, {
      userId: input.userId,
      action: "product.image.describe",
      entity: "ProductImage",
      entityId: input.imageId,
      diff: { productId: input.productId, alt: alt.value },
    });
  });

  return { ok: true, value: await listProductImages(input.productId) };
}

// ─────────────────────────────────────────────────────────────────────
// Suppression
// ─────────────────────────────────────────────────────────────────────

/**
 * Supprime un visuel : la ligne en base ET le fichier sur le disque.
 *
 * POURQUOI LES DEUX : supprimer la ligne seule laisserait le fichier sur le
 * disque pour toujours. C'est le mode d'échec silencieux du risque R6 — le
 * disque se remplit de fichiers que plus aucune interface ne référence, donc
 * personne ne pense à les supprimer.
 *
 * ET SI LE FICHIER EST RÉFÉRENCÉ AILLEURS : on ne le supprime pas. Le schéma
 * n'interdit pas à deux visuels de partager une même URL, et supprimer le
 * fichier d'un autre produit afficherait une image cassée chez lui. On compte
 * donc les lignes restantes qui pointent sur l'URL avant de toucher au disque.
 * Le fichier n'est effacé que s'il n'est plus référencé du tout.
 *
 * Compactage : les rangs restants sont réécrits 0..n-2 pour ne pas laisser de
 * trou (AC explicite). On remonte les rangs en ordre croissant : chaque rang
 * libéré est occupé par la ligne suivante, donc la contrainte d'unicité n'est
 * jamais violée, même une instruction à la fois.
 */
export async function deleteProductImage(input: {
  productId: string;
  imageId: string;
  userId: string;
}): Promise<OperationOutcome<ProductImageDto[]>> {
  const image = await prisma.productImage.findFirst({
    where: { id: input.imageId, productId: input.productId },
    select: { id: true, url: true, sizeBytes: true, position: true },
  });
  if (!image) {
    return fail(404, "VISUEL_INTROUVABLE", "Cette photo n'existe plus pour ce produit.");
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.productImage.delete({ where: { id: image.id } });

      const remaining = await tx.productImage.findMany({
        where: { productId: input.productId },
        orderBy: [{ position: "asc" }, { createdAt: "asc" }],
        select: { id: true },
      });
      for (let index = 0; index < remaining.length; index += 1) {
        await tx.productImage.update({
          where: { id: remaining[index]!.id },
          data: { position: index },
        });
      }

      await writeAuditLog(tx, {
        userId: input.userId,
        action: "product.image.delete",
        entity: "ProductImage",
        entityId: image.id,
        diff: { productId: input.productId, url: image.url, position: image.position },
      });
    });
  } catch (error) {
    console.error("[product-images] suppression en base impossible", error);
    return fail(500, "SUPPRESSION_IMPOSSIBLE", "Impossible de supprimer la photo.");
  }

  // Le fichier n'est supprimé que s'il n'est plus référencé par AUCUNE ligne.
  if (image.sizeBytes !== null && isSafeGeneratedFileName(fileNameFromUrl(image.url))) {
    const stillReferenced = await prisma.productImage.count({ where: { url: image.url } });
    if (stillReferenced === 0) {
      await removeFileQuietly(path.join(resolveUploadRoot(), fileNameFromUrl(image.url)));
    }
  }

  return { ok: true, value: await listProductImages(input.productId) };
}

/**
 * Nom de fichier extrait d'une URL de visuel, ou chaîne vide si l'URL n'est pas
 * la nôtre. Le test `isSafeGeneratedFileName` qui suit empêche toute traversée
 * de répertoire : même si une URL en base avait été forgée à la main
 * (`/uploads/products/../../.env`), on ne la suit pas pour aller supprimer un
 * fichier en dehors du répertoire des téléversements.
 */
export function fileNameFromUrl(url: string): string {
  if (!url.startsWith(`${UPLOADS_URL_PREFIX}/`)) return "";
  return url.slice(UPLOADS_URL_PREFIX.length + 1);
}
