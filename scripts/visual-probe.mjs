/**
 * Sonde de diagnostic de mise en page.
 *
 * Distingue deux choses qu'un simple `getBoundingClientRect` confond :
 *   1. la PAGE déborde horizontalement (vrai bug, scrollWidth > clientWidth)
 *   2. un élément dépasse à droite MAIS est dans un conteneur scrollable
 *      (comportement voulu pour un tableau ou une nav sur mobile)
 *
 * Mesure aussi la grille de KPI et la hauteur relative nav/contenu.
 */
import { chromium } from "playwright";

const BASE = process.env.APP_URL ?? "http://127.0.0.1:3108";

const pages = [
  { key: "admin-dashboard", path: "/admin" },
  { key: "admin-orders", path: "/admin/orders" },
  { key: "admin-stock", path: "/admin/stock" },
  { key: "catalogue", path: "/products" },
  { key: "checkout", path: "/checkout" },
];

const vps = [
  { name: "mobile-360", width: 360, height: 800 },
  { name: "tablet-768", width: 768, height: 1024 },
  { name: "desktop-1440", width: 1440, height: 900 },
];

const browser = await chromium.launch();

for (const vp of vps) {
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 1,
  });
  const page = await ctx.newPage();

  // login admin
  await page.goto(`${BASE}/admin/login`, { waitUntil: "domcontentloaded" });
  await page.fill('input[name="email"]', "admin@shop.local");
  await page.fill('input[name="password"]', "admin1234");
  await Promise.all([
    page.waitForURL(/\/admin(?!\/login)/, { timeout: 30000 }).catch(() => null),
    page.click('button[type="submit"]'),
  ]);

  for (const p of pages) {
    await page.goto(`${BASE}${p.path}`, { waitUntil: "networkidle", timeout: 30000 }).catch(() => null);
    await page.waitForTimeout(250);

    const r = await page.evaluate(() => {
      const de = document.documentElement;
      const pageOverflow = de.scrollWidth - de.clientWidth;

      // Élément qui dépasse ET qui n'est dans aucun ancêtre scrollable : vrai bug.
      const isInScroller = (el) => {
        let n = el.parentElement;
        while (n && n !== document.body) {
          const o = getComputedStyle(n).overflowX;
          if (o === "auto" || o === "scroll") return true;
          n = n.parentElement;
        }
        return false;
      };
      const realOverflow = [...document.querySelectorAll("*")]
        .filter((el) => el.getBoundingClientRect().right > de.clientWidth + 1 && !isInScroller(el))
        .slice(0, 6)
        .map((el) => `${el.tagName.toLowerCase()}.${(el.className || "").toString().slice(0, 30)}`);

      // Cellules tronquées (texte coupé)
      const truncated = [...document.querySelectorAll("td, th, .stat-card__value, h1")]
        .filter((el) => el.scrollWidth > el.clientWidth + 2)
        .slice(0, 6)
        .map((el) => `${el.tagName.toLowerCase()}:${(el.textContent || "").trim().slice(0, 22)}`);

      const grid = document.querySelector(".stat-grid, .admin-stats");
      const cols = grid ? getComputedStyle(grid).gridTemplateColumns.split(" ").length : null;
      const cards = document.querySelectorAll(".stat-card").length;

      const nav = document.querySelector(".admin-nav");
      const main = document.querySelector(".admin-main, main");
      const navH = nav ? Math.round(nav.getBoundingClientRect().height) : null;
      const mainH = main ? Math.round(main.getBoundingClientRect().height) : null;

      return {
        pageOverflow,
        realOverflow,
        truncated,
        statCols: cols,
        statCards: cards,
        navH,
        mainH,
        docH: de.scrollHeight,
      };
    });

    console.log(
      `${p.key}@${vp.name}  pageOverflow=${r.pageOverflow}px  statGrid=${r.statCols}col/${r.statCards}cards  navH=${r.navH} mainH=${r.mainH}`,
    );
    if (r.realOverflow.length) console.log(`   DÉBORDE (hors scroller): ${r.realOverflow.join(", ")}`);
    if (r.truncated.length) console.log(`   TRONQUÉ: ${r.truncated.join(" | ")}`);
  }
  await ctx.close();
}
await browser.close();
