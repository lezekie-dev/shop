# ADR-0009 — Adresses de commande **snapshotées** (source de vérité = la commande, pas le carnet)

- **Statut** : Acceptée (Sprint 1), introduite carte S1-015 (audit D7, arbitré 22:29 chef)
- **Date** : 2026-09-17
- **Décideurs** : équipe architecture + PO + chef
- **Référence DAT** : §2 (schéma Prisma, `model Order`, `model Address`), §11 ADR-0009

## Contexte

La commande d'un client doit porter **deux adresses** :

1. **Adresse de livraison** — où le colis part.
2. **Adresse de facturation** — où la facture est envoyée (C2 du
   PO-BRIEF : cas diaspora, livraison à un tiers, commande pour un
   proche resté au pays).

L'adresse de facturation est aujourd'hui **inexprimable** dans le
schéma : `model Order` n'a qu'un seul `addressId` qui pointe vers
`Address`. Le PO-BRIEF C2 (livraison ≠ facturation) est donc
inimplémentable en l'état.

**Le vrai problème n'est pas la facturation** — c'est la **valeur
légale** d'une adresse de commande. Le DAT §2 documente déjà la règle
« snapshot prix/nom sur `OrderItem` » : même si le `Variant` est
modifié/supprimé ensuite, la commande reste fidèle. On l'applique
déjà aux lignes (l.337 : `productNameSnapshot`, `variantNameSnapshot`).

Mais le DAT fait l'impasse sur les **adresses** : une `FK Order.addressId → Address.id`
suffit pour lier la commande au carnet du client, et **ça semble marcher**.
Ça ne marche pas. `Address` vit dans le carnet du client et reste
**éditable** (le client peut corriger une faute de frappe dans
« 12 rue de la Paix » → « 14 rue de la Paix »). Conséquence : modifier
le profil **réécrit rétroactivement** l'adresse d'une commande passée.
La facture d'il y a 6 mois ne correspond plus à ce qui a été livré.
Le transporteur n'a plus la bonne adresse dans son historique. La
commande devient **inauditable**.

Pour les lignes (`OrderItem.productNameSnapshot`), la perte d'audit est
fâcheuse mais pas fatale : on peut recalculer la commande depuis
le catalogue. Pour une **adresse**, la perte d'audit est **fatale** :
c'est la donnée juridique de la transaction, ce qui figure sur la
facture, ce qu'on oppose au client en cas de litige (« le colis a
bien été livré à l'adresse que vous aviez indiquée »).

## Décision

### 1. Règle générale — la commande porte ses propres instantanés

> **Les instantanés portés par la commande (`*Snapshot`) sont la source
> de vérité. Les FK vers `Address` servent le carnet d'adresses du
> client et le pré-remplissage du formulaire de checkout.**

Cette règle s'applique désormais à **trois champs** sur `Order` :

- `shippingAddressSnapshot Json` — obligatoire, non-null.
- `billingAddressSnapshot Json?` — obligatoire si `billingSameAsShipping = false`.
- `productNameSnapshot`, `variantNameSnapshot` sur `OrderItem` — déjà en place.

Les FK conservées :

- `Order.shippingAddressId String?` → `Address.id` (carnet client,
  pré-remplissage, suppression du carnet autorisée sans casser la
  commande).
- `Order.billingAddressId String?` → `Address.id` (idem).

### 2. Modèle `Order` amendé

```prisma
model Order {
  // ── Champs existants conservés ──
  id              String      @id @default(cuid())
  number          String      @unique        // "ORD-2026-000123"
  customerId      String
  status          OrderStatus @default(PENDING_PAYMENT)
  subtotalCents   Int
  shippingCents   Int
  totalCents      Int
  currency        String      @default("EUR")
  paymentProvider String                       // "stripe" | "mobile_money"
  paymentRef      String?                     // PaymentIntent id / tx ref
  placedAt        DateTime    @default(now())
  paidAt          DateTime?
  shippedAt       DateTime?
  cancelledAt     DateTime?

  // ── Adresses : FK pour le carnet + instantanés pour la vérité ──
  shippingAddressId       String?
  shippingAddress         Address?  @relation("Shipping", fields: [shippingAddressId], references: [id])
  shippingAddressSnapshot Json                       // OBLIGATOIRE, non-null

  billingAddressId        String?
  billingAddress          Address?  @relation("Billing", fields: [billingAddressId], references: [id])
  billingSameAsShipping   Boolean   @default(true)   // par défaut, on duplique l'adresse
  billingAddressSnapshot  Json?                      // OBLIGATOIRE si billingSameAsShipping = false

  customer        Customer    @relation(fields: [customerId], references: [id])
  items           OrderItem[]
  payments        Payment[]
  shipments       Shipment[]

  @@index([customerId])
  @@index([status])
  @@index([placedAt])
}
```

