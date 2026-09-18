/**
 * Boucle visuelle — capture les écrans clés à 3 viewports.
 *
 * Se connecte d'abord en admin via le formulaire réel, puis capture :
 *   - catalogue, fiche produit, panier, checkout  (parcours client)
 *   - dashboard, commandes, détail, produits, stock, emails  (admin)
 *
 * Écrit un JSON de synthèse (statuts HTTP, débordement horizontal,
 * placeholders détectés) dans /tmp/shop-captures/summary.json.
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.env.APP_URL ?? "http://127.0.0.1:3108";
const OUT = process.env.OUT_DIR ?? "/tmp/shop-captures";
mkdirSync(OUT, { recursive: true });

const ADMIN_EMAIL = "admin@shop.local";
const ADMIN_PASSWORD = "admin1234";

const viewports = [
  { name: "mobile-360", width: 360, height: 800 },
  { name: "tablet-768", width: 768, height: 1024 },
  { name: "desktop-1440", width: 1440, height: 900 },
];

const screens = [
  { key: "home", path: "/", label: "Accueil" },
  { key: "catalogue", path: "/products", label: "Catalogue" },
  { key: "panier", path: "/cart", label: "Panier" },
  { key: "checkout", path: "/checkout", label: "Checkout" },
  { key: "admin-dashboard", path: "/admin", label: "Dashboard admin" },
  { key: "admin-orders", path: "/admin/orders", label: "Commandes" },
  { key: "admin-products", path: "/admin/products", label: "Produits" },
  { key: "admin-stock", path: "/admin/stock", label: "Stock" },
  { key: "admin-emails", path: "/admin/emails", label: "Emails" },
];

const browser = await chromium.launch();
const summary = [];

for (const vp of viewports) {
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();

  // Connexion admin via le formulaire réel (pas d'injection de cookie : on
  // veut aussi valider que le login fonctionne depuis un navigateur).
  await page.goto(`${BASE}/admin/login`, { waitUntil: "domcontentloaded" });
  await page.fill('input[name="email"]', ADMIN_EMAIL);
  await page.fill('input[name="password"]', ADMIN_PASSWORD);
  await Promise.all([
    page.waitForURL(/\/admin(?!\/login)/, { timeout: 30000 }).catch(() => null),
    page.click('button[type="submit"]'),
  ]);

  for (const s of screens) {
    const url = `${BASE}${s.path}`;
    const resp = await page
      .goto(url, { waitUntil: "networkidle", timeout: 30000 })
      .catch(() => null);
    await page.waitForTimeout(350);

    const file = `${OUT}/${s.key}-${vp.name}.png`;
    await page.screenshot({ path: file, fullPage: true });

    const probe = await page
      .evaluate(() => {
        const de = document.documentElement;
        const overflow = [...document.querySelectorAll("*")]
          .filter((el) => el.getBoundingClientRect().right > de.clientWidth + 1)
          .slice(0, 8)
          .map((el) => `${el.tagName.toLowerCase()}.${(el.className || "").toString().slice(0, 40)}`);
        const text = document.body.innerText ?? "";
        return {
          overflowCount: overflow.length,
          overflowSample: overflow,
          placeholders: (text.match(/lorem|placeholder|\bTODO\b|dummy|example/gi) ?? []).length,
          hasH1: !!document.querySelector("h1"),
          textLen: text.trim().length,
          scrollH: de.scrollHeight,
          clientH: de.clientHeight,
        };
      })
      .catch(() => null);

    summary.push({
      screen: s.key,
      label: s.label,
      vp: vp.name,
      status: resp ? resp.status() : "error",
      path: s.path,
      file,
      ...(probe ?? {}),
    });
    process.stdout.write(`${s.key}@${vp.name} → ${resp ? resp.status() : "ERR"}\n`);
  }
  await ctx.close();
}

await browser.close();
writeFileSync(`${OUT}/summary.json`, JSON.stringify(summary, null, 2));
console.log(`\n${summary.length} captures dans ${OUT}`);
