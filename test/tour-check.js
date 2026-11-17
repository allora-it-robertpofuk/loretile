// Tours (kintale driver.js port): the map tour fires once on the first
// non-empty map, the seen-flag suppresses it, the drawer replays it, and
// the learn tour fires on the first learning session.
// Usage: serve public/ first, then: node test/tour-check.js [baseUrl]
const puppeteer = require('puppeteer-core');
const BASE = process.argv[2] || 'http://localhost:8291';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (ok, name) => { console.log((ok ? 'PASS' : 'FAIL') + ' ' + name); if (!ok) failures++; };

(async () => {
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_BIN || '/usr/bin/google-chrome',
    headless: 'new', args: ['--no-sandbox', '--disable-gpu'],
  });
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('PAGE ERROR', e.message));
  await page.setViewport({ width: 1280, height: 800 });
  await page.goto(BASE, { waitUntil: 'networkidle0' });
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem('loretile-locale', 'ru'); });
  await page.reload({ waitUntil: 'networkidle0' });
  await sleep(400);
  check(await page.$('.driver-popover') === null, 'no tour on an empty map');
  await page.click('.load-demo');
  await sleep(2200 + 1600); // demo + the 1.5s auto-trigger
  check(await page.$('.driver-popover') !== null, 'map tour fires on the first non-empty map');
  check(/тема|пререквизит/i.test(await page.$eval('.driver-popover', (e) => e.textContent)), 'first step explains the map');
  await page.click('.driver-popover-next-btn');
  await sleep(300);
  check(/готова к публикации|Пунктирное/i.test(await page.$eval('.driver-popover', (e) => e.textContent)), 'second step is the legend');
  await page.screenshot({ path: 'test/shot-tour.png' });
  await page.keyboard.press('Escape');
  await sleep(300);
  check(await page.$('.driver-popover') === null, 'Escape closes the tour');

  await page.reload({ waitUntil: 'networkidle0' });
  await sleep(2200);
  check(await page.$('.driver-popover') === null, 'seen-flag suppresses the auto tour');

  // drawer replay
  await page.click('.burger');
  await sleep(300);
  await page.evaluate(() => [...document.querySelectorAll('.drawer nav a')].find((a) => /Показать тур/.test(a.textContent)).click());
  await sleep(600);
  check(await page.$('.driver-popover') !== null, 'drawer replays the tour on demand');
  await page.keyboard.press('Escape');
  await sleep(300);

  // learn tour on the first session
  await page.goto(BASE + '#/learn/sql-analyst', { waitUntil: 'networkidle0' });
  await sleep(300);
  await page.click('.learn .start');
  await sleep(1400);
  check(await page.$('.driver-popover') !== null, 'learn tour fires on the first learning session');
  check(/лент/i.test(await page.$eval('.driver-popover', (e) => e.textContent)), 'its first step explains the feed');
  await page.keyboard.press('Escape');

  await browser.close();
  console.log(failures ? 'TOUR CHECK FAILED' : 'TOUR CHECK OK');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('CHECK CRASHED', e); process.exit(1); });
