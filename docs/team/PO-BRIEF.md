# PO-BRIEF — Boutique e-commerce MVP

> Document de cadrage produit pour la V1 d'une boutique en ligne de produits physiques.
> Cible : marché francophone africain (Cameroun + diaspora). Volumétrie cible : 100–500 commandes/mois.
> Stack : Next.js 14+ (App Router) + TypeScript · Prisma + PostgreSQL · Stripe (+ adaptateurs Mobile Money / virement) · Vitest + Playwright.

---

## 1. Vision & promesse

Permettre à un marchand francophone africain (basé au Cameroun ou dans sa diaspora) de vendre en ligne des produits physiques avec variantes (taille, couleur, etc.), d'encaisser via carte, Mobile Money Orange/MTN ou virement, et d'expédier ses commandes avec suivi — depuis une boutique moderne, mobile-first, simple à administrer seul ou en très petite équipe (1–3 personnes). La promesse : **« vendre en ligne sans se battre avec la technique »**, avec un checkout pensé pour le mobile africain (paiement assisté, confirmation claire) et un back-office qui ne nécessite pas de compétences d'ingénieur.

---

## 2. Personas

### P1 — Aïcha, la cliente mobile-first camerounaise

- **Profil** : 24–38 ans, urbaine (Douala / Yaoundé), salariée ou auto-entrepreneure.
- **Contexte** : smartphone Android milieu de gamme, connexion 3G/4G instable, forfaits data limités. Utilise Orange Money / MTN Mobile Money au quotidien.
- **Objectifs** : trouver un produit précis (vêtements, beauté, déco), commander rapidement, payer sans créer de compte compliqué, recevoir son colis à domicile ou en point relais.
- **Frustrations** : sites lents, formulaires interminables, absence de Mobile Money, photos produits manquantes, SAV introuvable.
- **Attitude technique** : accepte de créer un compte uniquement si la valeur est claire (suivi de commande, factures). Sinon préfère commander « invité ».

### P2 — Marc, le client diaspora (Europe / Amérique du Nord)

- **Profil** : 30–55 ans, originaire d'Afrique centrale, installé en France/Belgique/Canada/USA. Achète pour lui-même et pour sa famille restée au pays.
- **Objectifs** : envoyer un cadeau ou commander pour un proche au Cameroun, payer par carte bancaire internationale, avoir une facture et un suivi d'expédition fiable.
- **Frustrations** : sites qui ne livrent pas vers l'Afrique, frais de douane opaques, impossibilité de mettre deux adresses (facturation ≠ livraison), tracking inexistant.
- **Attitude technique** : à l'aise web, compare les avis, exige transparence sur les délais et les frais.

### P3 — Fatou, la marchande (persona principal côté opérationnel)

- **Profil** : 28–45 ans, fondatrice d'une micro-marque (mode, cosmétique, déco, artisanat). Gère tout : sourcing, réseau social, expédition.
- **Objectifs** : mettre ses produits en ligne sans dépendre d'un dev, accepter plusieurs modes de paiement, suivre ses commandes et son stock sans spreadsheet, expédier depuis son atelier/domicile.
- **Frustrations** : WooCommerce à maintenir, plugins qui cassent, modules Mobile Money hors de prix, tableau de bord illisible sur téléphone, aucun reporting fiable.
- **Attitude technique** : non-dev. Apprend vite mais n'a pas de temps à perdre. A besoin que les choses « marchent tout court ».
- **Indicateurs clés pour elle** : nombre de commandes/jour, taux de commandes payées vs. abandonnées, alertes de stock bas.

### P4 — Jules, l'opérateur préparation/SAV

- **Profil** : employé ou aide familiale, accès limité au back-office (rôle « staff »).
- **Objectifs** : voir la liste des commandes à préparer, imprimer un bordereau, marquer comme expédié avec un numéro de suivi, traiter un retour ou une question client.
- **Frustrations** : devoir passer par le marchand pour chaque action, interfaces confuses, perte de temps sur des tâches répétitives.
- **Attitude technique** : utilisateur basique. Veut des écrans sobres, des actions claires, peu de clics.

---

## 3. User Stories MVP (par Epic)

### Epic A — Catalogue & Navigation client

**A1.** En tant que **visiteur**, je veux **parcourir les produits par catégorie** afin de **trouver rapidement ce qui m'intéresse**.
- AC : la home liste les catégories ; chaque catégorie a une page dédiée (`/categorie/[slug]`) avec pagination ; le tri (prix, nouveautés) fonctionne ; la page charge en < 2 s en 3G.

**A2.** En tant que **visiteur**, je veux **voir le détail d'un produit avec ses variantes** (taille, couleur, etc.) afin de **choisir la bonne option avant d'acheter**.
- AC : la page produit affiche galerie, prix, description, stock par variante, sélecteur de variantes fonctionnel ; les variantes indisponibles sont grisées ; un produit sans variante permet l'ajout direct au panier.

