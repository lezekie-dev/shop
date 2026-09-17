# ADR-0006 — Cartographie des dépendances par carte (et check constraints de cohérence)

- **Statut** : Acceptée (Sprint 1) — créée 2026-09-17 (audit D5/D8) — **amendée S1-016** (Finding D9 : `CHECK` en SQL brut dans la migration, pas de `@@check` Prisma ; `REFUND_PENDING` ajouté à `PaymentStatus`).
- **Date** : 2026-09-17
- **Décideurs** : équipe architecture + PO + chief (arbitrage post-audit DAT)
- **Référence DAT** : §6 (stack technique — dépendances et versions), §2 (schéma Prisma), §11 ADR-0006 ; audit DAT carte S1-002 findings 6 et 8/8

> **But** : aucune carte du backlog n'ajoute sa propre version d'une
> dépendance. Les versions sont **figées** dans le DAT §6 (carte
> S1-002) et toute introduction d'un nouveau paquet (ou toute
> montée de version) passe par cette ADR. Et `Stock.quantity` /
> `Stock.reserved` sont protégés par des `CHECK` posés en SQL brut
> dans la migration — ceinture-bretelles avec le code applicatif
> (audit D8).

---

## Contexte

L'audit DAT a relevé deux trous qui, laissés en l'état, produisent
des bugs lents et invisibles :

1. **Versions divergentes entre cartes parallèles**. Sans cartographie
   explicite, deux cartes en parallèle peuvent légitimement ajouter
   chacune leur propre version de `stripe` (par exemple `16.12.0` en
   S3 Stripe et `16.13.1` en S3 Mobile Money si Stripe publie
   entre-temps) — créant deux versions concurrentes dans
   `node_modules`, un lockfile qui ne résoudra plus la même chose en
   CI, et des bugs subtils (les helpers de Stripe sont versionnés,
   leur API change entre minors).

   Même risque sur `bcryptjs` (S1-007), `pino` + `pino-pretty` (S4),
   ou sur l'ajout d'un paquet transverse (`zod`, `date-fns`, etc.)
   qu'une carte importerait sans vérifier qu'il n'est pas déjà prévu
   ailleurs.

2. **Stock non protégé en base**. `Stock.quantity` et `Stock.reserved`
   sont des `Int` non-null, **sans `CHECK (quantity >= 0)` ni
   `CHECK (reserved >= 0)`**. Le code applicatif est seul garant de
   l'invariant. Un bug applicatif (ou une migration mal écrite) peut
   rendre le stock négatif, **sans que la base ne protège**.

## Décision

### 1. Versions figées (DAT §6 — verrouillées)

Toutes les versions ci-dessous sont **immuables** jusqu'à nouvel ADR.
Le lockfile (`pnpm-lock.yaml` ou `package-lock.json`) est la source
de vérité de l'arbre résolu ; le `package.json` du projet fixe la
version **autorisée**.

```jsonc
// dependencies
{
  "next": "14.2.15",
  "react": "18.3.1",
  "react-dom": "18.3.1",
  "@prisma/client": "5.20.0",
  "stripe": "16.12.0",
  "@stripe/stripe-js": "4.8.0",
  "@stripe/react-stripe-js": "2.8.1",
  "zod": "3.23.8",
  "bcryptjs": "2.4.3",
  "pino": "9.4.0",
  "pino-pretty": "11.2.2",
  "cuid": "3.0.0"
}

// devDependencies
{
  "typescript": "5.5.4",
  "@types/node": "20.16.5",
  "@types/react": "18.3.5",
  "@types/react-dom": "18.3.0",
  "@types/bcryptjs": "2.4.6",
  "prisma": "5.20.0",
  "vitest": "2.1.1",
  "@vitest/coverage-v8": "2.1.1",
  "@playwright/test": "1.47.2",
  "@testing-library/react": "16.0.1",
  "@testing-library/jest-dom": "6.5.0",
  "happy-dom": "15.7.4",
  "eslint": "8.57.0",
  "eslint-config-next": "14.2.15",
  "prettier": "3.3.3",
  "tsx": "4.19.1",
  "dotenv-cli": "7.4.2"
}
```

