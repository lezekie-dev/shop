# ADR-0002 — `PaymentProvider` : interface profonde, Stripe en premier adaptateur

- **Statut** : Acceptée (Sprint 1), **amendée** post-audit S1-002 (Finding 1/8)
- **Date** : 2026-09-17
- **Décideurs** : équipe architecture + PO
- **Référence DAT** : §3, §11 ADR-002

## Contexte

Le marché cible (Cameroun + diaspora, cf. PO-BRIEF §1) utilise massivement
Mobile Money (Orange Money, MTN MoMo, Wave). En parallèle, une partie de la
clientèle (diaspora Europe/Amérique du Nord, PO-BRIEF §2 persona P2)
paiera par carte bancaire internationale.

Le PO demande dès le Sprint 1 que **les paiements soient pensés pour
basculer de provider sans tout réécrire** (PO-BRIEF §6 Risque R1).

Stripe est le provider qu'on branche en premier : SDK stable, support
webhook natif, documentation exhaustive, mode test immédiatement
disponible. Mais le code métier (`src/server/checkout.ts`,
`src/server/webhook-handlers.ts`, le front `/checkout`) ne doit **jamais**
importer `stripe` directement.

## Décision

On définit une **interface étroite** `PaymentProvider` dans
`src/domain/payment/provider.ts`, **dans la couche `domain/`** (TypeScript
pur, zéro dépendance runtime) :

```ts
export interface PaymentProvider {
  readonly name: string; // "stripe" | "mobile_money"

  createIntent(input: CreateIntentInput): Promise<CreateIntentResult>;
  capture(providerRef: string): Promise<{ status: "succeeded" | "pending" | "failed" }>;
  refund(providerRef: string, amount?: Money): Promise<RefundResult>;
  verifyWebhook(input: VerifyWebhookInput): Promise<VerifiedWebhook>;
}
```

- **Stripe** : implémenté en S3 (`src/domain/payment/stripe.ts`).
- **Mobile Money** : placeholder throw `not implemented yet` en S1, à
  brancher via un agrégateur (NotchPay, Flutterwave, PayDunya) en S3.
- **Mock** : `src/domain/payment/mock.ts` utilisé par les tests
  d'intégration (`tests/integration/checkout.test.ts`).
- **Registry** : `src/domain/payment/registry.ts` sélectionne le provider
  via `process.env.PAYMENT_PROVIDER`. Singleton paresseux.
- Le code applicatif (`src/server/checkout.ts`,
  `src/app/api/checkout/route.ts`, `src/app/api/webhooks/stripe/route.ts`)
  reçoit le provider **par injection** (paramètre de fonction), pas par
  import direct du registry. C'est ce qui rend les tests triviaux.

## Conséquence

**Positives**
- Le contrat métier (`createIntent` → `capture` → webhook) est **figé**.
  Si on bascule de Stripe à un autre PSP, seul
  `src/domain/payment/stripe.ts` change.
- Tests : `mockPaymentProvider()` (DAT §9) remplace n'importe quel PSP
  en 5 lignes. Pas besoin de `nock`, pas besoin de `stripe-mock`.
- L'ajout d'un futur provider (virement, cryptomonnaie, etc.) est un
  nouveau fichier dans `src/domain/payment/`, pas une modification du
  code appelant.
- Le front ne dépend pas du SDK Stripe : on expose `clientToken` (pour
  Stripe Elements) ou `redirectUrl` (pour Mobile Money PSP) de la même
  façon, et le front choisit son rendu selon la présence de l'un ou
  l'autre.

**Négatives / risques**
- L'interface doit rester **suffisamment expressive** pour tous les PSP
  visés. Si un PSP n'a pas de concept de `capture` séparé (ex : virement),
  on l'implémente côté adaptateur comme un no-op.
- `refund` peut avoir des sémantiques différentes selon PSP (partiel vs
  total, async vs sync). On documente ça dans le JSDoc de chaque
  adaptateur, pas dans l'interface.
- Le `verifyWebhook` doit renvoyer une structure normalisée. Si Stripe
  ajoute un nouveau type d'événement qu'on ne mappe pas, on l'ignore
  silencieusement (retour `200 { received: true }` à Stripe, comme
  recommandé).

**Surface de code touchée**
- `src/domain/payment/{provider,stripe,mobile-money,mock,registry}.ts`
- `src/server/checkout.ts`, `src/server/webhook-handlers.ts`
- `src/app/api/checkout/route.ts`, `src/app/api/webhooks/*/route.ts`
- `tests/helpers/stripe-mock.ts`

## Alternatives écartées

| Alternative | Pourquoi écartée |
|-------------|------------------|
| **Importer `stripe` partout** | Couplage total au PSP. Bascule Mobile Money = réécriture de `checkout.ts`, des routes webhook, etc. À proscrire. |
| **Abstraction via un wrapper "façade" maison au-dessus de Stripe uniquement** | Différé en attendant d'avoir un 2e provider concret. Préférer l'abstraction dès maintenant pour ne pas avoir à migrer deux fois. |
| **Stripe Connect avec sous-comptes** | Pertinent pour un modèle marketplace multi-vendeurs, qui est **hors-périmètre V1** (PO-BRIEF §5). |
| **PSP unique (Stripe only) au MVP** | Le marché cible paie en Mobile Money. Bloquerait la moitié des acheteurs potentiels. Refusé par PO. |
| **Adapter par PSP sans interface commune** (`StripeCheckout`, `OrangeMoneyCheckout`, …) | Le code applicatif doit alors tester `instanceof` partout. Couplage en étoile au lieu d'un contrat commun. |

## Amendement S1-002 — Refund async (Finding 1/8)

Suite à l'audit `t_88675ec5` du DAT, **le contrat `refund()` est clarifié** :

- Le retour `RefundResult = { refundRef, status: "succeeded" | "pending" }` **est une promesse de soumission**, pas une confirmation de remboursement. Le remboursement effectif arrive ensuite via un **webhook** `charge.refunded` (Stripe) ou équivalent.
- L'état réel d'un refund est **déterministe seulement après** lecture du webhook → `Payment.status` doit passer par `REFUND_PENDING → REFUNDED` (et non directement à `REFUNDED`).

## Amendement S1-016 — Source de vérité du refund : `Payment.status` uniquement (ratification D9)

Deux enums qui affirment le même fait finissent par diverger. **Le refund n'est
porté que par `PaymentStatus`** — `OrderStatus.REFUNDED` (déjà présent, terminal)
reste un état d'affichage posé uniquement à la confirmation du webhook. Pendant
qu'un remboursement est en vol, la commande **reste `PAID`** : rien n'a changé
dans son cycle de vie, et si `refund.failed` arrive il n'y a aucune transition
à annuler.

- **Enum amendée** : `PaymentStatus` gagne la valeur `REFUND_PENDING` (DAT §2
  schéma). `OrderStatus` n'est **pas** modifiée.
- **Badge "remboursé"** de F-102 (PO) se **dérive** de `Payment.status` en V1.1.
- **À implémenter** côté Stripe adapter (Sprint 3) :
  - handler webhook `charge.refunded` → `Payment.status: REFUND_PENDING → REFUNDED`
    + `Order.status = REFUNDED` (transition terminale posée à la confirmation).
  - handler webhook `refund.failed` (existe en Stripe Connect) → `Payment.status:
    REFUND_PENDING → SUCCEEDED` (le paiement reste acquis) + alerte marchand
    via `AuditLog`. **Pas de transition sur `Order.status`.**