### 3. Modèle `Address` — deux relations nommées

```prisma
model Address {
  id         String   @id @default(cuid())
  customerId String
  line1      String
  line2      String?
  city       String
  postalCode String
  country    String   @default("FR")
  isDefault  Boolean  @default(false)
  customer   Customer @relation(fields: [customerId], references: [id], onDelete: Cascade)

  // Une même adresse du carnet peut servir d'adresse de livraison OU de
  // facturation sur N commandes. Deux relations nommées pour lever
  // l'ambiguïté Prisma.
  shippingOrders Order[] @relation("Shipping")
  billingOrders  Order[] @relation("Billing")

  @@index([customerId])
}
```

### 4. Forme du `Json` snapshot

```ts
// src/domain/address.ts (Sprint 2) — type de référence
export type AddressSnapshot = {
  line1: string;
  line2: string | null;
  city: string;
  postalCode: string;
  country: string;        // ISO-3166-1 alpha-2 ("FR", "CM", …)
  recipientName: string;  // nom du destinataire (différent du client si livraison tiers)
  phone: string | null;   // contact transporteur
};
```

Le snapshot **n'inclut pas** `customerId`, `id`, `createdAt`, `isDefault`
— uniquement ce qui a valeur d'adresse au moment de la commande. Pas
d'identifiant interne du carnet dans la facture.

### 5. Sémantique `billingSameAsShipping`

- `billingSameAsShipping = true` (défaut) : `billingAddressId` et
  `billingAddressSnapshot` sont **tous deux null**. La facturation
  utilise `shippingAddressSnapshot`. C'est le cas C1 du PO-BRIEF
  (« guest checkout » le plus simple).
- `billingSameAsShipping = false` : `billingAddressId` peut être null
  (saisie libre, cas diaspora sans carnet), `billingAddressSnapshot`
  est **obligatoire** (la facture doit savoir où aller).

Le code de checkout remplit **toujours** `billingAddressSnapshot` (en
copiant `shippingAddressSnapshot` si `billingSameAsShipping = true`).
Ainsi la facture n'a jamais à se poser la question.

### 6. Cycle de vie d'une adresse du carnet

- **Création** d'une `Address` (par le client ou par le seed) : aucun
  impact sur les commandes existantes — les instantanés sont déjà
  figés.
- **Édition** d'une `Address` (correction de rue) : aucun impact sur
  les commandes existantes. La commande porte son propre instantané.
- **Suppression** d'une `Address` : `Order.shippingAddressId` devient
  `null` (FK nullable). `shippingAddressSnapshot` reste intact. Aucune
  perte de vérité. Cf. `onDelete: Cascade` ne s'applique **pas** ici :
  la relation est `references: [id]` sans `onDelete`, ce qui produit
  un `ON DELETE SET NULL` au niveau SQL — la commande survit, l'adresse
  du carnet disparaît.
- **Édition a posteriori du snapshot** : **interdit**. Aucun code ne
  doit faire `UPDATE Order SET shippingAddressSnapshot = …`. Si une
  correction est nécessaire (faute dans la saisie au checkout), elle
  passe par une **note de correction** dans `Shipment.notes` ou un
  document administratif hors base. Le snapshot est la **photographie
  juridique** de la transaction.

## Conséquence

**Positives**

- **C2 du PO-BRIEF devient implémentable** : le checkout accepte deux
  adresses distinctes ; la facture porte l'adresse de facturation au
  moment T ; le transporteur reçoit l'adresse de livraison au moment T.
- **Auditabilité juridique** : `SELECT shippingAddressSnapshot FROM "Order" WHERE id = ?`
  renvoie la donnée qui figurait sur la commande, indépendamment de
  toute évolution du carnet client.
- **Cohérence avec l'existant** : la règle des instantanés est déjà
  appliquée aux lignes (`OrderItem.*Snapshot`). L'étendre aux adresses
  est un **renforcement de pattern**, pas une rupture.
