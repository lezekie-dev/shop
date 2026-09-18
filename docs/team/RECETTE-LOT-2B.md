# RECETTE — LOT 2B · Codes promo (E) + Avis clients (F)

> Dérouler dans l'ordre, ligne par ligne. Chaque ligne = une action, un résultat. Aucune ligne ne demande d'interprétation.
> Ce document est un **outil de vérification**, pas un plan de correction : on constate et on consigne, on ne bricole pas.

---

## 0. Mode d'emploi (à lire une fois)

| Élément | Valeur |
|---|---|
| Base de recette | `BASE=http://localhost:3010` (dev : `docker compose --profile app up -d`) — en prod : `https://shop.app-lezekie.dev` |
| Base de données | dev : `docker exec shop-db psql -U shop -d shop -tAc '<SQL>'` — en prod : la base décrite dans `RUNBOOK.md` |
| Session admin | cookie `admin_session` (env `SESSION_COOKIE_NAME`), jar `$ADM` — ADMIN |
| Session STAFF | même cookie, jar `$STAFF` |
| Session client | cookie `customer_session`, jars `$C1` / `$C2` |
| Livraison | `SHIP=590` (défaut `SHIPPING_FLAT_CENTS`) |
| `SUB` | sous-total en centimes relevé à l'étape **P4** ; toutes les attentes du §B s'expriment en fonction de `SUB` |
| Devise | EUR, montants en **centimes entiers**. Aucun `Float` toléré dans un chemin de calcul de montant |

**Règles de lecture (valables pour toute la recette)**

1. **Un refus est un 4xx porteur d'un message distinct.** Un 5xx, un 200 silencieux, ou un « code invalide » générique = défaut, même si le parcours « marche ».
2. **Toute observation différente de la colonne « Résultat attendu » est un écart** : noter le n° de ligne, le verbe joué et la sortie exacte.
3. **La base fait foi**, pas l'écran : les lignes qui portent une requête SQL se tranchent par la requête.
4. **Contrat d'interface utilisé par cette recette.** Si le nom livré diffère, substituer *mécaniquement* partout ; toute autre différence de contrat est un écart.

| Geste | Route / URL attendue |
|---|---|
| Liste, création, édition, désactivation des codes | `/admin/promos`, `POST` / `PATCH /api/admin/promos` |
| Appliquer / retirer un code au panier | `POST` / `DELETE /api/cart/promo` — corps `{"code":"…"}` |
| Checkout | `POST /api/checkout` (existant, corps inchangé) |
| Déposer un avis | `POST /api/reviews` — corps `orderId`, `productId`, `rating`, `title?`, `body`, `authorName` |
| File de modération + actions | `/admin/avis`, `POST /api/admin/reviews/[id]/approve`, `POST /api/admin/reviews/[id]/reject` |
| Avis public | fiche produit `/products/[slug]` |

---

## P. Préparation (une fois)

```bash
BASE=${BASE:-http://localhost:3010}
PSQL='docker exec shop-db psql -U shop -d shop -tAc'
SHIP=590
ADM=/tmp/rec2b-adm.txt; STAFF=/tmp/rec2b-staff.txt; C1=/tmp/rec2b-c1.txt; C2=/tmp/rec2b-c2.txt
```

