// Pre-deploy smoke gate: boot the RELEASE bundle headlessly, assert the
// editor renders and nothing errored. Exits non-zero on failure.
// `--no-demos` (the enterprise zip, `make smoke-enterprise`): also assert no
// demo control is rendered — on the empty map or in the drawer — and no demo
// file is ever requested.
// Usage: node test/smoke.js [baseUrl] [--no-demos]   (default http://localhost:8292)

const puppeteer = require('puppeteer-core');

const BASE = process.argv.slice(2).find((a) => !a.startsWith('--')) || 'http://localhost:8292';
const NO_DEMOS = process.argv.includes('--no-demos');
const CHROME = process.env.CHROME_BIN || '/usr/bin/google-chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu', '--lang=ru'],
  });
  const page = await browser.newPage();
  // headless may not fire rAF; reagent batches renders on it
  await page.evaluateOnNewDocument(() => {
    window.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 16);
    window.cancelAnimationFrame = (h) => clearTimeout(h);
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  const demoRequests = [];
  page.on('request', (r) => { if (/\/demo\//.test(r.url())) demoRequests.push(r.url()); });

  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 30000 });
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem('loretile-locale', 'ru'); localStorage.setItem('loretile-tour-done','1'); localStorage.setItem('loretile-chat-tour-done','1'); localStorage.setItem('loretile-learn-tour-done','1'); });
  await page.reload({ waitUntil: 'networkidle2' });

  let ok = false;
  const t0 = Date.now();
  while (Date.now() - t0 < 15000) {
    ok = await page.evaluate(() => !!document.querySelector('header h1')).catch(() => false);
    if (ok) break;
    await sleep(300);
  }
  if (ok && NO_DEMOS) {
    await sleep(500);
    const onMap = await page.evaluate(() => ({ empty: !!document.querySelector('.empty'), demos: document.querySelectorAll('.demo-row, .demo-pick, .empty-or').length }));
    await page.click('.burger').catch(() => {}); await sleep(400);
    const inDrawer = await page.evaluate(() => !!document.querySelector('.drawer') && !document.querySelector('.drawer .nav-demos'));
    if (!onMap.empty) errors.push('no-demos: the empty map did not render');
    if (onMap.demos) errors.push('no-demos: the empty map offers demo graphs (' + onMap.demos + ' controls)');
    if (!inDrawer) errors.push('no-demos: the drawer offers demo graphs (or did not open)');
    if (demoRequests.length) errors.push('no-demos: demo files requested: ' + demoRequests.join(', '));
  }
  await browser.close();

  if (!ok) { console.error('SMOKE FAILED: header never rendered'); process.exit(1); }
  if (errors.length) { console.error('SMOKE FAILED:\n' + errors.join('\n')); process.exit(1); }
  console.log(NO_DEMOS ? 'smoke OK (no demos)' : 'smoke OK');
})().catch((e) => { console.error('SMOKE FAILED: ' + e.message); process.exit(1); });
