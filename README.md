# Shop — Boutique e-commerce MVP

Boutique en ligne de produits physiques, marché francophone africain.
Stack : Next.js 14 (App Router) · TypeScript strict · Prisma · PostgreSQL 16 · Vitest · Playwright · Docker.

> Sprint 1 livré : fondations, catalogue browsable, auth admin basique.
> Paiement et panier arrivent en Sprint 2 et 3.

## Démarrage local en moins de 5 commandes

```bash
cp .env.example .env
npm install
docker compose up -d db
npx prisma migrate dev --name init
npx tsx prisma/seed.ts
npm run dev
```

Puis ouvrez http://localhost:3000.

## Identifiants admin (créés par le seed)

- email : `admin@shop.local`
- mot de passe : `admin1234`
- login : http://localhost:3000/admin/login

## Scripts

| Commande              | Effet                                              |
|-----------------------|----------------------------------------------------|
| `npm run dev`         | Lance Next en mode dev (port 3000)                 |
| `npm run build`       | Build production                                   |
| `npm run start`       | Démarre le build production                        |
| `npm run lint`        | ESLint                                             |
| `npm run typecheck`   | `tsc --noEmit`                                     |
| `npm run test`        | Lance unit + integration (vitest run)              |
| `npm run test:e2e`    | Lance Playwright                                   |
| `npm run prisma:migrate` | `prisma migrate dev`                             |
| `npm run prisma:seed` | Seed idempotent (admin + catégories + produits)    |
| `npm run db:up`       | `docker compose up -d db`                          |
| `npm run db:down`     | Stoppe + supprime le volume Postgres               |

## Tests

```bash
# Unit uniquement (pas de DB)
npx vitest run tests/unit

# Integration (besoin de la DB démarrée + seed)
docker compose up -d db
npx prisma migrate deploy
npx tsx prisma/seed.ts
npx vitest run tests/integration

# E2E Playwright (Next doit pouvoir démarrer)
npx playwright install --with-deps
npm run test:e2e
```

## Architecture

Voir `docs/team/ARCHITECTURE.md` (DAT complet) et `docs/team/PO-BRIEF.md` (vision produit).
