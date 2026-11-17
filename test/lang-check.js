// Language coverage sweep: for de and en, walk every screen with the demo
// loaded and assert ZERO Cyrillic anywhere in the rendered DOM (UI strings
// AND demo content are translated); for ru, assert no raw English enum
// tokens (levels, object/item kinds) leak into the UI.
// Usage: serve public/ first, then: node test/lang-check.js [baseUrl]
const puppeteer = require('puppeteer-core');
const BASE = process.argv[2] || 'http://localhost:8291';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (ok, name) => { console.log((ok ? 'PASS' : 'FAIL') + ' ' + name); if (!ok) failures++; };

const CYR = /[А-Яа-яЁё]/;
const ENUMS = /\b(worked-example|single-choice|multi-choice|explain-back|apprentice|novice|professional)\b/;

(async () => {
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_BIN || '/usr/bin/google-chrome',
    headless: 'new', args: ['--no-sandbox', '--disable-gpu'],
  });
  const page = await browser.newPage();
  page.on('dialog', (d) => d.accept());
  await page.setViewport({ width: 1280, height: 900 });

  const body = () => page.evaluate(() => document.body.innerText);
  const offend = (re, text) => {
    const lines = text.split('\n').filter((l) => re.test(l));
    return lines.slice(0, 3).join(' | ').slice(0, 160);
  };

  for (const loc of ['de', 'en', 'ru']) {
    const re = loc === 'ru' ? ENUMS : CYR;
    const what = loc === 'ru' ? 'no raw enum tokens' : 'no Cyrillic';
    await page.goto(BASE, { waitUntil: 'networkidle0' });
    await page.evaluate((l) => {
      localStorage.clear();
      localStorage.setItem('loretile-locale', l);
      localStorage.setItem('loretile-tour-done', '1');
      localStorage.setItem('loretile-chat-tour-done', '1');
      localStorage.setItem('loretile-learn-tour-done', '1');
    }, loc);
    await page.reload({ waitUntil: 'networkidle0' });
    await sleep(300);
    await page.click('.load-demo');
    await sleep(2500);

    const screens = [
      ['map', async () => {}],
      ['drawer', async () => { await page.click('.burger'); await sleep(300); }],
      ['concept popup', async () => {
        await page.keyboard.press('Escape'); await sleep(200);
        await page.goto(BASE + '#/c/group-by', { waitUntil: 'networkidle0' }); await sleep(900);
      }],
      ['edit forms', async () => {
        await page.click('.def-row .pt-edit'); await sleep(200);
        await page.evaluate(() => [...document.querySelectorAll('.form.edit select option')]
          .forEach((o) => { o.selected = true; })); // render all option labels into innerText? options are in DOM anyway
      }],
      ['course panel', async () => {
        await page.goto(BASE + '#/course/sql-analyst', { waitUntil: 'networkidle0' }); await sleep(900);
      }],
      ['learn: intro+diagnostic', async () => {
        await page.goto(BASE + '#/learn/sql-analyst', { waitUntil: 'networkidle0' }); await sleep(400);
        await page.click('.learn .start'); await sleep(500);
      }],
      ['learn: plan + scratchpad', async () => {
        // finish the diagnostic with any answers, then try the scratchpad on the plan
        for (let n = 0; n < 25 && await page.$('.qcard:not(.done)'); n++) {
          if (await page.$('.qcard:not(.done) .opt')) await page.click('.qcard:not(.done) .opt');
          else { await page.type('.qcard:not(.done) input', 'x'); await page.click('.qcard:not(.done) button.primary'); }
          await sleep(120);
        }
        if (await page.$('.scratch-toggle')) await page.click('.scratch-toggle');
        await sleep(200);
        await page.type('.scratch textarea.ex-code', 'SELECT 1 WHERE false');
        await page.click('.scratch .ex-run');
        for (let i = 0; i < 300 && !(await page.$('.scratch .ex-out')); i++) await sleep(100);
        check(await page.$('.scratch .ex-out') !== null, `[${loc}] the scratchpad rendered a result to sweep`);
      }],
      ['exercise authoring + gate message', async () => {
        await page.goto(BASE + '#/c/group-by', { waitUntil: 'networkidle0' }); await sleep(900);
        const adds = await page.$$('.addbtn');
        await adds[adds.length - 1].click(); await sleep(200);
        await page.select('.form select', 'exercise'); await sleep(200);
        await page.select('.form select.ex-check', 'assert'); await sleep(200);
        await page.type('.form input', 'x');
        await page.type('.form textarea.ex-solution', 'x = 1');
        await page.type('.form textarea.ex-test', 'assert True');
        await page.click('.form button.primary');
        for (let i = 0; i < 300 && !(await page.$('.form .ex-out')); i++) await sleep(100);
        check(await page.$('.form .ex-out') !== null, `[${loc}] the gate rendered its message to sweep`);
      }],
      ['chat', async () => {
        await page.goto(BASE + '#/chat', { waitUntil: 'networkidle0' }); await sleep(400);
      }],
      ['settings', async () => {
        await page.goto(BASE + '#/settings', { waitUntil: 'networkidle0' }); await sleep(400);
      }],
      ['palette', async () => {
        await page.goto(BASE + '#/', { waitUntil: 'networkidle0' }); await sleep(600);
        await page.keyboard.down('Control'); await page.keyboard.press('k'); await page.keyboard.up('Control');
        await sleep(300);
      }],
    ];
    for (const [name, go] of screens) {
      await go();
      const text = await body();
      const bad = offend(re, text);
      check(!bad, `[${loc}] ${name}: ${what}${bad ? ' — ' + bad : ''}`);
    }
    await page.keyboard.press('Escape');
  }

  await browser.close();
  console.log(failures ? 'LANG CHECK FAILED' : 'LANG CHECK OK');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('CHECK CRASHED', e); process.exit(1); });
