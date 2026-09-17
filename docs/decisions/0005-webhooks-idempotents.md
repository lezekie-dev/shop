# ADR-0005 — Webhooks Stripe idempotents via table `WebhookEvent`

- **Statut** : Acceptée (Sprint 1)
- **Date** : 2026-09-17
- **Décideurs** : équipe architecture + PO
- **Référence DAT** : §2, §11 ADR-005

## Contexte

Stripe (et tout PSP en général) garantit **at-least-once** sur la
livraison des webhooks : un même événement peut être reçu plusieurs
fois.

- Retry automatique en cas de 5xx / timeout côté receiver.
- Replay manuel par un opérateur (Dashboard Stripe → "Resend event").
- Reconnexion réseau entre Stripe et notre infra.

Conséquences si on n'idempotence pas :
- **Double décrément de stock** : un seul paiement validé, mais deux
  webhooks `payment_intent.succeeded` → `Stock.quantity -= requested`
  appliqué deux fois → on a vendu deux fois une unité qu'on a en un
  seul exemplaire.
- **Double création de `Payment`** : impossible à distinguer d'un vrai
  second paiement dans les exports comptables.
- **Double email de confirmation** au client.
- **Statut commande incohérent** entre la DB et Stripe.

## Décision

On impose une **insertion préalable idempotente** dans
`WebhookEvent` **avant tout traitement métier** :

```prisma
model WebhookEvent {
  id          String   @id @default(cuid())
  provider    String                       // "stripe"
  eventKey    String                       // stripe event id (evt_…)
  type        String                       // "payment_intent.succeeded"
  receivedAt  DateTime @default(now())
  processedAt DateTime?
  payload     Json
  error       String?
  @@unique([provider, eventKey])           // ← clé d'idempotence
  @@index([provider, type])
}
```

### Algorithme dans `src/server/webhook-handlers.ts`

```
1. Vérifier la signature (PaymentProvider.verifyWebhook).
   - Signature invalide → 400, on log, on insère PAS dans WebhookEvent.

2. Tenter INSERT dans WebhookEvent avec (provider, eventKey, type, payload).
   - Contrainte unique violée (P2002) → événement déjà reçu.
       → SELECT l'ancien enregistrement.
       → Si processedAt non null → on a déjà tout fait.
       → Si processedAt null ET error non null → on a déjà essayé, on
         a échoué → retry autorisé (voir §3).
       → Sinon (receivedAt existe mais processedAt null, pas d'error)
         → état incohérent, on log et on renvoie 200 sans retraitement.
       → Dans tous les cas : 200 { received: true, replay: true }.

3. Si l'INSERT réussit : exécuter le handler métier dans une transaction.
   - Succès → UPDATE WebhookEvent SET processedAt = now.
   - Échec métier (ex : Order introuvable) → UPDATE WebhookEvent SET
     error = "...". Stripe va retenter automatiquement (réponse != 2xx).
     On NE remet PAS processedAt : on garde la trace pour debug.

4. Renvoyer 200 { received: true }.
```

### Deuxième niveau d'idempotence : `Payment @@unique([provider, providerRef])`

Même si `WebhookEvent` est contourné (bug, manipulation manuelle), la
contrainte unique sur `Payment` empêche deux lignes de paiement pour
un même `payment_intent.id`. C'est une **ceinture + bretelles** assumée.

## Conséquence

**Positives**
- **Replay = no-op** : un opérateur qui rejoue un événement dans Stripe
  Dashboard pour debug ne déclenche rien côté métier.
- **Double livraison réseau** = no-op.
- **Audit trail** : la table `WebhookEvent` garde l'historique de tous
  les événements reçus (qui, quand, quel type, quel résultat). Utile
  en cas de litige avec un client.
- **Code lisible** : tout est linéaire dans `webhook-handlers.ts`, pas
  de logique de "déjà fait ?" éparpillée.
- **Compatible multi-provider** : le même schéma marche pour Stripe,
  Mobile Money, virement — il suffit de respecter la contrainte unique
  `(provider, eventKey)`.

**Négatives / risques**
- **Croissance de la table** : 1 ligne par événement reçu. À 500
  commandes/mois + 3-4 événements par commande ≈ 2000 lignes/mois.
  Pas critique. **Purge après 12 mois** dans un cron en S4.
- **Transaction WebhookEvent INSERT + métier** : on peut décider de NE
  PAS englober le métier dans la même transaction que l'INSERT
  (sinon un plantage métier empêche de logger l'événement). On
  commit l'INSERT d'abord, puis le métier dans une transaction
  séparée. Cf. pseudo-code ci-dessus.
- **Événement non idempotent côté Stripe** : Stripe peut envoyer un
  événement `payment_intent.amount_capturable_updated` puis un
  `payment_intent.succeeded`. Si on décrémente sur le premier, on
  décrémente deux fois. → **On n'agit QUE sur
  `payment_intent.succeeded` et `payment_intent.payment_failed`** pour
  les transitions de stock et de statut. Tout autre type est loggué
  et ignoré (réponse 200 immédiate).

**Surface de code touchée**
- `prisma/schema.prisma` : `WebhookEvent`, `Payment @@unique`
- `src/server/webhook-handlers.ts`
- `src/app/api/webhooks/stripe/route.ts`
- `tests/integration/webhook.test.ts` : 2e appel identique = no-op
- Cron de purge (S4)

## Alternatives écartées

| Alternative | Pourquoi écartée |
|-------------|------------------|
| **Pas d'idempotence** (et tant pis pour les doublons) | Inacceptable : double décrément = perte d'argent / client frustré. |
| **Idempotence par token applicatif** (notre propre UUID) | Obligerait Stripe à transporter notre token → impossible, Stripe génère ses propres `event.id`. On utilise `event.id` directement. |
| **Idempotence via Redis** (`SETNX event:stripe:evt_xxx`) | Ajoute Redis comme dépendance critique. La DB Postgres suffit avec une contrainte unique. |
| **Idempotence via cache mémoire** | Invalide au redémarrage du conteneur Coolify. Pas fiable. |
| **Idempotence uniquement via `Payment @@unique`** | Insuffisant : ça empêche le double `Payment` mais pas le double décrément de stock ni le double email. Il faut la couche `WebhookEvent` pour court-circuiter AVANT le métier. |
| **Lock pessimiste sur la table Order pendant le traitement webhook** | Sérialise tous les webhooks (1 par commande à la fois) → bottleneck. L'insertion idempotente est non bloquante. |
