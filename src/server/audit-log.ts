import type { Prisma, PrismaClient } from "@prisma/client";

import { prisma } from "@/lib/db";

/**
 * Journal d'audit — porte d'entrée unique vers `AuditLog`.
 *
 * POURQUOI UN HELPER PLUTÔT QU'UN `prisma.auditLog.create` DISPERSÉ : les
 * modèles Prisma tolèrent un `diff` de n'importe quelle forme. Centraliser la
 * signature garantit que (1) l'acteur est toujours renseigné — un log sans
 * `userId` ne répond pas à la seule question qui compte en audit, « qui a
 * fait ça ? » — et (2) aucun secret ne parte dans le JSON : c'est ici qu'on
 * documente l'interdit, au plus près du point d'écriture.
 */

/** Client Prisma ou client de transaction : le log doit pouvoir être écrit
 * dans la MÊME transaction que la modification qu'il décrit, sinon on peut
 * avoir une écriture journalisée qui a échoué (ou l'inverse). */
export type AuditDb = PrismaClient | Prisma.TransactionClient;

export type AuditEntry = {
  /** Auteur de l'action. Jamais nul pour une action sensible du back-office. */
  userId: string;
  /**
   * Action en `domaine.verbe` (ex. `user.2fa.enable`), aligné sur l'existant
   * (`order.mark_shipped`, `product.update`).
   */
  action: string;
  /** Modèle Prisma concerné (`User`, `Product`, `Order`…). */
  entity: string;
  /** Identifiant de la ligne concernée. */
  entityId: string;
  /**
   * Détail avant/après. INTERDIT d'y mettre un mot de passe, un hash de mot de
   * passe ou un secret TOTP : la piste d'audit est lisible par tout ADMIN
   * (capacité `audit-log:read`) et survit à la rotation des secrets.
   */
  diff?: Prisma.InputJsonValue;
};

/** Écrit une ligne d'audit. Ne lève jamais pour un problème de forme du diff :
 * l'appelant, lui, laisse remonter une vraie erreur DB (elle doit annuler sa
 * transaction). */
export async function writeAuditLog(db: AuditDb, entry: AuditEntry): Promise<void> {
  await db.auditLog.create({
    data: {
      userId: entry.userId,
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId,
      diff: entry.diff ?? undefined,
    },
  });
}

/** Point d'accès pratique quand on n'est pas dans une transaction. */
export function auditLogWithDefaultClient(entry: AuditEntry): Promise<void> {
  return writeAuditLog(prisma, entry);
}
