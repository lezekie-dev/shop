# Known issues — Sprint 2

## E2E `guest-checkout.spec.ts` flaky en dev local

**Symptôme** : lancé via `npx playwright test`, le test échoue avec
`Unhandled Runtime Error: __webpack_require__.n is not a function` dans
`add-to-cart-form.tsx`. Lancé isolément (`npx playwright test
tests/e2e/guest-checkout.spec.ts`), il passe en ~37s.

**Cause** : bug connu de Next 14.2 + webpack en mode dev : un module
client partagé entre deux specs (browse + guest-checkout) qui touche la
fiche produit laisse des chunks périmés dans `.next` après la 1ère
exécution. La 2e rencontre un module CJS qui n'a plus son helper
`__webpack_require__.n` injecté.

**Contournement validé** :
- `rm -rf .next && npx playwright test tests/e2e/guest-checkout.spec.ts`
  → 100% vert
- En CI GitHub Actions (build de prod, pas dev) → non reproductible

**Fix durable à investiguer en S3** :
- Passer le webServer Playwright en `npm run build && npm run start`
  plutôt que `npm run dev`
- OU ajouter `test.use({ ... })` avec un context isolé par spec
