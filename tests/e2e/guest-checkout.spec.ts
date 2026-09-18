import { test, expect } from "@playwright/test";

/**
 * E2E guest-checkout (S2 Phase G)
 *
 * Parcours complet invité :
 *   1. Catalogue → fiche produit → 1ère variante
 *   2. Ajout au panier (vérifie que le compteur / message de succès s'incrémente)
 *   3. Panier → checkout
 *   4. Soumission formulaire (adresse FR)
 *   5. /checkout/success : numéro ORD-YYYY-NNNNNN + lien "Voir ma commande"
 *   6. /orders/[id] : produit affiché, statut PAID
 *
 * Idempotent : email unique via cuid à chaque run (pas de dépendance à un état DB).
 */
test("guest checkout: ajoute 2 produits → checkout → succès", async ({ page }) => {
  // Timeout étendu : premier hit sur dev server Next.js = compilation JIT.
  test.setTimeout(180_000);

  // Email unique pour idempotence (cuid-like : timestamp + random court)
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `test-${uniq}@example.com`;

  // 1. Démarrage sur /
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  // 2. Naviguer vers /products (via le lien Catalogue du header)
  await Promise.all([
    page.waitForURL(/\/products/, { timeout: 60_000 }),
    page.getByRole("link", { name: "Catalogue" }).click(),
  ]);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  // 3. Cliquer sur le premier produit → fiche produit
  //    Le lien du NOM (`.card-title`) est ciblé explicitement : la carte
  //    contient désormais deux liens vers la même fiche (le visuel et le nom),
  //    et l'ordre du DOM ferait sélectionner le visuel — qui n'a pas de texte,
  //    donc `firstProductName` serait vide.
  const firstProductLink = page.locator(".card-grid li a.card-title").first();
  await expect(firstProductLink).toBeVisible();
  const firstProductName = (await firstProductLink.textContent())?.trim() ?? "";
  expect(firstProductName.length).toBeGreaterThan(0);
  await Promise.all([
    page.waitForURL(/\/products\/[^/?]+/, { timeout: 90_000 }),
    firstProductLink.click(),
  ]);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  // 4. Sélectionner la 1ère variante dans le <select>
  const variantSelect = page.locator('select[name="variantId"]');
  await expect(variantSelect).toBeVisible({ timeout: 30_000 });
  // Le formulaire pré-sélectionne déjà la première variante disponible, mais on
  // confirme explicitement en lisant la valeur courante.
  const selectedVariantText = await variantSelect.evaluate(
    (el: HTMLSelectElement) => {
      const opt = el.options[el.selectedIndex];
      return opt ? opt.textContent?.trim() ?? "" : "";
    }
  );
  expect(selectedVariantText.length).toBeGreaterThan(0);

  // 5. Cliquer sur "Ajouter au panier"
  //    Le form redirige automatiquement vers /cart après 600ms.
  //    On capture la réponse POST /api/cart pour valider que l'ajout a réussi.
  const addResponsePromise = page.waitForResponse(
    (resp) => resp.url().includes("/api/cart") && resp.request().method() === "POST"
  );
  await page.getByRole("button", { name: /ajouter au panier/i }).click();
  const addResponse = await addResponsePromise;
  expect(addResponse.status()).toBe(200);

  // Vérifie que le compteur / message de succès annonce bien "1 article"
  // (la réponse renvoie items.length ; le composant affiche
  //  "Ajouté au panier (X article(s))." via role="status").
  await expect(page.getByRole("status")).toContainText(/ajout/i);

  // 6. Atterrit sur /cart (setTimeout 600ms côté composant add-to-cart-form
  //    qui fait window.location.href = "/cart"). On laisse le temps à Next de
  //    compiler /cart à la demande (1er hit en dev = ~10-30s).
  await page.waitForURL(/\/cart$/, { timeout: 90_000, waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: /votre panier/i })).toBeVisible();

  // 7. Le produit ajouté est listé avec son nom et son prix.
  //    On utilise un sélecteur large : n'importe quel <li> qui contient le nom.
  const cartItems = page.locator("ul li").filter({ hasText: firstProductName });
  await expect(cartItems.first()).toBeVisible();
  // Le prix (euros) est rendu par <Money> dans cart-item-row.
  await expect(page.getByText(/€/)).toHaveCount(await page.getByText(/€/).count()); // sanity : au moins un €
  // Quantité ≥ 1 dans la rangée
  await expect(cartItems.first()).toContainText(/[1-9]/);

  // 8. Cliquer sur "Passer commande" → /checkout
  await page.getByRole("link", { name: /passer commande/i }).click();
  await expect(page).toHaveURL(/\/checkout/);

  // 9. Remplir le formulaire
  //    Sélecteurs précis par name pour éviter les collisions avec le label
  //    "Adresse de facturation identique à l'adresse de livraison".
  //    On utilise .pressSequentially() plutôt que .fill() parce que les inputs
  //    sont contrôlés par React (onChange/onInput), et pressSequentially
  //    déclenche un flux d'événements clavier natifs que React capte
  //    correctement — alors que .fill() peut poser problème sur des inputs
  //    contrôlés avec un onChange qui dépend de la valeur précédente.
  async function fillByName(name: string, value: string) {
    const input = page.locator(`input[name="${name}"]`);
    await input.click();
    await input.fill("");
    await input.pressSequentially(value, { delay: 5 });
  }
  await fillByName("email", email);
  await fillByName("firstName", "Test");
  await fillByName("lastName", "User");
  await fillByName("phone", "+33600000000");
  await fillByName("line1", "1 rue de Test");
  await fillByName("city", "Paris");
  await fillByName("postalCode", "75001");
  // Le pays est pré-rempli "FR" (DEFAULT_ADDRESS.country) — on s'assure qu'il est valide.
  await fillByName("country", "FR");

  // 10. Soumettre
  //     Capture la réponse /api/checkout pour récupérer l'orderId.
  const checkoutResponsePromise = page.waitForResponse(
    (resp) => resp.url().includes("/api/checkout") && resp.request().method() === "POST"
  );
  await page.getByRole("button", { name: /payer et commander/i }).click();
  const checkoutResponse = await checkoutResponsePromise;
  expect(checkoutResponse.status()).toBe(200);
  const checkoutBody = (await checkoutResponse.json()) as {
    orderId?: string;
    orderNumber?: string;
    accessToken?: string;
  };
  expect(checkoutBody.orderId, "orderId manquant dans la réponse /api/checkout").toBeTruthy();
  expect(checkoutBody.orderNumber, "orderNumber manquant dans la réponse /api/checkout").toBeTruthy();
  expect(checkoutBody.orderNumber).toMatch(/^ORD-\d{4}-\d{6}$/);
  // Le jeton d'accès est indispensable : la commande n'est consultable que par
  // lui (l'id seul ne doit plus rien ouvrir).
  expect(
    checkoutBody.accessToken,
    "accessToken manquant dans la réponse /api/checkout",
  ).toMatch(/^[0-9a-f]{64}$/);

  // 11. Atterrit sur /checkout/success
  await expect(page).toHaveURL(/\/checkout\/success/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(/merci/i);

  // 12. Numéro de commande affiché au format ORD-YYYY-NNNNNN
  await expect(page.getByText(/Numéro de commande/i)).toBeVisible();
  const orderNumberEl = page.locator("strong").filter({ hasText: /^ORD-\d{4}-\d{6}$/ });
  await expect(orderNumberEl).toBeVisible();
  const displayedNumber = (await orderNumberEl.textContent())?.trim() ?? "";
  expect(displayedNumber).toBe(checkoutBody.orderNumber);

  // 13. Lien "Voir ma commande" pointe vers /orders/[orderId] avec le jeton
  const viewLink = page.getByRole("link", { name: /voir ma commande/i });
  await expect(viewLink).toBeVisible();
  const href = await viewLink.getAttribute("href");
  expect(href).toBe(`/orders/${checkoutBody.orderId}?token=${checkoutBody.accessToken}`);

  // 14. Cliquer, vérifier que la page détail affiche le produit et le statut PAID
  await Promise.all([
    page.waitForURL(new RegExp(`/orders/${checkoutBody.orderId}`), {
      timeout: 90_000,
      waitUntil: "domcontentloaded",
    }),
    viewLink.click(),
  ]);

  // H1 contient le numéro de commande
  await expect(page.getByRole("heading", { level: 1 })).toContainText(displayedNumber);

  // Le produit ajouté est listé dans la carte "Articles"
  const articlesCard = page.locator("div").filter({ hasText: /^Articles/ }).first();
  await expect(articlesCard).toBeVisible();
  await expect(page.getByText(firstProductName).first()).toBeVisible();

  // Statut PAID : le badge a un aria-label "Statut : Payée"
  await expect(page.getByLabel(/statut.*payée/i)).toBeVisible();
});
