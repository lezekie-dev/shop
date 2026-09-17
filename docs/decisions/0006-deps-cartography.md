# ADR-0006 — Cartographie des dépendances par carte (versions figées au DAT §6)

- **Statut** : Acceptée (Sprint 1) — **créée 2026-09-17 (carte S1-014, audit D5)**
- **Date** : 2026-09-17
- **Décideurs** : équipe architecture + PO + chief (arbitrage post-audit DAT)
- **Référence DAT** : §6 (stack technique — dépendances et versions) ; audit DAT carte S1-002 finding 6

> **But** : aucune carte du backlog n'ajoute sa propre version d'une
> dépendance. Les versions sont **figées** dans le DAT §6 (carte
> S1-002) et toute introduction d'un nouveau paquet (ou toute
> montée de version) passe par cette ADR.

---

## Contexte

L'audit DAT a relevé qu'en l'absence de cartographie explicite, deux
cartes en parallèle peuvent légitimement ajouter chacune leur propre
version de `stripe` (par exemple `16.12.0` en S3 Stripe et `16.13.1`
en S3 Mobile Money si Stripe publie entre-temps) — créant deux
versions concurrentes dans `node_modules`, un lockfile qui ne
résoudra plus la même chose en CI, et des bugs subtils (les helpers
de Stripe sont versionnés, leur API change entre minors).

Même risque sur `bcryptjs` (S1-007), `pino` + `pino-pretty` (S4), ou
sur l'ajout d'un paquet transverse (`zod`, `date-fns`, etc.) qu'une
carte importerait sans vérifier qu'il n'est pas déjà prévu ailleurs.

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
  "@t3-oss/env-nextjs": "0.11.1",
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
| S1-005   | S1     | _aucune nouvelle_ (consomme `zod`, `@t3-oss/env-nextjs`) | déjà résolu   |
| S1-006   | S1     | _aucune nouvelle_ (consomme `@prisma/client`, `cuid`)  | déjà résolu   |
| S1-007   | S1     | **`bcryptjs@2.4.3`**, `@types/bcryptjs@2.4.6`         | introduit S1  |
| S3-001   | S3     | **`stripe@16.12.0`**, `@stripe/stripe-js@4.8.0`, `@stripe/react-stripe-js@2.8.1`, `cuid@3.0.0` | déjà listées DAT §6 |
| S3-002   | S3     | Mobile Money aggregator (à fixer : NotchPay / Flutterwave / PayDunya) → **ADR séparée requise** | ADR à créer |
| S4-001   | S4     | **`pino@9.4.0`**, **`pino-pretty@11.2.2`** (déjà listés DAT §6) | déjà résolu |
| S4-002   | S4     | UptimeRobot ou équivalent (SaaS, pas de paquet npm)     | pas de dep npm |
| S4-003   | S4     | Cron runner : `@t3-oss/env-nextjs` suffit, pas de nouveau paquet | déjà résolu |
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

**Négatives / risques**

- **Rigidité** : une découverte en S3 (« Stripe v17 règle notre bug
  X ») demande un ADR avant de bumper. Acceptable — c'est le prix
  de la cohérence.
- **Documentation à maintenir** : à chaque ajout de dep, on édite
  cette ADR. Charge légère, mais réelle. → Compensée par le
  script CI de §4.

**Surface de code touchée**

- `package.json` (versions figées ci-dessus).
- `pnpm-lock.yaml` / `package-lock.json` (résolution).
- Cette ADR (vivante, éditée à chaque ajout).
- `scripts/check-deps.mjs` (à ajouter en S4, pseudo-code ici).

## Alternatives écartées

| Alternative                                          | Pourquoi écartée |
|------------------------------------------------------|------------------|
| Laisser chaque carte fixer ses propres versions       | C'est exactement le bug que cette ADR prévient. Drift inévitable entre devs parallèles. |
| Tout dans `package.json` sans ADR                     | Le `package.json` dit « quoi », pas « pourquoi » ni « qui l'a introduit ». L'ADR ajoute la traçabilité. |
| Dependabot automatique sans gate                      | Pertinent en S4, mais même Dependabot doit créer une PR qui met à jour cette ADR (cohérence). |
| Paquets internes maison (`@shop/money`, `@shop/auth`) | Surdimensionné pour un monorepo mono-app. On reporte à un vrai découpage si l'app passe 50 fichiers partagés. |
