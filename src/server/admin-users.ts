import { Prisma, type Role } from "@prisma/client";

import { hashPassword } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { normalizeEmail } from "@/lib/email";
import { writeAuditLog } from "@/server/audit-log";

/**
 * Gestion des utilisateurs du back-office (capacités `users:read` / `users:write`,
 * réservées à ADMIN — cf. `src/domain/access.ts`).
 *
 * DEUX INVARIANTS PORTENT TOUT CE FICHIER :
 *
 * 1. ON NE SUPPRIME JAMAIS UN UTILISATEUR, ON LE DÉSACTIVE (`active = false`).
 *    `AuditLog.userId` référence l'utilisateur : supprimer la ligne rendrait
 *    orphelin l'historique de ses actions (qui a remboursé cette commande ?)
 *    et l'on perdrait la réponse au moment où elle devient importante.
 *
 * 2. ON NE PEUT PAS FERMER LA BOUTIQUE PAR MÉGARDE. Désactiver ou rétrograder
 *    le DERNIER administrateur actif rendrait le back-office inadministrable
 *    (plus personne pour réactiver un compte, changer un prix ou rembourser).
 *    Ce n'est pas une validation de formulaire : c'est un état global, donc le
 *    contrôle est fait ici, en base, dans la transaction qui écrit.
 */

export type AdminUserSummary = {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  active: boolean;
  /** `true` seulement si le premier code a été validé (`totpEnabledAt` non nul). */
  totpEnabled: boolean;
  /** Enrôlement commencé mais jamais confirmé : la 2FA n'est PAS active. */
  totpPending: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
};

export type UserMutationFailureCode =
  | "NOT_FOUND"
  | "EMAIL_TAKEN"
  | "LAST_ADMIN"
  | "CONCURRENT_CHANGE";

export type UserMutationFailure = {
  ok: false;
  code: UserMutationFailureCode;
  message: string;
  status: number;
};

export type UserMutationResult = { ok: true; user: AdminUserSummary } | UserMutationFailure;

const userSummarySelect = {
  id: true,
  email: true,
  name: true,
  role: true,
  active: true,
  totpSecret: true,
  totpEnabledAt: true,
  lastLoginAt: true,
  createdAt: true,
} as const;

type UserSummaryRow = {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  active: boolean;
  totpSecret: string | null;
  totpEnabledAt: Date | null;
  lastLoginAt: Date | null;
  createdAt: Date;
};

/** Le secret TOTP ne sort JAMAIS de la base par ce chemin : on n'expose que
 * l'état (actif / en cours / absent). */
function toSummary(row: UserSummaryRow): AdminUserSummary {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    active: row.active,
    totpEnabled: row.totpEnabledAt !== null,
    totpPending: row.totpEnabledAt === null && row.totpSecret !== null,
    lastLoginAt: row.lastLoginAt,
    createdAt: row.createdAt,
  };
}

/**
 * Liste des utilisateurs internes : administrateurs d'abord, puis alphabétique.
 */
export async function listAdminUsers(): Promise<AdminUserSummary[]> {
  const users = await prisma.user.findMany({
    // L'ordre d'un enum Prisma suit l'ordre de déclaration (ADMIN avant STAFF).
    orderBy: [{ role: "asc" }, { email: "asc" }],
    select: userSummarySelect,
  });
  return users.map(toSummary);
}

export async function getAdminUser(id: string): Promise<AdminUserSummary | null> {
  const user = await prisma.user.findUnique({ where: { id }, select: userSummarySelect });
  return user ? toSummary(user) : null;
}

/** Nombre d'administrateurs actifs — sert à expliquer la règle du dernier
 * admin dans l'UI AVANT que l'utilisateur ne tente l'action. */
export async function countActiveAdmins(): Promise<number> {
  return prisma.user.count({ where: { role: "ADMIN", active: true } });
}

export type CreateAdminUserInput = {
  email: string;
  name?: string | null;
  role: Role;
  password: string;
};

/**
 * Crée un utilisateur interne. Le mot de passe est haché AVANT d'ouvrir la
 * transaction : bcrypt est volontairement lent (~100 ms), et le garder dans une
 * transaction ouverte immobiliserait une connexion de pool pour rien.
 */
export async function createAdminUser(params: {
  actorId: string;
  input: CreateAdminUserInput;
}): Promise<UserMutationResult> {
  const email = normalizeEmail(params.input.email);
  const passwordHash = await hashPassword(params.input.password);
  const name = params.input.name?.trim() ? params.input.name.trim() : null;

  try {
    const created = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { email, name, role: params.input.role, passwordHash, active: true },
        select: userSummarySelect,
      });

      await writeAuditLog(tx, {
        userId: params.actorId,
        action: "user.create",
        entity: "User",
        entityId: user.id,
        // JAMAIS de mot de passe ni de hash ici : la piste d'audit est lisible
        // par tout ADMIN et n'a aucune raison de contenir un secret.
        diff: { after: { email: user.email, name: user.name, role: user.role, active: user.active } },
      });

      return user;
    });

    return { ok: true, user: toSummary(created) };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return {
        ok: false,
        code: "EMAIL_TAKEN",
        message: "Cet email est déjà utilisé par un autre utilisateur",
        status: 409,
      };
    }
    throw err;
  }
}

export type UpdateAdminUserInput = {
  name?: string | null;
  email?: string;
  role?: Role;
  active?: boolean;
};