- **Pas de migration destructive** : `Order.addressId` (DAT initial)
  devient `Order.shippingAddressId String?` (renommage logique, le
  type reste `String?`). Si la table existe déjà en Sprint 2+, une
  migration `RENAME COLUMN` suffit.

**Négatives / risques**

- **Duplication de données** : l'adresse vit à deux endroits
  (carnet + snapshot). Acceptable : la taille est faible (~200 octets),
  la fréquence de mise à jour est nulle (snapshot figé), et le bénéfice
  juridique justifie le coût.
- **Validation à deux endroits** : le carnet valide via
  `Address.line1 NOT NULL` etc. ; le snapshot valide via
  `AddressSnapshotSchema` (zod) au checkout. **Pas** de validation
  DB sur les champs `Json` — c'est le contrat zod qui en est le
  garant. Cf. CONVENTIONS §6.
- **Le snapshot ne capture pas les variations de devise / taxes** au
  niveau de l'adresse elle-même : c'est `Order.currency` qui en est la
  source. Une adresse ne porte pas de devise. Pas d'ambiguïté.
- **Risque d'oubli au checkout** : si le code applicatif oublie de
  remplir `shippingAddressSnapshot`, la commande est créée et la
  facture est vide. **Atténué** par : (a) le champ est non-null en
  Prisma → erreur d'insertion explicite, (b) test d'intégration
  obligatoire (cf. alternatives écartées).

**Surface de code touchée**

- `prisma/schema.prisma` (Sprint 2, carte S1-005) — `model Order`,
  `model Address`, `enum OrderStatus` inchangé.
- `src/domain/address.ts` (Sprint 2) — type `AddressSnapshot`.
- `src/server/checkout.ts` (Sprint 3) — copie du snapshot au moment
  de la création d'`Order`.
- `src/app/api/orders/[id]/route.ts` (Sprint 3) — affichage facture,
  utiliser **toujours** `shippingAddressSnapshot` ou
  `billingAddressSnapshot`, jamais l'`Address` liée par FK.
- `tests/integration/checkout.test.ts` (Sprint 3) — test obligatoire :
  éditer une `Address` après une commande ne modifie pas le snapshot
  de la commande.
- `docs/team/ARCHITECTURE.md` §2 — modèle amendé (carte S1-015).
- `docs/team/CONVENTIONS.md` §5 (note argent) — déjà couvert par
  l'amendement D3 ; §9 — ajout ADR-0009 à la liste.

## Alternatives écartées

| Alternative | Pourquoi écartée |
|-------------|------------------|
| **Garder uniquement `Order.addressId` FK vers `Address`** | Ne permet pas C2 (facturation ≠ livraison). Et — surtout — ne protège pas contre la réécriture rétroactive du carnet. Inacceptable pour une donnée juridique. |
| **Snapshot `Json` côté `Address`, pas côté `Order`** | L'invariant « la commande porte sa vérité » se retourne : c'est l'adresse qui « appartient » à la commande, pas l'inverse. Mauvais modèle conceptuel, code plus confus. |
| **Trigger Postgres qui copie l'addresse à l'INSERT** | Logique métier dans la DB = invisible depuis Prisma, non testable sans DB, source de bugs en cas d'évolution du schéma. Le code applicatif (testé unitairement + en intégration) est l'endroit correct. |
| **`versioned_addresses` — table d'historique des adresses** | Compliqué : on historise à chaque modification, mais quelle version prend-on pour la commande ? Il faut un pointeur vers la version. Revient, en plus complexe, à un snapshot. |
| **Refuser d'éditer le carnet après une commande** | Mauvaise UX (le client ne peut plus corriger une faute de frappe sur sa nouvelle commande). Mauvaise sémantique (l'adresse du carnet et l'adresse de la commande sont deux choses différentes). |
| **Pas de snapshot, juste un flag `Order.addressLocked` qui désactive la FK** | Ne résout rien : la donnée n'est pas figée, on a juste désactivé le lien visible. La commande continue de pointer vers l'adresse modifiée. |
| **Snapshot `Json` non typé (champs `line1`/`line2` directement sur `Order`)** | Pourrait marcher, mais crée un schéma DB plat avec 5-6 colonnes « adresse » dupliquées entre shipping et billing → 10-12 colonnes. Plus lourd à maintenir qu'un `Json` typé côté code (`AddressSnapshot`). |