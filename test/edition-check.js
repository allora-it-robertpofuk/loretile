// The enterprise build (Denis 2026-10-20: «release loretile without demo
// graphs»): `make dist-enterprise` writes <meta name="loretile-demos"
// content="off"> into index.html and ships no demo/ directory. With the meta
// the app renders NO demo control — not on the empty map, not in the drawer —
// and never asks for a demo file; without it, everything is as before.
// Usage: serve public/ on :8291; node test/edition-check.js
const puppeteer = require('puppeteer-core');
const BASE = process.argv[2] || 'http://localhost:8291';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (ok, name) => { console.log((ok ? 'PASS' : 'FAIL') + ' ' + name); if (!ok) failures++; };

(async () => {
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_BIN || '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
  const open = async (noDemos) => {
    const page = await browser.newPage();
    page.on('pageerror', (e) => console.log('PAGE ERROR', e.message));
    await page.setViewport({ width: 1280, height: 900 });
    const demoRequests = [];
    await page.setRequestInterception(true);
    page.on('request', async (req) => {
      if (/\/demo\//.test(req.url())) demoRequests.push(req.url());
      // the enterprise index.html, as `make dist-enterprise` writes it
      if (noDemos && req.resourceType() === 'document') {
        const r = await fetch(req.url());
        const html = (await r.text()).replace('<meta charset="utf-8">', '<meta charset="utf-8">\n<meta name="loretile-demos" content="off">');
        return req.respond({ status: 200, contentType: 'text/html', body: html });
      }
      req.continue();
    });
    await page.goto(BASE, { waitUntil: 'networkidle0' });
    await page.evaluate(() => {
      localStorage.clear(); localStorage.setItem('loretile-locale', 'ru');
      for (const k of ['loretile-tour-done', 'loretile-chat-tour-done', 'loretile-learn-tour-done']) localStorage.setItem(k, '1');
    });
    await page.reload({ waitUntil: 'networkidle0' }); await sleep(500);
    return { page, demoRequests };
  };
  const look = async (page) => {
    const map = await page.evaluate(() => ({ empty: !!document.querySelector('.empty'),
      demos: document.querySelectorAll('.demo-row, .demo-pick, .empty-or').length,
      add: !!document.querySelector('.empty button.primary') }));
    await page.click('.burger'); await sleep(400);
    const drawer = await page.evaluate(() => ({ demos: !!document.querySelector('.drawer .nav-demos'),
      import: !!document.querySelector('.drawer input[type=file][accept=".edn"]') }));
    return { map, drawer };
  };

  const plain = await open(false);
  const a = await look(plain.page);
  check(a.map.demos >= 3 && a.drawer.demos, 'the standard build offers the demo graphs (map and drawer)');

  const ent = await open(true);
  const b = await look(ent.page);
  check(b.map.empty && b.map.add, 'the enterprise build: the empty map renders, «add a topic» and the assistant stay');
  check(b.map.demos === 0, 'no demo control on the empty map (' + b.map.demos + ')');
  check(!b.drawer.demos && b.drawer.import, 'no demo entry in the drawer; import stays');
  check(ent.demoRequests.length === 0, 'no demo file is ever requested (' + ent.demoRequests.length + ')');

  await browser.close();
  console.log(failures ? 'EDITION CHECK FAILED' : 'EDITION CHECK OK');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('CHECK CRASHED', e); process.exit(1); });
