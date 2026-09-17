# ADR-0004 — Stock décrémenté à la confirmation de paiement, pas au panier

- **Statut** : Acceptée (Sprint 1) — **amendée** S1-002 (Findings 2, 4, 8/8) et **ré-amendée** S1-016 (Finding D9 : webhook répond 200 sur violation de contrainte, retry borné `40001`, job de réconciliation sort en S2, passage de `READ COMMITTED` à isolation `Serializable`).
- **Date** : 2026-09-17
- **Décideurs** : équipe architecture + PO + chief (arbitrage post-audit DAT)
- **Référence DAT** : §2 (schéma Prisma), §11 ADR-0004 ; audit DAT carte S1-002 findings 2, 4, 8/8 ; ratification D9 (cartes S1-015, S1-016)

## Contexte

Décrémenter au panier (à l'ajout) **produit de fausses ruptures** : un
client met l'article au panier, va réfléchir, revient 2 h plus tard,
voit « rupture » alors qu'il n'a jamais été question d'acheter — la
marchandise est toujours là. Décrémenter **uniquement** au paiement
**réserve trop peu** : un panier abandonné laisse `Stock.reserved`
élevé à perpétuité, et la marchandise reste bloquée alors qu'elle
est physiquement disponible.

Le compromis, proposé par l'audit S1-002, est **réservation au
checkout, libération au webhook, annulation au job cron**.

## Décision

1. `Stock.quantity` représente la **disponibilité physique** au
   dernier instant connu (lecture seule pour l'UI).
2. `Stock.reserved` représente la **promesse** : ce qui est dans un
   panier ou une commande non terminée. Il monte au passage en
   `PENDING_PAYMENT` (transaction avec `createIntent`), descend
   quand le `payment_intent.succeeded` arrive (webhook), ou est
   libéré par le job de réconciliation au-delà du TTL.
3. Le décrément final (`Stock.quantity -= requested`) se fait dans
   la transaction du webhook `payment_intent.succeeded`. **Pas** de
   décrément ailleurs.
4. **Isolement** : la transaction checkout et la transaction webhook
   utilisent **toutes deux** `prisma.$transaction` avec
   `isolationLevel: "Serializable"` (DAT §7) — pas le défaut
   `ReadCommitted`. En cas de conflit de sérialisation
   (`SQLSTATE 40001`), on **retente** jusqu'à 3 fois avec backoff
   court (50 ms puis 150 ms) avant de renvoyer 503 au client. La
   politique de retry détaillée est dans `CONVENTIONS.md` §11.
5. **TTL de réservation** : `RESERVATION_TTL_MINUTES=30` (référence
   marché : Shopify = 10 min, WooCommerce = 60 min ; 30 min est un
   compromis défendable et paramétrable via `.env`).
6. **Job de réconciliation quotidien** (à mettre en place **en S2, en
   même temps que le checkout — amendement S1-016**) : toutes les
   commandes en `PENDING_PAYMENT` depuis > 30 min sont vérifiées
   auprès du PSP ; au-delà de 24 h, on annule et on libère le stock
   réservé.

### Cas dégradés

- **Webhook qui arrive après libération** : on acquitte Stripe
  (200), on tente le décrément, s'il viole une contrainte on
  déclenche la procédure d'exception (cf. *Amendement S1-016*
  ci-dessous) plutôt que de répondre 500.
- **Webhook qui arrive après suppression d'une variante** :
  l'order reste affiché via ses snapshots ; le décrément porte
  sur `Variant.id` historique si encore présent, sinon procédure
  d'exception (cf. ADR-0006 §5 — `Stock` protégé par `CHECK`).
- **TTL dépassé sans webhook** : le job de réconciliation libère
  le `reserved` et **vérifie le statut réel côté PSP** avant
  d'agir — on n'annule pas une commande qui a payé.
- **Migration partielle / crash entre checkout et webhook** :
  `WebhookEvent @@unique([provider, eventKey])` garantit
  l'idempotence ; un événement rejoué = no-op.

### Règle générale : **les instantanés portés par la commande sont la source de vérité** (amendement S1-014 / audit D6)

> Ajoutée en Sprint 1 carte S1-014. Cette règle existait déjà pour
> les lignes (`productNameSnapshot`, `variantNameSnapshot` sur
> `OrderItem`, DAT §2). On l'**étend** aux adresses et on
> l'érige en principe général.

**Pourquoi** : une FK vers `Address` ne suffit pas. `Address` vit
dans le carnet du client, qui peut l'éditer après coup. Sans
instantané, modifier un profil réécrit l'histoire — l'adresse
d'expédition d'une commande de mars change en juin et la facture
d'avril devient fausse. Pour les **adresses**, la valeur est
légale (facture, douane CNPS, contestation client). Pour les
**noms de produits/variantes**, c'est de l'archivage commercial
(« le produit a été renommé en juillet, mais la commande de juin
conserve l'intitulé de l'époque »).

**Application dans le schéma** :

| Champ                              | Type            | Rôle                                                                |
|------------------------------------|-----------------|---------------------------------------------------------------------|
| `OrderItem.productNameSnapshot`    | `String`        | Nom du produit au moment de la commande.                            |
| `OrderItem.variantNameSnapshot`    | `String`        | Nom de la variante au moment de la commande.                        |
| `OrderItem.unitPriceMinor`         | `Int`           | Prix unitaire au moment de l'ajout au panier (anti-surpricing).     |
| `Order.shippingAddressSnapshot`    | `Json` (requis) | Copie figée de l'adresse de livraison au checkout.                  |
| `Order.billingAddressSnapshot`     | `Json?`         | Idem facturation ; `null` si `billingSameAsShipping = true`.        |
| `Order.shippingAddressId` / `Order.billingAddressId` | `String?` / `String?` | FK vers le carnet d'adresses — sert au **pré-remplissage** uniquement. |

**Règle** : toute donnée affichée ou imprimée sur une commande
post-paiement (facture PDF, étiquette colis, export comptable) lit
**le snapshot**, jamais la FK. Si les deux divergent (parce que
le client a édité son carnet depuis), c'est le snapshot qui a
raison — c'est celui qui existait au moment de la transaction.

**Conséquence pour les exports comptables** : un client qui édite
son adresse en mars pour une commande passée en janvier ne peut
pas réécrire la facture de janvier. La facture reste
juridiquement correcte.

**Tests d'intégration obligatoires** :
- Création d'`Order` puis édition de l'`Address` du carnet → la
  commande affichée conserve l'ancienne adresse.
- Création d'`Order` puis `delete` de l'`Address` (si autorisé en
  S4+) → la commande reste consultable via ses snapshots.

## Conséquence

- Le panier peut promettre plus que le stock réel ; on prévient
  l'utilisateur au checkout si `available < requested`.
- Une commande peut rester `PENDING_PAYMENT` jusqu'à 30 min — non
  critique mais UX dégradée. **Sortie en S2 obligatoire, avec le
  checkout — amendement S1-016.** Sans ce job, **tout `reserved`
  posé par un panier abandonné n'est jamais libéré** : le marchand
  voit un stock indisponible alors que la marchandise est dans son
  atelier. Des ruptures fantômes invisibles s'accumulent dès la
  première semaine de production. Le PO a relevé la même faille de
  son côté (deux lectures indépendantes, même conclusion).
- L'isolation `Serializable` rejette les courses rares (deux
  clients sur la dernière unité) au commit par un code Postgres
  `40001` ; la politique de retry de `CONVENTIONS §11` les relance.
  **Vérifier en test d'intégration.**

