# ADR-0006 — Cartographie dépendances par carte (et check constraints de cohérence)

- **Statut** : Acceptée (Sprint 1), introduite post-audit S1-002 (Findings 6, 8/8)
- **Date** : 2026-09-17
- **Décideurs** : équipe architecture + PO
- **Référence DAT** : §6 (dépendances), §2 (schéma Prisma), §11 ADR-0006

## Contexte

Deux trous identifiés dans l'audit du DAT pendant S1-002 :

1. **DAT §6 liste 13 dépendances**, mais `package.json` du worktree S1-001 n'en contient que 4. **Aucune carte** ne dit explicitement "j'ajoute `stripe@16.12.0` à `dependencies`" ou "j'ajoute `bcryptjs@2.4.3`". Si on laisse les cartes filles décider seules, on aura des **versions incohérentes** entre Stripe côté serveur (`16.12.0`) et `@stripe/stripe-js` côté client (`4.8.0`) — Stripe renvoie des erreurs cryptiques à l'intégration.

2. **DAT §2 schéma Prisma** : `Stock.quantity` et `Stock.reserved` sont des `Int` non-null, **sans `CHECK (quantity >= 0)` ni `CHECK (reserved >= 0)`**. Le code applicatif est seul garant de l'invariant. Un bug applicatif (ou une migration mal écrite) peut rendre le stock négatif, **sans que la base ne protègent**.

## Décision

### 1. Cartographie dépendances ↔ cartes S1/S2

| Carte   | Dépendances ajoutées                                                              |
|---------|----------------------------------------------------------------------------------|
| S1-001 scaffold | (aucune — uniquement fichiers de config + env.ts)                       |
| S1-005 catalogue | (aucune — réutilise les dépendances existantes)                         |
| S1-006 auth admin | `dependencies: bcryptjs@2.4.3` ; `devDependencies: @types/bcryptjs@2.4.6` |
| S1-007 checkout  | `dependencies: stripe@16.12.0, @stripe/stripe-js@4.8.0, @stripe/react-stripe-js@2.8.1, cuid@3.0.0` |
| S1-008 webhook   | (aucune — réutilise `stripe` de S1-007)                                  |
| S1-009 observabilité | `dependencies: pino@9.4.0, pino-pretty@11.2.2`                    |

**Retrait validé** : `@t3-oss/env-nextjs@0.11.1` n'est **pas** ajouté. Justification dans le commentaire WAR ROOM de backend-dev (22:24) — env-nextjs est couplé au transform de build Next, donc non importable depuis `prisma/seed.ts` ni Vitest. Remplacé par **zod pur** dans `src/lib/env.ts`. Documenté dans CONVENTIONS §10 (cartographie deps).

### 2. Check constraints sur table `Stock` — SQL brut dans la migration

> **Amendement S1-016** : `@@check` Prisma 5 preview était affirmé sans preuve
> empirique (l.48 avant amendement). L'ADR-0006 retenue par D4 demandait des
> `CHECK` ; la question n'est pas *faut-il des CHECK* mais *comment les écrire*
> pour qu'ils marchent quelle que soit la version Prisma. **Verdict** : SQL brut
> dans le fichier de migration. Voir section « Preuve et choix d'implémentation »
> ci-dessous.

Le `schema.prisma` de Sprint 2 (carte S1-005) déclare le modèle **sans** les
directives `@@check` (que Prisma ne supporte pas de façon stable) :

```prisma
model Stock {
  variantId String  @id
  quantity  Int     @default(0)
  reserved  Int     @default(0)
  variant   Variant @relation(fields: [variantId], references: [id], onDelete: Cascade)
  @@index([variantId])
}
```

Les `CHECK` sont ajoutés **en SQL brut** dans la migration Prisma générée
(`prisma/migrations/<timestamp>_stock_check_constraints/migration.sql`) :

```sql
-- Prisma ne supportant pas @@check de façon stable (cf. S1-016),
-- on ajoute les contraintes en SQL brut dans la migration.
ALTER TABLE "Stock"
  ADD CONSTRAINT "stock_quantity_nonneg"  CHECK ("quantity" >= 0),
  ADD CONSTRAINT "stock_reserved_nonneg"  CHECK ("reserved" >= 0),
  ADD CONSTRAINT "stock_reserved_le_qty"  CHECK ("reserved" <= "quantity");
```

#### Preuve et choix d'implémentation (S1-016)

- **D4 (DAT §2)** demandait `CHECK (quantity >= 0)` et `CHECK (reserved >= 0)`.
- Le pré-amendement S1-002 affirmait que Prisma 5 supporte `@@check` en preview
  sans démontrer la capacité. Risque concret : S1-005 perd une heure à débuguer
  une syntaxe non supportée par la version de Prisma installée.
