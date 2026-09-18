# Shop — Boutique e-commerce

Boutique en ligne de produits physiques, marché francophone Afrique / France.

Stack : Next.js 14 (App Router) · TypeScript strict · Prisma · PostgreSQL 16 ·
Vitest · Playwright · Docker.

## Fonctionnalités

**Côté client**

- Catalogue avec catégories, fiche produit à variantes (couleur, taille, prix).
- Panier persistant, **commande sans création de compte**.
- Trois moyens de paiement : Mobile Money (Orange / MTN), virement bancaire,
  carte (adaptateur fourni, désactivé faute de compte marchand).
- Suivi de commande par lien à jeton : `/orders/<jeton>`.

**Côté marchand (`/admin`)**

- Tableau de bord : chiffre d'affaires, panier moyen, commandes à traiter,
  alertes de stock, répartition des moyens de paiement.
- Commandes : filtres par statut, détail, validation de paiement manuelle
  (virement), expédition, **remboursement complet**.
- Produits et variantes, ajustement de stock, journal des emails envoyés.

> **Aucun compte tiers n'est requis.** Paiements et emails passent par des
> implémentations locales : les adaptateurs réels (Stripe, NotchPay…) et les
> emails transactionnels existent derrière la même interface `PaymentProvider`
> et basculent en changeant une variable d'environnement. Voir
> `docs/team/ARCHITECTURE.md` § Paiements.

## Démarrage local

```bash
cp .env.example .env
cp .env.example .env.test        # requis pour les tests
npm install
docker compose up -d db
npx prisma migrate dev
npx tsx prisma/seed.ts
npm run dev
```

Puis ouvrez http://localhost:3000.

## Identifiants admin (créés par le seed)

- email : `admin@shop.local`
- mot de passe : `admin1234` — **à changer avant toute mise en ligne** :
  `npx tsx scripts/set-admin-password.ts admin@shop.local "<nouveau-mot-de-passe>"`

## Scripts

| Commande                 | Effet                                            |
|--------------------------|--------------------------------------------------|
| `npm run dev`            | Next en mode dev (port 3000)                     |
| `npm run build`          | Build production                                 |
| `npm run start`          | Démarre le build production                      |
| `npm run lint`           | ESLint                                           |
| `npm run typecheck`      | `tsc --noEmit`                                   |
| `npm run test`           | Unit + intégration (vitest run)                  |
| `npm run test:e2e`       | Playwright                                       |
| `npm run prisma:migrate`  | `prisma migrate dev`                             |
| `npm run prisma:seed`    | Seed idempotent (admin + catégories + produits)  |
| `npm run db:up` / `db:down` | Démarre / stoppe le Postgres de dev           |

## Tests

```bash
# Unit (sans base de données)
npx vitest run tests/unit

# Intégration — la base doit tourner et être migrée
docker compose up -d db
npx prisma migrate deploy
npx tsx prisma/seed.ts
npx vitest run tests/integration

# E2E Playwright — à lancer contre un BUILD de production, jamais `next dev`
# (un bug de compilation webpack en mode dev rend ces tests instables)
npm run build && npm run start &
npx playwright install --with-deps
npm run test:e2e
```

`.env.test` est ignoré par git (il contient des identifiants locaux) : copiez-le
depuis `.env.example` avant de lancer les tests.

## Architecture

- `docs/team/ARCHITECTURE.md` — document d'architecture technique.
- `docs/team/PO-BRIEF.md` — vision produit, personas, périmètre.
- `docs/team/KNOWN-ISSUES.md` — limites connues.
