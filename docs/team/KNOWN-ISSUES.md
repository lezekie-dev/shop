# Known issues — résolus et suivis

> Tenu à jour par le Chief of Staff. Une ligne « résolu » doit porter une date
> et une preuve d'exécution, pas une intention.

## Résolus

### Rate limiting de la connexion admin — RÉSOLU (18/09)

**Vérifié en production, pas relu dans un document** : 6 tentatives ratées
consécutives sur `https://shop.app-lezekie.dev/api/admin/login` renvoient
`401 401 401 401 401` puis **`429`**, avec
`{"error":"Trop de tentatives pour ce compte. Réessayez dans 15 minutes.",
"code":"RATE_LIMITED","retryAfterSeconds":897}`.

Traçage en base (table `LoginAttempt`, portée `admin`) et non en mémoire :
Next.js sert la même route depuis plusieurs workers, un compteur en RAM se
contournerait en tombant sur un autre worker à chaque essai.

### Accès aux commandes par jeton — RÉSOLU

`Order.accessToken` (32 octets crypto). Vérifié en production : 401 sans
jeton, 404 avec un faux, 404 avec le jeton d'une autre commande, 200 avec le
bon.

### E2E `guest-checkout.spec.ts` — RÉSOLU

**Ancien symptôme** : lancé via `npx playwright test` en mode `next dev`, le test
échouait par intermittence avec `__webpack_require__.n is not a function` dans
`add-to-cart-form.tsx`. Lancé isolément, il passait.

**Cause** : bug de Next 14.2 + webpack en mode dev — un module client partagé
entre deux specs laissait des chunks périmés dans `.next`.

**Correctif appliqué** : les specs tournent contre le **build de production**
(`npm run build && npx next start`), pas le dev server. En production, pas de
HMR ni de chunks invalidés. Vérifié : les 2 specs passent (13,5s au total).

Commande :
```
npm run build && npx next start -p 3108 &
PLAYWRIGHT_BASE_URL=http://127.0.0.1:3108 npx playwright test
```
`playwright.config.ts` démarre `npm run dev` par défaut ; passer
`PLAYWRIGHT_BASE_URL` court-circuite ce démarrage et pointe sur le serveur prod.

### Lenteur de la suite de tests — RÉSOLU (18/09)

**Symptôme** : des tests d'intégration dépassaient 30 s et la suite complète
frôlait les 12 minutes. Un agent d'implémentation est resté bloqué 30 minutes
dessus et a été coupé en timeout.

**Cause racine** : `tests/helpers/prisma-test.ts` lançait **29 `TRUNCATE`
séparés dans une même transaction**. `TRUNCATE` prend un verrou
`AccessExclusiveLock` par table ; lancés en parallèle, les verrous s'attendent
mutuellement. Relevé directement dans `pg_locks` : un processus exécutant 29
`TRUNCATE "Order"` concurrents. Une passe de nettoyage sur des tables **vides**
coûtait ~5 s.

**Correctif** : une seule instruction `TRUNCATE` groupée, liste des tables
découverte à l'exécution (elle était codée en dur et ignorait les 10 tables
ajoutées en V1, d'où des tests qui héritaient des données du précédent), et
`RESTART IDENTITY` retiré (aucune séquence à réinitialiser : toutes les clés
sont des `cuid()`).

**Mesure** : 33 s → **1,3 s** par test.

## Pièges rencontrés et documentés dans le code

- **Items de grid/flex et `min-width: auto`** : un tableau large élargissait
  toute la page au lieu de scroller dans son conteneur. Chaque niveau de la
  chaîne (`.admin-main`, `.admin-page`, `.admin-page > *`, `.filters`,
  `.filters__pill`) porte maintenant `min-width: 0`. Voir les commentaires
  dans `src/ui/styles/admin.css`.
- **Serveurs `next start` orphelins** : plusieurs instances survivent aux
  sessions et servent un HTML obsolète référençant des fichiers CSS supprimés,
  ce qui produit de faux bugs (styles absents, débordements fantômes). Avant
  toute vérification visuelle : `ss -tlnp | grep :<port>` et tuer l'ancien
  process, ou utiliser un port neuf.
- **`redirect()` de Next en test** : l'erreur jetée a pour `message` exactement
  `NEXT_REDIRECT`, l'URL de destination est dans `digest`. Tester
  `/NEXT_REDIRECT.*\/categorie/` sur le message seul échoue toujours.
- **Audit visuel par un modèle** : ses lectures de chiffres et de glyphes sont
  faillibles (trois faux positifs relevés : écart de 0,16 € inexistant, colonne
  « vide » qui contenait un chevron, faute d'orthographe fantôme). Vérifier
  tout montant en SQL et tout texte par `grep` avant de corriger.

## Visuels produits : démonstration, à remplacer

Les 6 visuels de `public/products/*.png` sont des **packshots générés**
(SVG → PNG, aux couleurs de la marque), pas des photos des produits réels.

Pourquoi ce choix : une recherche de photos libres de droits ramène du bruit
imprévisible (une planète pour « casquette », un poteau en bois, un homme en
débardeur mouillé pour « t-shirt »), et une photo de banque d'images ne
correspond de toute façon pas au produit vendu. Un visuel généré est cohérent
entre produits et sans question de licence.

La mécanique de remplacement est en place : `ProductImage` en base (galerie
ordonnée avec `alt` obligatoire, `width`/`height` pour éviter le décalage de
mise en page), et `ProductVisual` côté rendu avec repli explicite si le
marchand n'a pas encore téléversé de photo.

**Limite de fond assumée** : une boutique textile sans photos réelles ne
convertira pas complètement. Le lot 2C de la vague 2 (téléversement d'images)
traite ce point.

## Sécurité — état

- Accès aux commandes par jeton 256 bits : vérifié en production.
- Rate limiting sur la connexion admin : **vérifié en production** (401 ×5
  puis 429). Rate limiting client sur la portée `customer`, seuils distincts.
- Le mot de passe admin est `admin1234` (valeur de démo, présente dans
  `README.md` et dans ce dépôt **public**). **À changer avant toute exposition
  réelle** : `npx tsx scripts/set-admin-password.ts admin@shop.local "<mot-de-passe>"`.
  C'est la seule barrière du back-office.
- 2FA TOTP disponible (RFC 6238, sans dépendance ajoutée) mais **optionnelle** :
  un compte sans `totpEnabledAt` se connecte normalement.
- Pas encore de limitation de débit sur le checkout (création de commande).
  Suivi au backlog de la vague 2.
