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

## 🟡 À vérifier en QA (vague 1 — code livré, validé par moi)

> Code écrit par les équipes, `tsc` 0 erreur. **Il me reste à lancer les tests
> et à vérifier les parcours en vrai avant de passer en ✅.**

### Chantier A — Espace client

| Carte | Livrable |
|---|---|
| Inscription (rattachement à un compte invité existant) | `src/server/customer-account.ts` |
| Connexion / déconnexion | `src/lib/customer-auth.ts`, `/compte/connexion` |
| Mes commandes | `/compte/commandes` |
| Détail commande + suivi d'expédition | `src/ui/components/order-progress.tsx` |
| Carnet d'adresses | `src/ui/components/customer/address-book.tsx` |
| ⚠️ **Réserve** : l'agent a échoué sur un test (`Order_customerId_fkey`) et a été coupé au bout de 30 min | à reprendre |

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

## 🔵 Vague 2 — à lancer

| Carte | Chantier | Note |
|---|---|---|
| Codes promo (percent / fixe, limites d'usage) | E | Tables prêtes, logique à écrire |
| Avis clients + modération | F | Modèle `Review` prêt |
| Favoris / wishlist | G | Modèles prêts |
| Téléversement d'images produits | H | Champs `mimeType`/`sizeBytes` prêts |
| Réconciliation des paiements `PENDING` | I | Champs `nextReconcileAt` prêts |
| Observabilité + sauvegardes | J | Modèle `JobRun` prêt |
| Multi-devise EUR/XAF | K | `VariantPrice` + `ExchangeRate` prêts |

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