### 2. Cartographie carte → dépendances introduites

Chaque carte du backlog qui **introduit** une dépendance (pas
celles qui ne font que la consommer) doit figurer dans le tableau
ci-dessous. Ce tableau vit dans cette ADR, **pas** dans le PO-BRIEF,
pour qu'il soit revu en même temps que le `package.json`.

| Carte    | Sprint | Dépendances introduites                                | Statut        |
|----------|--------|--------------------------------------------------------|---------------|
| S1-005   | S1     | _aucune nouvelle_ (consomme `zod`) | déjà résolu   |
| S1-006   | S1     | _aucune nouvelle_ (consomme `@prisma/client`, `cuid`)  | déjà résolu   |
| S1-007   | S1     | **`bcryptjs@2.4.3`**, `@types/bcryptjs@2.4.6`         | introduit S1  |
| S3-001   | S3     | **`stripe@16.12.0`**, `@stripe/stripe-js@4.8.0`, `@stripe/react-stripe-js@2.8.1`, `cuid@3.0.0` | déjà listées DAT §6 |
| S3-002   | S3     | Mobile Money aggregator (à fixer : NotchPay / Flutterwave / PayDunya) → **ADR séparée requise** | ADR à créer |
| S4-001   | S4     | **`pino@9.4.0`**, **`pino-pretty@11.2.2`** (déjà listés DAT §6) | déjà résolu |
| S4-002   | S4     | UptimeRobot ou équivalent (SaaS, pas de paquet npm)     | pas de dep npm |
| S4-003   | S4     | Cron runner : `zod` suffit, pas de nouveau paquet | déjà résolu |
| Backlog générique | — | _aucune_ (pas de dep par défaut)                       | — |

**Hors-tableau explicite** (interdits sans nouvelle ADR) :

- ❌ `tailwindcss` — choix CSS à trancher dans un ADR séparé (DAT §6).
- ❌ `react-query` / `@tanstack/react-query` — non bloquant pour le MVP.
- ❌ `next-auth` — explicitement écarté (ADR-0001).
- ❌ `lodash` / `ramda` — dépréciés, on utilise les builtins.
- ❌ Tout paquet transverse non listé ci-dessus.

### 3. Règles opérationnelles

1. **Une carte = un `pnpm add` (ou `npm install`) sur les seules
   deps listées dans cette ADR pour cette carte.** Tout `pnpm add`
   hors-tableau doit être précédé d'un edit de cette ADR (PR dédiée).
2. **Aucun dev n'ajoute une dépendance sans modifier cette ADR dans
   la même PR.** Le reviewer refuse la PR sinon.
3. **Mises à jour** (correctifs sécurité, nouvelle minor compatible) :
   - Patch (`x.y.Z → x.y.Z+1`) : autorisé en `chore(deps)` direct,
     bloqué par CI si tests cassent.
   - Minor (`x.Y → x.Y+1`) : nécessite un ADR ou, à défaut, un
     commentaire dans cette ADR avec date + raison.
   - Major (`X → X+1`) : **nouvelle ADR obligatoire**.
4. **Lockfile commité** (`pnpm-lock.yaml` ou `package-lock.json`) :
   toute PR qui modifie `package.json` doit aussi modifier le
   lockfile. CI vérifie.

### 4. Vérification automatisée

Un script CI (à ajouter dans la carte S4 pipeline CI, mais la règle
vaut dès S1) :

```bash
# Bloque si une dep hors-tableau est ajoutée
node scripts/check-deps.mjs
# → diff entre package.json et ADR-0006 ; refuse si non vide.
```

Tant que ce script n'est pas en place, la règle est **manuelle en
review** : le reviewer ouvre cette ADR, vérifie la cohérence avec
le diff `package.json`, refuse si une dep apparaît sans entrée
tableau correspondante.

### 5. Check constraints sur table `Stock` — SQL brut dans la migration

> **Amendement S1-016** : `@@check` Prisma 5 preview était affirmé
> sans preuve empirique. L'ADR-0006 retenue par D4 demandait des
> `CHECK` ; la question n'est pas *faut-il des CHECK* mais *comment
> les écrire* pour qu'ils marchent quelle que soit la version
> Prisma. **Verdict** : SQL brut dans le fichier de migration.

