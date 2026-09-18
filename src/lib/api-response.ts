import { NextResponse } from "next/server";

/**
 * Réponses d'erreur JSON uniformes du back-office.
 *
 * POURQUOI UN HELPER : chaque route admin doit renvoyer la même forme
 * (`{ error, code }`) pour que le client distingue un refus d'autorisation
 * d'une validation échouée sans lire le texte français. `code` est stable et
 * destiné au code client ; `error` est destiné à l'humain.
 */
export type ApiFailure = {
  ok: false;
  code: string;
  message: string;
  status: number;
};

/** Transforme un échec de service en réponse HTTP. */
export function jsonFailure(failure: Pick<ApiFailure, "code" | "message" | "status">): NextResponse {
  return NextResponse.json({ error: failure.message, code: failure.code }, { status: failure.status });
}
