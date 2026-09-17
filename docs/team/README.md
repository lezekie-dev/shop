# README — Équipe Shop

> **Carte de l'équipe** : qui fait quoi, où est quoi, comment on
> communique. Lisible en 2 minutes par un nouveau dev un lundi matin.

---

## 1. Qui fait quoi

> Sprint 1 : 4 devs full-stack + 1 PO + 1 architecte (moi). Les rôles
> sont indicatifs au MVP ; on garde la flexibilité de tout faire.

| Qui                | Rôle Sprint 1                            | Spécialité |
|--------------------|------------------------------------------|------------|
| _Architecte (moi)_ | DAT, conventions, ADR, review transverse  | archi / backend |
| _Dev A_            | Catalogue + variantes + tests            | frontend / data |
| _Dev B_            | Panier + checkout + cart UI              | backend / full-stack |
| _Dev C_            | Stripe + webhooks + dashboard admin      | backend / infra |
| _Dev D_            | Espace client + dashboard stats          | full-stack |
| _PO_               | Brief produit, priorisation, validation UX | produit |

> **Rotation code review** : chaque PR est review par le dev qui
> n'a pas codé la feature + passage architecte sur les PR touchant
> `src/domain/`, `prisma/schema.prisma`, ou un sujet ADR.

## 2. Où est quoi

```
docs/
├── team/
│   ├── PO-BRIEF.md          ← vision, personas, KPIs, hors-périmètre
│   ├── ARCHITECTURE.md      ← DAT : stack, schéma, routes, Docker, ADR
│   ├── CONVENTIONS.md       ← (ce sprint) règles de collaboration
│   ├── RUNBOOK.md           ← (ce sprint) procédures incidents
│   └── README.md            ← (ce sprint) ce fichier
└── decisions/
    ├── 0001-auth-admin-cookie.md
    ├── 0002-payment-provider-interface.md
    ├── 0003-prix-minor-units.md   ← amendée S1-014 (minor units ISO 4217)
    ├── 0004-stock-au-paiement.md   ← amendée S1-014 (règle snapshots étendue)
    ├── 0005-webhooks-idempotents.md
    ├── 0006-deps-cartography.md    ← créée S1-014
    └── 0007-migration-prod.md      ← créée S1-014

src/
├── app/                     ← App Router (pages + API)
├── domain/                  ← TypeScript pur, AUCUNE dépendance externe
├── server/                  ← orchestration + Prisma écritures
├── lib/                     ← adapters techniques (db, auth, env, log)
├── ui/                      ← composants partagés
└── types/                   ← types partagés

prisma/
├── schema.prisma            ← modèle de données
├── seed.ts                  ← données de démo
└── migrations/              ← historique des migrations

tests/
├── unit/                    ← Vitest pur (domain/)
├── integration/             ← Vitest + Prisma sur DB jetable
└── e2e/                     ← Playwright
```

## 3. Comment on communique

### Carte WAR ROOM du projet

C'est ici qu'on parle de tout ce qui touche **plus d'une carte** ou
qui concerne l'équipe entière.

- **Carte** : `t_b0886788` sur le board `shop`.
- **Lire** : `hermes kanban --board shop show t_b0886788`
- **Poster** : `hermes kanban --board shop comment t_b0886788 "ton message" --author <profil>`
- **Contenu attendu** :
  - Questions transverses ("qui s'occupe du composant `<Money>` ?").
  - Annonces ("DB seed v2 déployée en staging").
  - Incidents P1 (cf. RUNBOOK §3).
  - Décisions informelles ("on skippe la review sur les typos").
  - Désaccords qui ne tiennent pas dans une PR.

### Comment ne PAS communiquer

- ❌ DM Slack pour une décision architecturale → ça se perd, et le
  suivant qui arrive n'a pas le contexte.
- ❌ Commentaire sur une carte `done` pour rouvrir le débat.
- ❌ "Réunion rapide" sans ordre du jour écrit dans le thread.

## 4. Rituels

| Quand | Quoi | Durée |
|-------|------|-------|
| Chaque jour | Daily (hier / aujourd'hui / bloqué) | 15 min |
| À chaque PR | Code review croisée | — |
| Fin de sprint | Démo interne | 30 min |
| Fin de sprint | Rétro + 3 actions concrètes | 30 min |
| Incident P1 | Post-mortem sous 48 h | — |

## 5. Liens utiles

- **DAT** : [`docs/team/ARCHITECTURE.md`](./ARCHITECTURE.md)
- **Conventions** : [`docs/team/CONVENTIONS.md`](./CONVENTIONS.md)
- **Runbook** : [`docs/team/RUNBOOK.md`](./RUNBOOK.md)
- **PO brief** : [`docs/team/PO-BRIEF.md`](./PO-BRIEF.md)
- **ADR** : [`docs/decisions/`](../../decisions/)
- **Kanban board** : `shop`
- **Carte WAR ROOM** : `t_b0886788`

---

*Ce fichier est volontairement court. Tout détail long vit dans le
document dédié (CONVENTIONS, RUNBOOK, ADR). Si tu as une question qui
n'a pas sa place ici → ouvre un thread sur la WAR ROOM.*