**A3.** En tant que **visiteur**, je veux **rechercher un produit par mot-clé** afin de **trouver un article précis**.
- AC : barre de recherche en header (desktop) et menu mobile ; résultats pertinents ; recherche vide → état vide explicite.

### Epic B — Panier persistant

**B1.** En tant que **visiteur**, je veux **ajouter un produit au panier** afin de **préparer ma commande**.
- AC : ajout depuis la fiche produit (variante + quantité) ; mise à jour du compteur panier ; panier persisté en localStorage (cookie httpOnly côté serveur pour les connectés).

**B2.** En tant que **visiteur**, je veux **retrouver mon panier après avoir fermé le navigateur** afin de **ne pas recommencer**.
- AC : à la réouverture, le panier est identique ; les produits devenus indisponibles sont signalés.

**B3.** En tant que **visiteur**, je veux **modifier quantités et supprimer des lignes** afin de **corriger mon panier**.
- AC : +/- quantité, suppression, recalcul du total, gestion du stock max.

### Epic C — Tunnel de checkout

**C1.** En tant que **client**, je veux **passer commande sans créer de compte** (« guest checkout ») afin de **finaliser rapidement**.
- AC : email + nom + téléphone + adresse suffisent ; un compte est proposé en option post-achat en un clic.

**C2.** En tant que **client**, je veux **saisir une adresse de livraison distincte de l'adresse de facturation** afin de **faire livrer à un tiers** (cas diaspora).
- AC : checkbox « autre adresse de livraison » ; champs adresse conditionnels ; persistance du choix.

**C3.** En tant que **client**, je veux **choisir mon mode de paiement** (carte, Mobile Money, virement) afin de **payer avec ce que j'utilise**.
- AC : 3 options visibles ; Mobile Money affiche opérateur (Orange / MTN) + numéro ; virement affiche IBAN + instructions ; le choix est mémorisé pour la commande.

**C4.** En tant que **client**, je veux **recevoir une confirmation de commande par email** afin de **garder une trace**.
- AC : email envoyé immédiatement avec numéro de commande, récap produits, total, adresse, mode de paiement ; page de remerciement `/commande/[id]/merci` accessible.

### Epic D — Espace client (lecture seule)

**D1.** En tant que **client connecté**, je veux **voir mes commandes passées** afin de **retrouver un achat**.
- AC : liste paginée avec statut, date, total, lien vers le détail.

**D2.** En tant que **client**, je veux **suivre l'expédition de ma commande** afin de **savoir quand elle arrive**.
- AC : un numéro de suivi + lien transporteur (ou message libre saisi par le marchand) est affiché sur la page commande.

### Epic E — Paiement (abstraction `PaymentProvider`)

**E1.** En tant que **client carte**, je veux **payer via Stripe Checkout/Payment Intent** afin de **payer en EUR/XAF selon le cas**.
- AC : redirection ou widget Stripe ; webhook met à jour le statut commande (`pending` → `paid` / `failed`) ; idempotence des webhooks.

**E2.** En tant que **client Mobile Money**, je veux **recevoir une demande de paiement sur mon téléphone** afin de **valider la transaction**.
- AC : choix opérateur + numéro ; instruction USSD / push affichée ; statut de la commande mis à jour via callback du provider (mock ou agrégateur).

**E3.** En tant que **client virement**, je veux **voir les coordonnées bancaires et passer ma commande en « à valider »** afin de **prévenir le marchand**.
- AC : IBAN + référence de virement (numéro de commande) affiché ; commande créée avec statut `awaiting_transfer` ; le marchand marque `paid` manuellement après réception.

### Epic F — Dashboard admin

**F1.** En tant que **marchand**, je veux **me connecter à un back-office sécurisé** afin de **gérer ma boutique**.
- AC : login email/password + 2FA TOTP (recommandé) ; session cookie httpOnly ; séparation `admin` / `staff` ; logs d'audit des actions sensibles.

**F2.** En tant que **marchand**, je veux **créer/éditer/supprimer un produit et ses variantes** afin de **maintenir mon catalogue à jour**.
- AC : formulaire produit (titre, description, prix, photos, stock, statut actif/inactif) ; éditeur de variantes (taille, couleur, SKU, prix, stock) ; upload d'images avec recadrage auto.

**F3.** En tant que **marchand**, je veux **voir la liste des commandes et leurs détails** afin de **les préparer**.
- AC : tableau filtrable (statut, date, paiement) ; fiche commande avec lignes, client, adresse, paiement, action « marquer comme expédiée ».

**F4.** En tant que **marchand**, je veux **marquer une commande comme expédiée avec un numéro de suivi** afin de **tenir le client informé**.
- AC : champ `tracking_number` + `carrier` ; email automatique au client ; historique des changements de statut.

