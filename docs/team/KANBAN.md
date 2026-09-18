# Kanban — Projet Shop (V1 globale)

> Mis à jour en continu par le Chief of Staff. Source de vérité de l'avancement.
> **Statut du board : voir la date sur chaque ligne. Une carte n'est « Terminé »
> que si ses tests passent et sont vérifiés, jamais parce que le code est écrit.**

Légende : ✅ terminé et vérifié · 🟡 à vérifier en QA · 🔵 en cours · ⚪ backlog

---

## ✅ Terminé et vérifié

### MVP (en ligne sur shop.app-lezekie.dev)

| Carte | Preuve |
|---|---|
| Catalogue + fiche produit + variantes | 12/12 contrôles visuels |
| Panier persistant | 210/210 vitest |
| Checkout invité (sans compte) | 2/2 Playwright prod |
| Paiements : Mobile Money, virement, mock | test prod : `REFUNDED`, idempotent |
| Back-office : dashboard, commandes, produits, stock, emails | 11/11 contrôles visuels |
| Remboursement complet | stock restauré, vérifié en prod |
| Sécurité : accès commande par jeton | 401/404/404/200 vérifié en prod |
| Sécurité : rate limiting connexion admin | 401 ×5 puis **429**, vérifié en prod |
| Refonte design (identité, icônes SVG, finitions d'achat) | 9/9 pages, 0 erreur JS |
| Push GitHub `lezekie-dev/shop` | `8acba25`, `.env` protégé |

### Fondation V1

| Carte | Preuve |
|---|---|
| Schéma Prisma étendu (19 → 29 tables) | migration `20260918122329_v1_features` |
| Rôles `ADMIN`/`STAFF` | enum appliqué en base |
| Vérification d'intégrité : 0 régression | tsc 0, **210/210 vitest** |

---

## ✅ Vague 1 — livrée et vérifiée (362/362 vitest, tsc 0)

> Trois chantiers menés en parallèle par des équipes sur fichiers disjoints,
> puis vérifiés et réparés par le Chief of Staff. Commit `8e37e1a`.

### Chantier A — Espace client

| Carte | Livrable |
|---|---|
| Inscription (rattachement à un compte invité existant) | `src/server/customer-account.ts` |
| Connexion / déconnexion | `src/lib/customer-auth.ts`, `/compte/connexion` |
| Mes commandes | `/compte/commandes` |
| Détail commande + suivi d'expédition | `src/ui/components/order-progress.tsx` |
| Carnet d'adresses | `src/ui/components/customer/address-book.tsx` |
| (résolu) l'agent était bloqué par la lenteur de `resetDb` — cause trouvée et corrigée | 33 s → 1,3 s par test |

### Chantier B — Recherche & catalogue

| Carte | Livrable |
|---|---|
| Recherche par mot-clé (nom + description) | `src/server/catalog.ts` |
| Pages catégorie `/categorie/[slug]` | `src/app/(shop)/categorie/` |
| Tri (nouveauté, prix ↑, prix ↓) | `src/domain/catalog.ts` |
| Pagination 12/page | `src/ui/components/catalog-pagination.tsx` |

### Chantier C — Rôles, staff & 2FA

| Carte | Livrable |
|---|---|
| Gestion des utilisateurs `/admin/users` | `src/server/admin-users.ts` |
| 2FA TOTP (RFC 6238, sans dépendance) | `src/server/totp.ts` |
| Gardes d'autorisation serveur | `src/server/guards.ts`, `src/domain/access.ts` |
| Journal d'audit des actions sensibles | `src/server/audit-log.ts` |
| Sécurité du compte `/admin/security` | `src/server/admin-2fa.ts` |

---

## 🔵 Vague 2 — cadrée par le PO (`docs/team/PO-BRIEF-V2.md`)

Le PO a priorisé, écrit 67 critères d'acceptation, tranché ce qui sort du
périmètre et listé 7 décisions à arbitrer. Séquencement en 4 lots.

| Lot | Carte | Valeur | Décision du PO |
|---|---|---|---|
| 2A | Réconciliation des paiements `PENDING` (I) | 5 | IN — en premier, c'est un filet de sécurité |
| 2A | Observabilité + sauvegardes (J) | 4 | IN — un chantier qui protège l'argent passe avant ceux qui le font circuler |
| 2B | Codes promo (E) | 4 | IN réduit — 1 code/commande, pas de cumul, pas de ciblage |
| 2B | Avis clients modérés (F) | 4 | IN réduit — rattachés à une commande, modération obligatoire |
| 2C | Téléversement d'images produits (H) | 5 | IN — le plus gros frein opérationnel pour Fatou |
| 2D | Multi-devise EUR/XAF (K) | 4 | IN réduit, **sacrifiable** si 2A–2C dérapent |
| — | Favoris / wishlist (G) | 2 | **OUT** → vague 3 : le panier est déjà persistant, et sans canal de relance un favori n'est qu'un signet |

**Conditions d'entrée du PO — les 3 satisfaites le 18/09 :**
1. ✅ Vague 1 verte sur preuve (362/362) — la carte que le PO refusait de laisser en 🟡 est close.
2. ✅ Rate limiting **vérifié en production** : 401 ×5 puis 429. `KNOWN-ISSUES.md` affirmait le contraire, il était périmé — corrigé.
3. ✅ Boutique en ligne et répondante (accueil, catalogue, recherche → 200).

**7 décisions à arbitrer par le propriétaire** (§7 du brief PO) : cumul de codes, post-modération des avis, libération d'un code après remboursement, CA multi-devises, saisie manuelle des prix XAF, sort d'un paiement bloqué, stockage des photos. Sans réponse, l'avis du PO s'applique par défaut et reste inscrit comme « à confirmer ».

---

## ⚪ Backlog (identifié, non planifié)

| Carte | Pourquoi pas maintenant |
|---|---|
| Photos produits réelles | Nécessite le marchand, pas du code |
| Pages légales (CGV, mentions, confidentialité) | Décision juridique, pas technique |
| 2FA obligatoire pour les ADMIN | À décider une fois la 2FA optionnelle validée |
| NPS post-achat J+7 (KPI K5 du brief PO) | Dépend d'un vrai envoi d'email |
| Envoi d'emails réel (Resend/SMTP) | Bloqué : aucun compte tiers (décision) |

---

## Règles de fonctionnement de l'équipe

1. **`schema.prisma` ne se modifie que par le Chief of Staff, seul et avant de
   lancer une vague.** Trois agents sur ce fichier = trois migrations en conflit.
2. **Un chantier = des fichiers disjoints.** Deux agents ne touchent jamais le
   même fichier dans la même vague.
3. **Aucun agent ne commit.** Le Chief of Staff commite, après vérification.
   Des commits concurrents cassent l'index git.
4. **Une carte passe en ✅ uniquement sur preuve d'exécution** : tests verts,
   `tsc` 0, et pour une carte visible, un contrôle en production.
5. **Le PO cadre chaque vague** : priorisation, critères d'acceptation, et
   arbitrage de ce qui sort du périmètre.

## Journal

| Date | Événement |
|---|---|
| 18/09 | MVP livré, sécurisé, design refait, poussé sur GitHub |
| 18/09 | Schéma V1 consolidé (29 tables), 210/210 verts |
| 18/09 | Vague 1 lancée : 3 chantiers parallèles (espace client, catalogue, rôles+2FA) |
| 18/09 | ⚠️ Agent « espace client » en timeout (30 min) sur un test cassé — code livré, test à reprendre |
