# ADR-0003 — Prix en `minor units` (Int) partout, devise en string ISO-4217

- **Statut** : Acceptée (Sprint 1), **amendée** post-audit S1-002 (Finding 5/8)
- **Date** : 2026-09-17
- **Décideurs** : équipe architecture + PO
- **Référence DAT** : §2, §11 ADR-0003

## Contexte

Les prix sont au cœur du système : variantes de produits, panier,
commande, paiement, remboursement, exports comptables. Un calcul faux
dû à un arrondi flottant est **inacceptable** — un client qui paie
`19,99 €` ne doit jamais se voir facturer `19,989999…`.

Le danger est cumulatif : `19.99 + 19.99 + 19.99` en `Float` IEEE-754
donne `59.96999999999999`. Multiplié par des centaines de paniers par
mois (PO-BRIEF §1 cible 100-500 commandes/mois), l'écart se creuse
et devient un vrai sujet comptable et juridique.

Le marché cible utilise deux devises principales :
- **EUR** pour la diaspora et les cartes internationales.
- **XAF** (Franc CFA, ISO-4217) pour le Cameroun et les paiements Mobile
  Money locaux. XAF n'a **pas de décimales** (1 XAF = subdivision 0).

## Décision

1. **Tout prix en base** est un `Int` PostgreSQL = **centimes** (ou
   unités entières pour XAF — le helper de conversion s'adapte).
2. **Tout prix dans le code** est un `Int` centimes. Aucun `Float`,
   aucun `Decimal` Prisma, aucun `number` non annoté.
3. **La devise** est un `String` ISO-4217 à 3 lettres (`"EUR"`,
   `"XAF"`, …), portée par `Money = { amountCents: number; currency: string }`.
4. **L'affichage** passe par un unique composant `<Money cents currency>`
   dans `src/ui/components/money.tsx` qui :
   - Choisit la locale (`fr-FR`, `fr-CM`).
   - Applique le bon séparateur de milliers.
   - Décide du nombre de décimales selon la devise (2 pour EUR/USD,
     0 pour XAF/JPY).
5. **Tous les calculs** sont dans `src/domain/pricing.ts` :
   `computeSubtotal`, `computeShipping`, `computeTotal`. Aucune logique
   de prix ailleurs.
6. **Conversion d'input UI → centimes** : une seule fois, au moment de
   la saisie ou de la création du Variant, pas à l'affichage.
7. **Comparaison cross-devise** interdite sans conversion explicite via
   une fonction `convertMoney(money, targetCurrency, rate)` (à ajouter
   quand le besoin se présentera — pas pour le MVP mono-devise).

## Conséquence

**Positives**
- **Impossible** d'avoir `19.999999` comme prix facturé. Tous les
  totaux sont des entiers reproductibles.
- Format cohérent sur toute l'app (front + back + exports).
- Exports comptables triviaux : CSV avec colonnes `amount_cents`
  directement exploitables.
- Pas de migration à prévoir si on ajoute une devise : c'est un champ
  `String`, pas un type money natif.

**Négatives / risques**
- **Migration** : si on avait déjà des données en `Float`, il faudrait
  tout convertir. Pas le cas ici (BDD vide au démarrage MVP).
- **Lecture code** : `1999` au lieu de `19.99` demande un temps
  d'adaptation. Le linter peut afficher un warning ESLint custom
  `no-decimal-price` si on voit `priceEuros: 19.99` (à ajouter en S2).
- **Calculs de taxes** (TVA, etc.) : si on doit faire du HT ↔ TTC, on
  garde tout en centimes et on applique les taux sur les entiers
  (`Math.round(ht * 1.2)`).
- **Affichage** : le helper `<Money>` doit être **strict** : aucun
  bypass direct avec `toLocaleString()` dans les templates (vérifié en
  code review, cf. CONVENTIONS §5).

**Surface de code touchée**
- `src/domain/pricing.ts`
- `src/ui/components/money.tsx`
- Tous les `Int` centimes dans `prisma/schema.prisma`
- Helpers de formatage dans `src/lib/format.ts` (à créer)

## Alternatives écartées

| Alternative | Pourquoi écartée |
|-------------|------------------|
| **`Float` (number JS)** | Erreurs d'arrondi cumulatives. `0.1 + 0.2 !== 0.3` en JS. Inacceptable pour de l'argent. |
| **`Decimal` Prisma** | Plus précis qu'un Float mais (a) convertit en string côté API, (b) plus lent, (c) alourdit les types TypeScript. Et on n'a pas besoin de plus de 2 décimales pour EUR / 0 pour XAF. |
| **BigInt** | Surdimensionné. Les montants max d'une commande (< 100 000 €) tiennent dans un `Int32` signé. |
| **Stocker en devise + exposant** (ex : `{ value: 1999, scale: 2 }`) | Plus flexible mais plus complexe à manipuler. Pas de cas d'usage où on aurait besoin de plus de 2 décimales au MVP. |
| **Multi-devise avec taux de change au runtime** | **Hors-périmètre V1** (PO-BRIEF §5). Le MVP est mono-devise paramétrable. On reporte. |

## Amendement S1-002 — Renommage `*Cents` → `*Minor` (Finding 5/8)

Suite à l'audit `t_88675ec5` du DAT, **le mot "cents" est éliminé** du nom de tous les champs prix et variables d'env. C'est une **fuite d'implémentation EUR** dans le contrat de données (XAF n'a pas de centimes).

**Renommages appliqués** (cette ADR + CONVENTIONS §5 + DAT §2 + .env.example) :

| Avant                          | Après                         |
|--------------------------------|-------------------------------|
| `priceCents`                   | `priceMinor`                  |
| `unitPriceCents`               | `unitPriceMinor`              |
| `subtotalCents`                | `subtotalMinor`               |
| `shippingCents`                | `shippingMinor`               |
| `totalCents`                   | `totalMinor`                  |
| `amountCents`                  | `amountMinor`                 |
| `SHIPPING_FLAT_CENTS`          | `SHIPPING_FLAT_MINOR`         |
| `FREE_SHIPPING_THRESHOLD_CENTS`| `FREE_SHIPPING_THRESHOLD_MINOR`|
| `Money.amountCents`            | `Money.amountMinor`           |
| `<Money cents={…}>`            | `<Money minor={…}>`           |

**Migration** : comme la base est vide au démarrage Sprint 1, **aucun script de migration** n'est requis. Tous les fichiers à créer portent le nouveau nom.

**Effort** : ≈ 5 minutes tant que les modèles ne sont pas commités. **Coût après paiement du premier client** : 1–2 jours de dette (renommer CSV comptable, formulaires admin, exports webhook, migrations Prisma).

**Note d'application** : XAF s'exprime en `Minor = unit` (exposant 0). Le helper `<Money>` applique l'exposant par devise ISO-4217 via une **lookup locale** (pas d'API externe), `minor / 10^exponent` pour l'affichage.
