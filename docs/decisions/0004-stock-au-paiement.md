# ADR-0004 — Stock décrémenté à la confirmation de paiement, pas au panier

- **Statut** : Acceptée (Sprint 1), **amendée** post-audit S1-002 (Findings 2, 4, 8/8)
- **Date** : 2026-09-17
- **Décideurs** : équipe architecture + PO
- **Référence DAT** : §2, §11 ADR-0004

## Contexte

Le marché cible (PO-BRIEF §2 persona P1 — Aïcha) commande depuis un
mobile en 3G/4G, parfois avec une connexion instable. Un panier peut
rester ouvert plusieurs heures, voire plusieurs jours, avant d'aboutir
à un paiement.

Deux modèles s'affrontent pour la gestion du stock :

**Modèle A — décrément au panier** : on réserve et décrémente dès
l'ajout au panier. Simple en lecture (`Stock.quantity` reflète ce qui
est vendable).

**Modèle B — décrément au paiement confirmé** : on ne touche au stock
qu'au webhook de succès. Un panier peut promettre plus que le stock
réel pendant tout le tunnel d'achat.

Le PO-BRIEF §6 Risque R3 traite déjà le sujet de la fraude et des
impayés : pour Mobile Money et virement, on ne peut pas expédier avant
confirmation. C'est cohérent avec le modèle B.

## Décision

Modèle **B avec une étape de réservation** :

1. **Ajout au panier** (`src/server/cart.ts`) : aucune écriture sur
   `Stock`. On lit `Stock.quantity - Stock.reserved` pour afficher
   la disponibilité à l'utilisateur.
2. **Passage en checkout** (`src/server/checkout.ts`) :
   - Vérifie `Stock.quantity - Stock.reserved >= requested`.
   - Si OK : `Stock.reserved += requested` (dans la même transaction
     que la création de `Order` en `PENDING_PAYMENT`).
   - Si KO : renvoie `StockUnavailableError` avec la quantité
     effectivement disponible → l'UI propose de réduire la quantité.
3. **Webhook `payment_intent.succeeded`** (`src/server/webhook-handlers.ts`) :
   - **Transaction** : `Stock.reserved -= requested`,
     `Stock.quantity -= requested`, `Order.status = PAID`,
     `Order.paidAt = now`, insertion `Payment(status=SUCCEEDED)`.
   - Si la transaction échoue (contrainte, deadlock) → retry selon
     ADR-0005 (idempotence).
4. **Webhook `payment_intent.payment_failed` ou annulation client** :
   `Stock.reserved -= requested`, `Order.status = CANCELLED`,
   `Order.cancelledAt = now`. Le stock redevient disponible
   immédiatement.
5. **Job de réconciliation quotidien** (à mettre en place **en S2, en
   même temps que le checkout — voir amendement S1-016**) : toutes les
   commandes en `PENDING_PAYMENT` depuis > 30 min sont vérifiées
   auprès du PSP ; au-delà de 24 h, on annule et on libère le stock
   réservé.

## Conséquence

**Positives**
- Abandon de panier = pas de stock bloqué. Le marchand voit son stock
  réel, pas un stock gonflé par des paniers fantômes.
- Décrément transactionnel au webhook = **impossible** d'avoir un
  stock négatif ou de vendre deux fois la même unité.
- Cohérent avec la stratégie anti-fraude R3 : on n'expédie qu'après
  paiement confirmé.
- La réservation (étape 2) évite l'incohérence "100 clients voient
  le produit disponible, 100 payent, 50 sont frustrés".

**Négatives / risques**
- **Sur-promesse temporaire** : pendant le checkout, le stock affiché
  peut être consommé par un autre client. On accepte ce risque
  (mitigé par l'étape 2).
- **Job de réconciliation** : si on oublie de l'implémenter, des
  paniers abandonnés en `PENDING_PAYMENT` bloquent du stock pendant
  30 min — non critique mais UX dégradée. **Sortie en S2 obligatoire,
  avec le checkout — amendement S1-016.** Sans ce job, **tout
  `reserved` posé par un panier abandonné n'est jamais libéré** : le
  marchand voit un stock indisponible alors que la marchandise est
  dans son atelier. Des ruptures fantômes invisibles s'accumulent
  dès la première semaine de production. Le PO a relevé la même
  faille de son côté (deux lectures indépendantes, même conclusion).
- **Race condition checkout double** : deux clients passent en
  checkout en même temps sur la dernière unité. La transaction
  PostgreSQL en isolation `Serializable` gère ça : une des deux
  transactions est rejetée avec `SQLSTATE 40001` (serialization
  failure) au commit, et la politique de retry de `CONVENTIONS §11`
  la relance. **Vérifier en test d'intégration.**
- **Refund** (S3+) : on remet du stock `quantity += refundedQty`,
  pas `reserved` (le produit est sorti du stock, il y reste).

**Surface de code touchée**
- `src/domain/stock.ts` (règles pures : `available(stock)`, `canReserve`)
- `src/server/cart.ts`, `src/server/checkout.ts`,
  `src/server/webhook-handlers.ts`
- `prisma/schema.prisma` : modèle `Stock { variantId, quantity, reserved }`
- `tests/integration/stock.test.ts` (à créer)
- Job cron de réconciliation (S2 — amendement S1-016)

## Alternatives écartées

| Alternative | Pourquoi écartée |
|-------------|------------------|
| **Décrément au panier** (modèle A) | Fausse rupture visible (le marchand voit son stock chuter pour des paniers abandonnés). Mauvaise UX admin. Refusé. |
| **Décrément au paiement, sans réservation** | Tous les clients voient "disponible" jusqu'au checkout, 90 % se font rejeter à la confirmation. Catastrophique pour la conversion. |
| **Pas de stock du tout** (catalogue infini) | Impossible pour des produits physiques avec suivi unitaire (SKU). Refusé par PO. |
| **Stock via Redis avec décrément atomique** | Ajoute un composant critique en plus de Postgres. Surdimensionné au MVP. L'isolation `Serializable` Postgres suffit (cf. amendement S1-016). |
| **Lock optimiste via version** (`Stock.version`) | Marche mais complique le modèle. `Serializable` + retry borné (`CONVENTIONS §11`) couvre le besoin sans colonne supplémentaire. À réévaluer si > 1000 commandes/jour. |
| **Décrément à l'expédition** (et pas au paiement) | Le marchand peut oublier d'expédier une commande payée → trésorerie perdue. Le paiement est le bon moment. |

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
- **À ajouter dans le schéma** : `CHECK (quantity >= 0)` et `CHECK (reserved >= 0)` sur la table `Stock` — voir ADR-0006 (cartographie des migrations).

## Amendement S1-016 — Webhook et violation de contrainte : toujours répondre 200 (ratification D9)

Les check constraints `quantity >= 0`, `reserved >= 0`, `reserved <= quantity`
(ADR-0006 §2 amendée) transforment la course sur le stock en **erreur
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
   (email / dashboard) en Sprint 3 via le job de réconciliation.
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
