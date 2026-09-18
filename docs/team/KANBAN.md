# Kanban — Projet Shop

> Tenu par le **Chief of Staff**. C'est la source de vérité de l'avancement : qui
> fait quoi, où ça en est, et sur quelle preuve.
>
> **Règle d'or** : une carte passe en ✅ uniquement sur **preuve d'exécution**
> (tests verts + contrôle réel en production pour une carte visible). Jamais
> parce que le code est écrit, jamais parce qu'un agent l'affirme.

Légende : ✅ terminé et vérifié · 🟠 code livré, en vérification · 🔵 en cours · ⚪ backlog

---

## L'équipe

| Rôle | Qui | Responsabilité | Sur quoi il ne décide pas |
|---|---|---|---|
| **Chief of Staff** | moi | Ordonnancement, schéma Prisma, vérification, commits, arbitrages techniques | Le périmètre produit (c'est le PO) |
| **PO** | agent `opencode` | Priorisation, critères d'acceptation, périmètre et hors-périmètre, KPIs | L'implémentation |
| **Équipe Backend** | agent par chantier | Logique métier, API, base de données | Le périmètre, le schéma |
| **Équipe Frontend** | agent par chantier | Pages, composants, design system | Le périmètre, le schéma |
| **Équipe QA/Sécurité** | agent dédié | Tests, audits, Recherche de failles | Le périmètre |

### Règles de fonctionnement de l'équipe

1. **Le schéma Prisma n'est modifié que par le Chief of Staff, seul, avant de lancer une vague.** Trois agents sur ce fichier = trois migrations en conflit. Vérifié à chaque vague : `git diff prisma/schema.prisma` doit être vide.
2. **Un chantier = des fichiers disjoints.** Deux agents ne touchent jamais le même fichier dans la même vague.
3. **Aucun agent ne commit.** Le Chief of Staff commite après vérification — des commits concurrents cassent l'index git.
4. **Le PO cadre chaque vague avant qu'elle démarre** et rend un document de cadrage avec critères d'acceptation.
5. **Une carte non vérifiée reste en 🟠**, même si l'agent la déclare terminée.

---

## ✅ Terminé et vérifié

### MVP — en ligne sur shop.app-lezekie.dev

| Carte | Preuve |
|---|---|
| Catalogue + fiche produit + variantes | 12/12 contrôles visuels |
| Panier persistant | 210/210 vitest |
| Checkout invité (sans compte) | 2/2 Playwright prod |
| Paiements : Mobile Money, virement, mock | test prod : `REFUNDED`, idempotent |
| Back-office : dashboard, commandes, produits, stock, emails | 11/11 contrôles visuels |
| Remboursement complet | stock restauré, vérifié en prod |
| Sécurité : accès commande par jeton 256 bits | 401/404/404/200 vérifié en prod |
| Sécurité : rate limiting connexion admin | 401 ×5 puis **429**, vérifié en prod |
| Refonte design (identité, icônes SVG, finitions d'achat) | 9/9 pages, 0 erreur JS |
| Packshots produit cohérents (style unifié, contraste) | script versionné `scripts/packshots.mjs` |
| Push GitHub `lezekie-dev/shop` | `c77f106`, `.env` protégé |

### Fondation V1

| Carte | Preuve |
|---|---|
| Schéma Prisma étendu (19 → 29 tables) | migration `20260918122329_v1_features` |
| Rôles `ADMIN`/`STAFF` | enum appliqué en base |
| 0 régression après extension du schéma | tsc 0, 210/210 vitest |

### Vague 1 — 362/362 vitest, tsc 0, commit `8e37e1a`

Trois chantiers en parallèle, puis vérifiés et réparés par le Chief of Staff.

| Carte | Équipe | Preuve |
|---|---|---|
| Inscription / connexion / déconnexion client | Backend | sessions dédiées, table séparée de l'admin |
| Rattachement d'un compte à une fiche invité existante | Backend | historique de commandes conservé |
| Mes commandes + détail + suivi d'expédition | Backend + Frontend | 33 tests du fichier au vert |
| Carnet d'adresses (défaut, suppression protégée) | Backend | refus 409 si adresse citée par une commande |
| Recherche par mot-clé (nom + description) | Backend | renvoie « Sac tote en canvas » en prod |
| Pages catégorie + tri + pagination 12 | Frontend | 14/14 contrôles visuels sur 2 viewports |
| Rôles staff + gardes serveur + audit | Backend | STAFF ne peut pas accéder à /admin/users |
| 2FA TOTP (RFC 6238, sans dépendance) | Backend | 31/31 tests, vecteurs officiels de l'annexe B |
| **Cause racine du blocage d'agent** : `resetDb` (29 TRUNCATE parallèles) | Chief of Staff | 33 s → **1,3 s** par test, relevé dans `pg_locks` |

---

## 🟠 Livré, en cours de vérification — lot 2A + 2C

> Code sur le disque, agents en fin de course. **Rien n'est en ✅ tant que je n'ai
> pas relancé la suite complète et contrôlé les parcours moi-même.**

| Carte | Chantier | Équipe | État |
|---|---|---|---|
| Réconciliation des paiements bloqués | I | Backend | 🟠 code livré, tests en cours d'écriture |
| Route cron protégée par `CRON_SECRET` | I | Backend | 🟠 |
| Page `/admin/paiements` (compteur PENDING > 24 h) | I | Backend + Frontend | 🟠 |
| `/api/health` avec 503 si base morte | J | Backend | 🟠 |
| Page `/admin/taches` (20 derniers `JobRun`) | J | Backend + Frontend | 🟠 |
| Script de sauvegarde DB + purge et rétention | J | Backend | 🟠 |
| **Restauration réellement testée** (exigence du PO) | J | Backend | 🔵 l'agent teste la restauration sur une base jetable |
| Téléversement d'images (API + validation du contenu réel) | H | Backend | 🟠 |
| Réordonnancement / suppression des visuels | H | Backend + Frontend | 🟠 |
| Interface admin de gestion des photos | H | Frontend | 🟠 |

---

## ⚪ Backlog (identifié, non planifié)

| Carte | Pourquoi pas maintenant |
|---|---|
| Favoris / wishlist | **Écartée par le PO** : le panier est déjà persistant, et sans canal de relance un favori n'est qu'un signet. Coût de report nul, on la garde pour la vague 3. |
| Codes promo (E) | Lot 2B, cadré par le PO : 1 code/commande, pas de cumul, pas de ciblage |
| Avis clients modérés (F) | Lot 2B, rattachés à une commande, modération obligatoire |
| Multi-devise EUR/XAF (K) | Lot 2D, **sacrifiable** : le franc CFA est arrimé à l'euro (taux fixe, aucune API à brancher) |
| Photos produits réelles | Le lot 2C en cours le rend techniquement possible ; le contenu viendra du marchand |
| Pages légales (CGV, mentions, confidentialité) | Décision juridique, pas technique |
| 2FA obligatoire pour les ADMIN | À décider une fois la 2FA optionnelle validée |
| Rate limiting sur le checkout | Repéré par le PO, pas encore priorisé |

---

## Décisions en attente du propriétaire

Le PO a remonté **7 arbitrages** (voir `docs/team/PO-BRIEF-V2.md` §7). Sans réponse, son avis s'applique par défaut et reste inscrit « décidée par défaut, à confirmer ».

| # | Question | Avis du PO |
|---|---|---|
| D1 | Un code promo peut-il se cumuler avec un autre ? | Non, un seul par commande |
| D2 | Un avis est-il publié avant modération ? | Non, `PENDING` obligatoire |
| D3 | Une commande remboursée libère-t-elle l'usage du code ? | Oui (la vente n'a rien rapporté) |
| D4 | Comment afficher un CA sur deux devises ? | Ventilation par devise, jamais de total fusionné |
| D5 | Les prix XAF sont-ils saisis ou convertis ? | Saisis à la main, conversion en repli seulement |
| D6 | Que fait l'app si un paiement reste bloqué ? | **Elle ne décide pas** : reste `PENDING`, remonte en tête, stock réservé conservé |
| D7 | Où vivent les photos produits ? | Volume local du serveur, sauvegardé avec la base |

---

## Journal

| Date | Événement |
|---|---|
| 18/09 | MVP livré, sécurisé, design refait, poussé sur GitHub |
| 18/09 | Schéma V1 consolidé (29 tables), 210/210 verts |
| 18/09 | Vague 1 lancée : 3 chantiers parallèles |
| 18/09 | ⚠️ Équipe « espace client » en timeout (30 min) — cause : lenteur de `resetDb`, corrigée (33 s → 1,3 s) |
| 18/09 | Vague 1 ✅ vérifiée : 362/362 vitest, commit `8e37e1a` |
| 18/09 | PO-BRIEF-V2 livré : 382 lignes, 67 critères d'acceptation, 7 arbitrages |
| 18/09 | Les 3 conditions d'entrée du PO satisfaites, dont le rate limiting **prouvé en prod** (401×5 → 429) |
| 18/09 | Packshots unifiés et contraste renforcé — défaut relevé par audit visuel |
| 18/09 | Lot 2A + 2C lancé : 3 équipes (réconciliation, observabilité, téléversement) |