**F5.** En tant que **marchand**, je veux **voir des statistiques basiques** afin de **piloter mon activité**.
- AC : dashboard avec CA sur 30 j, nombre de commandes, panier moyen, top 5 produits, taux de commandes payées vs. abandonnées.

**F6.** En tant que **marchand**, je veux **gérer les utilisateurs staff** afin de **donner un accès limité à un opérateur**.
- AC : CRUD utilisateurs staff (email, rôle) ; impossible de supprimer le dernier admin.

### Epic G — Exploitation & qualité transverse

**G1.** En tant qu'**équipe**, je veux **un système de logs et d'erreurs centralisé** afin de **déboguer en production**.
- AC : logger structuré (pino) ; capture des exceptions serveur ; alertes sur erreurs paiement.

**G2.** En tant que **client**, je veux **une expérience utilisable sur mobile** afin de **commander depuis mon téléphone**.
- AC : responsive design validé sur 360 px ; Lighthouse mobile ≥ 80 ; checkout en < 5 écrans.

---

## 4. Métriques de succès du MVP (KPIs)

| # | KPI | Cible MVP | Source de mesure |
|---|-----|-----------|------------------|
| K1 | **Taux de conversion checkout** (commandes payées / sessions checkout) | ≥ 35 % | DB commandes + analytics sessions |
| K2 | **Temps médian de parcours achat** (entrée site → paiement validé) | ≤ 3 min sur mobile | Logs serveur (timestamps) |
| K3 | **Taux de panne paiement** (commandes `failed` / tentatives) | ≤ 5 % | Stripe webhooks + table `payments` |
| K4 | **Délai médian d'expédition** (commande payée → marquée expédiée) | ≤ 48 h ouvrées | DB commandes (`shipped_at - paid_at`) |
| K5 | **NPS post-achat** (email J+7) | ≥ 40 sur 100 premiers répondants | Mini-enquête email |

**Critère de go/no-go V2** : ≥ 100 commandes payées sur 1 mois avec K1 ≥ 30 % et K3 ≤ 8 %.

---

## 5. Hors-périmètre EXPLICITE (V1)

| Fonctionnalité | Pourquoi on s'en passe |
|---|---|
| Wishlist / favoris | Faible valeur prouvée au lancement, complexifie le modèle de données et l'UX mobile. À réévaluer post-MVP. |
| Avis et notes clients | Risque réputationnel (modération, faux avis) ; demande du temps de modération non couvert par 1–3 personnes. |
| Codes promo & promotions | Logique métier complexe (stacking, conditions, expirations) ; pas demandeur au lancement. |
| Multi-langue (FR/EN/autres) | Surcoût UX + i18n dès J1. Le marché cible est francophone — on reste 100 % FR pour la V1. |
| Multi-devise (EUR, XAF, USD, etc.) | Implique taux de change, conformité PSP, prix par zone. V1 = devise unique paramétrable (XAF ou EUR selon marché). |
| Marketplace multi-vendeurs | Change fondamentalement le modèle (sous-boutiques, splits, KYC multiples). V1 = mono-merchant. |
| Programme de fidélité / parrainage | Pas prioritaire tant que la rétention n'est pas mesurée. |
| Synchronisation ERP / logistique externe | Intégrations prématurées — on gère l'expédition à la main via numéro de suivi saisi. |
| App mobile native | Le web mobile-first suffit pour 100–500 commandes/mois. |
| Comparaison de produits, recommandations IA | Nice-to-have, hors valeur cœur. |

---

## 6. Risques produit majeurs

### R1 — Paiement Mobile Money : intégration instable ou indisponible selon opérateur

- **Description** : Orange Money et MTN Mobile Money ont des APIs opérateurs hétérogènes, parfois fermées aux agrégateurs, avec des latences et des statuts flous. Risque de commandes bloquées en `pending` et de réconciliation manuelle douloureuse.
- **Mitigation** :
  - Construire une interface `PaymentProvider` propre dès le départ, avec un adaptateur `MobileMoneyProvider` derrière lequel on branche dans l'ordre : 1) agrégateur tiers (NotchPay, Flutterwave, PayDunya), 2) intégration opérateur directe si pas d'agrégateur viable, 3) solution manuelle (instruction USSD affichée + validation marchand) en repli.
  - Timeout explicite et job de réconciliation quotidien (cron) qui vérifie les commandes > 30 min en `pending`.
  - Toujours proposer Stripe et virement en parallèle — le client n'est jamais bloqué.

### R2 — Performance mobile sur réseaux 3G/4G dégradés

