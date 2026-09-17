# ADR-0003 — Prix en **minor units ISO 4217** (Int), devise en string ISO-4217

- **Statut** : Acceptée (Sprint 1) — **amendée 2026-09-17 (audit D3)**
- **Date initiale** : 2026-09-17
- **Date d'amendement** : 2026-09-17 (carte S1-014)
- **Décideurs** : équipe architecture + PO + chief (arbitrage D3 post-audit DAT)
- **Référence DAT** : §2, §11 ADR-003 ; audit DAT carte S1-002

> **Amendement** : la formulation « centimes » est remplacée par
> **« minor units ISO 4217 »**. La règle technique reste la même
> (`Int` côté Postgres et code) mais le vocabulaire, le module de
> conversion et le contrat Stripe sont alignés. Voir la section
> « Amendement 2026-09-17 » en fin de document pour le diff
> conceptuel.

---

## Contexte

Les prix sont au cœur du système : variantes de produits, panier,
commande, paiement, remboursement, exports comptables. Un calcul faux
dû à un arrondi flottant est **inacceptable** — un client qui paie
`19,99 €` ne doit jamais se voir facturer `19,989999…`.

Le danger est cumulatif : `19.99 + 19.99 + 19.99` en `Float` IEEE-754
donne `59.96999999999999`. Multiplié par des centaines de paniers par
mois (PO-BRIEF §1 cible 100-500 commandes/mois), l'écart se creuse
et devient un vrai sujet comptable et juridique.

Le marché cible utilise **deux devises principales** :

- **EUR** pour la diaspora et les cartes internationales (2 décimales).
- **XAF** (Franc CFA, ISO-4217) pour le Cameroun et les paiements
  Mobile Money locaux. XAF a **0 décimale** (1 XAF = subdivision 0).

La spec ISO 4217 formalise ce découpage : chaque devise a un **nombre
de décimales officiel** (appelé *minor unit* / *fraction digit*).
Conséquence directe : un même « 1,00 » en EUR = `100` minor units, mais
« 1 XAF » = `1` minor unit. **Un « facteur 100 » universel est faux.**
Voir tableau § « Décision — Devises supportées et décimales ».

---

## Décision

### 1. Devises supportées et nombre de décimales (ISO 4217)

On supporte officiellement les devises suivantes. Chaque devise porte
son nombre de décimales officiel ISO 4217 — **on ne divise pas
arbitrairement par 100** :

| Devise | Libellé                  | Décimales | Exemple              | Minor units de `12,50` |
|--------|--------------------------|-----------|----------------------|------------------------|
| EUR    | Euro                     | 2         | `12,50 €`            | `1250`                 |
| USD    | Dollar US                | 2         | `12.50`              | `1250`                 |
| GBP    | Livre sterling           | 2         | `12.50`              | `1250`                 |
| XAF    | Franc CFA (Afrique Centrale) | **0** | `1 250 FCFA`         | `1250`                 |
| XOF    | Franc CFA (Afrique Ouest)    | **0** | `1 250 FCFA`         | `1250`                 |
| XPF    | Franc CFP (Pacifique)    | **0**     | `1 250 XPF`          | `1250`                 |
| JPY    | Yen japonais             | **0**     | `¥1,250`             | `1250`                 |
| KRW    | Won sud-coréen           | **0**     | `₩1,250`             | `1250`                 |

> La liste est figée au MVP. Ajouter une devise = nouvel ADR.

### 2. Module unique de conversion : `src/domain/money.ts`

Toute conversion entre une valeur humaine (`"19.99"`, `"1250"`) et un
`Int` minor units **passe par ce module**. Pas d'exception.

```ts
// src/domain/money.ts — extrait du contrat (à implémenter en S1-005)

/** Nombre de décimales officiel ISO 4217 pour une devise donnée. */
export function decimalsFor(currency: string): 0 | 2 | 3 | 4;

/** Convertit une valeur humaine (string ou number) vers les minor units. */
export function toMinorUnits(humanValue: string | number, currency: string): number;

/** Convertit des minor units vers une valeur humaine (string, locale-indépendante). */
export function fromMinorUnits(minor: number, currency: string): string;

/** Type valeur-monetaire : entier + devise. */
export type Money = { amountMinor: number; currency: string };
```

**Règle absolue (déclinée) :**

