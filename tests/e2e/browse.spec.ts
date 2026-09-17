import { test, expect } from "@playwright/test";

test("browse: home → catalogue → fiche produit", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  await page.getByRole("link", { name: "Catalogue" }).click();
  await expect(page).toHaveURL(/\/products/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  const firstProductLink = page.locator("ul li a").first();
  await expect(firstProductLink).toBeVisible();
  await firstProductLink.click();

  await expect(page).toHaveURL(/\/products\//);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.locator('select[name="variantId"]')).toBeVisible();
});
