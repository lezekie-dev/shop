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