- ❌ `amount * 100` n'importe où dans le code.
- ❌ `amount / 100` n'importe où dans le code.
- ❌ Stockage direct d'un `Float` ou `Decimal` pour un prix.
- ✅ Toute conversion passe par `toMinorUnits` / `fromMinorUnits`.
- ✅ Le type `Money` est la seule forme monetaire qui circule entre
  couches (`app/api` ↔ `server` ↔ `domain`).

### 3. Champs en base = `Int` minor units

Les colonnes Postgres (`Variant.priceMinor`, `Order.subtotalMinor`,
`OrderItem.unitPriceMinor`, `Payment.amountMinor`, etc.) sont des
`Int` minor units de la devise portée par la ligne (`Order.currency`,
`Payment.currency`, etc.). Le mapping « colonne = minor units » est
porté par le **type Prisma** (commentaire `// minor units of <currency>`)
et par les helpers ci-dessus.

> **Pourquoi ne pas nommer les colonnes `priceMinorUnits` ?** Les noms
> historiques (`priceCents`, `amountCents`, `unitPriceCents`,
> `subtotalCents`, `shippingCents`, `totalCents`, `amountCents`) sont
> déjà figés dans le schéma S1-002 et consommés par les tests à venir.
> Renommer une colonne = migration de schéma + tous les `select`
> Prisma + tous les snapshots. On accepte le décalage « nom de colonne =
> centimes historiques / sémantique = minor units ISO 4217 ». Le
> **vocabulaire mental** dans le code et les ADR est désormais « minor
> units » ; le nom de colonne reste comme une dette de naming assumée.
> Une migration `priceCents → priceMinor` pourra être faite
> indépendamment plus tard (S4+) sans casser le contrat métier.

### 4. Cohérence avec Stripe

Stripe attend ses montants **en minor units de la devise** (champ
`amount` de `PaymentIntent`, `price_data.unit_amount`, etc.). C'est
exactement le contrat de `Money.amountMinor`. Conséquence directe :

> **Le montant passé à Stripe est `Money.amountMinor` tel quel, sans
> aucune conversion.** Plus de multiplication par 100, plus de
> division par 100. La même valeur fait foi du stockage DB au
> `PaymentIntent.amount`. Si la conversion est fausse en un point,
> elle est fausse partout — et un test unitaire sur
> `createIntentInput` la détecte en ms.

Le module `src/domain/payment/stripe.ts` (S3) prend `Money` en
entrée et passe `amountMinor` directement à l'API Stripe.

### 5. Affichage et calculs

- **Affichage** : composant unique `<Money value={money} />` dans
  `src/ui/components/money.tsx`, qui choisit la locale (`fr-FR`,
  `fr-CM`) et le nombre de décimales selon `money.currency`. Aucun
  `toLocaleString` direct.
- **Calculs** : dans `src/domain/pricing.ts`
  (`computeSubtotal`, `computeShipping`, `computeTotal`) : toutes les
  fonctions prennent/retournent des `Money`, jamais des nombres nus.
- **Comparaison cross-devise** interdite sans conversion explicite
  (`convertMoney(money, targetCurrency, rate)` — hors MVP mono-devise).

---

## Conséquence

**Positives**