## Alternatives écartées

| Alternative | Pourquoi écartée |
|-------------|------------------|
| **Décrément au panier** | Fausses ruptures (UX), panier = intention ≠ engagement. |
| **Décrément au paiement uniquement, sans réservation** | Panier abandonné = stock jamais libéré → ruptures fantômes. |
| **Pas de décrément (stock infini conceptuel)** | Hors-périmètre métier. Une marketplace réelle a du stock limité. |
| **Décrément après expédition** | Le client paie mais on ne peut pas honorer la commande → annulation remboursée + mauvaise UX. |
| **Stock via Redis avec décrément atomique** | Ajoute un composant critique en plus de Postgres. Surdimensionné au MVP. L'isolation `Serializable` Postgres suffit (cf. amendement S1-016). |
| **Lock optimiste via version** (`Stock.version`) | Marche mais complique le modèle. `Serializable` + retry borné (`CONVENTIONS §11`) couvre le besoin sans colonne supplémentaire. À réévaluer si > 1000 commandes/jour. |
| **Job cron de libération côté Stripe (`Stripe webhooks retry`)** | Stripe ne rejoue pas un webhook qui a répondu 200 ; la libération doit venir de chez nous. |
| **`RESERVATION_TTL_MINUTES=10`** (Shopify) | Trop court : checkout 3DSecure dépasse régulièrement 10 min en Mobile Money Cameroun. UX dégradée. |
| **`RESERVATION_TTL_MINUTES=60`** (WooCommerce) | Trop long : la marchandise reste bloquée 1 h pour un panier abandonné. |
| **Pas de procédure d'exception sur violation de contrainte** | Le webhook répondrait 500, Stripe retente, on sature l'idempotence. **Amendement S1-016** corrige : on répond 200, on inscrit dans `AuditLog`. |