/**
 * Modifie un utilisateur (nom, email, rôle, activation).
 *
 * TRANSACTION `Serializable` + RETRY (cf. CONVENTIONS §12) : le contrôle
 * « reste-t-il un autre admin actif ? » est un LECTURE-PUIS-ÉCRITURE globale.
 * En Read Committed, deux rétrogradations simultanées liraient chacune « il
 * reste l'autre » et la boutique se retrouverait sans administrateur — un
 * write skew classique. Serializable fait échouer l'une des deux en 40001
 * (Prisma : P2034) ; le retry la rejoue, relit le compte à jour et répond
 * proprement LAST_ADMIN.
 */
export async function updateAdminUser(params: {
  actorId: string;
  targetId: string;
  patch: UpdateAdminUserInput;
}): Promise<UserMutationResult> {
  const email = params.patch.email !== undefined ? normalizeEmail(params.patch.email) : undefined;
  const name =
    params.patch.name === undefined ? undefined : params.patch.name?.trim() ? params.patch.name.trim() : null;

  return withSerializableRetry(async (tx) => {
    const target = await tx.user.findUnique({
      where: { id: params.targetId },
      select: userSummarySelect,
    });
    if (!target) {
      return failure("NOT_FOUND", "Utilisateur introuvable", 404);
    }

    if (email !== undefined && email !== target.email) {
      const clash = await tx.user.findUnique({ where: { email }, select: { id: true } });
      if (clash) {
        return failure("EMAIL_TAKEN", "Cet email est déjà utilisé par un autre utilisateur", 409);
      }
    }

    // Quels champs changent réellement ? On ne journalise (et n'écrit) que s'il
    // y a un changement : une sauvegarde sans modification ne doit pas polluer
    // la piste d'audit d'une ligne « user.update » vide.
    const nextRole = params.patch.role ?? target.role;
    const nextActive = params.patch.active ?? target.active;
    const nextEmail = email ?? target.email;
    const nextName = name === undefined ? target.name : name;
    const changed: string[] = [];
    if (nextRole !== target.role) changed.push("role");
    if (nextActive !== target.active) changed.push("active");
    if (nextEmail !== target.email) changed.push("email");
    if (nextName !== target.name) changed.push("name");

    if (changed.length === 0) {
      return { ok: true, user: toSummary(target) };
    }

    // RÈGLE DU DERNIER ADMIN : seule une perte de droit ADMIN ACTIF compte.
    // Renommer le dernier admin reste possible (ce n'est pas une perte de droit).
    const losesActiveAdmin = target.role === "ADMIN" && target.active && (nextRole !== "ADMIN" || !nextActive);
    if (losesActiveAdmin) {
      const otherActiveAdmins = await tx.user.count({
        where: { role: "ADMIN", active: true, id: { not: target.id } },
      });
      if (otherActiveAdmins === 0) {
        return failure(
          "LAST_ADMIN",
          "Impossible : c'est le dernier administrateur actif. Créez ou réactivez un autre administrateur d'abord, sinon la boutique ne serait plus administrable.",
          409,
        );
      }
    }

    const updated = await tx.user.update({
      where: { id: target.id },
      data: {
        ...(params.patch.role !== undefined ? { role: params.patch.role } : {}),
        ...(params.patch.active !== undefined ? { active: params.patch.active } : {}),
        ...(email !== undefined ? { email } : {}),
        ...(name !== undefined ? { name } : {}),
      },
      select: userSummarySelect,
    });

    // Désactivation = révocation immédiate : on supprime les sessions du
    // compte. Sans ça, un compte fermé (départ d'un employé, soupçon de
    // compromission) resterait utilisable jusqu'à l'expiration du cookie.
    // Les gardes revérifient `active` de toute façon, mais supprimer la session
    // ferme aussi la porte au vol de cookie répliqué.
    if (target.active && !updated.active) {
      await tx.session.deleteMany({ where: { userId: updated.id } });
    }

    await writeAuditLog(tx, {
      userId: params.actorId,
      action: "user.update",
      entity: "User",
      entityId: updated.id,
      diff: {
        before: {
          email: target.email,
          name: target.name,
          role: target.role,
          active: target.active,
        },
        after: {
          email: updated.email,
          name: updated.name,
          role: updated.role,
          active: updated.active,
        },
        changed,
      },
    });

    return { ok: true, user: toSummary(updated) };
  });
}

function failure(code: UserMutationFailureCode, message: string, status: number): UserMutationFailure {
  return { ok: false, code, message, status };
}

/**
 * Transaction `Serializable` avec retry borné (CONVENTIONS §12 : 3 tentatives,
 * backoff 50 ms puis 150 ms, et UNIQUEMENT sur un conflit de sérialisation).
 *
 * Pourquoi une copie locale plutôt que `src/lib/db.ts` : le helper partagé
 * suppose un accord d'équipe (il est noté « à créer en S2 » dans les
 * conventions) et ce fichier-ci n'a pas à éditer un module transverse pendant
 * que d'autres chantiers le modifient. Le jour où `withSerializableRetry`
 * arrive dans `lib/db.ts`, cette fonction disparaît au profit de l'import.
 */
async function withSerializableRetry<T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  const backoffMs = [50, 150];
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await prisma.$transaction(fn, { isolationLevel: "Serializable" });
    } catch (err) {
      const isSerializationFailure =
        err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2034";
      if (!isSerializationFailure || attempt === maxAttempts) throw err;
      await new Promise((resolve) => setTimeout(resolve, backoffMs[attempt - 1] ?? 50));
    }
  }

  /* istanbul ignore next — boucle toujours sortie par return ou throw. */
  throw new Error("withSerializableRetry : sortie de boucle impossible");
}
