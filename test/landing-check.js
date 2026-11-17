// The landing is filled ENTIRELY by its inline script, so one runtime
// error ships a BLANK page (kintale, 2026-07-28). Load it in a browser,
// assert it filled itself in, the burger opens its drawer, and the
// language/theme switches work. Screenshots at 1280 and 390 land in
// test/ for the review-new-UI rule.
const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const ROOT = path.join(__dirname, '..', 'landing');
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  const file = url === '/app/icon.svg' ? path.join(__dirname, '..', 'public', 'icon.svg')
             : path.join(ROOT, url === '/' ? '/index.html' : url);
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': file.endsWith('.svg') ? 'image/svg+xml' : 'text/html' });
    res.end(data);
  });
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (ok, msg) => { console.log(ok ? '  ok  ' : '  FAIL', msg); if (!ok) fail = 1; };

server.listen(8432, async () => {
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_BIN || '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
  await page.goto('http://localhost:8432/', { waitUntil: 'networkidle0' });
  await sleep(500);

  check(errors.length === 0, `no runtime errors${errors.length ? ': ' + errors[0] : ''}`);
  const empties = await page.evaluate(() =>
    [...document.querySelectorAll('[data-i]')].filter((e) => !e.textContent.trim()).map((e) => e.dataset.i));
  check(empties.length === 0, `every translated node has text${empties.length ? ' — empty: ' + empties.join(', ') : ''}`);
  check(await page.evaluate(() => document.body.innerText.length > 600), 'the page has actual content');
  check(await page.evaluate(() => !!document.querySelector('.cta a[href="/app/"]')), 'the hero links to the app');
  check(await page.evaluate(() => (document.getElementById('ver').textContent || '').length > 2), 'shows which build it is');
  await page.screenshot({ path: 'test/shot-landing.png' });

  // burger → drawer → theme + language
  await page.click('#burger');
  await sleep(300);
  check(await page.evaluate(() => !document.getElementById('drawer').hidden), 'burger opens the drawer');
  await page.screenshot({ path: 'test/shot-landing-menu.png' });
  await page.click('[data-theme="dark"]');
  await sleep(100);
  check(await page.evaluate(() => document.documentElement.dataset.theme === 'dark'
    && localStorage.getItem('loretile-theme') === 'dark'), 'dark theme applies and persists');
  await page.click('[data-loc="de"]');
  await sleep(300);
  check(await page.evaluate(() => /Lücken|Wissensgraph/i.test(document.body.innerText)), 'switching to German translates it');
  await page.screenshot({ path: 'test/shot-landing-dark.png' });
  await page.keyboard.press('Escape');
  await sleep(200);
  check(await page.evaluate(() => document.getElementById('drawer').hidden), 'Escape closes the drawer');

  await page.setViewport({ width: 390, height: 844 });
  await sleep(300);
  check(await page.evaluate(() => document.documentElement.scrollWidth <= 390), 'no horizontal overflow on a phone');
  await page.screenshot({ path: 'test/shot-landing-mobile.png' });
  await page.click('#burger');
  await sleep(300);
  await page.screenshot({ path: 'test/shot-landing-mobile-menu.png' });

  await browser.close();
  server.close();
  console.log(fail ? 'LANDING CHECK FAILED' : 'LANDING CHECK PASSED');
  process.exit(fail);
});
