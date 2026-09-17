# ADR-0004 — Stock décrémenté à la confirmation de paiement, pas au panier

- **Statut** : Acceptée (Sprint 1)
- **Date** : 2026-09-17
- **Décideurs** : équipe architecture + PO
- **Référence DAT** : §2, §11 ADR-004

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
5. **Job de réconciliation quotidien** (à mettre en place en S3) :
   toutes les commandes en `PENDING_PAYMENT` depuis > 30 min sont
   vérifiées auprès du PSP ; au-delà de 24 h, on annule et on libère
   le stock réservé.

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
  30 min — non critique mais UX dégradée. **À ajouter dans la DoD
  du Sprint 3.**
- **Race condition checkout double** : deux clients passent en
  checkout en même temps sur la dernière unité. La transaction
  PostgreSQL (`prisma.$transaction` en isolation `READ COMMITTED`)
  + le **`SELECT … FOR UPDATE` explicite** sur la ligne `Stock`
  (en `$queryRaw`) gère ça. Le verrou pessimiste ligne suffit ; on
  n'a pas besoin de `SERIALIZABLE`. **Détails complets :
  CONVENTIONS §12.** **Vérifier en test d'intégration**.
- **Refund** (S3+) : on remet du stock `quantity += refundedQty`,
  pas `reserved` (le produit est sorti du stock, il y reste).

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
| `OrderItem.unitPriceCents`         | `Int`           | Prix unitaire au moment de l'ajout au panier (anti-surpricing).     |
| `Order.shippingAddressSnapshot`    | `Json` (requis) | Copie figée de l'adresse de livraison au checkout.                  |
| `Order.billingAddressSnapshot`     | `Json?`         | Idem facturation ; `null` si `billingSameAsShipping = true`.        |
| `Order.addressId` / `billingAddressId` | `String` / `String?` | FK vers le carnet d'adresses — sert au **pré-remplissage** uniquement. |

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

**Surface de code touchée**
- `src/domain/stock.ts` (règles pures : `available(stock)`, `canReserve`)
- `src/server/cart.ts`, `src/server/checkout.ts`,
  `src/server/webhook-handlers.ts`
- `prisma/schema.prisma` : modèle `Stock { variantId, quantity, reserved }`
- `tests/integration/stock.test.ts` (à créer)
- Job cron de réconciliation (S3)

## Alternatives écartées

| Alternative | Pourquoi écartée |
|-------------|------------------|
| **Décrément au panier** (modèle A) | Fausse rupture visible (le marchand voit son stock chuter pour des paniers abandonnés). Mauvaise UX admin. Refusé. |
| **Décrément au paiement, sans réservation** | Tous les clients voient "disponible" jusqu'au checkout, 90 % se font rejeter à la confirmation. Catastrophique pour la conversion. |
| **Pas de stock du tout** (catalogue infini) | Impossible pour des produits physiques avec suivi unitaire (SKU). Refusé par PO. |
| **Stock via Redis avec décrément atomique** | Ajoute un composant critique en plus de Postgres. Surdimensionné au MVP. Le `SELECT FOR UPDATE` Postgres suffit. |
| **Lock optimiste via version** (`Stock.version`) | Marche mais complique le modèle. Surdimensionné pour les volumétries MVP. À réévaluer si > 1000 commandes/jour. |
| **Décrément à l'expédition** (et pas au paiement) | Le marchand peut oublier d'expédier une commande payée → trésorerie perdue. Le paiement est le bon moment. |
