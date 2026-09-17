# CONVENTIONS — Équipe Shop

> **Verrouillage des règles de collaboration** pour que 4 devs codent en
> parallèle sans se marcher dessus. Ce document est **contractuel** : toute PR
> qui le contrevient est revue même si elle passe les tests.
>
> Source de vérité de l'architecture : `docs/team/ARCHITECTURE.md` (DAT).
> Source de vérité du produit : `docs/team/PO-BRIEF.md`.
>
> **Statut** : verrouillé Sprint 1. Toute modification passe par un ADR.

---

## Table des matières

1. [Nommage](#1-nommage)
2. [Structure de dossiers — règles d'or](#2-structure-de-dossiers--règles-dor)
3. [Stratégie de branches](#3-stratégie-de-branches)
4. [Format de commit (Conventional Commits)](#4-format-de-commit-conventional-commits)
5. [Gestion de l'argent — minor units ISO 4217](#5-gestion-de-largent--minor-units-iso-4217)
6. [Gestion des erreurs](#6-gestion-des-erreurs)
7. [Style de code](#7-style-de-code)
8. [Tests — quoi tester, où](#8-tests--quoi-tester-où)
9. [Ce qu'on ne fait PAS sans ADR](#9-ce-quon-ne-fait-pas-sans-adr)
10. [Vie de l'équipe — rituels](#10-vie-de-léquipe--rituels)
11. [Middleware — ce qu'il couvre, ce qu'il ne couvre PAS](#11-middleware--ce-quil-couvre-ce-quil-ne-couvre-pas)
12. [Transactions PostgreSQL — `Serializable` + retry borné](#12-transactions-postgresql--serializable--retry-borné)
13. [Capacités par rôle — matrice STAFF / ADMIN](#13-capacités-par-rôle--matrice-staff--admin)
14. [Cartographie des dépendances par carte](#14-cartographie-des-dépendances-par-carte)

---

---

## 1. Nommage

### Fichiers et dossiers

- **kebab-case** pour tout ce qui n'est pas code : `cart-button.tsx`,
  `checkout-success/`, `prisma-test.ts`, `adr-0001-…md`.
- Code TypeScript : on suit la convention Next.js par défaut —
  `PascalCase` pour composants React (`CartButton.tsx`),
  `camelCase` pour les utilitaires (`parseSession.ts`).
- Un fichier = une responsabilité exportée. Pas de `utils.ts` fourre-tout.

### Identifiants base / API / types

- **Modèles Prisma** : `PascalCase`, singulier (`Order`, pas `Orders`).
- **Champs / DTOs** : `camelCase`. Snapshots en `PascalCase` suffixe `Snapshot`
  (`productNameSnapshot`).
- **Enums Prisma** : `PascalCase` pour le nom (`OrderStatus`), `SCREAMING_SNAKE`
  pour les valeurs (`PENDING_PAYMENT`).
- **Endpoints** : `kebab-case` pour les segments d'URL, **pluriel pour les
  collections** (`/api/admin/products`, `/api/cart/items`),
  **singulier pour les ressources par id** (`/api/products/[slug]`).
- **Variables d'env** : `SCREAMING_SNAKE_CASE`. Tout ce qui commence par
  `NEXT_PUBLIC_` est exposé au bundle client → **aucun secret**.

### Variables et fonctions TypeScript

- Fonctions = verbes (`computeTotal`, `reserveStock`).
- Booléens = adjectifs/états (`isActive`, `canRefund`).
- Pas d'abréviations obscures : `customerId` plutôt que `custId`.
- Fonctions pures du domaine = **un seul niveau d'abstraction**, pas de
  flag à 4 valeurs ; on fait plusieurs fonctions.

---

## 2. Structure de dossiers — règles d'or

L'arborescence est imposée par le DAT §1. Les trois règles suivantes sont
**non négociables** :

### `src/domain/` — TypeScript pur, AUCUNE dépendance externe

```
import { } from "next"        ← INTERDIT
import { PrismaClient } from  ← INTERDIT
import { } from "@prisma"     ← INTERDIT (sauf types stricts si justifié)
import fs from "node:fs"       ← INTERDIT
```

- Tout module de `src/domain/` prend des **structures de données** en
  entrée et retourne des **structures de données** en sortie.
- Pas de `Date.now()`, pas de `Math.random()`, pas de `process.env`.
- Si une logique a besoin de "l'heure actuelle", elle la reçoit en paramètre
  `now: Date`. Testable sans mock.
- Si une logique a besoin d'aléatoire (id, token), elle prend un
  `randomBytes: () => Buffer` injecté ou utilise un module technique `lib/ids.ts`.

### `src/server/` — orchestration, **seul** endroit qui appelle Prisma en écriture

- Importe `domain/` + `lib/db.ts` + adaptateurs techniques.
- C'est ici qu'on ouvre les `prisma.$transaction`, qu'on appelle
  `PaymentProvider`, qu'on écrit dans `AuditLog`.
- Une fonction de `src/server/` retourne soit un DTO de domaine, soit une
  erreur typée — **jamais** une `Prisma.*KnownRequestError` brute.
- Aucun import depuis `src/app/` ni depuis `src/ui/`.

### `src/app/api/*/route.ts` — FIN

Le handler fait 5 lignes utiles maximum :

```ts
export const POST = withApi({
  requireSession: true,
  schema: AddItemSchema,
}, async ({ body, session }) => {
  const cart = await addToCart({ session, variantId: body.variantId, quantity: body.quantity });
  return { cartId: cart.id, items: cart.items };
});
```

- Parse via `withApi()` (validation zod, auth, logger, erreurs uniformes).
- Délègue à un service de `src/server/`.
- Retourne le DTO. Pas de SQL, pas de calcul métier, pas de `try/catch`
  applicatif (c'est `withApi` qui gère).

### Imports entre couches — règle de la flèche

```
app/api ──► server ──► domain
   │           │           ▲
   └───────────┴───────────┘  (types, jamais runtime)
```

- `app/` ne peut PAS importer `domain/` directement sauf pour des **types**.
- `server/` peut importer `domain/` et `lib/`.
- `domain/` ne peut importer **que** d'autres modules `domain/`.

Cette règle est vérifiée par ESLint (boundary lint) — voir §7.

---

## 3. Stratégie de branches

### Modèle : **Trunk-based + branches courtes**

- `master` = branche principale, toujours verte (CI OK).
- Branches de feature : `wt/<task-id>-<slug-court>` (max 40 caractères).
  - Exemple : `wt/t_88675ec5-conventions`.
  - Une carte kanban = une branche. Deux cartes = deux branches.
- Pas de `develop`, pas de `release/*` au MVP. On déploie `master` directement.
- Branches détruites après merge (pas de cleanup manuel en S1).

### Pull Requests

- Une PR par carte (sauf refactor transverse qui dit pourquoi dans le titre).
- Titre de PR = titre de carte (on évite la traduction).
- **Minimum 1 review** par un dev qui ne code pas la feature.
- Pas de squash merge si on perd l'historique utile ; merge commit avec
  description du ticket.
- La PR doit être **verte en CI** avant review (lint + unit + integration).

### Hotfix prod

- Branche `hotfix/<slug>` depuis `master`.
- PR avec label `HOTFIX`, revue par 2 personnes, déployée en fast-track.
- Post-mortem obligatoire dans `docs/team/RUNBOOK.md` § incidents.

---

## 4. Format de commit (Conventional Commits)

Format **strict** :

```
<type>(<scope>): <description courte au présent, < 72 char>

<body optionnel — pourquoi, pas comment>

<footer optionnel — refs ticket, BREAKING CHANGE, etc.>
```

### Types autorisés

| Type         | Usage                                                  |
|--------------|--------------------------------------------------------|
| `feat`       | Nouvelle fonctionnalité utilisateur                     |
| `fix`        | Correction de bug                                       |
| `chore`      | Tâche sans valeur utilisateur (deps, config, CI)        |
| `docs`       | Documentation uniquement                               |
| `refactor`   | Refactor sans changement de comportement                |
| `test`       | Ajout ou correction de tests sans code de prod          |
| `perf`       | Optimisation mesurable                                  |
| `style`      | Formatage, point-virgule manquant, etc. (pas de CSS)   |
| `build`      | Changement du système de build / Docker                 |
| `ci`         | Changement de pipeline CI                               |
| `revert`     | Annulation d'un commit précédent                        |

### Scopes imposés par le projet

Alignés sur l'arborescence DAT §1 :

- `domain` (pricing, stock, order, payment)
- `server` (services applicatifs)
- `api` (routes)
- `app` (pages)
- `ui` (composants)
- `db` (Prisma, migrations, seeds)
- `auth` (login, sessions, middleware)
- `payment` (Stripe, Mobile Money, webhooks)
- `deps`
- `ci`

### Exemples

```
feat(cart): persistance cookie sessionKey pour panier guest
fix(checkout): webhook stripe en double → idempotence OK
docs(team): conventions, adr, runbook
chore(deps): bump next 14.2.15 → 14.2.16
refactor(domain): extract computeSubtotal depuis checkout.ts
test(payment): ajout unit verifyWebhook signature invalide
```

### Interdits

- ❌ `WIP`, `fix`, `update`, `stuff` comme message.
- ❌ Commit avec 30 fichiers non liés → on découpe.
- ❌ Commit de secret (`.env`, clé Stripe, etc.) → pre-commit hook bloque.
- ❌ Commit de `node_modules`, `.next`, `dist` → `.gitignore`.

---

## 5. Gestion de l'argent — minor units ISO 4217

**Règle absolue** (cf. ADR-0003 amendée — audit D3) :

> Tout prix dans le code et en base est un entier **`Int` minor units
> de la devise ISO 4217**. La devise est un `string` ISO-4217
> (`"EUR"`, `"XAF"`). **Une seule fonction de conversion** existe —
> `toMinorUnits` / `fromMinorUnits` dans `src/domain/money.ts` — et
> c'est l'**unique** point de passage entre forme humaine (`"19.99"`)
> et entier stocké.

### Vocabulaire

- On ne parle **plus** de « centimes » dans le code ni dans les ADR.
  Pour XAF/JPY/KRW ça n'a aucun sens (0 décimale).
- Le type de référence est `Money = { amountMinor: number; currency: string }`.
- Les colonnes DB historiques s'appellent encore `priceCents`,
  `amountCents`, etc. (dette de naming documentée dans ADR-0003). Leur
  sémantique est désormais « **minor units** de la devise portée par
  la ligne ».

### Ce qu'on ne fait JAMAIS

- ❌ `Float` ou `Decimal` pour un prix (rounding cumulatif).
- ❌ `priceEuros: 19.99` — toujours `Money { amountMinor: 1999, currency: "EUR" }`.
- ❌ `amount * 100` ou `amount / 100` **où que ce soit** dans le code.
  Tout passe par `toMinorUnits` / `fromMinorUnits`. C'est la décision
  de l'audit D3 : la même conversion sert au stockage et au paiement,
  donc plus de facteur 100 possible.
- ❌ `Int` de prix **nu** (sans `Money` autour) en dehors de
  `src/domain/money.ts`. Le compilateur TypeScript ne peut pas le
  garantir seul → c'est une règle de code review (cf. §10 checklist).
- ❌ Comparaison de prix entre deux devises sans conversion explicite.
- ❌ Affichage manuel du prix dans un template → on passe par
  `<Money value={money} />` (`src/ui/components/money.tsx`).

### Affichage

- Format français par défaut : `19,99 €` (locale `fr-FR`, currency EUR).
- Format XAF : `12 500 FCFA` (pas de décimales, code `XAF`).
- Le helper `<Money>` est l'unique point de formatage ; **aucun**
  `toLocaleString` direct dans les composants.
- `<Money>` choisit la locale et le nombre de décimales **selon
  `value.currency`**, pas selon un code en dur.

### Calculs

Tous les calculs sont dans `src/domain/pricing.ts`. Tout nouveau calcul
de prix doit y être ajouté et couvert par `tests/unit/pricing.test.ts`.
Les signatures prennent/retournent `Money`.

```ts
// ✅ Correct
const subtotal: Money = computeSubtotal(items); // items: { unitPrice: Money, quantity }[]

// ❌ Interdit
const subtotal = items.reduce((s, i) => s + i.unitPriceEuros * i.quantity, 0);

// ❌ Interdit
const stripeAmount = money.amountMinor * 100; // confusion centimes ↔ major unit
```

### Cohérence Stripe

`Money.amountMinor` est passé **tel quel** à
`PaymentIntent.amount` dans `src/domain/payment/stripe.ts`. Aucune
multiplication, aucune division. Si la valeur est fausse, elle est
fausse au même endroit en DB et côté PSP — un test unitaire sur
l'adaptateur Stripe le détecte immédiatement.

---

## 6. Gestion des erreurs

### Hiérarchie d'erreurs côté `src/domain/`

On **ne lance jamais** `Error("message")` brut. On utilise des erreurs
typées par couche :

```ts
// src/domain/errors.ts (à créer en S2)
export class DomainError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "DomainError";
  }
}

export class InvalidMoneyError extends DomainError {
  constructor(msg: string) { super("INVALID_MONEY", msg); }
}
export class StockUnavailableError extends DomainError {
  constructor(public readonly variantId: string, public readonly available: number) {
    super("STOCK_UNAVAILABLE", `Variant ${variantId}: only ${available} available`);
  }
}
export class InvalidOrderTransitionError extends DomainError {
  constructor(public readonly from: OrderStatus, public readonly to: OrderStatus) {
    super("INVALID_ORDER_TRANSITION", `${from} → ${to} not allowed`);
  }
}
```

### Côté `src/server/`

- On catch les `DomainError` et on les **convertit** en `Result<DTO, AppError>`
  (ou on relance une exception HTTP mappée par `withApi`).
- On catch les `Prisma.PrismaClientKnownRequestError` (contraintes uniques,
  FK) et on les mappe en `AppError` lisible — pas de trace brute au client.
- Toute erreur 5xx est loggée avec **stack trace** + contexte (requestId,
  userId si connu, route).

### Côté `src/app/api/`

`withApi()` (helper `src/lib/api.ts`) fait :
1. Parse + validation zod → 400 + details si invalide.
2. Vérifie auth → 401/403 selon le cas.
3. Exécute le handler dans un `try/catch`.
4. Si `DomainError` → 4xx mappé.
5. Si autre erreur → 500 + log error, **réponse générique** au client
   (`{ error: "internal_error", requestId }`).

### Côté UI

- Erreur API affichée via `<ErrorBanner message={...} />`.
- **Jamais** de `alert("Erreur : " + JSON.stringify(err))` ou de
  `console.error(err)` sans UI dédiée.
- Toute action destructrice (DELETE, cancel order) a une **double
  confirmation** dans l'UI admin.

---

## 7. Style de code

### TypeScript

- `"strict": true` dans `tsconfig.json` (DAT §1). On ne le relâche jamais.
- `"noUncheckedIndexedAccess": true` → force à gérer `arr[i]` qui peut être
  `undefined`.
- `"exactOptionalPropertyTypes": true` → distingue `undefined` de "absent".
- Pas de `any` dans le code committé. `unknown` + narrowing sinon.
- Pas de `as` pour faire taire le compilateur — on type correctement.
- `enum` Prisma uniquement. Côté code, on préfère les **unions de
  string literals** (`type Status = "pending" | "paid"`).

### Formatage

- **Prettier** avec config par défaut du projet (`printWidth: 100`,
  `singleQuote: false`, `trailingComma: "all"`).
- Lancé via `pnpm format` (write) et `pnpm format:check` (CI).
- Pre-commit hook bloque si `format:check` échoue.

### ESLint

- `eslint-config-next` (déjà dans `devDependencies` DAT §6).
- Plugin additionnel `eslint-plugin-boundaries` pour faire respecter la
  règle `app/api → server → domain` (cf. §2).
- Plugin `eslint-plugin-import` pour l'ordre des imports.
- Pas de warning toléré en CI → `--max-warnings 0`.

### Commentaires

- Code = ce qu'il fait ; commentaires = **pourquoi**.
- Pas de commentaire `// TODO` orphelin → soit on ouvre un ticket, soit
  on supprime.
- Chaque fonction publique exportée a un JSDoc minimal :

```ts
/**
 * Calcule le sous-total d'une commande en minor units ISO 4217
 * (cf. ADR-0003 amendée). Ne tient pas compte des remises ni
 * des frais de port.
 */
export function computeSubtotal(items: OrderItem[]): Money { … }
```

### Imports

- Groupes : stdlib externe → packages externes → alias `@/` → relatifs.
- Triés alphabétiquement dans chaque groupe (Prettier `import-sort`).
- Pas d'import cyclique. Si on en a besoin, c'est qu'on a un problème
  d'arborescence.

---

## 8. Tests — quoi tester, où

Pyramide DAT §9 — rappel des **responsabilités** :

| Niveau        | Cible                                  | Pas le droit d'utiliser                  |
|---------------|----------------------------------------|------------------------------------------|
| **Unit**      | `src/domain/**` (pur)                  | Prisma, Next, fetch, `Date.now()`        |
| **Integration** | `src/server/**` + vraie DB jetable    | Stripe réel, navigateur                 |
| **E2E**       | Parcours navigateur réel (Playwright)  | DB partagée, mocks non-isolés            |

### Couverture minimale par carte

- Toute nouvelle fonction de `domain/` : **au moins 3 cas** (nominal,
  limite, erreur).
- Toute nouvelle route API : **au moins 1 test intégration** (succès)
  et **1 test 400** (validation).
- Tout fix de bug : **1 test qui reproduit le bug** avant le fix.

### Helpers obligatoires

- `tests/helpers/prisma-test.ts` : `resetDb()` qui tronque toutes les tables.
- `tests/helpers/stripe-mock.ts` : `mockPaymentProvider()` qui retourne un
  `PaymentProvider` fake (cf. DAT §9).
- `tests/helpers/factories.ts` : `makeProduct()`, `makeOrder()`, etc.
  Retourne des **objets littéraux**, jamais des instances Prisma.

### Convention de nommage des tests

```
<module>.test.ts                    → unit (à côté du module ? NON — dans tests/unit/)
<module>.spec.ts                    → e2e (Playwright, dans tests/e2e/)
```

- `tests/unit/<mirror-of-src-path>.test.ts`
  (ex : `src/domain/pricing.ts` → `tests/unit/domain/pricing.test.ts`).
- `tests/integration/<mirror-of-src-path>.test.ts`.
- `tests/e2e/<flow>.spec.ts`.

### En local

```bash
pnpm test              # unit + integration
pnpm test:unit         # que unit
pnpm test:integration  # que integration
pnpm test:e2e          # playwright
```

---

## 9. Ce qu'on ne fait PAS sans ADR

Une **ADR** (Architecture Decision Record) est un fichier
`docs/decisions/NNNN-<slug>.md` au format contexte · décision ·
conséquence · alternatives écartées. Voir les 5 ADR verrouillées en S1 :
0001 à 0005.

### Nécessite un ADR obligatoire

| Sujet                                                          | Pourquoi c'est un ADR |
|----------------------------------------------------------------|------------------------|
| Changer la stack (remplacer Prisma, Next, Vitest, etc.)        | Impact total sur la codebase |
| Modifier le schéma Prisma (nouveau modèle, FK, enum)           | Migration = risque de perte de données |
| Toucher au pattern `PaymentProvider`                           | Le contrat métier change → clients réels impactés |
| Ajouter une dépendance `dependencies` ou `devDependencies`     | Surface d'attaque + lockfile |
| Changer les règles de `src/domain/`                            | La règle "pur TypeScript" est l'invariant central |
| Modifier la stratégie de tests (niveau, pyramide)              | Change la couverture et la confiance |
| Toucher à l'auth admin (cookie, hashing, middleware)          | Surface d'auth = P0 sécurité |
| Changer la convention de prix (minor units ISO 4217, devise)    | Migration des données existantes |
| Ajouter un nouvel endpoint webhook                             | Idempotence + signature sont non triviaux |
| Modifier les variables d'env ou leur validation                | Boot fail-fast → tout peut casser |

### Processus

1. Ouvrir une PR avec le fichier `docs/decisions/NNNN-<slug>.md`.
2. Discussion dans la PR (review par 1 dev + PO).
3. Une fois mergée, l'ADR a force de convention **jusqu'à ce qu'une
   nouvelle ADR la remplace**.

### Ce qui ne nécessite PAS d'ADR

- Renommer une fonction privée.
- Déplacer un fichier dans la même couche.
- Ajouter un test, une dépendance interne entre fichiers du domaine.
- Changer le wording d'une UI sans impact modèle.
- Refactor local sans changement de comportement (mais → Conventional
  Commits `refactor`).

---

## 10. Vie de l'équipe — rituels

### Daily (15 min, en visio ou chat)

- Hier / aujourd'hui / bloqué.
- On ne débug pas en daily ; on prend un RDV à part.

### War room (kanban)

- Toute question transverse, désaccord, scope creep → **commentaire sur la
  carte kanban**, pas en DM.
- Une carte = un thread de discussion centralisé. Si on sort du thread,
  on perd l'historique.

### Cérémonies de fin de sprint

- Démo interne (30 min) : chaque dev montre ce qu'il a livré en local.
- Rétro : ce qui a marché, ce qui a coincé, 3 actions concrètes pour le
  sprint suivant.
- Mise à jour du `RUNBOOK.md` si on a découvert un cas d'incident.

### Code review — checklist du reviewer

1. **Lisibilité** : un nouveau dev peut-il comprendre ce code en 5 min ?
2. **Bénéfice / risque** : est-ce que la complexité ajoutée vaut le coup ?
3. **Tests** : y a-t-il des cas nominaux ET des cas d'erreur ?
4. **Sécurité** : un input malicieux peut-il passer ? (cf. OWASP top 10).
5. **Conventions** : nommage, formatage, imports, frontières de couches.
6. **ADR** : si la PR change un truc listé §9, l'ADR est-elle mergée ?
7. **Performance** : on charge pas une lib de 200 ko pour formater une
   date ; on évite les `N+1` Prisma.

---

## Annexe — commandes utiles

```bash
# Setup local (DAT annexe)
pnpm install
docker compose up -d postgres
pnpm prisma migrate dev
pnpm prisma db seed

# Qualité
pnpm lint                # ESLint
pnpm format              # Prettier write
pnpm format:check        # Prettier check (CI)
pnpm typecheck           # tsc --noEmit
pnpm test                # unit + integration
pnpm test:e2e            # Playwright

# Branche + PR
git checkout -b wt/<task-id>-<slug>
git push -u origin HEAD
gh pr create --title "<titre carte>" --body "…"
```

---

*Document rédigé en Sprint 1, validé par toute l'équipe. Toute
modification passe par une PR avec ADR si elle touche un sujet de §9.*

---

## 11. Middleware — ce qu'il couvre, ce qu'il ne couvre PAS

> Ajouté en Sprint 1 carte S1-014 (audit D2). Source : ADR-0001 +
> arbitrage chief post-audit.

**Règle** : `src/middleware.ts` ne couvre que les **pages**
`/admin/:path*`. Les routes `/api/admin/*` sont protégées
**uniquement** par `withApi({ requireAdmin: true })` côté handler.

### Pourquoi le middleware Next 14 ne couvre PAS les routes API

Le middleware Next.js (Edge runtime) s'exécute **avant** la résolution
de la route, mais sur Next 14 App Router :

- Pour matcher `/api/admin/*` depuis le middleware, on est tenté
  d'écrire `matcher: ["/admin/:path*", "/api/admin/:path*"]` et de
  faire `if (pathname.startsWith("/api/admin")) return NextResponse…`.
- **Problème** : le middleware s'exécute en Edge runtime, qui n'a
  **pas accès** à la DB Postgres (pas de driver Node natif, pas de
  `crypto` complet). On ne peut donc pas y faire le `lookup Session`
  dont on a besoin pour valider le cookie. Tout ce qu'on peut faire
  côté middleware = vérifier la **présence** du cookie. Pas sa
  validité. Pas sa révocation. Pas son expiration.
- Résultat : si on laisse le middleware matcher `/api/admin/*`, on
  croit protéger l'API, mais un cookie révoqué (déconnexion, vol,
  expiration manuelle en DB) reste accepté. **Faille de sécurité
  silencieuse.** Le seul garde-fou correct est la re-vérification
  côté handler Node, qui elle a accès à la DB.

### Ce qu'on fait

```ts
// src/middleware.ts — uniquement pages /admin/*
export const config = {
  matcher: ["/admin/:path*"],  // PAS /api/*
};
export async function middleware(req: NextRequest) {
  const cookie = req.cookies.get(process.env.SESSION_COOKIE_NAME);
  if (!cookie) return NextResponse.redirect(new URL("/admin/login", req.url));
  // On NE vérifie PAS la DB ici. Présence du cookie = redirection
  // évitée, mais la page serveur re-vérifiera côté Node.
}
```

```ts
// src/lib/api.ts — handler API admin
export const POST = withApi({ requireAdmin: true, schema: … }, async ({ session }) => {
  // withApi a déjà : SELECT Session WHERE tokenHash=…, vérifié expiresAt,
  // vérifié user.role, mis session dans le context. Ici on est sûr.
});
```

### Surface de code

- `src/middleware.ts` : matcher = `["/admin/:path*"]` uniquement.
- `src/lib/api.ts` : `withApi({ requireAdmin: true })` utilisé sur
  toutes les routes sous `/api/admin/`.
- Toute route `/api/admin/**` non couverte par `withApi({ requireAdmin: true })`
  est un **bug** → bloquant en review.

### Erreur classique à ne pas refaire

> « Je mets le matcher sur `/admin/:path*` ET `/api/admin/:path*` pour
> mutualiser. » → faux. L'API doit être re-protégée côté Node. Le
> middleware fait juste un confort UX (rediriger `/admin` non loggué
> vers `/admin/login`), l'API doit quant à elle **refuser**
> structurellement les requêtes non authentifiées.

## 12. Transactions PostgreSQL — `Serializable` + retry borné

> **Source** : ADR-0004 amendée S1-016 (ratification D9).

### Pourquoi `Serializable`

Les transactions qui lisent **et écrivent** `Stock` ou `Order.status`
(checkout en S2, webhook `payment_intent.succeeded` en S3) utilisent
**toutes** `isolationLevel: "Serializable"` (paramètre de `prisma.$transaction`,
(DAT §7). Un seul mécanisme d'isolation,
qui ne dépend pas de la discipline de celui qui écrira la requête.

### Politique de retry — obligatoire, sans exception

`Serializable` ne sérialise pas : PostgreSQL **rejette** les transactions
concurrentes au commit avec `SQLSTATE 40001` (`serialization_failure`).
Sans retry, on remplace une double réservation silencieuse par un 500
visible sous exactement la charge que le finding 8 d'S1-002 décrit.

Règle **non optionnelle** pour toute transaction `Serializable` du `src/server/` :

| Paramètre         | Valeur                                  | Pourquoi                                                                                  |
|-------------------|-----------------------------------------|-------------------------------------------------------------------------------------------|
| Nombre de tentatives | **3** (1 initiale + 2 retries)        | Suffisant pour la majorité des cas ; au-delà, le conflit est structurel, pas concurrent. |
| Backoff           | **50 ms, 150 ms** (géométrique)         | Assez court pour ne pas dégrader la conversion checkout ; assez long pour laisser passer le conflit. |
| Erreur retry      | `SQLSTATE 40001` **uniquement**          | Pas de retry sur `23P01` (deadlock_detected) — deadlock = logique applicative à corriger.   |
| Échec final       | 503 au client / `200 {received:true}` au PSP | Voir ADR-0004 S1-016 §procédure d'exception (webhook acquitte toujours). |

### Implémentation attendue (`src/lib/db.ts`)

```ts
// Helper à créer en S2. Toute transaction checkout/webhook passe par là.
export async function withSerializableRetry<T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  opts?: { maxAttempts?: number; backoffMs?: number[] },
): Promise<T> {
  const max = opts?.maxAttempts ?? 3;
  const backoff = opts?.backoffMs ?? [50, 150];
  for (let attempt = 1; attempt <= max; attempt++) {
    try {
      return await prisma.$transaction(fn, { isolationLevel: "Serializable" });
    } catch (err) {
      const isSerializationFailure =
        err instanceof Prisma.PrismaClientUnknownRequestError &&
        // Prisma expose le code PG via err.message?.match(/SQLSTATE (\d{5})/)
        /SQLSTATE 40001/.test(String(err));
      if (!isSerializationFailure || attempt === max) throw err;
      await new Promise((r) => setTimeout(r, backoff[attempt - 1] ?? 50));
    }
  }
  /* unreachable */
}
```

### Tests obligatoires (DoD S2 / S3)

- **Test nominal** : 1 transaction checkout, 1 transaction webhook,
  pas de conflit → pas de retry, succès.
- **Test de contention** : 2 transactions concurrentes sur la dernière
  unité → 1 succès, 1 retry, 1 succès final. Vérifier que `Stock.reserved`
  reste cohérent après les deux commits.
- **Test d'échec** : forcer `40001` au 3e essai (mock) → 503 (checkout) ou
  `200 {received:true}` (webhook) selon le contexte.
- **Test non-retry** : une erreur `P2002` (contrainte unique) doit **propager
  immédiatement**, pas être retryée.

### Anti-patterns (interdits)

- ❌ Mélanger `Serializable` et `ReadCommitted` dans la même transaction —
  Prisma throw `Invalid isolation level`. Une transaction = un niveau.
- ❌ `await prisma.$transaction(fn, { isolationLevel: "Serializable" })` sans
  wrapper de retry : la transaction peut échouer au commit, on perd la
  réservation sans le client le sache.
- ❌ Retry sur n'importe quelle erreur `Prisma.*` : seules les `40001`
  sont des échecs de sérialisation. Les autres erreurs (contraintes,
  timeouts) indiquent un vrai bug.
- ❌ `BEGIN; SET TRANSACTION ISOLATION LEVEL SERIALIZABLE; ...` en SQL brut :
  passer par `prisma.$transaction` avec `isolationLevel`, qui gère le commit/
  rollback et la propagation d'erreur propre.

---

## 13. Capacités par rôle — matrice STAFF / ADMIN

> Ajouté en Sprint 1 carte S1-014 (audit D7 — absence de `Role.STAFF`).
> L'implémentation du contrôle d'accès est en **S4** (cf. backlog).
> Cette matrice est la **source de vérité** : aucune route ne définit
> son propre contrôle de droits à la main.

**Règle d'or** : les routes admin s'autorisent **par capacité**
(`can:orders:read`, `can:orders:transition:shipped`, …), **jamais**
par `role === 'ADMIN'` en dur. Pourquoi : ajouter un rôle
(aujourd'hui `STAFF`, demain `SUPER_ADMIN`, demain un partenaire)
devient sinon une chasse au `if (role === 'ADMIN')` à travers tout
le code. La capacité, elle, se teste à un seul endroit (le
`withApi` helper) et s'attache aux rôles via une table de mapping.

### Matrice MVP

| Capacité                            | ADMIN | STAFF | Notes |
|-------------------------------------|:-----:|:-----:|-------|
| `auth:login`                        | ✅    | ✅    | Tous les utilisateurs internes. |
| `dashboard:view`                    | ✅    | ✅    | Tableau de bord lecture. |
| `products:read`                     | ✅    | ❌    | STAFF ne gère pas le catalogue. |
| `products:write`                    | ✅    | ❌    | Idem. |
| `categories:write`                  | ✅    | ❌    | Idem. |
| `orders:read`                       | ✅    | ✅    | STAFF traite les commandes au quotidien. |
| `orders:transition:preparing`       | ✅    | ✅    | `PAID → PREPARING`. |
| `orders:transition:shipped`         | ✅    | ✅    | `PREPARING → SHIPPED` + saisie tracking. |
| `orders:transition:delivered`       | ✅    | ✅    | `SHIPPED → DELIVERED`. |
| `orders:transition:cancelled`       | ✅    | ❌    | Annulation = décision business, ADMIN only. |
| `orders:refund`                     | ✅    | ❌    | Remboursement = impact financier, ADMIN only. |
| `customers:read`                    | ✅    | ✅    | Lecture seule. |
| `customers:write`                   | ✅    | ❌    | Édition fiche client = ADMIN only. |
| `users:read`                        | ✅    | ❌    | Liste des utilisateurs internes. |
| `users:write`                       | ✅    | ❌    | Création / désactivation. |
| `settings:write`                    | ✅    | ❌    | Paramètres boutique, PSP, livraison. |
| `audit-log:read`                    | ✅    | ❌    | Lecture des pistes d'audit. |

### Comment ça se branche côté code (S4)

```ts
// src/lib/auth.ts (S4) — pseudo-code
const CAPABILITIES: Record<Role, Capability[]> = {
  ADMIN: [/* toutes */],
  STAFF: [
    "auth:login", "dashboard:view",
    "orders:read", "orders:transition:preparing",
    "orders:transition:shipped", "orders:transition:delivered",
    "customers:read",
  ],
};

export function can(user: User, capability: Capability): boolean {
  return CAPABILITIES[user.role].includes(capability);
}
```

```ts
// src/lib/api.ts (S4) — extension de withApi
export const POST = withApi({
  requireAdmin: true,
  capability: "orders:transition:shipped", // ← granularité réelle
  schema: ShipOrderSchema,
}, handler);
```

### Règle de revue

- Toute route admin qui check `user.role === 'ADMIN'` est un **bug**
  de capacité → on remplace par `requireCapability(...)`. Bloquant
  en review.
- Toute nouvelle capacité ajoutée au tableau ci-dessus doit l'être
  dans une PR qui met à jour **les deux endroits** : ce §13 (source
  de vérité) et la map `CAPABILITIES` en code.

### Pourquoi ne pas juste faire `role === 'ADMIN'`

Parce qu'au prochain rôle (livraison externe, comptable, partenaire
marketplace) on ré-ouvre 30 routes pour ajouter un `|| role === '…'`.
La capacité est testée une fois dans `withApi`, mappée une fois dans
`CAPABILITIES`, et c'est fini. La matrice vit ici, dans la doc,
pour qu'elle soit lue une fois par tout dev qui touche au code
admin — plutôt que redécouverte dans chaque fichier de route.

## 14. Cartographie des dépendances par carte des dépendances par carte (cf. ADR-0006)

| Carte   | Dépendances ajoutées                                                              |
|---------|----------------------------------------------------------------------------------|
| S1-001 scaffold | (aucune — fichiers de config + `src/lib/env.ts`)                      |
| S1-005 catalogue | (aucune — réutilise les dépendances existantes)                        |
| S1-006 auth admin | `dependencies`: `bcryptjs@2.4.3` ; `devDependencies`: `@types/bcryptjs@2.4.6` |
| S1-007 checkout  | `dependencies`: `stripe@16.12.0`, `@stripe/stripe-js@4.8.0`, `@stripe/react-stripe-js@2.8.1`, `cuid@3.0.0` |
| S1-008 webhook   | (aucune — réutilise `stripe` de S1-007)                                  |
| S1-009 observabilité | `dependencies`: `pino@9.4.0`, `pino-pretty@11.2.2`                |

**Retrait validé** (vs DAT §6) : aucun wrapper env couplé au transform Next n'est
installé. Remplacé par **zod pur** dans `src/lib/env.ts` (commentaire WAR ROOM
backend-dev, 22:24). Si quelqu'un souhaite réintroduire un tel wrapper, il faut une
ADR (cf. §9).