Le `schema.prisma` (carte S1-005, Sprint 2) déclare le modèle
**sans** les directives `@@check` (que Prisma ne supporte pas de
façon stable) :

```prisma
model Stock {
  variantId String  @id
  quantity  Int     @default(0)
  reserved  Int     @default(0)
  variant   Variant @relation(fields: [variantId], references: [id], onDelete: Cascade)
  @@index([variantId])
}
```

Les `CHECK` sont ajoutés **en SQL brut** dans la migration Prisma
générée (`prisma/migrations/<timestamp>_stock_check_constraints/migration.sql`) :

```sql
-- Prisma ne supportant pas @@check de façon stable (cf. S1-016),
-- on ajoute les contraintes en SQL brut dans la migration.
ALTER TABLE "Stock"
  ADD CONSTRAINT "stock_quantity_nonneg"  CHECK ("quantity" >= 0),
  ADD CONSTRAINT "stock_reserved_nonneg"  CHECK ("reserved" >= 0),
  ADD CONSTRAINT "stock_reserved_le_qty"  CHECK ("reserved" <= "quantity");
```

**Preuve et choix d'implémentation (S1-016)** :

- **D4 (DAT §2)** demandait `CHECK (quantity >= 0)` et
  `CHECK (reserved >= 0)`.
- Le pré-amendement S1-002 affirmait que Prisma 5 supporte `@@check`
  en preview sans démontrer la capacité. Risque concret : S1-005
  perd une heure à débuguer une syntaxe non supportée par la version
  de Prisma installée.
- **Deux issues acceptables** :
  1. Vérifier empiriquement avec une migration d'essai jetable et
     coller la sortie réelle — pas réalisé en S1-016 (chemin non
     retenu).
  2. Écrire les `CHECK` en SQL brut dans le fichier de migration —
     **chemin retenu**. Indépendant de la version Prisma, conforme à
     D4, et le runner `prisma migrate dev` ré-exécute le SQL tel
     quel en prod.
- Les check constraints sont **appliquées par Postgres** à chaque
  INSERT/UPDATE. Si le code applicatif tente `quantity = -1`, la
  requête échoue avec un code Postgres `23514` (check_violation),
  que `src/lib/db.ts` mappe en `StockNegativeError` (sous-type de
  `DomainError`).
- `reserved <= quantity` est l'invariant métier : on **ne peut pas
  promettre plus qu'on n'a**. Un webhook qui se retrouve avec
  `reserved > quantity` ne décrémente **pas** silencieusement — il
  déclenche la procédure d'exception documentée dans ADR-0004
  (Finding 8/8, amendée S1-016).

### 6. Carte des migrations à venir (S2/S3)

| Sprint  | Migration Prisma                                              |
|---------|---------------------------------------------------------------|
| Sprint 1 | (squelette uniquement — generator + datasource)              |
| Sprint 2 | Tables User/Session/Customer/Address/Category/Product/Variant/Stock/Cart/CartItem/Order/OrderItem/Payment/Shipment/WebhookEvent/AuditLog + check constraints `CHECK` en SQL brut (cf. §5) |
| Sprint 2 | Enum `PaymentStatus` amendé : ajout de `REFUND_PENDING`        |
| Sprint 3 | Index composites (perf — à mesurer avant)                     |
| Sprint 4 | Partitionnement `WebhookEvent` par mois (si volumétrie justifie) |

## Conséquence

**Positives**

- **Une seule source de vérité** : cette ADR. Si on demande
  « pourquoi Stripe est en 16.12.0 ? » → réponse ici, avec lien DAT.
- **Pas de drift entre cartes** : deux devs en parallèle ne peuvent
  pas diverger sur les versions, parce que la liste est fermée.
- **Lockfile reproductible** : un `pnpm install --frozen-lockfile`
  en CI résout toujours la même chose. Pas de surprise « ça marche
  chez moi, pas en CI ».