- **Vocabulaire mental ISO-correct** : on ne parle plus de « centimes »
  pour XAF (où il n'y en a pas). Tout le monde — devs, PO, comptable —
  parle la même langue que Stripe et que la norme ISO 4217.
- **Impossible** d'avoir `19.999999` comme prix facturé. Tous les
  totaux sont des entiers reproductibles, indépendamment de la devise.
- **Une seule source de vérité pour la conversion** : `money.ts`. Une
  régression sur XAF (oubli du facteur 100) ne peut plus passer en
  review, parce que le code n'a plus de conversion locale à oublier.
- **Stripe-compatible by design** : `Money.amountMinor` est exactement
  ce que Stripe attend. Plus de bug classique « j'ai envoyé `19.99`
  au lieu de `1999` » (cf. guerre des `*100` sur Stripe-Node).
- **Format cohérent** sur toute l'app (front + back + exports).
- **Exports comptables** triviaux : CSV avec colonnes `amount_minor`
  directement exploitables, peu importe la devise.

**Négatives / risques**

- **Migration** : si on avait déjà des données en `Float` ou en
  centimes « codés en dur *100 », il faudrait tout reconvertir. Pas
  le cas ici (BDD vide au démarrage MVP).
- **Dette de naming** : noms de colonnes `*Cents` ne reflètent plus
  la sémantique « minor units ISO 4217 ». Accepté comme dette
  documentée. À renommer dans une migration ultérieure si le coût
  devient trop visible.
- **Lecture code** : `1999` au lieu de `19.99` demande un temps
  d'adaptation pour les devs venant d'un univers `Float`. Le linter
  peut afficher un warning ESLint custom `no-decimal-price` si on voit
  `priceEuros: 19.99` (à ajouter en S2).
- **Calculs de taxes** (TVA, etc.) : si on doit faire du HT ↔ TTC,
  on garde tout en minor units et on applique les taux sur les
  entiers (`Math.round(ht * 1.2)`).
- **Affichage** : le helper `<Money>` doit être **strict** : aucun
  bypass direct avec `toLocaleString()` dans les templates (vérifié en
  code review, cf. CONVENTIONS §5).

**Surface de code touchée**

- `src/domain/money.ts` (helpers `toMinorUnits`, `fromMinorUnits`,
  `decimalsFor`, type `Money`) — créé par S1-005.
- `src/domain/pricing.ts` — adapté pour prendre/retourner `Money`.
- `src/ui/components/money.tsx` — accepte `Money` en prop.
- `src/domain/payment/stripe.ts` (S3) — passe `Money.amountMinor` à
  Stripe sans conversion.
- Toutes les colonnes `Int` monétaires dans `prisma/schema.prisma`
  (commentaire `// minor units of <currency>` à ajouter).
- Helpers de formatage dans `src/lib/format.ts` (à créer) — ne
  formatent que des `Money`.

---

## Alternatives écartées

| Alternative                                       | Pourquoi écartée |
|---------------------------------------------------|------------------|
| **`Float` (number JS)**                            | Erreurs d'arrondi cumulatives. `0.1 + 0.2 !== 0.3` en JS. Inacceptable pour de l'argent. |
| **`Decimal` Prisma**                               | Plus précis qu'un Float mais (a) convertit en string côté API, (b) plus lent, (c) alourdit les types TypeScript. Et on n'a pas besoin de plus de 2 décimales pour EUR / 0 pour XAF. |
| **`BigInt`**                                       | Surdimensionné. Les montants max d'une commande (< 100 000 €) tiennent dans un `Int32` signé. |
| **Stocker en devise + exposant** (ex : `{ value: 1999, scale: 2 }`) | Plus flexible mais plus complexe à manipuler. Le module `money.ts` répond au besoin sans complexifier le modèle. |
| **« Centimes » comme nom canonique**               | Faux pour XAF/JPY/KRW. Crée une dette sémantique permanente avec ISO 4217 et avec Stripe. Refusé par arbitrage D3. |
| **Multi-devise avec taux de change au runtime**   | **Hors-périmètre V1** (PO-BRIEF §5). Le MVP est mono-devise paramétrable. On reporte. |
| **Conversion locale `* 100` / `/ 100`** dans chaque fichier | C'est exactement le bug qu'on veut prévenir. Refusé par arbitrage D3 : la **même** conversion doit servir au stockage et au paiement, donc plus de facteur 100 possible nulle part. |

---

## Amendement 2026-09-17 (carte S1-014, audit D3)

### Avant (rédaction S1-002)

- Titre : « Prix en **centimes** (Int) partout ».
- Décision : « tout prix = `Int` centimes, ou unités entières pour
  XAF — le helper de conversion s'adapte ».
- Pas de tableau de devises par décimales.
- Pas de module `money.ts` nommé.
- Pas de règle « aucun `Int` prix nu hors helpers ».

### Après (amendement S1-014)

- Titre : « Prix en **minor units ISO 4217** ».
- Décision explicite : **une seule fonction de conversion**, qui
  connaît la décimale de la devise, est l'unique entrée/sortie entre
  forme humaine et `Int` stocké.
- Tableau des devises MVP et leur nombre de décimales (table §1).
- Module canonique `src/domain/money.ts` nommé explicitement.
- Règle « aucun `*100` ou `/100` dans le code » écrite noir sur blanc.
- Conséquence Stripe : `Money.amountMinor` passé tel quel à
  `PaymentIntent.amount`.

### Pourquoi

L'audit DAT (carte S1-002) a relevé que « centimes » est ambigu pour
toutes les devises à 0 décimale, et que le DAT ne nommait pas le
module de conversion. Conséquence : un dev pouvait légitimement
écrire `amount * 100` dans un nouveau fichier en pensant bien faire,
et personne ne l'aurait vu en review tant que les tests ne couvraient
que EUR. L'amendement rend la conversion **physiquement** unique —
plus de facteur 100 à oublier, parce qu'il n'y a plus de facteur 100
du tout dans le code.
