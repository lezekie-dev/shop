/**
 * Normalisation des identifiants email du back-office.
 *
 * POURQUOI UN MODULE DÉDIÉ : l'email est une CLÉ (contrainte unique en base et
 * identifiant de connexion). Si la création normalise mais que la connexion ne
 * normalise pas, deux écritures différentes désignent la même personne et le
 * login échoue sur un compte qui existe pourtant. Une seule définition, deux
 * appelants (`src/server/admin-users.ts`, `/api/admin/login`).
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
