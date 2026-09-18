import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireCustomerApi } from "@/lib/customer-auth";
import { submitReview } from "@/server/reviews";

export const dynamic = "force-dynamic";

/**
 * POST /api/account/reviews — dépôt d'un avis client (chantier F, F2).
 *
 * LES QUATRE DÉFENSES DE CETTE ROUTE, dans l'ordre où elles s'exécutent :
 *
 * 1. SESSION CLIENT OBLIGATOIRE (401 sans cookie valide). Pas de dépôt
 *    anonyme : l'avis doit pouvoir être rattaché à quelqu'un, sinon la
 *    modération devient un mur sans interlocuteur.
 * 2. LA COMMANDE EST RELUE EN BASE AVEC LE `customerId` DE LA SESSION, jamais
 *    avec un `customerId` fourni dans le corps (voir `submitReview`). Un
 *    `orderId` reçu du client n'est qu'une DÉCLARATION : c'est la requête
 *    `where: { id, customerId }` qui en fait une preuve d'achat.
 * 3. `orderId` et `productId` sont obligatoires au schéma : l'avis « non
 *    rattaché à une commande » n'existe pas dans l'API (le modèle le tolère
 *    pourtant — `Review.orderId` est nullable —, c'est ici que la règle du PO
 *    est appliquée : aucun avis sans preuve d'achat).
 * 4. Le doublon est refusé avec un message clair (409) : contrainte
 *    `@@unique([productId, customerId])` doublée d'un contrôle applicatif,
 *    pour ne jamais renvoyer un 500 à un double clic.
 *
 * Le corps de la requête ne contient JAMAIS le statut, le nom du modérateur ni
 * l'auteur de l'avis : un client ne choisit pas son statut de publication.
 */

const submissionSchema = z.object({
  orderId: z.string().trim().min(1, "Commande manquante"),
  productId: z.string().trim().min(1, "Produit manquant"),
  // La note est validée finement dans le domaine (`validateReviewInput`) : le
  // schéma se contente de refuser ce qui n'est pas un entier, pour que le
  // message d'erreur reste unique et cohérent avec le formulaire.
  rating: z.number().int(),
  title: z.string().nullable().optional(),
  body: z.string(),
  authorName: z.string(),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  const customer = await requireCustomerApi(req);
  if (!customer) {
    return NextResponse.json(
      { error: "Connectez-vous pour laisser un avis sur une commande.", code: "UNAUTHENTICATED" },
      { status: 401 },
    );
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Body JSON invalide", code: "INVALID_JSON" }, { status: 400 });
  }

  const parsed = submissionSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Champs invalides",
        code: "INVALID_INPUT",
        details: parsed.error.flatten().fieldErrors,
      },
      { status: 400 },
    );
  }

  const result = await submitReview({
    // L'identité vient de la session : le corps de la requête ne peut pas la
    // désigner (pas de `customerId` dans le schéma, volontairement).
    customerId: customer.id,
    orderId: parsed.data.orderId,
    productId: parsed.data.productId,
    rating: parsed.data.rating,
    title: parsed.data.title ?? null,
    body: parsed.data.body,
    authorName: parsed.data.authorName,
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.message, code: result.code, details: result.errors },
      { status: result.status },
    );
  }

  // Message explicite d'attente de modération (F2) : le client doit savoir que
  // son avis n'est pas perdu, et pourquoi il n'apparaît pas encore.
  return NextResponse.json(
    {
      review: { id: result.review.id, status: result.review.status },
      message: "Merci, votre avis sera publié après vérification.",
    },
    { status: 201 },
  );
}
