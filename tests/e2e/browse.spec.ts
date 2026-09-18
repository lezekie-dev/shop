import { test, expect } from "@playwright/test";

test("browse: home → catalogue → fiche produit", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  await page.getByRole("link", { name: "Catalogue" }).click();
  await expect(page).toHaveURL(/\/products/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  // Le nom du produit : ciblé via `.card-title` car la carte porte aussi un lien
  // sur le visuel (même destination, sans texte).
  const firstProductLink = page.locator(".card-grid li a.card-title").first();
  await expect(firstProductLink).toBeVisible();
  await firstProductLink.click();

  await expect(page).toHaveURL(/\/products\//);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  // Le sélecteur de variante est sous le visuel : sur mobile il n'est pas dans
  // le viewport au chargement. Le timeout par défaut de 5 s suffit en général,
  // mais on l'allonge pour absorber le premier hit sur un build de prod froid.
  await expect(page.locator('select[name="variantId"]')).toBeVisible({ timeout: 20_000 });
});
