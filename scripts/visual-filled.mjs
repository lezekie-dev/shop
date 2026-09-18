/**
 * Capture le checkout AVEC un panier rempli (l'état vide ne montre pas
 * le formulaire ni les moyens de paiement). Ajoute 2 articles puis capture
 * /cart et /checkout aux 3 viewports.
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.APP_URL ?? "http://127.0.0.1:3108";
const OUT = "/tmp/shop-captures-filled";
mkdirSync(OUT, { recursive: true });

const viewports = [
  { name: "mobile-360", width: 360, height: 800 },
  { name: "tablet-768", width: 768, height: 1024 },
  { name: "desktop-1440", width: 1440, height: 900 },
];

const browser = await chromium.launch();

for (const vp of viewports) {
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();

  // 1. Ajouter 2 articles au panier depuis les fiches produit
  const links = page.locator('ul li a[href^="/products/"]');
  await page.goto(`${BASE}/products`, { waitUntil: "networkidle" });
  const slugs = await links.evaluateAll((els) =>
    els.map((e) => e.getAttribute("href")).filter(Boolean).slice(0, 2),
  );
  const nb = Math.min(2, slugs.length);
  for (let i = 0; i < nb; i++) {
    // Navigation directe par slug : le formulaire redirige vers /cart après
    // l'ajout, donc on ne peut pas enchaîner les clics dans une boucle.
    await page.goto(`${BASE}${slugs[i]}`, { waitUntil: "networkidle" });
    await page.waitForSelector('select[name="variantId"]', { timeout: 60000 });
    const respP = page.waitForResponse(
      (r) => r.url().includes("/api/cart") && r.request().method() === "POST",
    );
    await page.getByRole("button", { name: /ajouter au panier/i }).click();
    const resp = await respP;
    console.log(`  ajout ${i + 1} (${slugs[i]}) → HTTP ${resp.status()}`);
    await page.waitForTimeout(1500);
  }

  // 2. Capturer le panier rempli
  await page.goto(`${BASE}/cart`, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  const cartOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  await page.screenshot({ path: `${OUT}/panier-rempli-${vp.name}.png`, fullPage: true });
  const cartText = await page.evaluate(() => document.body.innerText.slice(0, 400));

  // 3. Passer au checkout
  const passLink = page.getByRole("link", { name: /passer commande|commander|checkout/i });
  if (await passLink.count()) {
    await Promise.all([
      page.waitForURL(/\/checkout/, { timeout: 60000 }),
      passLink.first().click(),
    ]);
  } else {
    await page.goto(`${BASE}/checkout`, { waitUntil: "networkidle" });
  }
  await page.waitForTimeout(500);
  const coOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  await page.screenshot({ path: `${OUT}/checkout-rempli-${vp.name}.png`, fullPage: true });

  const probe = await page.evaluate(() => {
    const body = document.body.innerText;
    const radios = [...document.querySelectorAll('input[type="radio"]')].map((r) => r.value);
    return {
      paymentOptions: radios,
      mentionsSimule: /simul/i.test(body),
      mentionsMobileMoney: /mobile money/i.test(body),
      mentionsVirement: /virement/i.test(body),
      hasForm: !!document.querySelector('input[name="email"]'),
      fields: [...document.querySelectorAll("input[name]")].map((i) => i.name),
      hasTotal: /total/i.test(body),
    };
  });

  console.log(`\n=== ${vp.name} ===`);
  console.log(`  panier   overflow=${cartOverflow}px`);
  console.log(`  checkout overflow=${coOverflow}px`);
  console.log(`  moyen de paiement proposés : ${JSON.stringify(probe.paymentOptions)}`);
  console.log(`  simulé=${probe.mentionsSimule} mobileMoney=${probe.mentionsMobileMoney} virement=${probe.mentionsVirement}`);
  console.log(`  formulaire présent=${probe.hasForm} total affiché=${probe.hasTotal}`);
  console.log(`  champs : ${probe.fields.join(", ")}`);
  if (vp.name === "desktop-1440") console.log(`  extrait panier : ${cartText.replace(/\n/g, " | ").slice(0, 200)}`);

  await ctx.close();
}
await browser.close();
console.log(`\nCaptures dans ${OUT}`);