- **Audit sécurité** : quand une CVE sort sur `stripe@16.12.0`, on
  sait exactement combien de projets sont impactés (1, le nôtre)
  et la procédure de bump est écrite.
- Les check constraints `CHECK` en SQL brut (cf. §5) sont une
  **ceinture-bretelles** avec le code applicatif. Un bug applicatif
  devient un crash visible, pas une corruption silencieuse.
- L'enum `PaymentStatus` amendée (ajout de `REFUND_PENDING`) suit
  la clarification de l'ADR-0002 (amendée S1-016) — refunds async
  correctement représentés en DB. **`OrderStatus` n'est pas
  touchée** : la source de vérité du refund est `Payment.status`
  uniquement.

**Négatives / risques**

- **Rigidité** : une découverte en S3 (« Stripe v17 règle notre bug
  X ») demande un ADR avant de bumper. Acceptable — c'est le prix
  de la cohérence.
- **Documentation à maintenir** : à chaque ajout de dep, on édite
  cette ADR. Charge légère, mais réelle. → Compensée par le
  script CI de §4.
- L'ajout de `CHECK` (SQL brut) peut bloquer des migrations
  existantes si on commit du code applicatif qui viole la
  contrainte. **Pas le cas ici** : la base est vide au Sprint 1.

**Surface de code touchée**

- `package.json` (versions figées ci-dessus).
- `pnpm-lock.yaml` / `package-lock.json` (résolution).
- Cette ADR (vivante, éditée à chaque ajout).
- `scripts/check-deps.mjs` (à ajouter en S4, pseudo-code ici).
- `prisma/schema.prisma` (Sprint 2) — modèle `Stock` sans `@@check`.
- `prisma/migrations/<ts>_stock_check_constraints/migration.sql` — `ALTER TABLE` brut (cf. §5).
- `src/domain/errors.ts` — ajout `StockNegativeError extends DomainError`.
- `src/lib/db.ts` — mapping `Prisma.PrismaClientKnownRequestError` code `P2010` / `23514` → `StockNegativeError`.
- `docs/team/CONVENTIONS.md` §11 (cartographie deps).
- `docs/team/ARCHITECTURE.md` §2 — amendement enum `PaymentStatus` (ajout `REFUND_PENDING`).
- `docs/team/CONVENTIONS.md` §13 — matrice des capacités par rôle (`Role.STAFF` introduit par ADR-0008).

## Alternatives écartées

| Alternative                                          | Pourquoi écartée |
|------------------------------------------------------|------------------|
| Laisser chaque carte fixer ses propres versions       | C'est exactement le bug que cette ADR prévient. Drift inévitable entre devs parallèles. |
| Tout dans `package.json` sans ADR                     | Le `package.json` dit « quoi », pas « pourquoi » ni « qui l'a introduit ». L'ADR ajoute la traçabilité. |
| Dependabot automatique sans gate                      | Pertinent en S4, mais même Dependabot doit créer une PR qui met à jour cette ADR (cohérence). |
| Paquets internes maison (`@shop/money`, `@shop/auth`) | Surdimensionné pour un monorepo mono-app. On reporte à un vrai découpage si l'app passe 50 fichiers partagés. |
| **Pas de check constraints, le code applicatif suffit** | Un bug applicatif (ou une migration) peut corrompre la base silencieusement. Les check constraints sont gratuites et protègent des années. |
| **Forcer l'ajout d'un wrapper env couplé au transform Next** | Couplage au transform Next bloque `prisma/seed.ts` et Vitest. Friction non justifiée. zod pur couvre 100% du besoin (cf. CONVENTIONS §14 — *Cartographie des dépendances*). |
| **`@@check` Prisma en preview sans preuve empirique** | D4 demande des CHECK ; la question est *comment* les écrire. SQL brut = chemin retenu, indépendant de la version Prisma. |
| **`@@check` uniquement en prod, pas en dev** | Les check constraints sont dev-only-friendly : PostgreSQL les évalue en permanence. Les avoir dès le dev évite les surprises. |
| **Mapping de l'erreur 23514 côté code applicatif uniquement** | C'est exactement ce qui est proposé ici, **en plus** des check constraints. Pas une alternative, un complément. |