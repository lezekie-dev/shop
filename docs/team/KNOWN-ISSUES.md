# Known issues — résolus et suivis

## E2E `guest-checkout.spec.ts` — RÉSOLU

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
convertira pas complètement. C'est le premier chantier à traiter avant une
mise en production.

## Sécurité — état

- Accès aux commandes par jeton 256 bits (`Order.accessToken`). L'id seul ne
  ouvre plus rien : vérifié en production (401 sans, 404 faux jeton, 200 avec).
- Le mot de passe admin est `admin1234` (valeur de démo). **À changer avant
  toute exposition réelle** — c'est la seule barrière du back-office.
- Pas de limitation de débit sur les tentatives de connexion ni sur le
  checkout.
