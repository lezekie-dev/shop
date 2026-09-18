# PO-BRIEF V2 — Boutique e-commerce, vague 2

> Document de cadrage produit de la **vague 2**, dans le prolongement de `PO-BRIEF.md` (MVP).
> Contexte : MVP + V1 en ligne (catalogue, panier, checkout invité, 3 paiements simulés, back-office, espace client, rôles + 2FA, emails en outbox).
> Marché : francophone Afrique (Cameroun + diaspora) / France. Volumétrie cible : 100–500 commandes/mois, marchand seul ou 1–3 personnes, clients mobile-first en 3G.
> Source de vérité de l'avancement : `KANBAN.md`. Limites assumées : `KNOWN-ISSUES.md`.
> Les 7 chantiers de cette vague sont désignés par les lettres du KANBAN (**E→K**) pour rester alignés sur le board.

---

## 0. Ce que ce document décide — et ce qu'il ne décide pas

Il **décide** : quels chantiers entrent dans la vague 2, ce que « fini » veut dire pour chacun, ce qui en sort, et quels arbitrages remontent au propriétaire.

Il **ne décide pas** : l'implémentation (c'est le rôle des chantiers), ni la modification de `schema.prisma` (réservée au Chief of Staff, seul, avant de lancer la vague — règle 1 du KANBAN). Les tables de la vague 2 **existent déjà** : la migration est appliquée, il n'y a **rien à ajouter au schéma pour E, F, G, H, I, J**. Le chantier K se contente de remplir `VariantPrice` et `ExchangeRate`. Toute demande de migration pendant la vague 2 est un signal d'alarme, pas une étape normale.

**Contrainte non négociable rappelée en tête** : **aucun compte tiers**. Pas de Stripe réel, pas d'agrégateur Mobile Money, pas de SMTP/Resend, pas de bucket S3/Cloudinary, pas d'API de taux de change. Tout reste simulé ou local. Aucun chantier ci-dessous ne déroge à cette règle, et aucun critère d'acceptation ne l'exige.

---

## 1. État des lieux et conditions d'entrée

### Acquis, vérifiés

| Domaine | Preuve |
|---|---|
| Catalogue, variantes, panier persistant, checkout invité | 210/210 Vitest, 2/2 Playwright prod |
| Paiements simulés (Mobile Money, virement, mock) + remboursement complet | vérifié en prod (`REFUNDED`, idempotent) |
| Back-office (dashboard, commandes, produits, stock, journal emails), espace client, recherche/tri/pagination | 11/11 + 9/9 contrôles visuels, 0 erreur JS |
| Rôles ADMIN/STAFF, 2FA TOTP, journal d'audit, jeton d'accès commande | vérifié en prod (401/404/404/200) |
| Schéma étendu (29 tables) | migration `20260918122329_v1_features` |

### Conditions d'entrée de la vague 2 (à satisfaire AVANT de lancer le lot 2A)

1. **La vague 1 passe en ✅ sur preuve.** Le chantier « espace client » est en 🟡 avec une réserve explicite (test `Order_customerId_fkey` à reprendre, agent coupé en timeout). On n'empile pas une vague sur une carte dont on ne sait pas si elle tient. Le PO refuse d'ouvrir la vague 2 tant que cette carte n'est pas verte ou **explicitement retirée du périmètre**.
2. **Le mot de passe admin de démonstration (`admin1234`) est changé**, et la question du rate limiting sur la connexion et sur le checkout est **vérifiée en production**, pas relue dans un document. `KNOWN-ISSUES.md` affirme « pas de limitation de débit sur les tentatives de connexion », `KANBAN.md` affirme « 401 ×5 puis 429, vérifié en prod » : une des deux pages est périmée. Une seule commande curl tranche — et cette vérification vaut preuve, pas la lecture.
3. **Une commande de test complète** (panier → paiement simulé → commande) est rejouée en production le jour du lancement de la vague, pour avoir une base de comparaison avant/après.

> Ces trois points ne sont pas du zèle : le risque n°1 d'une vague 2 sur un socle non vérifié est de re-déboguer la vague 1 en croyant déboguer la vague 2.

---

## 2. Priorisation argumentée des 7 chantiers

### Grille de lecture