- **Description** : la cible principale est mobile-first avec connexion limitée. Une boutique lourde (images non optimisées, JS excessif) tue la conversion.
- **Mitigation** :
  - Images WebP/AVIF + `next/image` + lazy loading agressif ; budget JS strict sur le parcours client.
  - Skeleton loaders sur liste produit, panier, checkout ; préchargement minimal.
  - Tests Playwright en throttling 3G sur les parcours critiques (home → checkout → paiement).
  - Cible Lighthouse mobile Performance ≥ 80 sur la home et la fiche produit.

### R3 — Fraude et impayés (surtout virement et Mobile Money)

- **Description** : le virement est notoirement sujet aux fausses preuves de paiement ; Mobile Money peut faire l'objet d'annulations/rejets. Sans process, le marchand expédie et n'est jamais payé.
- **Mitigation** :
  - Virement : expédition uniquement après confirmation bancaire manuelle ; commande `awaiting_transfer` expire automatiquement après 7 jours.
  - Mobile Money : expédition après `paid` confirmé par callback, jamais avant ; politique claire d'annulation si callback négatif.
  - Stripe : anti-fraude natif activé, 3DS forcé si applicable.
  - Backlog : journaliser toutes les transitions de statut de paiement pour traçabilité en cas de litige.

---

## 7. Roadmap suggérée (3–4 sprints, 2 semaines chacun)

> Convention : `S1` = Sprint 1, `S2` = Sprint 2, etc. Chaque sprint livre un incrément testable.

### Sprint 1 — Fondations & catalogue (2 sem.)
**Objectif** : avoir un catalogue browsable de bout en bout, sans paiement.

Livrables :
- Setup Next.js 14 + TS + Prisma + PostgreSQL ; CI de base (lint, tests, build).
- Modèle de données : `Product`, `Variant`, `Category`, `Image`, `User`, `Session`.
- Pages publiques : home, liste catégorie, fiche produit avec sélecteur de variantes.
- Recherche simple (SQL `ILIKE` puis Meilisearch si besoin).
- Auth admin basique (email/password, seed du premier marchand).
- Tests Vitest (modèles, logique variantes) + 2 scénarios Playwright (parcours produit).

**Dépendances** : aucune.

### Sprint 2 — Panier & checkout invité (2 sem.)
**Objectif** : on peut passer une commande, le paiement est encore en mock.

Livrables :
- Panier persistant (localStorage + sync cookie httpOnly).
- Tunnel checkout : email, adresse livraison, adresse facturation optionnelle, récap.
- Page de confirmation post-commande (`pending`).
- Modèle `Order`, `OrderItem`, `Address`, `OrderStatus` enum.
- Interface `PaymentProvider` + adaptateur `MockProvider` pour les tests.
- Tests : unité (calculs panier/total), intégration (création commande), E2E (parcours invité).

**Dépendances** : S1 (catalogue, auth).

### Sprint 3 — Paiements réels + dashboard marchand (2 sem.)
**Objectif** : on encaisse vraiment, le marchand gère ses commandes.

Livrables :
- Adaptateur `StripeProvider` (Payment Intent + webhook).
- Adaptateur `MobileMoneyProvider` (agrégateur choisi, ex. NotchPay/Flutterwave) + UI instruction.
- Adaptateur `BankTransferProvider` (instruction IBAN + statut manuel).
- Dashboard admin : liste commandes, fiche commande, actions (marquer payée, expédiée, saisir tracking).
- Email transactionnel (Resend/SMTP) : confirmation commande + expédition.
- Tests webhook Stripe (signature, idempotence, replay).
- Job de réconciliation des paiements `pending`.

**Dépendances** : S2 (commande créée, interface PaymentProvider).

### Sprint 4 — Espace client, stats, polish & déploiement (2 sem.)
**Objectif** : V1 production-ready.

Livrables :
- Espace client : login, liste commandes, détail + suivi.
- Dashboard stats (CA, top produits, taux conversion, délai expédition).
- Gestion utilisateurs staff (CRUD + rôles).
- Logs structurés + alertes erreurs paiement.
- Optimisations Lighthouse mobile ; audit sécurité OWASP top 10 (CSRF, XSS, SQLi via Prisma, secrets).
- Déploiement : Vercel (front) + Postgres managé (Neon/Supabase) ; sauvegardes DB configurées.
- Documentation runbook (incident paiement, rollback, restauration backup).

**Dépendances** : S3 (commandes payées, dashboard commandes).

### Vue d'ensemble des dépendances

```
S1 ──► S2 ──► S3 ──► S4
[catalogue] [checkout] [paiements & admin] [client + stats + prod]
```

**Marge** : le sprint 4 peut absorber une découverte du sprint 3 (ex. : intégration Mobile Money plus complexe que prévu) sans retarder la mise en production.

---

*Document rédigé par l'équipe Produit. Toute modification du périmètre V1 doit faire l'objet d'une PR sur ce fichier.*