## Amendements S1-002

### Finding 2/8 — TTL de réservation + job de libération

Le **point 5 de la décision** est quantifié :

- **TTL par défaut** : `RESERVATION_TTL_MINUTES=30` (référence marché : Shopify = 10 min, WooCommerce = 60 min ; 30 min est un compromis défendable et paramétrable via `.env`).
- **Job de libération** : toutes les 5 min, un cron (`src/server/jobs/release-expired-reservations.ts` — **à créer en Sprint 2, en même temps que le checkout — amendement S1-016**) sélectionne les `Order` en `PENDING_PAYMENT` dont `placedAt < now() - RESERVATION_TTL_MINUTES`, **vérifie le statut réel côté PSP** (`PaymentProvider.capture(order.paymentRef)`), puis :
  - si PSP confirme `pending` → on ne touche à rien, on attend le webhook ;
  - si PSP confirme `failed` / timeout dépassé → transition `PENDING_PAYMENT → CANCELLED` + décrément `Stock.reserved -= requested` + transition `Cart.ACTIVE → ABANDONED` si cart lié.
- **À ajouter dans la DoD Sprint 2** (amendement S1-016) : test d'intégration qui simule un checkout abandonné (PaymentIntent jamais créé) et vérifie la libération du `reserved`.

### Finding 4/8 — Qui crée l'Order et appelle `createIntent` ?

Le **point 2 de la décision** est précisé (Option A tranchée par S1-002) :

- L'`Order` est créé **dans la même transaction** que l'incrément de `Stock.reserved` ET que l'appel `provider.createIntent()`.
- Si `createIntent()` échoue (PSP indisponible), la transaction est rollback : l'`Order` n'existe pas, le `reserved` n'est pas augmenté, le client reçoit une erreur 503 — il pourra retenter.
- Le retour `POST /api/checkout` est : `{ orderId, payment: { clientToken | redirectUrl } }`.
- Le client confirme côté Stripe Elements (ou redirige vers le PSP MM) ; le webhook `payment_intent.succeeded` (Sprint 3) applique alors le décrément de `Stock.quantity` (étape 3).

### Finding 8/8 — Politique d'isolation et de stock négatif

Le **point 3 de la décision** est renforcé :

