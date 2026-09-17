import { chromium } from 'playwright';

const screens = [
  { name: 'home', path: '/' },
  { name: 'catalogue', path: '/products' },
  { name: 'product-detail', path: '/products/t-shirt-basique-blanc' },
  { name: 'admin-login', path: '/admin/login' },
];

const viewports = [
  { name: 'mobile-360', width: 360, height: 800 },
  { name: 'tablet-768', width: 768, height: 1024 },
  { name: 'desktop-1440', width: 1440, height: 900 },
];

const browser = await chromium.launch();
const summary = [];

for (const vp of viewports) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
  const page = await ctx.newPage();
  for (const s of screens) {
    const url = `http://127.0.0.1:3000${s.path}`;
    const r = await page.goto(url, { waitUntil: 'networkidle', timeout: 15000 }).catch(e => null);
    await page.waitForTimeout(400);
    const file = `/tmp/s1-captures/${s.name}-${vp.name}.png`;
    await page.screenshot({ path: file, fullPage: true });
    const status = r ? r.status() : 'error';
    const dim = await page.evaluate(() => ({
      scrollW: document.documentElement.scrollWidth,
      scrollH: document.documentElement.scrollHeight,
      cliW: document.documentElement.clientWidth,
      placeholders: [...document.querySelectorAll('*')].filter(el => /TODO|placeholder|lorem|dummy|example/i.test(el.textContent ?? '')).length,
    })).catch(() => null);
    summary.push({ screen: s.name, vp: vp.name, status, dim, file });
  }
  await ctx.close();
}
await browser.close();
console.log(JSON.stringify(summary, null, 2));
