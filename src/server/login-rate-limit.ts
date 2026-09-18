import { prisma } from "@/lib/db";

/**
 * Limitation des tentatives de connexion au back-office.
 *
 * MENACE : sans plafond, un mot de passe se teste en boucle. Le mot de passe
 * admin est la SEULE barrière du back-office (il donne accès à toutes les
 * commandes, donc aux coordonnées de tous les clients), et il est court par
 * défaut en démo.
 *
 * DEUX COMPTEURS, parce qu'ils couvrent deux attaques différentes :
 *   - par identifiant : « je vise ce compte précis » (admin@shop.local)
 *   - par adresse IP  : « je teste 500 emails avec le même mot de passe »
 * Un plafond par email seul laisse passer le bourrage d'identifiants ; un
 * plafond par IP seul laisse un attaquant distribué viser un compte unique.
 *
 * Le stockage est EN BASE, pas en mémoire : Next.js peut servir la route
 * depuis plusieurs workers, donc un compteur en RAM se contourne en tombant
 * sur un autre worker au fil des essais.
 *
 * PORTÉE (`scope`) : le back-office et l'espace client partagent la même table
 * mais PAS le même compteur. Sans ce cloisonnement, un attaquant qui sature le
 * quota d'un email côté client bloquerait la connexion admin du même
 * identifiant (et inversement) : un déni de service gratuit offert par le
 * mécanisme censé protéger. `scope` vaut "admin" par défaut, ce qui préserve
 * exactement le comportement historique du back-office.
 */

/** Fenêtre glissante d'observation. */
const WINDOW_MS = 15 * 60 * 1000;
/** Échecs tolérés par identifiant dans la fenêtre avant blocage. */
const MAX_FAILURES_PER_IDENTIFIER = 5;
/** Échecs tolérés par IP dans la fenêtre (plus large : un bureau partage une IP). */
const MAX_FAILURES_PER_IP = 20;

/** Portée par défaut : le back-office (comportement historique inchangé). */
export const ADMIN_RATE_LIMIT_SCOPE = "admin";
/** Portée de l'espace client — seuils comptés séparément de l'admin. */
export const CUSTOMER_RATE_LIMIT_SCOPE = "customer";

export type RateLimitVerdict =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number; scope: "identifier" | "ip" };

/**
 * Vérifie si une tentative est autorisée. À appeler AVANT de vérifier le mot
 * de passe, et à enregistrer ensuite quel que soit le résultat.
 *
 * `scope` isole les compteurs par espace (`admin` / `customer`) : les deux
 * partagent la table `LoginAttempt` mais jamais un quota.
 */
export async function checkLoginRateLimit(params: {
  identifier: string;
  ip: string | null;
  scope?: string;
}): Promise<RateLimitVerdict> {
  const identifier = params.identifier.trim().toLowerCase();
  const scope = params.scope ?? ADMIN_RATE_LIMIT_SCOPE;
  const since = new Date(Date.now() - WINDOW_MS);

  const [byIdentifier, byIp] = await Promise.all([
    prisma.loginAttempt.count({
      where: { scope, identifier, succeeded: false, createdAt: { gte: since } },
    }),
    params.ip
      ? prisma.loginAttempt.count({
          where: { scope, ip: params.ip, succeeded: false, createdAt: { gte: since } },
        })
      : Promise.resolve(0),
  ]);

  if (byIdentifier >= MAX_FAILURES_PER_IDENTIFIER) {
    return {
      allowed: false,
      retryAfterSeconds: await secondsUntilOldestExpires(scope, identifier, "identifier"),
      scope: "identifier",
    };
  }
  if (byIp >= MAX_FAILURES_PER_IP) {
    return {
      allowed: false,
      retryAfterSeconds: await secondsUntilOldestExpires(scope, identifier, "ip", params.ip),
      scope: "ip",
    };
  }
  return { allowed: true };
}

/**
 * Délai avant qu'une tentative redevienne possible.
 *
 * On vise l'expiration de la PLUS ANCIENNE tentative échouée de la fenêtre :
 * c'est elle qui sortira la première du compteur, donc le moment où l'attaquant
 * récupère un essai. Annoncer un délai plus long serait mentir à l'utilisateur
 * légitime, plus court laisserait l'attaquant insister pour rien.
 */
async function secondsUntilOldestExpires(
  scope: string,
  identifier: string,
  by: "identifier" | "ip",
  ip?: string | null,
): Promise<number> {
  const since = new Date(Date.now() - WINDOW_MS);
  const where =
    by === "identifier"
      ? { scope, identifier, succeeded: false, createdAt: { gte: since } }
      : { scope, ip: ip ?? undefined, succeeded: false, createdAt: { gte: since } };

  const oldest = await prisma.loginAttempt.findFirst({
    where,
    orderBy: { createdAt: "asc" },
    select: { createdAt: true },
  });
  if (!oldest) return 0;

  const unlocksAt = oldest.createdAt.getTime() + WINDOW_MS;
  return Math.max(1, Math.ceil((unlocksAt - Date.now()) / 1000));
}

/**
 * Enregistre une tentative. `succeeded: true` remet le compteur à zéro.
 *
 * La remise à zéro est elle aussi cloisonnée par `scope` : un client qui
 * s'authentifie ne doit pas effacer les traces d'attaque sur le compte admin
 * qui porte le même email.
 */
export async function recordLoginAttempt(params: {
  identifier: string;
  succeeded: boolean;
  ip: string | null;
  scope?: string;
}): Promise<void> {
  const identifier = params.identifier.trim().toLowerCase();
  const scope = params.scope ?? ADMIN_RATE_LIMIT_SCOPE;

  if (params.succeeded) {
    // Une connexion réussie efface l'ardoise : l'utilisateur légitime qui s'est
    // trompé 4 fois ne doit pas rester à un essai du blocage pendant 15 min.
    await prisma.loginAttempt.deleteMany({ where: { scope, identifier, succeeded: false } });
    return;
  }

  await prisma.loginAttempt.create({
    data: { scope, identifier, succeeded: false, ip: params.ip },
  });
}

/**
 * Extrait l'IP cliente derrière le tunnel Cloudflare.
 *
 * `cf-connecting-ip` est posé par Cloudflare et remplace `x-forwarded-for`,
 * qu'un client peut falsifier. On lit quand même `x-forwarded-for` en dernier
 * recours (accès direct au serveur, hors tunnel) en prenant la PREMIÈRE valeur,
 * qui est l'origine réelle de la chaîne.
 */
export function clientIpFromHeaders(headers: Headers): string | null {
  const cf = headers.get("cf-connecting-ip");
  if (cf) return cf.trim();
  const xff = headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    return first && first.length > 0 ? first : null;
  }
  return null;
}

/** Purge les tentatives anciennes (appelée à l'occasion, pas de cron requis). */
export async function pruneOldLoginAttempts(): Promise<number> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const { count } = await prisma.loginAttempt.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });
  return count;
}
