# ADR-0001 — Auth admin via cookie httpOnly + middleware, pas NextAuth

- **Statut** : Acceptée (Sprint 1)
- **Date** : 2026-09-17
- **Décideurs** : équipe architecture + PO
- **Référence DAT** : §11 ADR-001

## Contexte

Le MVP a un seul rôle applicatif (`ADMIN`), un seul écran de login, et un
back-office utilisé par 1 à 3 personnes (marchand + opérateur). On veut
sécuriser cet accès sans embarquer la complexité d'un framework d'auth
complet.

Contraintes identifiées :
- Pas de connexion sociale (OAuth) au MVP — la marchande gère son compte
  elle-même.
- Pas de "compte client" obligatoire côté boutique (cf. PO-BRIEF Epic C,
  guest checkout) ; un éventuel compte client arrivera en Sprint 4.
- On déploie sur Coolify / VPS, pas Vercel — pas de Serverless Functions
  exotiques.
- `next-auth` (et ses équivalents : Lucia, Clerk, Auth.js) amènent des
  versions mobiles, des adapters, une couche d'abstraction et des breaking
  changes fréquents. Pour un seul rôle, c'est disproportionné.

## Décision

On implémente une **authentification maison minimale** :

- Cookie `admin_session` (nom paramétrable via `SESSION_COOKIE_NAME`).
- Token opaque de 256 bits (généré via `crypto.randomBytes`),
  **haché** avant d'être stocké en base (`SHA-256`).
- Modèle `Session { id, userId, tokenHash, expiresAt, createdAt }`.
- Hash de mot de passe via `bcryptjs`, `BCRYPT_ROUNDS=12` par défaut.
- `src/middleware.ts` protège **les pages** `/admin/*` : présence du cookie
  + non expiré. Si manquant/expiré → redirection `/admin/login`.
- Les **routes API admin** sont re-protégées côté handler via
  `withApi({ requireAdmin: true })` (lookup `Session` en base, pas juste
  le cookie). Le middleware seul ne suffit pas : un appel direct à
  `/api/admin/...` doit aussi être bloqué.
- TTL par défaut `SESSION_TTL_HOURS=24` → re-login quotidien.
- Cookies flags : `HttpOnly; Secure; SameSite=Lax; Path=/`.

## Conséquence

**Positives**
- Aucune dépendance `next-auth` à maintenir ou patcher. ~200 lignes de
  code max pour le module `auth.ts`.
- Contrôle total : on sait exactement ce qui est vérifié et où.
- Migration de schéma simple si on doit ajouter un rôle ou un second
  cookie plus tard (`customer_session`).
- Compatible avec Coolify / Docker, pas de surprise sur les runtimes
  Edge/Serverless.

**Négatives / risques**
- On **réimplémente** de la crypto. Risque d'erreur si on n'utilise pas
  les bons primitives (`crypto.timingSafeEqual` pour la comparaison de
  hash, etc.).
- Pas de 2FA par défaut. Le PO-BRIEF §Epic F1 AC mentionne "2FA TOTP
  recommandé" → ajout en Sprint 4 dans une ADR séparée.
- Pas de rate-limiting sur `/api/admin/auth/login` au MVP → brute-force
  possible. **Mitigation S2** : rate-limit applicatif (5 essais / IP / 10 min).

**Surface de code touchée**
- `src/lib/auth.ts` (hash, cookie, verifySession).
- `src/lib/api.ts` (helper `withApi`).
- `src/middleware.ts` (matcher = `/admin/:path*` **uniquement**,
  pas `/api/admin/*` — cf. CONVENTIONS §11 pour la raison
  Edge runtime vs Node).
- Routes `/api/admin/auth/login`, `/api/admin/auth/logout`.

## Alternatives écartées

| Alternative | Pourquoi écartée |
|-------------|------------------|
| **NextAuth.js / Auth.js v5** | Trop lourd pour un seul rôle. Surface d'attaque plus large (callbacks, providers). Versions instables. Pas de valeur ajoutée quand on n'a pas d'OAuth. |
| **Lucia Auth** | Bonne lib mais apporte des concepts (sessions table adapter, OAuth helpers) qu'on n'utilise pas. Surdimensionné pour 1 rôle. |
| **Clerk / Auth0 / WorkOS** (SaaS) | Dépendance externe payante au-delà du free tier. Données utilisateurs chez un tiers. Mauvais alignement avec "self-hosted sur VPS" du DAT. |
| **Cookie JWT signé (HS256)** auto-implémenté | Plus simple qu'une table `Session` MAIS impossible à révoquer un cookie avant expiration (logout, vol). On veut pouvoir invalider côté serveur → on stocke l'état en base. |
| **Basic Auth derrière reverse proxy** | Mauvaise UX (popup navigateur), pas de logout propre, mots de passe stockés en clair dans le navigateur. |