- **Effort** : `S` ≈ ≤ 2 jours-agent · `M` ≈ 3–6 jours-agent · `L` ≈ > 1 semaine-agent (ou touche beaucoup de fichiers partagés).
- **Valeur** : cote de 1 (accessoire) à 5 (bloque la conversion ou protège l'argent).
- La colonne **décision** est ce que ce document tranche : `IN` (vague 2), `IN réduit` (vague 2 avec périmètre volontairement amputé), `OUT` (renvoyé, avec raison écrite).

| # | Chantier | Persona principal | Valeur | Effort | Décision | Lot |
|---|----------|-------------------|:------:|:------:|----------|-----|
| I | Réconciliation des paiements `PENDING` | Jules, Fatou | **5** | M | **IN** | 2A |
| J | Observabilité + sauvegardes | Fatou, Jules | **4** | M | **IN** | 2A |
| H | Téléversement d'images produits | Fatou | **5** | M | **IN** | 2C |
| E | Codes promo | Fatou, Aïcha | **4** | M | **IN réduit** | 2B |
| F | Avis clients modérés | Marc, Aïcha, Fatou | **4** | M | **IN réduit** | 2B |
| K | Multi-devise EUR/XAF | Fatou, Aïcha | **4** | L | **IN réduit, sacrifiable** | 2D |
| G | Favoris / wishlist | Aïcha | 2 | S | **OUT** | vague 3 |

### Argumentaire, chantier par chantier

**I — Réconciliation des paiements `PENDING` (IN, lot 2A, en premier).**
Personas : **Jules** (il ne sait pas quoi préparer) et **Fatou** (elle ne sait pas si elle a été payée). Un paiement bloqué en `PENDING` a aujourd'hui deux issues, toutes les deux mauvaises : la commande reste en attente pour toujours et le stock réservé ne redescend jamais (stock fantôme = rupture de vente invisible), ou Fatou expédie sans être payée. Le champ `nextReconcileAt` et l'index `[status, nextReconcileAt]` sont déjà en base, la table `JobRun` aussi : c'est le chantier avec le meilleur rapport valeur / effort de la vague, et c'est un **filet de sécurité**, donc il passe avant les fonctionnalités qui rapportent. Sans lui, KPI K3 (« taux de panne paiement ») n'est pas mesurable.

**J — Observabilité + sauvegardes (IN, lot 2A, indissociable de I).**
Personas : **Fatou** (elle doit savoir que la boutique va bien sans lire des logs) et **Jules** (il doit voir qu'une tâche a échoué). Le chantier I écrit des `JobRun` ; encore faut-il que quelqu'un les regarde. Et surtout, la vague 2 ajoute des **données irremplaçables** : des photos téléversées (H) qui n'existent nulle part ailleurs, et des codes promo dont l'historique de consommation (E) sert de preuve en cas de litige. Une sauvegarde qui n'a jamais été restaurée n'est pas une sauvegarde : l'exercice de restauration est un critère de sortie, pas une ligne de runbook. Effort M parce qu'il ne s'agit pas d'installer un outil tiers (interdit) mais d'écrire un script, de le planifier, de le tracer et de le tester.

**H — Téléversement d'images produits (IN, lot 2C).**
Persona : **Fatou**, et elle seule. `KNOWN-ISSUES.md` est catégorique : « une boutique textile sans photos réelles ne convertira pas complètement », et la table `ProductImage` porte déjà `mimeType` / `sizeBytes` / `width` / `height` / `alt` obligatoire et une contrainte d'ordre. Sans téléversement, Fatou ne peut pas mettre **ses** produits en ligne ; les 6 packshots actuels sont des visuels générés, c'est-à-dire une démonstration. Aujourd'hui elle dépend d'un tiers pour chaque photo : c'est le plus gros frein opérationnel restant, et il concerne le persona principal. Valeur 5. Il est en 2C (et pas 2A) uniquement parce qu'il dépend de J : un téléversement non sauvegardé est une perte de travail.

**E — Codes promo (IN réduit, lot 2B).**
Personas : **Fatou** d'abord — elle vend via les réseaux sociaux, un code est son seul levier de campagne mesurable ; **Aïcha** ensuite (un code de bienvenue convertit un panier hésitant) ; **Marc** enfin (offrir une remise à un proche). Tables prêtes (`PromoCode`, `PromoRedemption`, `Cart.promoCode`, `Cart.discountCents`, `Order.discountCents`). Décision **IN réduit** : un seul code par commande, pas de cumul, pas de ciblage par produit ni par catégorie, pas de livraison gratuite par code. C'est un chantier **où le périmètre compte plus que la fonctionnalité** : la version riche (stacking + ciblage + conditions d'éligibilité) est exactement le terrain où l'on perd de la marge sans le voir (risque R4). Valeur 4, effort M, et le coût réel est dans les cas limites, pas dans l'écran d'administration.

**F — Avis clients modérés (IN réduit, lot 2B).**
Personas : **Marc** (« compare les avis » est écrit noir sur blanc dans son profil) ; **Aïcha** (sur ce marché, la recommandation pèse plus que la fiche produit) ; **Fatou** (des avis rattachés à des commandes sont du contenu gratuit **et** une remontée sur la qualité). Décision **IN réduit** : avis **uniquement rattachés à une commande** (donc preuve d'achat), modération obligatoire avant publication, pas de photo dans un avis, pas de réponse publique de la marchande. Le modèle `Review` est prêt (statut `PENDING` par défaut, `orderId`, `moderatedBy`). Valeur 4, effort M : la modération n'est pas un écran, c'est un **rituel** qui doit tenir avec 1–3 personnes — d'où les critères « compteur visible » et « PENDING de plus de 7 jours = 0 ».

**K — Multi-devise EUR/XAF (IN réduit, sacrifiable, lot 2D).**
Personas : **Fatou** (elle pense en FCFA : « 29 000 FCFA » est un prix rond, « 44,20 € » n'existe pas dans sa tête, ni dans la rue) et **Aïcha** (un prix en euros sur une boutique qui livre à Douala est un signal d'étrangeté, et elle paie en Mobile Money en FCFA). Valeur 4, et c'est le seul chantier qui touche le **cœur identitaire** du projet : aujourd'hui tous les affichages passent par `formatMoneyEur`, la devise de référence est l'euro en dur, et le back-office raisonne en centimes d'euro.

Deux faits techniques changent le calcul habituel (« la multi-devise, c'est cher et risqué ») :
1. **Le franc CFA est arrimé à l'euro à taux fixe** (1 EUR = 655,957 XAF, parité garantie par la Banque de France). Il n'y a donc **aucune API de taux à brancher** — ce qui aurait violé la contrainte « aucun compte tiers ». Le taux devient une ligne en base, stable par construction.
2. **XAF n'a pas de sous-unité** (exposant 0). C'est le piège : convertir 1 000 « centimes » EUR en 655 957 « centimes » XAF est une erreur d'un facteur 100. Un helper qui suppose deux décimales partout se trompe de 100× sur le prix affiché.

Malgré cela, K reste **`IN réduit, sacrifiable`** : c'est le seul chantier de la vague qui touche presque tous les fichiers de rendu de prix (donc qui entre en collision avec E et F, cf. règle « un chantier = des fichiers disjoints »), et le seul dont le dérapage coûterait la vague entière. Périmètre retenu : **deux devises seulement**, devise choisie à la boutique (pas de détection automatique par visiteur), prix explicites prioritaires, conversion par taux en base en repli. Si les lots 2A–2C dérapent, **2D est le premier abandonné** — aucun autre lot n'en dépend, c'est une décision de cadrage, pas un échec.

**G — Favoris / wishlist (OUT, vague 3).**
Persona : **Aïcha** (sauvegarder un article pour plus tard quand elle n'a plus de forfait data). Valeur 2 — la plus basse des sept, et pour une raison structurelle : **le panier est déjà persistant** (il survit à la fermeture du navigateur), et un favori n'a de valeur que s'il existe un canal pour le raviver. Or **il n'y a pas de canal** : pas de SMTP, pas de notification, pas de relance panier. Un favori sans relance est un signet, et un panier suffit comme signet. Rajouter une surface (fusion invité → connecté, doublons, affichage des indisponibles) pour un gain non démontré, ce n'est pas une priorité. Tables prêtes : le coût de report est nul, on les gardera pour la vague 3 quand un vrai canal d'email existera.

---

## 3. Chantiers retenus — user stories et critères d'acceptation

> Convention de lecture : `AC :` = critère d'acceptation testable. Un chantier ne passe en ✅ que sur preuve d'exécution (tests verts, `tsc` 0, contrôle en production pour une carte visible) — règle 4 du KANBAN. Un AC non vérifiable automatiquement doit au minimum être vérifié à la main **et daté**.

### 3.1 Lot 2A — I. Réconciliation des paiements bloqués

**I1.** En tant que **Fatou**, je veux **voir la liste des paiements bloqués** afin de **savoir lesquels je ne dois pas expédier**.
- AC : `/admin/paiements` liste les `Payment` en `PENDING` triés par âge décroissant, avec : numéro de commande, client, montant + devise, fournisseur, date de création, âge en heures, `reconcileAttempts`, `lastCheckedAt`, `nextReconcileAt`.
- AC : la page affiche en tête un compteur « PENDING > 24 h : N » ; N = 0 est l'état attendu (cf. KPI K9).
- AC : la page est accessible à STAFF en lecture ; les actions restent réservées aux capacités de la matrice `CONVENTIONS §13` (aucun `if (role === 'ADMIN')` dans le code).

**I2.** En tant que **l'application**, je veux **réinterroger périodiquement chaque paiement en attente** afin qu'aucun paiement ne reste bloqué pour toujours.
- AC : une tâche `reconcile-payments` sélectionne les `Payment.status = PENDING` avec `nextReconcileAt <= now()` (index `[status, nextReconcileAt]`), appelle `capture()` du fournisseur d'origine du paiement, et applique le résultat **via `applyPaymentOutcome()`** — la fonction unique et idempotente déjà en place (aucune seconde implémentation de transition de paiement).
- AC : chaque exécution écrit **exactement un** `JobRun` (`name = "reconcile-payments"`, `status`, `startedAt`, `finishedAt`, `meta = { checked, succeeded, failed, stillPending }`) y compris en erreur (avec `error` renseigné).
- AC : backoff borné — `reconcileAttempts += 1` et `nextReconcileAt = now() + min(2^attempts minutes, 24 h)`.
- AC : **aucune annulation silencieuse.** Un paiement arrivé au bout des tentatives reste `PENDING` et remonte en tête de `/admin/paiements` avec la mention « à traiter manuellement ». L'application ne décide pas à la place de Fatou (cf. décision D6).
- AC : la tâche est déclenchable par un cron système (ou un planificateur Coolify) et **manuellement** via une route protégée par un secret d'environnement (`CRON_SECRET`) — aucune dépendance à un service tiers, et la route renvoie 401 sans secret valide (vérifié en prod).
- AC : passer la réconciliation deux fois de suite ne produit **jamais** un double décrément de stock ni un double email — l'idempotence de `applyPaymentOutcome` est prouvée par un test, pas supposée.
- AC : un paiement confirmé entre-temps par un callback Mobile Money ne peut pas être rétrogradé en `FAILED` par la réconciliation (test : callback puis réconciliation → statut inchangé).

**I3.** En tant que **Jules**, je veux **relancer une vérification à la main** afin de **débloquer une commande sans attendre la prochaine exécution**.
- AC : action « Vérifier maintenant » sur un paiement → exécute la réconciliation sur **ce seul** paiement et affiche le résultat en clair (confirmé / toujours en attente / échec).
- AC : action « Marquer payé » (virement reçu en banque) réservée à ADMIN, écrit un `AuditLog` avec l'utilisateur, l'entité et le diff.

### 3.2 Lot 2A — J. Observabilité et sauvegardes

**J1.** En tant que **Fatou**, je veux **savoir que la boutique fonctionne** afin de **ne pas découvrir une panne par un client mécontent**.
- AC : `/api/health` renvoie `{ ok, version, db: "up" | "down", durationMs }` ; 503 si la base ne répond pas ; aucun secret, aucune version d'infrastructure sensible dans la réponse.
- AC : `/admin/taches` affiche les 20 derniers `JobRun` (nom, statut, durée, message d'erreur) — un job en échec est **visible dans le back-office**, sans accès SSH et sans lire un fichier de log.
- AC : la section « Alertes » du dashboard affiche un avertissement si un même job a **3 `FAILED` consécutifs** ; en l'absence d'alertes, la section affiche explicitement « Aucune alerte » (un vide silencieux n'est pas une information).
- AC : aucun email d'alerte n'est requis (pas de SMTP) — l'alerte est dans l'interface, et c'est assumé.

**J2.** En tant que **l'équipe**, je veux **restaurer la boutique après une perte de données** afin de **repartir en moins d'une heure**.
- AC : la sauvegarde est un script documenté dans `RUNBOOK.md` : commande exacte, fréquence quotidienne, rétention 7 jours, emplacement de destination **hors du conteneur applicatif**.
- AC : la sauvegarde couvre **la base ET le dossier des téléversements** (lot H) — restaurer l'un sans l'autre produit des fiches produit pointant vers des images inexistantes. C'est un critère, pas un conseil.
- AC : **une restauration est exécutée et réussie au moins une fois pendant la vague**, vers une base jetable, avec vérification du nombre de commandes, de produits et de la présence des fichiers images. La preuve est la sortie de la restauration, datée, collée dans `RUNBOOK.md`.
- AC : le runbook indique la durée mesurée de la restauration (pour savoir si l'objectif « moins d'une heure » tient réellement).

### 3.3 Lot 2B — E. Codes promo

**E1.** En tant que **Fatou**, je veux **créer un code promo pour une campagne** afin de **mesurer ce que la campagne m'a rapporté**.
- AC : `/admin/promos` — création / édition / désactivation. Champs : `code` (3–24 caractères, `A–Z 0–9 -`, **stocké en majuscules**, unicité garantie), `kind` (`PERCENT | FIXED`), `value` (> 0 ; `PERCENT` ≤ 90), `minSubtotalCents`, `startsAt`, `endsAt`, `maxRedemptions`, `maxPerCustomer`, `active`.
- AC : un code créé est **inactif par défaut** ; l'activation est un geste explicite. Un code activé sans date de fin est accepté mais signalé à l'écran comme « sans fin ».
- AC : la liste affiche par code : nombre d'utilisations / plafond, **montant total remisé**, et le statut déduit (à venir / actif / expiré / épuisé / désactivé). Fatou doit voir ce que le code lui **coûte**, pas seulement combien de fois il a servi.
- AC : `PERCENT` et `FIXED` dans la même campagne ne se cumulent pas — jamais deux remises sur une commande (cf. décision D1).

**E2.** En tant qu'**Aïcha**, je veux **saisir mon code dans le panier** afin de **voir ma remise avant de payer**.
- AC : champ code dans `/cart`. Un code valide affiche la remise en clair (« −1 000 FCFA », ligne distincte) et le total recalculé.
- AC : un code refusé affiche une raison **distincte et actionnable** : expiré (avec la date) / pas encore commencé (avec la date) / désactivé / sous-total insuffisant (avec **le montant manquant**) / plafond global atteint / déjà utilisé par ce client. Jamais un « code invalide » générique : Aïcha doit savoir quoi corriger.
- AC : la remise est **recalculée à chaque affichage et à la commande** à partir de `Cart.promoCode` (le calcul n'est jamais figé en cache) — un code qui expire entre l'ajout au panier et le paiement ne s'applique pas, sans erreur pour le client.
- AC : `discountCents = min(remise calculée, subtotalCents)` — le total ne peut **jamais** être négatif. La livraison n'est jamais remisée en vague 2.
- AC : nouveau code saisi → l'ancien est remplacé (pas d'accumulation, pas de stacking).
- AC : retirer le code remet le total initial à l'identique.

**E3.** En tant que **l'application**, je veux **consommer un usage de code de façon atomique** afin qu'**un plafond ne soit jamais dépassé**.
- AC : la `PromoRedemption` est écrite dans la **même transaction** que la création de la commande, et les contrôles `maxRedemptions` / `maxPerCustomer` sont évalués **dans** la transaction (isolation `Serializable`, retry borné — `CONVENTIONS §12`), avec la contrainte `@@unique(orderId)` comme dernier filet.
- AC : test obligatoire — deux checkouts concurrents sur un code `maxRedemptions = 1` produisent **une** commande remisée et **une** commande sans remise (ou un refus explicite) ; jamais deux remises.
- AC : `Order.discountCents` et `Order.totalCents` portent la remise ; la confirmation de commande et l'email `order_confirmation` affichent sous-total / remise (avec le code) / livraison / total.
- AC : `PromoRedemption.orderId` reste unique — rejouer le checkout ne consomme pas un second usage.
- AC : test unitaire du calcul : `PERCENT 10` sur un sous-total de 10 000 → remise 1 000, total 9 000 + livraison ; `FIXED 20 000` sur un sous-total de 5 000 → remise 5 000, total = livraison seule. Aucun `Float` dans le chemin de calcul.
- AC : une commande annulée ou remboursée **libère** l'usage (la `PromoRedemption` est supprimée, le compte d'utilisations redescend) tout en laissant une trace dans le journal d'audit (décision D3).

### 3.4 Lot 2B — F. Avis clients modérés

**F1.** En tant que **Marc**, je veux **lire des avis vérifiés** afin de **me décider avant d'acheter** (et commander pour ma famille au pays en confiance).
- AC : la fiche produit affiche la note moyenne, le nombre d'avis et les avis `APPROVED` uniquement, les plus récents d'abord, avec pagination.
- AC : la note moyenne est arrondie à une décimale et n'est **affichée que s'il existe au moins un avis approuvé** — un produit neuf n'affiche pas « 0,0 » ni cinq étoiles vides (un zéro affiché est pire que rien).
- AC : un avis rattaché à une commande porte la mention « Achat vérifié ».
- AC : balisage `JSON-LD AggregateRating` présent **uniquement** si des avis approuvés existent.

**F2.** En tant qu'**Aïcha**, je veux **donner mon avis** afin de **partager mon expérience** (le bouche-à-oreille est la norme sur ce marché).
- AC : le formulaire n'est proposé que depuis une commande **réellement passée** (lien « Laisser un avis » sur la page de commande) — aucun avis anonyme sans commande.
- AC : champs : note 1–5 (obligatoire), titre (optionnel, ≤ 80 car.), texte (obligatoire, ≤ 1 000 car.), nom affiché. À la soumission : `status = PENDING` et message explicite « Merci, votre avis sera publié après vérification ».
- AC : un client ne peut déposer qu'**un avis par produit** (`@@unique([productId, customerId])`) ; une seconde tentative affiche un message compréhensible, jamais une erreur 500.
- AC : aucun HTML n'est rendu depuis le corps d'avis ; une URL dans un avis est refusée à la soumission ou neutralisée à l'affichage (test : `<script>` et `<a href>` ne produisent aucun élément dans le DOM).

**F3.** En tant que **Jules**, je veux **modérer les avis en attente** afin de **protéger la réputation de la boutique**.
- AC : `/admin/avis` filtrée par statut (`PENDING` par défaut), avec **compteur de `PENDING` visible dans la navigation** — une file invisible n'est jamais modérée.
- AC : actions Approuver / Rejeter (motif libre), qui renseignent `moderatedById` + `moderatedAt` et écrivent un `AuditLog`.
- AC : un avis `PENDING` ou `REJECTED` n'est **jamais** accessible publiquement, y compris par URL directe, et n'entre dans aucune moyenne (vérifié en production).
- AC : le compteur `PENDING` retombe à 0 après modération (pas de file fantôme).

### 3.5 Lot 2C — H. Téléversement d'images produits

**H1.** En tant que **Fatou**, je veux **téléverser les photos de mes produits depuis mon téléphone** afin de **publier mes vrais articles**.
- AC : depuis la fiche produit (admin), téléversement multiple (jusqu'à 6 visuels par produit) ; réordonnancement respectant `@@unique([productId, position])` ; suppression unitaire ; champ `alt` **obligatoire** (l'enregistrement est refusé sans alt, avec un message explicite) — un visuel sans texte alternatif est inaccessible.
- AC : types acceptés **JPEG, PNG, WebP uniquement**, vérifiés par **signature binaire** du fichier (ni l'extension ni le `Content-Type` envoyé par le client ne font foi) ; SVG **refusé** à la fois comme fichier tiers et comme source d'image (vecteur d'exécution de script) ; taille max 5 Mo par fichier ; un refus explique la cause (type ou taille).
- AC : le serveur **re-encode** l'image (l'original téléversé n'est jamais servi tel quel) et produit les tailles utilisées par l'interface, avec `width` / `height` enregistrés pour réserver la place — zéro décalage de mise en page pendant le chargement (critique en 3G, cf. commentaire du schéma).
- AC : stockage sur le **volume local** du serveur, servi avec `Content-Type` issu de `mimeType` et un `Cache-Control` long ; aucun bucket ni service tiers.
- AC : quota affiché dans l'administration (espace utilisé) et refus au-delà de la limite configurée (`QUOTA_UPLOADS_MB`, défaut 500 Mo) avec un message actionnable — pas de remplissage de disque silencieux.
- AC : supprimer un visuel supprime le fichier **et compacte les positions** restantes (pas de trou dans l'ordre d'affichage).
- AC : si un produit n'a aucun visuel, le repli de rendu existant (`ProductVisual`) prend le relais — aucune fiche produit ne casse.
- AC : le dossier des téléversements est **dans le périmètre de sauvegarde** (dépendance J) et la restauration testée du lot J inclut une image vérifiée à l'écran.
- AC : 3 images téléversées apparaissent dans le bon ordre sur la fiche produit publique (contrôle en production, pas seulement en test local).

### 3.6 Lot 2D — K. Multi-devise EUR/XAF *(lot sacrifiable)*

**K1.** En tant que **Fatou**, je veux **tenir ma boutique en FCFA** afin de **vendre aux prix du marché et pas au prix d'un convertisseur**.
- AC : `SHOP_CURRENCY` accepte `XAF` (en plus de `EUR`). Quand la boutique est en XAF, **tous** les affichages — catalogue, fiche produit, panier, checkout, confirmation, espace client, back-office, email de confirmation — sont en FCFA, formatés selon l'**exposant de la devise** : `29 000 FCFA`, jamais `29 000,00 FCFA`, jamais un montant en euros.
- AC : un prix `VariantPrice` explicite **prime toujours** sur la conversion et n'est jamais écrasé par un calcul de taux. La conversion n'est qu'un repli pour les variantes sans prix explicite dans la devise de la boutique.
- AC : le taux de conversion vit dans `ExchangeRate` (jamais codé en dur dans un composant de rendu) ; la valeur initiale EUR→XAF est le taux d'arrimage officiel (1 EUR = 655,957 XAF), saisissable par ADMIN via le back-office.
- AC : **piège d'exposant traité explicitement** — un helper unique est le seul chemin de conversion, il applique l'exposant ISO 4217 de **chaque** devise. Test obligatoire : `1 000` (centimes EUR) → **6 560 XAF**, et non `655 957` (le bug attendu si l'on suppose deux décimales partout). Aucun `Float` dans le chemin de calcul.
- AC : la conversion se fait **ligne par ligne**, puis on additionne — jamais en convertissant un total déjà arrondi (source d'écart de 1 à 2 XAF visible sur la facture).
- AC : une commande est **figée dans sa devise** : `Order.currency`, `OrderItem.unitPriceCents`, sous-total, remise, livraison et total sont des copies définitives ; modifier un taux ou un prix produit ensuite ne change **jamais** une commande existante (source de vérité = snapshot).
- AC : le dashboard admin **n'additionne jamais deux devises** : le CA est présenté par devise, la devise est écrite en clair dans l'en-tête de chaque bloc ; aucun total fusionné (décision D4).
- AC : le paiement Mobile Money simulé exige un montant **dans la devise de la commande** ; aucune conversion silencieuse au moment de payer ; le montant payé affiché = le montant de la commande, au centime/franc près.
- AC : contrat négatif — payer une commande en XAF avec un montant EUR (ou l'inverse) est **refusé**, pas converti à la volée.
- AC : aucune régression sur la suite existante : `npx vitest run` reste intégralement vert après le passage des affichages au helper multi-devise (c'est le vrai test de ce chantier, il touche tout).

---

## 4. KPIs de la vague 2 et critère de sortie

| # | KPI | Cible | Source de mesure |
|---|-----|-------|------------------|
| K6 | **Coût des remises** (remises accordées / CA du mois) | ≤ 8 % | `PromoRedemption.amountCents` / `Order.totalCents` |
| K7 | **Avis déposés** sur commandes livrées | ≥ 30 % sur les 100 premières commandes livrées | `Review` / `Order` |
| K8 | **Délai de modération** des avis (médiane) | ≤ 48 h ouvrées ; **0** avis `PENDING` > 7 jours | `Review.moderatedAt - Review.createdAt` |
| K9 | **Paiements bloqués** > 24 h en `PENDING` | **0** ; tout `PENDING` a reçu ≥ 1 tentative de réconciliation sous 2 h | `Payment.reconcileAttempts`, `lastCheckedAt` |
| K10 | **Sauvegarde** | dernière restauration réussie < 30 jours ; 0 job en échec non vu > 7 jours | `JobRun` + `RUNBOOK.md` |
| K11 | **Produits réellement illustrés** | ≥ 80 % des produits actifs ont ≥ 1 visuel téléversé avec `alt` ; **0** fiche sans visuel | `ProductImage` |
| K12 | **Cohérence des montants** (si K livré) | 0 commande dont la devise ou le montant diffère de ce qui a été affiché au client | `Order` vs écran de paiement |
| K13 | **Non-régression** | 100 % des tests Vitest verts + `tsc` 0 + les 2 Playwright verts à chaque fin de lot | CI |

**Critère de sortie de la vague 2** — les trois conditions, aucune n'étant optionnelle :
1. chaque carte retenue a une **preuve d'exécution** (tests verts, `tsc` 0, contrôle en production pour une carte visible) ;
2. **K9 = 0** et une **restauration réussie datée** existe dans `RUNBOOK.md` (K10) ;
3. les décisions D1–D6 sont **tranchées par écrit** par le propriétaire, ou explicitement reportées avec leur valeur par défaut appliquée.

Le code écrit ne suffit jamais à passer une carte en ✅ — c'est la règle 4 du KANBAN, et la vague 1 a déjà montré ce que coûte de l'oublier (une carte livrée en 🟡 pendant que l'agent était coupé).

---

## 5. Hors-périmètre EXPLICITE (vague 2)

> Un bon cadrage dit non. Ce qui suit est **hors périmètre**, et le rester est une décision, pas un oubli.

| Fonctionnalité | Pourquoi on s'en passe (vague 2) |
|---|---|
| **Favoris / wishlist** (chantier G) | Le panier est déjà persistant et aucun canal ne permet de relancer un favori (pas de SMTP). Valeur non démontrée, surface de fusion invité→connecté en plus. Reporté vague 3. |
| **Cumul de codes promo** (stacking) | Explosion combinatoire des règles, et fuite de marge invisible. Un seul code par commande. |
| **Code promo ciblé** (par produit, catégorie, 1ʳᵉ commande, client précis) | Multiplie les conditions à tester pour un gain marketing marginal. Un code global suffit à lancer une campagne. |
| **Livraison gratuite par code promo** | Se cumule avec les frais de port et complique la lecture de la marge. La livraison a ses propres seuils. |
| **Avis avec photos** | Double la surface de modération et de stockage (et donc la sauvegarde). Le texte suffit en vague 2. |
| **Réponse publique de la marchande à un avis** | Risque de dérapage public (répondre sous le coup de l'émotion). Le contact se fait en privé. |
| **Avis anonymes / sans commande** | Contredit la preuve d'achat et ouvre la porte aux faux avis — le modèle exige un `orderId`. |
| **Envoi d'emails réel (SMTP / Resend)** | Décision explicite et répétée : aucun compte tiers. Les emails restent dans `EmailOutbox`. Conséquence assumée : les KPIs qui dépendent d'un email (NPS J+7) restent non mesurés. |
| **Stockage des images chez un tiers** (S3, Cloudinary, CDN) | Aucun compte tiers. Volume local, sauvegardé avec la base. |
| **Édition / retouche d'image dans l'admin** (recadrage, filtres) | Le téléversement et le re-encodage suffisent ; une retouche intégrée est un produit à elle seule. |
| **Plus de deux devises** (USD, GBP…) | Taux, arrondis et reporting à multiplier. EUR + XAF couvrent la cible réelle. |
| **Devise détectée automatiquement par visiteur** (IP, navigateur) | Un client qui voit un prix changer de devise sans comprendre pourquoi perd confiance ; et cela force un panier multi-devises. La devise est un réglage de la boutique. |
| **Taux de change en direct (API)** | Interdit (compte tiers), et inutile : le franc CFA est arrimé à l'euro à taux fixe. |
| **Remboursement partiel** | Le remboursement complet est livré et couvre le cas réel. Le partiel ouvre la comptabilité au prorata (remise, livraison, plusieurs articles) pour un besoin non exprimé. |
| **Retours / échanges / RMA** | Processus métier entier (état du produit, réexpédition). À traiter quand il y aura un vrai volume de retours. |
| **Réconciliation automatique côté agrégateur Mobile Money réel** | Pas d'agrégateur (aucun compte tiers). La réconciliation interroge nos propres fournisseurs simulés — le mécanisme est conçu pour brancher un vrai provider sans réécriture, il n'est pas branché. |
| **Facture PDF** | Un récapitulatif de commande imprimable suffit ; une facture conforme est une décision juridique, pas une carte de dev. |
| **Pages légales (CGV, mentions, confidentialité)** | Décision juridique, pas technique. Reste au backlog. |
| **Alertes par email ou SMS** | Aucun compte tiers. Les alertes vivent dans le back-office (lot J). |
| **2FA obligatoire pour les ADMIN** | À décider une fois la 2FA optionnelle validée en usage réel. |
| **Multi-langue (i18n)** | Marché francophone. 100 % FR, comme au MVP. |
| **App mobile native / application hors-ligne** | Le web mobile-first suffit pour 100–500 commandes/mois. |
| **Programme de fidélité, parrainage, abonnement** | Aucune mesure de rétention fiable à ce stade (et pas de canal email). |
| **Tableau de bord avancé** (cohortes, LTV, entonnoir analytics) | KPI non actionnables à cette échelle ; le dashboard actuel répond aux questions de Fatou. |

---

## 6. Risques nouveaux introduits par la vague 2

Les risques R1–R3 du brief MVP restent valides ; R1 (Mobile Money) est désormais **partiellement traité** par le lot 2A.

### R4 — Code promo mal validé = perte de marge silencieuse

- **Description** : une remise mal calculée, appliquée deux fois, cumulée, ou issue d'une valeur envoyée par le client, ne casse rien visiblement : elle réduit juste la marge. Fatou ne s'en aperçoit qu'à la fin du mois, quand 40 commandes ont bénéficié de 30 % au lieu de 10 %. C'est le risque le plus **insidieux** de la vague parce qu'il est invisible dans les tests de bout en bout.
- **Mitigation** :
  - **Un seul** chemin de calcul (`computePromo` dans `src/domain/`), appelé par le panier **et** par le checkout. Aucune remise ne vient jamais du client : le client envoie un **code**, le serveur calcule le montant.
  - Plafonds (`maxRedemptions`, `maxPerCustomer`) évalués **dans la transaction** de création de commande, `Serializable` + retry borné, `@@unique(orderId)` en filet.
  - `discountCents = min(calculé, subtotalCents)` : test de borne obligatoire, le total ne peut pas être négatif.
  - Test de concurrence (deux checkouts simultanés, `maxRedemptions = 1`) comme critère d'acceptation, pas comme bonne intention.
  - Le coût du code est **affiché** dans l'administration (`amountCents` cumulé) : ce qui est visible se contrôle.

### R5 — Avis : faux avis, contenu illégal, fuite de données personnelles

- **Description** : un avis non modéré publié automatiquement peut contenir une insulte, un lien de phishing, un numéro de téléphone, ou venir d'un concurrent. Sur une boutique dont la promesse est la confiance, un seul avis affiché à 3 h du matin peut coûter des semaines de réputation. Le formulaire d'avis est par ailleurs un **formulaire public d'écriture** : c'est une surface d'attaque (spam, injection).
- **Mitigation** :
  - `PENDING` obligatoire ; **rien** n'est public avant approbation, même par URL directe.
  - Avis **rattaché à une commande** (preuve d'achat) et un seul avis par client et par produit.
  - Aucun HTML rendu ; URL refusée ou neutralisée ; limites de longueur strictes côté serveur (pas seulement côté formulaire).
  - Modération journalisée (`moderatedBy`, `AuditLog`) : qui a approuvé quoi est traçable.
  - File de modération visible (compteur dans la navigation) : le risque réel n'est pas la modération, c'est la **file oubliée**.

### R6 — Téléversement d'images = surface d'attaque et remplissage de disque

- **Description** : un téléversement mal filtré, c'est au mieux un fichier de 200 Mo qui bloque le conteneur, au pire du code servi depuis le domaine de la boutique. Sans quota, le disque du VPS se remplit et la base tombe — y compris à cause d'un usage légitime.
- **Mitigation** :
  - Signature binaire réelle, liste blanche strict (JPEG/PNG/WebP), SVG refusé, 5 Mo max.
  - **Re-encodage** serveur : l'original n'est jamais servi, ce qui neutralise les charges utiles embarquées dans les métadonnées.
  - Quota visible et refus explicite au-delà ; les fichiers vivent sur un volume dédié.
  - Dossier de téléversements **inclus dans la sauvegarde** — sans quoi le risque se déplace : on ne perdrait pas la boutique, on perdrait ses photos.

### R7 — La réconciliation se débat avec un fournisseur muet

- **Description** : si un fournisseur de paiement ne répond jamais, un job de réconciliation naïf boucle indéfiniment (appels en boucle, logs qui gonflent) ou annule des commandes trop vite, en libérant un stock déjà promis. À l'inverse, un job qui ne borne rien laisse un paiement `PENDING` éternel et un client sans réponse.
- **Mitigation** : backoff exponentiel borné (max 24 h), nombre de tentatives tracé, statut final **jamais** décidé en silence (remontée en tête de file pour action humaine — décision D6), un `JobRun` par exécution y compris en échec, et l'annulation éventuelle qui passe par la fonction de transition unique et idempotente.

### R8 — Multi-devise : un montant client différent de celui affiché

- **Description** : c'est le pire scénario d'un site de vente — le client voit 29 000 FCFA, est débité de 29 500, et perd confiance définitivement. Les trois causes classiques : confusion d'exposant (XAF n'a pas de centimes — une erreur d'un facteur 100 est facile), conversion d'un total déjà arrondi au lieu des lignes, et recalcul d'une commande après changement de taux.
- **Mitigation** :
  - Un **seul** helper de conversion, un test explicite du piège d'exposant (`1 000` centimes EUR → `6 560` XAF), aucun `Float` dans le chemin de calcul.
  - Conversion **ligne par ligne** puis somme, jamais l'inverse.
  - **Snapshot** : la commande fige sa devise et ses montants ; aucun changement de taux ne réécrit une commande passée.
  - Un **taux unique** en base (pas de dérive, le peg est fixe) et un prix explicite qui prime sur la conversion.
  - Contrat négatif testé : devise de paiement ≠ devise de commande → refus, pas de conversion à la volée.
  - C'est aussi le chantier qui **casse le plus de choses existantes** (tous les affichages) : la suite Vitest complète est le critère de sortie, pas un bonus.

### R9 — Une sauvegarde jamais restaurée est une fausse sécurité

- **Description** : tout le monde se rassure avec un script de dump qui écrit un fichier. Le jour où il faut restaurer, on découvre que le fichier est vide, tronqué, ou que la restauration échoue sur une contrainte. La vague 2 ajoute des données irremplaçables (photos, historique de consommation des codes) : le coût de la découverte augmente.
- **Mitigation** : la **restauration testée une fois** est un critère de sortie de la vague (K10), avec la sortie de commande collée et datée dans `RUNBOOK.md`. Sauvegarde base + fichiers dans le même exercice.

### R10 — Conflits entre chantiers parallèles (risque de méthode, pas de produit)

- **Description** : la vague 1 a déjà produit un agent coupé en timeout et une carte en 🟡. La vague 2 est plus dangereuse sur ce plan : le chantier K touche **tous** les fichiers de rendu de prix, E touche panier/checkout/commande, F et H touchent la fiche produit. Deux agents sur le même fichier dans la même vague = conflit garanti.
- **Mitigation** :
  - Application stricte des règles du KANBAN : un chantier = des fichiers disjoints ; `schema.prisma` n'est touché que par le Chief of Staff, seul, avant la vague ; aucun agent ne commit.
  - **Ordre imposé** : 2A (I, J) → 2B (E, F) → 2C (H) → 2D (K). K démarre **seulement** quand E, F et H sont mergés — c'est le seul moyen d'éviter qu'il réécrive des affichages que les autres viennent de modifier.
  - Lots dimensionnés pour un sprint chacun ; **2D est sacrifiable** sans conséquence sur les autres (décision de cadrage prise maintenant, pas en cours de route).
  - Le PO refuse tout ajout de carte en cours de vague : un ajout = un lot suivant, jamais une carte de plus.

### R11 — Périmètre qui glisse (« pendant qu'on y est »)

- **Description** : les codes promo appellent le cumul, les avis appellent les photos, les images appellent le recadrage intégré, la multi-devise appelle une troisième devise. Chaque « pendant qu'on y est » repousse la sortie de la vague, et cette vague contient deux chantiers qui protègent de l'argent (I) et des données (J).
- **Mitigation** : la section 5 est la réponse écrite. Toute demande d'ajout passe par une PR sur ce fichier, et le PO a le dernier mot avec l'argument « dans quel lot, à la place de quoi ? ».

---

## 7. Décisions produit à trancher par le propriétaire

> Format : arbitrage · **avis du PO** · alternative. Une décision non tranchée applique l'avis du PO par défaut, et reste inscrite comme « décidée par défaut, à confirmer » — ce n'est pas un blocage, c'est une trace.

**D1 — Un code promo peut-il se cumuler avec un autre ?**
*Avis du PO* : **non**, un seul code par commande, jamais deux remises empilées. Le cumul est la porte d'entrée de la perte de marge (R4) et personne, côté client, ne réclame de cumuler deux codes.
*Alternative* : cumul plafonné à 30 % du sous-total. Plus généreux commercialement, mais chaque règle de cumul est une combinaison à tester et un scénario de marge négative à surveiller — je ne le recommande pas à ce stade.

**D2 — Un avis est-il publié avant modération (« post-modération ») ?**
*Avis du PO* : **non**. `PENDING` obligatoire, rien de public avant approbation. Avec 1–3 personnes, la file peut attendre 48 h ; mieux vaut un avis en retard qu'une insulte en ligne un dimanche soir.
*Alternative* : publication immédiate + retrait a posteriori, pour donner de la vie à la fiche produit plus vite. Défendable commercialement, inacceptable en gestion de réputation : ce qui est en ligne est déjà lu.

**D3 — Une commande annulée ou remboursée libère-t-elle l'usage du code promo ?**
*Avis du PO* : **oui**, libérer l'usage (la commande annulée n'a rien vendu), en conservant la trace dans le journal d'audit. Sinon Fatou voit « code déjà utilisé » pour une vente qu'elle n'a jamais encaissée, et perd du temps à comprendre.
*Alternative* : l'usage est consommé dès la création de la commande (plus simple à coder, plus rapide à expliquer). À éviter si les codes ont un faible nombre d'utilisations, ce qui sera le cas.

**D4 — Comment le tableau de bord présente-t-il un chiffre d'affaires sur deux devises ?**
*Avis du PO* : **ventilation par devise**, avec la devise écrite en clair dans l'en-tête de chaque bloc ; **jamais** de total fusionné. Additionner des FCFA et des euros produit un nombre faux, et c'est le genre de chiffre qu'on finit par citer en réunion.
*Alternative* : tout ramener à une devise de référence via le taux fixe, pour un total unique et lisible. Séduisant (et exact aujourd'hui grâce à l'arrimage), mais faux le jour où une devise non arrimée entre dans la boutique — je préfère ne pas installer l'habitude.

**D5 — Les prix XAF sont-ils saisis à la main ou convertis automatiquement du prix EUR ?**
*Avis du PO* : **saisis à la main** (`VariantPrice`) pour tout produit actif quand la boutique passe en XAF ; la conversion n'est qu'un **repli** pour les nouveaux produits, avec un indicateur « prix converti, à valider » dans l'admin. Fatou veut afficher 29 000 FCFA, pas la conversion de 44,20 €.
*Alternative* : conversion automatique seule, zéro saisie pour la marchande. Moins de travail, mais des prix qui ne ressemblent à rien localement **et** une marge qui bouge toute seule quand un prix EUR change : le second point est un vrai piège comptable.

**D6 — Que fait l'application quand un paiement reste bloqué après toutes les tentatives de réconciliation ?**
*Avis du PO* : **elle ne décide pas**. Le paiement reste `PENDING`, remonte en tête de `/admin/paiements` avec la mention « à traiter manuellement », et le stock réservé **reste** réservé tant qu'un humain n'a pas tranché (annuler ou confirmer). Un stock réservé qu'on libère automatiquement peut se retrouver vendu deux fois ; une commande annulée automatiquement peut être payée cinq minutes après.
*Alternative* : annulation automatique après 24 h + libération du stock (protège la disponibilité des articles). Défendable pour un grand volume, mais avec 100–500 commandes/mois le volume ne justifie pas de prendre le risque d'annuler une vente payée. **Si le propriétaire retient l'alternative, elle doit être visible** : la page paiements affiche « annulée automatiquement après 24 h » et l'action est réversible par un ADMIN.

**D7 — Où vivent les photos des produits ?** *(décision courte mais structurante)*
*Avis du PO* : **volume local du serveur, sauvegardé avec la base** — la contrainte « aucun compte tiers » ne laisse pas d'autre option crédible, et la solution est cohérente : un seul endroit à sauvegarder, un seul à restaurer.
*Alternative* : versionner les images dans le dépôt git (simplicité, historique, aucun volume à gérer). À refuser : dépôt qui gonfle, images dans chaque build Docker, et un marchand qui ne peut pas téléverser sans passer par un développeur — exactement ce que le projet veut éviter.

---

## 8. Séquencement de la vague 2

| Lot | Chantiers | Objectif du lot | Dépend de |
|---|---|---|---|
| **2A** | I (réconciliation) + J (observabilité, sauvegardes) | Protéger l'argent et les données avant d'ajouter des fonctionnalités | Conditions d'entrée §1 |
| **2B** | E (codes promo) + F (avis modérés) | Donner à Fatou deux leviers : convertir (remise) et rassurer (avis) | 2A (les alertes doivent exister avant d'ajouter des chemins d'écriture) |
| **2C** | H (téléversement d'images) | Rendre la boutique réellement utilisable par la marchande | 2A (les téléversements doivent être sauvegardés) |
| **2D** | K (multi-devise EUR/XAF) — **sacrifiable** | Vendre au bon prix dans le bon pays | 2B + 2C mergés (fichiers partagés libérés) |

```
2A ──► 2B ──► 2C ──► 2D (sacrifiable)
[sécurité] [leviers marchand] [vraies photos] [vraie devise]
```

**Marge** : si 2A dérape (le lot le plus incertain techniquement, parce qu'il touche au temps et aux tâches planifiées), on réduit 2D — pas 2A, pas 2C. Un chantier qui protège l'argent ne se sacrifie jamais au profit d'un chantier qui le fait circuler.

**Règle de la vague** : aucune carte n'est ajoutée en cours de route. Une idée qui arrive pendant la vague va dans le backlog du KANBAN, pas dans le lot en cours (cf. R11).

---

*Document rédigé par l'équipe Produit à partir de `PO-BRIEF.md`, `KANBAN.md`, `KNOWN-ISSUES.md`, `ARCHITECTURE.md` et du schéma Prisma effectivement migré. Toute modification du périmètre de la vague 2 doit faire l'objet d'une PR sur ce fichier.*