**P1.** Connexion ADMIN (mot de passe changé — condition d'entrée §1) → attendu `200`
```bash
curl -si -c $ADM -X POST $BASE/api/admin/login -H 'content-type: application/json' \
  -d '{"email":"admin@shop.local","password":"<MDP_ADMIN>"}' | head -1
```

**P2.** Deux comptes clients de recette, deux cookies distincts → attendu `200`/`201`
```bash
curl -si -c $C1 -X POST $BASE/api/account/register -H 'content-type: application/json' \
  -d '{"email":"rec1@exemple.test","password":"recette2b1","firstName":"Rec","lastName":"Un"}' | head -1
curl -si -c $C2 -X POST $BASE/api/account/register -H 'content-type: application/json' \
  -d '{"email":"rec2@exemple.test","password":"recette2b1","firstName":"Rec","lastName":"Deux"}' | head -1
```

**P3.** Relever un produit, son slug et une variante → noter `SLUG` et `VAR`
```bash
$PSQL 'select p.slug, v.id, v."priceCents" from "Variant" v join "Product" p on p.id=v."productId" limit 3;'
```

**P4.** Panier du client 1 (2 exemplaires) → noter `SUB = totals.subtotalCents`
```bash
curl -s -b $C1 -c $C1 -X POST $BASE/api/cart -H 'content-type: application/json' \
  -d '{"variantId":"<VAR>","quantity":2}'
```

**P5.** Créer un compte STAFF (via `/admin/users`) et s'y connecter dans le jar `$STAFF` → attendu `200`, rôle `STAFF`.

---

## B. Chantier E — Codes promo

### B.1 Cas nominal

| # | Ce qu'on vérifie | Comment on le vérifie (commande exacte ou URL) | Résultat attendu |
|---|---|---|---|
| B-N1 | Inactif par défaut | Créer `RECETTE10` (PERCENT, 10) depuis `/admin/promos` **sans toucher l'interrupteur**, puis `$PSQL "select code,kind,value,active from \"PromoCode\" where code='RECETTE10';"` | 1 ligne : `PERCENT`, `10`, **`active = f`** |
| B-N2 | Activation = geste explicite | Activer le code dans `/admin/promos`, relancer la requête B-N1 | `active = t` |
| B-N3 | Saisie insensible à la casse, stockage en majuscules | `curl -s -b $C1 -X POST $BASE/api/cart/promo -H 'content-type: application/json' -d '{"code":"recette10"}'` puis `$PSQL "select \"promoCode\",\"discountCents\" from \"Cart\" order by \"updatedAt\" desc limit 1;"` | 200 ; `promoCode = 'RECETTE10'` **en majuscules** ; `discountCents = SUB × 10 / 100` (entier) |
| B-N4 | Affichage de la remise dans le panier | Ouvrir `/cart` avec C1 | Ligne **distincte** « −10,00 € » (format fr-FR) et total recalculé = `SUB − remise + 5,90 €` |
| B-N5 | Commande porte la remise | `POST /api/checkout` (corps inchangé) puis `$PSQL "select number,\"subtotalCents\",\"discountCents\",\"shippingCents\",\"totalCents\" from \"Order\" order by \"placedAt\" desc limit 1;"` | `subtotalCents = SUB` ; `discountCents = SUB×10/100` ; `shippingCents = 590` **plein** ; `totalCents = subtotal − discount + shipping` |
| B-N6 | Usage consommé, une seule fois | `$PSQL "select count(*), sum(r.\"amountCents\") from \"PromoRedemption\" r join \"PromoCode\" p on p.id=r.\"promoCodeId\" where p.code='RECETTE10';"` | `1` et `sum = discountCents` de B-N5 |
| B-N7 | Confirmation et email | Ouvrir la confirmation de commande, puis `$PSQL "select template,subject,\"bodyText\" from \"EmailOutbox\" order by \"sentAt\" desc limit 1;"` | Les deux affichent **sous-total / remise (avec le code) / livraison / total** ; `template = 'order_confirmation'` |
| B-N8 | Retrait du code = retour à l'identique | `curl -s -b $C1 -X DELETE $BASE/api/cart/promo` puis `GET /api/cart` | `discountCents = 0`, `totalCents = SUB + 590` — **strictement l'état initial** ; `Cart.promoCode` nul |
| B-N9 | Un 2ᵉ code **remplace** le 1ᵉʳ (zéro cumul) | Appliquer `RECETTE10`, puis un code `RECETTE5` (PERCENT 5), relire le panier | `Cart.promoCode = 'RECETTE5'` (une seule valeur) ; remise = **5 % seule** ; la remise précédente a disparu |
| B-N10 | Statuts déduits dans la liste admin | Créer 5 codes — `PASENCORE` (`startsAt` futur), `ENCOURS` (actif), `FINI` (`endsAt` passé), `EPUISE` (`maxRedemptions` atteint), `OFF` (désactivé) — puis ouvrir `/admin/promos` | Chaque code affiche **à venir / actif / expiré / épuisé / désactivé**, plus **utilisations `n` / plafond** et **montant total remisé** |
| B-N11 | Code sans date de fin | Activer un code sans `endsAt` ; `$PSQL "select \"endsAt\" from \"PromoCode\" where code='<code>';"` | Accepté (200) et **signalé « sans fin »** à l'écran ; `endsAt` vide |
| B-N12 | Format et unicité du code | Créer `AB` (2 car.), `ABC_DEF` (underscore), puis `RECETTE10` (doublon) ; `$PSQL "select count(*) from \"PromoCode\" where code='RECETTE10';"` | 3 refus 4xx avec message explicite, **jamais 5xx** ; le compte reste `1` |
| B-N13 | Bornes de valeur | Créer PERCENT 0, PERCENT 91, FIXED 0 | 3 refus 4xx (valeur > 0 ; PERCENT ≤ 90) |
| B-N14 | Capacité et cloisonnement | Ouvrir `/admin/promos` avec `$STAFF` ; puis `curl -si $BASE/api/admin/promos` **sans cookie** | STAFF → refus (403 ou page interdite), aucune donnée servie ; sans cookie → **401** |
| B-N15 | Capacité déclarée aux deux endroits | `grep -rn "role === 'ADMIN'" src/` ; et si une capacité `promos:*` a été introduite : vérifier sa présence dans `docs/team/CONVENTIONS.md` §13 **et** dans `src/domain/access.ts` | 0 occurrence de `role === 'ADMIN'` ; capacité présente **aux deux endroits** (règle de revue §13) |
| B-N16 | Test unitaire du calcul | `pnpm vitest run` et le fichier de test promo livré | Vert ; contient `PERCENT 10 sur 10 000 → remise 1 000` et `FIXED 20 000 sur 5 000 → remise 5 000` |
| B-N17 | Aucun Float dans le calcul | `grep -rn "parseFloat\|toFixed(" src/domain/promo*.ts src/server/promo*.ts` | 0 occurrence |

### B.2 Cas limites (indispensables)

| # | Ce qu'on vérifie | Comment on le vérifie (commande exacte ou URL) | Résultat attendu |
|---|---|---|---|
| B-L1 | **Remise supérieure au panier** | Code FIXED `1000000` appliqué sur `SUB` | `discountCents = SUB` (plafonné), `totalCents = 590` (livraison seule), **jamais négatif** ; l'écran affiche la remise plafonnée |
| B-L2 | **La livraison n'est jamais remisée** | Code PERCENT 90 sur `SUB`, commande passée, `$PSQL` sur la commande | `shippingCents = 590` plein ; `totalCents = (SUB − 90 % de SUB) + 590` |
| B-L3 | **Code expiré** | Créer `EXPIRE` avec `endsAt = now() − 1 jour`, l'appliquer dans `/cart` | Refus 4xx ; le message **contient la date d'expiration** ; `Cart.discountCents = 0` |
| B-L4 | **Code pas encore commencé** | Créer un code avec `startsAt = now() + 1 jour`, l'appliquer | Refus 4xx ; le message **contient la date de début** — raison distincte de B-L3 |
| B-L5 | **Code désactivé** | Appliquer un code avec `active = f` | Refus 4xx « désactivé » — raison distincte de « expiré » |
| B-L6 | **Sous-total insuffisant** | Code `minSubtotalCents = SUB + 500`, l'appliquer | Refus 4xx mentionnant **le montant manquant** (5,00 €) — jamais « code invalide » |
| B-L7 | **Plafond global atteint** | `maxRedemptions = 1`, une 1ʳᵉ commande consomme, le client 2 applique le code | Refus 4xx « plafond atteint » ; `$PSQL "select count(*) from \"PromoRedemption\" r join \"PromoCode\" p on p.id=r.\"promoCodeId\" where p.code='<code>';"` → **1** |
| B-L8 | **Plafond par client** | `maxPerCustomer = 1`, sans plafond global : C1 consomme une fois puis retente ; C2 applique le même code | C1 → refus 4xx « déjà utilisé par ce client » ; C2 → passe |
| B-L9 | **Concurrence (obligatoire)** | `maxRedemptions = 1`, `maxPerCustomer` **nul** ; panier C1 et panier C2 portant le même code ; deux checkouts **en parallèle** : `curl … -b $C1 … & curl … -b $C2 … & wait` | **Exactement une** commande remisée ; l'autre a `discountCents = 0` (ou un refus explicite) ; `PromoRedemption` count = **1** ; jamais deux remises |
| B-L10 | **Rejeu du checkout** | Relancer le même checkout (même cookie panier) après succès ; `$PSQL "select count(*) from \"PromoRedemption\" where \"orderId\"='<orderId>';"` | 410 (panier converti) ; compte de `PromoRedemption` = **1** |
| B-L11 | **Montant falsifié par le client** | Ajouter `"discountCents":999999, "totalCents":1, "value":90` au corps de `POST /api/cart/promo` puis de `POST /api/checkout` | Champs **ignorés** : remise et total recalculés serveur, **identiques au cas nominal** ; aucune valeur issue du corps n'est écrite en base |
| B-L12 | **Code qui expire entre le panier et le paiement** | Appliquer un code, puis `$PSQL "update \"PromoCode\" set \"endsAt\"=now() - interval '1 hour' where code='<code>';"`, puis commander | Commande créée **sans remise** (`discountCents = 0`, `totalCents = SUB + 590`), **sans erreur** affichée au client ; aucun `PromoRedemption` |
| B-L13 | **Remise recalculée, jamais en cache** | Code appliqué, puis `$PSQL "update \"PromoCode\" set value=50 where code='<code>';"`, puis `GET /api/cart` | La remise servie devient 50 % : le panier ne ressert pas l'ancienne valeur |
| B-L14 | **Commande annulée / remboursée libère l'usage** (D3) | Commander avec un code, rembourser via `/admin/orders/[id]` (ADMIN), puis `$PSQL "select count(*) from \"PromoRedemption\" where \"orderId\"='<orderId>';"` et `$PSQL "select action,entity from \"AuditLog\" order by \"createdAt\" desc limit 5;"` | Compte = **0** ; le client peut **réutiliser** le code ; la trace est dans `AuditLog` |
| B-L15 | **Code inconnu** | Appliquer `NEXISTEPAS` | Refus 4xx avec raison distincte « code inconnu » — ni 5xx, ni message générique |
| B-L16 | **Plafond par client compté, pas estimé** | `maxPerCustomer = 2` : C1 consomme 2 fois, puis retente une 3ᵉ fois | 2 succès puis refus 4xx ; `$PSQL "select count(*) from \"PromoRedemption\" r join \"PromoCode\" p on p.id=r.\"promoCodeId\" where p.code='<code>' and r.\"customerId\" is not null;"` → 2 |

---

## C. Chantier F — Avis clients

### C.1 Cas nominal

| # | Ce qu'on vérifie | Comment on le vérifie (commande exacte ou URL) | Résultat attendu |
|---|---|---|---|
| C-N1 | Le formulaire n'existe que depuis une commande | Ouvrir `/orders/[token]` (commande de P4) et `/compte/commandes/[id]` avec C1 ; puis ouvrir la fiche produit | Lien **« Laisser un avis » présent** sur la page de commande ; **absent** du catalogue et de la fiche produit. Commande éligible = **payée** (`PAID`, `PREPARING`, `SHIPPED` ou `DELIVERED`) ; aucun lien sur `PENDING_PAYMENT`, `CANCELLED` ou `REFUNDED` |
| C-N2 | Dépôt d'avis → `PENDING` | `curl -s -b $C1 -X POST $BASE/api/reviews -H 'content-type: application/json' -d '{"orderId":"<id>","productId":"<id>","rating":5,"title":"Très bien","body":"Tissu solide, arrivé vite.","authorName":"Rec Un"}'` puis `$PSQL "select status,\"customerId\",\"orderId\" from \"Review\" order by \"createdAt\" desc limit 1;"` | 2xx + message « Merci, votre avis sera publié après vérification » ; `status = PENDING` ; `customerId` **non nul** ; `orderId` = celui de la commande |
| C-N3 | Rien de public avant approbation | `curl -s $BASE/products/<SLUG>` | Texte de l'avis **absent** ; aucun `aggregateRating` ; aucune note |
| C-N4 | File de modération visible | Ouvrir `/admin/avis` avec `$STAFF`, puis regarder la navigation | Liste filtrée **PENDING par défaut** ; **compteur d'avis en attente visible dans la navigation** = 1 |
| C-N5 | Approbation journalisée | `POST /api/admin/reviews/<id>/approve` avec `$STAFF` puis `$PSQL "select status,\"moderatedById\",\"moderatedAt\" from \"Review\" where id='<id>';"` et `$PSQL "select action,entity from \"AuditLog\" order by \"createdAt\" desc limit 1;"` | `APPROVED` ; `moderatedById` **et** `moderatedAt` non nuls ; une ligne d'audit écrite |
| C-N6 | Publication complète | `curl -s $BASE/products/<SLUG>` | Avis affiché avec mention **« Achat vérifié »** ; note moyenne **arrondie à 1 décimale** + nombre d'avis ; plus récent d'abord ; pagination si le volume l'exige ; `aggregateRating` (JSON-LD) présent |
| C-N7 | Le compteur retombe à 0 | Rouvrir `/admin/avis` | Compteur **0** avec un état explicite (« aucun avis en attente »), pas un vide muet |
| C-N8 | Rejet | Déposer un 2ᵉ avis (autre produit), le rejeter via `POST /api/admin/reviews/<id>/reject` avec un motif | `status = REJECTED` ; motif enregistré ; avis **jamais public** et **jamais compté** dans la moyenne |
| C-N9 | Capacité de modération | Ouvrir `/admin/avis` avec `$STAFF` ; `curl -si $BASE/api/admin/reviews` **sans cookie** | STAFF **accepté** (la modération est une tâche quotidienne — persona Jules) ; sans cookie → **401** |
| C-N10 | Produit sans avis | Ouvrir la fiche d'un produit sans avis approuvé | **Pas de « 0,0 »**, pas de 5 étoiles vides, **pas de JSON-LD AggregateRating** |
| C-N11 | Non-régression | `pnpm test` puis `pnpm typecheck` | 100 % vert ; `tsc` **0** |

### C.2 Cas limites (indispensables)

| # | Ce qu'on vérifie | Comment on le vérifie (commande exacte ou URL) | Résultat attendu |
|---|---|---|---|
| C-L1 | **Avis sans achat** | `POST /api/reviews` **sans** `orderId` ; puis `$PSQL "select count(*) from \"Review\" where \"orderId\" is null;"` | Refus 4xx ; compte **0** |
| C-L2 | `orderId` inexistant | `POST /api/reviews` avec `{"orderId":"inconnu-123", …}` | **404** ; aucun enregistrement |
| C-L3 | **`orderId` d'un autre client** | `POST /api/reviews` avec `$C2` et l'`orderId` du client 1 | **404** (et non 403 : on ne divulgue pas l'existence de la commande) ; aucun enregistrement |
| C-L4 | **Avis en double** | Rejouer C-N2 (même client, même produit) | Refus 4xx avec message compréhensible, **jamais 500** ; `$PSQL "select count(*) from \"Review\" where \"productId\"='<id>';"` → **1** |
| C-L5 | **Dédoublonnage sur commande invité** | Passer une commande **en invité** (email sans compte), déposer l'avis, puis retenter le même avis | `customerId` **non nul** (dérivé de la commande) et 2ᵉ tentative **refusée**. Si `customerId` est NULL, `@@unique([productId,customerId])` **ne dédoublonne pas** (plusieurs NULL sont distincts en PostgreSQL) → écart |
| C-L6 | **Avis d'une commande remboursée** | Relever `$PSQL "select count(*) from \"Review\" where \"orderId\"='<orderId>';"` ; rembourser la commande (ADMIN) ; relancer la même requête ; ouvrir la page de la commande | **Après** remboursement : le lien « Laisser un avis » **disparaît** de la page et `POST /api/reviews` sur cette commande → refus 4xx. Le compte d'avis est **identique** avant/après : un avis déjà déposé n'est **pas effacé en silence** |
| C-L7 | **PENDING visible publiquement** | `curl -s $BASE/products/<SLUG>` ; puis `curl -so /dev/null -w "%{http_code}" $BASE/api/reviews/<id>` sur un avis `PENDING` puis sur un `REJECTED` | Avis absent de la fiche ; **404** par URL directe (toute route de lecture d'avis par id), pour les deux statuts |
| C-L8 | Note hors bornes | `rating` = 0, 6, 4.5, `"5"`, absent (5 appels) | 5 refus **400** côté serveur (le `min`/`max` HTML ne vaut pas preuve) ; aucun enregistrement |
| C-L9 | Longueurs, côté serveur | `body` de 1 001 caractères ; `title` de 81 caractères ; puis 1 000 et 80 | 2 refus **400** ; 1 000 et 80 acceptés |
| C-L10 | **Injection HTML** | Avis contenant `<script>alert(1)</script>` et `<a href="http://x.test">lien</a>` ; approuver ; `curl -s $BASE/products/<SLUG>` | **0** occurrence de `<script>alert(1)</script>`, **0** occurrence de `<a href="http://x.test">` ; le texte est **échappé** à l'affichage ; en base le texte brut est conservé |
| C-L11 | Champs obligatoires | `POST /api/reviews` sans `rating`, sans `body`, sans `authorName` (3 appels) | 3 refus **400** explicites, chacun nommant le champ manquant |
| C-L12 | Pagination et tri | Produit portant plus de 12 avis approuvés | Page 2 atteignable ; ordre **plus récents d'abord** ; aucun `PENDING`/`REJECTED` dans les pages ; le nombre affiché = nombre d'`APPROVED` |
| C-L13 | **Commande non payée** | Sur une commande `PENDING_PAYMENT` (checkout mock en `scenario: pending`), chercher le lien puis `POST /api/reviews` avec cet `orderId` | Lien **absent** ; `POST` → refus 4xx ; `$PSQL "select count(*) from \"Review\" r join \"Order\" o on o.id=r.\"orderId\" where o.status='PENDING_PAYMENT';"` → **0** |

---

## D. Les 3 pièges les plus probables — et comment les détecter

| # | Piège | Comment le détecter à la recette |
|---|---|---|
| D1 | **Le code naît ACTIF.** `PromoCode.active` porte `@default(true)` en base, alors que l'AC E1 exige « inactif par défaut » : si la route de création ne force pas `false`, tout code créé est immédiatement utilisable | Créer `PIEGE1` via `/admin/promos` **sans toucher l'interrupteur**, puis `$PSQL "select active from \"PromoCode\" where code='PIEGE1';"`, puis tenter de l'appliquer dans `/cart`. Attendu : `active = f` **puis** refus « désactivé ». Si `active = t` ou si le code s'applique → piège confirmé (défaut) |
| D2 | **Remise issue du client ou figée.** Une remise calculée à partir du corps de la requête, ou mise en cache, réduit la marge sans rien casser à l'écran (R4) | (a) Forger `discountCents`, `totalCents` et `value` dans le corps de `POST /api/cart/promo` et de `POST /api/checkout` → doivent être **ignorés**, remise recalculée serveur. (b) Changer `PromoCode.value` ou faire expirer le code en base entre le panier et la commande (B-L12, B-L13) → la nouvelle valeur doit s'appliquer. Si l'ancienne remise persiste ou si la valeur forgée est écrite → piège confirmé |
| D3 | **Dédoublonnage d'avis fantôme.** Sur une commande invité, si le code écrit `customerId = null`, `@@unique([productId, customerId])` **n'empêche rien** (en PostgreSQL, plusieurs NULL sont distincts) : un même client peut publier N avis sur le même produit | Déposer un avis depuis une commande **invité**, puis `$PSQL "select \"customerId\" from \"Review\" order by \"createdAt\" desc limit 1;"`, puis retenter le même avis. Attendu : `customerId` **non nul** (dérivé de la commande, qui porte toujours un `Customer`) et 2ᵉ tentative **refusée**. Si `customerId` est NULL et que le doublon passe → piège confirmé |

---

## E. REFUSÉ en recette — hors-périmètre

> Ces fonctionnalités ne doivent **pas** exister dans le code livré. Si l'une est présente, ce n'est pas une bonne surprise : c'est un **ÉCART** (défaut), à consigner et à refuser.

| # | Fonctionnalité hors-périmètre | Comment on détecte sa présence | Verdict |
|---|---|---|---|
| E1 | **Cumul de codes (stacking)** | B-N9 : deux codes appliqués → une seule remise. `$PSQL "select \"promoCode\" from \"Cart\" limit 1;"` (une colonne = une valeur, pas un tableau) ; `grep -rn "promoCodes" src/` | ÉCART si deux remises se cumulent ou si le schéma/le panier porte un **tableau** de codes |
| E2 | **Code ciblé** (par produit, catégorie, 1ʳᵉ commande, client précis) | `docker exec shop-db psql -U shop -d shop -c '\d "PromoCode"'` (aucun champ de ciblage attendu) ; `grep -rniE "productId\|categoryId\|firstOrder" src/**/promo*` ; ouvrir le formulaire `/admin/promos` | ÉCART si un champ de ciblage existe en base, ou si l'écran propose un sélecteur produit/catégorie/client |
| E3 | **Livraison gratuite par code** | B-L2 : PERCENT 90 | ÉCART si `shippingCents` de la commande ≠ 590 (la livraison a été remisée) |
| E4 | **Avis avec photo** | `grep -rniE "reviewImage\|ReviewImage" src/` ; `docker exec shop-db psql -U shop -d shop -c '\d "Review"'` (aucun champ image attendu) ; tenter un `POST /api/reviews` en `multipart/form-data` | ÉCART si un champ image existe, ou si un upload / une URL d'image est accepté |
| E5 | **Réponse publique de la marchande** | `grep -rniE "merchantReply\|adminReply\|reviewReply" src/` ; ouvrir `/admin/avis` | ÉCART si un champ ou un formulaire de réponse existe dans l'UI ou en base |
| E6 | **Avis anonyme / sans commande** | `$PSQL "select count(*) from \"Review\" where \"orderId\" is null;"` | ÉCART si > **0** |
| E7 | **Publication avant modération (post-modération)** | Après C-N2 : `$PSQL "select status, count(*) from \"Review\" group by status;"` → uniquement `PENDING` | ÉCART si un avis est public/`APPROVED` sans passage par `/admin/avis` (y compris un avis de démonstration ou de seed) |
| E8 | **Compte tiers / dépendance ajoutée** | `git diff --stat package.json` ; `git diff --stat prisma/schema.prisma` ; `grep -rniE "resend\|nodemailer\|sendgrid\|recaptcha\|cloudinary\|aws-sdk" src/ package.json` | ÉCART si une dépendance apparaît ou si un service tiers est appelé (SMTP, antispam externe, stockage distant) |
| E9 | **Email réellement envoyé** | `$PSQL "select provider, count(*) from \"EmailOutbox\" group by provider;"` | ÉCART si `provider` ≠ `outbox` (une tentative d'envoi réel a eu lieu) |
| E10 | **Migration / modification du schéma** | `git diff --stat prisma/schema.prisma` ; `git status` (aucune nouvelle migration) | ÉCART = **signal d'alarme** : les tables de la vague 2 existent déjà, rien ne doit être ajouté au schéma pour E et F (règle 1 du KANBAN) |

---

## F. Clôture

- Consigner chaque écart par son n° de ligne et la sortie exacte obtenue. Ne rien corriger de soi-même.
- Le lot 2B passe en ✅ **uniquement** si : §B et §C sans écart, §E sans ÉCART, `pnpm test` 100 % vert, `pnpm typecheck` à 0, **et** les contrôles d'écran refaits en production sur `shop.app-lezekie.dev` (panier avec code, `/admin/promos`, `/admin/avis`, fiche produit) — pas seulement en dev.
- K6 (coût des remises ≤ 8 % du CA) et K8 (0 avis `PENDING` > 7 jours) sont des mesures d'usage : elles s'apprécient après 30 jours, pas à la recette. À la recette, on vérifie seulement que les données qui les alimentent existent (`PromoRedemption.amountCents`, `Review.moderatedAt`).