- **Deux issues acceptables** :
  1. Vérifier empiriquement avec une migration d'essai jetable et coller la
     sortie réelle — pas réalisé en S1-016 (chemin non retenu).
  2. Écrire les `CHECK` en SQL brut dans le fichier de migration — **chemin
     retenu**. Indépendant de la version Prisma, conforme à D4, et le runner
     `prisma migrate dev` ré-exécute le SQL tel quel en prod.

- Les check constraints sont **appliquées par Postgres** à chaque INSERT/UPDATE.
  Si le code applicatif tente `quantity = -1`, la requête échoue avec un code
  Postgres `23514` (check_violation), que `src/lib/db.ts` mappe en
  `StockNegativeError` (sous-type de `DomainError`).
- `reserved <= quantity` est l'invariant métier : on **ne peut pas promettre plus
  qu'on n'a**. Un webhook qui se retrouve avec `reserved > quantity` ne
  décrémente **pas** silencieusement — il déclenche la procédure d'exception
  documentée dans ADR-0004 (Finding 8/8, amendée S1-016).

### 3. Carte des migrations à venir (S2/S3)

| Sprint | Migration Prisma                                              |
|--------|---------------------------------------------------------------|
| Sprint 1 | (squelette uniquement — generator + datasource)              |
| Sprint 2 | Tables User/Session/Customer/Address/Category/Product/Variant/Stock/Cart/CartItem/Order/OrderItem/Payment/Shipment/WebhookEvent/AuditLog + check constraints `CHECK` en SQL brut (cf. §2 amendé) |
| Sprint 2 | Enum `PaymentStatus` amendé : ajout de `REFUND_PENDING`        |
| Sprint 3 | Index composites (perf — à mesurer avant)                     |
| Sprint 4 | Partitionnement `WebhookEvent` par mois (si volumétrie justifie) |

## Conséquence

**Positives**
- Chaque dev qui ouvre une carte sait **exactement** quoi ajouter à `package.json`. Pas d'incohérence de version entre Stripe SDK serveur et client.
- Les check constraints `CHECK` en SQL brut (cf. §2 amendé) sont une **ceinture-bretelles** avec le code applicatif. Un bug applicatif devient un crash visible, pas une corruption silencieuse.
- L'enum `PaymentStatus` amendée (ajout de `REFUND_PENDING`) suit la clarification de l'ADR-0002 (Finding 1/8, amendée S1-016) — refunds async correctement représentés en DB. **`OrderStatus` n'est pas touchée** : la source de vérité du refund est `Payment.status` uniquement.

**Négatives / risques**
- L'ajout de `CHECK` (SQL brut) peut bloquer des migrations existantes si on commit du code applicatif qui viole la contrainte. **Pas le cas ici** : la base est vide au Sprint 1.
- Le retrait de `@t3-oss/env-nextjs` est un écart explicite au DAT §6. **À acter dans la prochaine revue de DAT** (S1-013).

**Surface de code touchée**
- `package.json` (ajouts par carte S1-006, S1-007, S1-009)
- `prisma/schema.prisma` (Sprint 2) — modèles + check constraints
- `src/domain/errors.ts` — ajout `StockNegativeError extends DomainError`
- `src/lib/db.ts` — mapping `Prisma.PrismaClientKnownRequestError` code `P2010`/`23514` → `StockNegativeError`
- `docs/team/CONVENTIONS.md` §10 — cartographie deps (table ci-dessus)
- `docs/team/ARCHITECTURE.md` §2 — amendement enum `PaymentStatus` (ajout `REFUND_PENDING`)

## Alternatives écartées

| Alternative | Pourquoi écartée |
|-------------|------------------|
| **Pas de cartographie deps, chaque carte décide seule** | Versions incohérentes entre Stripe serveur/client, bugs d'intégration Stripe, perte de temps en debug "pourquoi mon client_secret ne matche pas". |
| **Pas de check constraints, le code applicatif suffit** | Un bug applicatif (ou une migration) peut corrompre la base silencieusement. Les check constraints sont gratuites et protègent des années. |
| **Forcer l'ajout de `@t3-oss/env-nextjs`** | Couplage au transform Next bloque `prisma/seed.ts` et Vitest. Friction non justifiée. zod pur couvre 100% du besoin. |
| **`@@check` uniquement en prod, pas en dev** | Les check constraints sont dev-only-friendly : PostgreSQL les évalue en permanence. Les avoir dès le dev évite les surprises. |
| **Mapping de l'erreur 23514 côté code applicatif uniquement** | C'est exactement ce qui est proposé ici, **en plus** des check constraints. Pas une alternative, un complément. |