- **Niveau d'isolation** : les transactions checkout et webhook utilisent `Serializable` (paramètre `isolationLevel: "Serializable"` de `prisma.$transaction`) — pas le défaut `ReadCommitted` qui ne protège pas du cas d'école "deux clients sur la dernière unité".
- En cas d'`optimistic concurrency exception` (Postgres `SQLSTATE 40001`) ou de deadlock, on **retente jusqu'à 3 fois** avec backoff court avant de renvoyer 503 au client. Politique de retry détaillée dans `CONVENTIONS.md` §11.
- **Politique de stock négatif** : un webhook qui se retrouve avec `Stock.quantity < requested` (panier accepté en checkout, plus de stock à la confirmation) déclenche une **procédure d'exception** : `Order.status = CANCELLED` + `Payment.status = REFUNDED` automatique + alerte marchand via la table `AuditLog`. **Pas de décrément partiel**, jamais.
- **À ajouter dans le schéma** : `CHECK (quantity >= 0)` et `CHECK (reserved >= 0)` sur la table `Stock` — voir ADR-0006 §5 (cartographie des migrations).

## Amendement S1-016 — Webhook et violation de contrainte : toujours répondre 200 (ratification D9)

Les check constraints `quantity >= 0`, `reserved >= 0`, `reserved <= quantity`
(ADR-0006 §5 amendée) transforment la course sur le stock en **erreur
PostgreSQL** (`SQLSTATE 23514 check_violation`). Mais le webhook Stripe qui
déclenche l'écriture est un appel HTTP **qui doit répondre 200** pour acquitter
l'événement : un 500 non géré = Stripe retente indéfiniment = ADR-0005
(idempotence) contournée par la bande, et saturation rapide des retries.

### Procédure d'exception obligatoire (handler webhook `payment_intent.succeeded`)

Le handler capture la violation de contrainte et route vers la procédure
d'exception, **puis répond 200** :

1. **Capture** : dans la transaction webhook, un `try/catch` autour de l'écriture
   détecte `Prisma.PrismaClientKnownRequestError` code `P2010` (raw query) ou
   l'`error.code` PG `23514` (check_violation) — voir `src/lib/db.ts`.
2. **Restauration cohérente** : `Stock.quantity` et `Stock.reserved` ramenés à
   des valeurs **cohérentes** (≥ 0 et `reserved ≤ quantity`), en une nouvelle
   transaction courte. **Pas** de remise à 0 brut qui masquerait l'écart
   comptable.
3. **Commande maintenue `PAID`** : `Order.status` reste `PAID` (la PSP a
   débité le client, on ne ment pas au marchand). La procédure d'exception
   alimente la file « à traiter » via `AuditLog(kind=STOCK_OVERSOLD, …)`.
4. **Alerte `STOCK_OVERSOLD`** : `AuditLog` avec
   `{ orderId, variantId, missingQty, requestId }`. Notification marchand
   (email / dashboard) en Sprint 2 via le job de réconciliation.
5. **Réponse HTTP 200** au PSP avec `{ received: true }`. **Jamais 500.**

### Test d'intégration obligatoire (à ajouter dans la DoD S1-005/S1-008)

- Provoquer la contrainte violée (par exemple : seed `Stock(quantity=0, reserved=0)`,
  simuler un webhook `payment_intent.succeeded` pour une commande dont
  `requested=1`).
- **Vérifier** : (a) réponse HTTP **200** (pas 500) ; (b) entrée `AuditLog`
  `STOCK_OVERSOLD` créée avec les bons champs ; (c) `Stock.quantity` et
  `Stock.reserved` restaurés à un état cohérent ; (d) `Order.status` reste
  `PAID`.

### Distinction avec la procédure d'exception existante (Finding 8/8 originelle)

La procédure d'exception pré-S1-016 parlait du cas `Stock.quantity < requested`
**sans violation de contrainte** (par exemple, deux décréments appliqués avant
que les check constraints ne soient en place, ou une logique applicative qui
n'a pas encore été migrée). Le présent amendement couvre le **cas
contemporain** : une logique applicative correcte qui se retrouve en conflit
avec un invariant Postgres — l'erreur n'est plus applicative, elle est dans la
base, et **la base a raison**. On aligne le comportement du webhook sur la
sémantique « Stripe a payé, on acquitte » sans pour autant laisser le marchand
sans trace de l'incident.