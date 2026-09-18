import { NextResponse, type NextRequest } from "next/server";

import { requireApiCapability } from "@/server/guards";
import {
  MAX_UPLOAD_BYTES,
  MULTIPART_OVERHEAD_BYTES,
  createProductImage,
  getUploadsUsage,
  listProductImages,
} from "@/server/product-images";

export const dynamic = "force-dynamic";

/**
 * `true` si la valeur de formulaire est un fichier téléversé.
 *
 * POURQUOI ON TESTE LA CAPACITÉ ET NON LA CLASSE `File` : selon le client et
 * le runtime, l'objet reçu peut venir d'une implémentation différente de celle
 * du module (polyfill undici, runtime Edge…). Un `instanceof File` échouerait
 * alors sur un fichier parfaitement valide, et l'erreur serait incompréhensible
 * pour la marchande. On vérifie donc ce dont on a besoin : `arrayBuffer()` et
 * un nom. Le contrôle reste STRICT — une chaîne de caractères (le cas d'un
 * champ texte glissé dans le formulaire) n'a pas d'`arrayBuffer`.
 */
function isFileLike(value: FormDataEntryValue | null): value is File {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as File).name === "string" &&
    typeof (value as File).arrayBuffer === "function"
  );
}

/**
 * GET  /api/admin/products/[id]/images — visuels du produit + consommation du quota.
 * POST /api/admin/products/[id]/images — téléversement d'une photo (multipart).
 *
 * Capacité `products:write` (ADMIN) : STAFF ne gère pas le catalogue (§13).
 *
 * LE HANDLER RESTE MINCE (CONVENTIONS §2) : il parse, appelle `src/server/`,
 * traduit le résultat. Aucun contrôle de sécurité n'est écrit ici — ils
 * vivent tous dans `src/server/product-images.ts`, à un seul endroit, pour
 * qu'on ne puisse pas en oublier un en ajoutant une route.
 */

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  // Lecture des visuels : le quota affiché fait partie de l'écran d'édition
  // du produit, donc `products:read` suffit pour la lecture.
  const access = await requireApiCapability(req, "products:read");
  if (!access.ok) return access.response;

  const [images, usage] = await Promise.all([
    listProductImages(params.id),
    getUploadsUsage(),
  ]);

  return NextResponse.json({ images, usage });
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const access = await requireApiCapability(req, "products:write");
  if (!access.ok) return access.response;

  // ── Refus précoce sur la taille ANNONCÉE ────────────────────────────────
  // POURQUOI CE CONTRÔLE AVANT LA LECTURE : `req.formData()` matérialise tout
  // le corps de la requête en mémoire. Sans ce garde-fou, un POST de 2 Go
  // serait entièrement tamponné AVANT qu'on puisse dire « trop gros » — et le
  // conteneur tomberait en OOM, ce qui est précisément le déni de service
  // visé par le risque R6. L'en-tête est fourni par le client, donc il ne
  // remplace PAS le contrôle sur les octets reçus (fait plus bas) : il sert
  // seulement à refuser les évidences sans rien allouer.
  const declaredLength = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_UPLOAD_BYTES + MULTIPART_OVERHEAD_BYTES) {
    return NextResponse.json(
      {
        error:
          "Photo trop lourde. La limite est de 5 Mo par photo : réduisez la photo " +
          "avant de l'envoyer.",
        code: "TAILLE_DEPASSEE",
      },
      { status: 413 },
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { error: "Requête invalide : un envoi de photo multipart est attendu.", code: "REQUETE_INVALIDE" },
      { status: 400 },
    );
  }

  const altField = form.get("alt");
  const fileField = form.get("file");

  if (!isFileLike(fileField)) {
    return NextResponse.json(
      {
        error: "Aucune photo reçue. Choisissez un fichier avant de valider.",
        code: "FICHIER_MANQUANT",
      },
      { status: 400 },
    );
  }

  // NOTE DE SÉCURITÉ : on ne lit NI `fileField.type` (Content-Type déclaré par
  // le client), NI `fileField.name` (extension). Les deux sont contrôlés par
  // l'appelant, donc falsifiables, et ne sont utilisés nulle part pour
  // décider. Le type est déduit des octets, le nom est généré.
  const bytes = new Uint8Array(await fileField.arrayBuffer());

  const result = await createProductImage({
    productId: params.id,
    bytes,
    alt: typeof altField === "string" ? altField : "",
    userId: access.user.id,
    originalName: fileField.name,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
  }

  return NextResponse.json({ image: result.value }, { status: 201 });
}
