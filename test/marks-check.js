// Reader marks (==essence==, ++example++) — a learner option, on by default:
// rendered as highlights with a legend, hidden by the learner's toggle (kept
// on the device), stripped from what the tutor model sees, always visible to
// the author. Usage: make engines; serve public/ on :8291; node test/marks-check.js
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const BASE = process.argv[2] || 'http://localhost:8291';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (ok, name) => { console.log((ok ? 'PASS' : 'FAIL') + ' ' + name); if (!ok) failures++; };

const KEY = {};
for (const line of fs.readFileSync(__dirname + '/../kg/demo/vineyard.ru.edn', 'utf8').split('\n')) {
  const sc = line.match(/:stem "([^"]+)" :options \[((?:"[^"]*" ?)+)\] :key (\d+)/);
  if (sc) { const opts = [...sc[2].matchAll(/"([^"]*)"/g)].map((m) => m[1]); KEY[sc[1]] = opts[+sc[3]]; continue; }
  const cz = line.match(/:text "([^"]+)" :key "([^"]+)"/);
  if (cz) KEY[cz[1]] = cz[2];
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_BIN || '/usr/bin/google-chrome',
    headless: 'new', args: ['--no-sandbox', '--disable-gpu'],
  });
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('PAGE ERROR', e.message));
  page.on('dialog', (d) => d.accept());
  await page.setViewport({ width: 1280, height: 900 });
  await page.evaluateOnNewDocument(() => {
    const orig = window.fetch.bind(window);
    window.__calls = [];
    window.fetch = (url, opts) => {
      if (String(url).includes('api.anthropic.com')) {
        window.__calls.push(JSON.parse(opts.body));
        return Promise.resolve(new Response(JSON.stringify({ content: [{ type: 'text', text: 'Ответ.' }] }), { status: 200 }));
      }
      return orig(url, opts);
    };
  });
  const LIVE = '.qcard:not(.done)';
  const text = (sel) => page.$eval(sel, (e) => e.textContent).catch(() => '');
  const stage = () => page.$eval('.learn', (e) => e.dataset.stage).catch(() => '');
  const answer = async (right) => {
    const stem = await text(LIVE + ' .stem'); const key = KEY[stem];
    if (await page.$(LIVE + ' .exercise, ' + LIVE + '.exercise')) return;
    if (await page.$(LIVE + ' .options')) {
      const opts = await page.$$eval(LIVE + ' .opt', (els) => els.map((e) => e.textContent));
      const i = right ? opts.indexOf(key) : opts.findIndex((o) => o !== key);
      await page.evaluate((i, sel) => document.querySelectorAll(sel + ' .opt')[i].click(), i, LIVE);
    } else { await page.type(LIVE + ' input', right ? key : 'нет'); await page.click(LIVE + ' button.primary'); }
    await sleep(200);
  };

  await page.goto(BASE, { waitUntil: 'networkidle0' });
  await page.evaluate(() => {
    localStorage.clear(); localStorage.setItem('loretile-locale', 'ru');
    for (const k of ['loretile-tour-done', 'loretile-chat-tour-done', 'loretile-learn-tour-done']) localStorage.setItem(k, '1');
    localStorage.setItem('loretile-llm-config', '{:preset :anthropic :shape :anthropic :url "https://api.anthropic.com/v1/messages" :model "test" :key "sk-test"}');
  });
  await page.reload({ waitUntil: 'networkidle0' }); await sleep(400);
  await page.evaluate(() => [...document.querySelectorAll('button.demo-row')].find((b) => /виноград/i.test(b.textContent)).click());
  await sleep(1500);
  await page.goto(BASE + '#/learn/vineyard-season', { waitUntil: 'networkidle0' }); await sleep(500);
  await page.click('.learn .start'); await sleep(300);
  let n = 0;
  while ((await stage()) === 'diagnostic' && n++ < 25) await answer(!/Зрелость/.test(await text(LIVE + ' .qtopic')));
  const btns = await page.$$('.plan-card button.primary'); await btns[btns.length - 1].click(); await sleep(400);

  const card = '.topic-card';
  check(/Зрелость/.test(await text(card + ' h2')), 'learning ripeness: its material is marked in the demo');
  check(/Цифры решают, физиология подтверждает/.test(await text(card + ' mark.mk-essence')), 'the essence is highlighted');
  const examples = await page.$$eval(card + ' mark.mk-example', (els) => els.map((e) => e.textContent));
  check(examples.some((x) => /коричневые косточки/.test(x)), 'the example is highlighted, in its own colour');
  check(await page.$(card + ' .marks-legend') !== null, 'a legend says what the colours mean');
  check(!/==|\+\+/.test(await text(card)), 'no raw markers ever reach the reader');

  // the learner's option
  await page.click('.learn-head .marks-toggle'); await sleep(200);
  check(await page.$(card + ' mark') === null && /Цифры решают/.test(await text(card)) && !/==/.test(await text(card)),
    'the toggle hides the marks; the words stay, the markers do not');
  check(await page.$(card + ' .marks-legend') === null, 'and the legend goes with them');
  await page.reload({ waitUntil: 'networkidle0' }); await sleep(500);
  check(await page.$(card + ' mark') === null, 'the choice is remembered on this device');

  // the tutor model never sees the markers
  await page.type('.learn .composer textarea', 'что важнее, цифры или вкус?');
  await page.keyboard.press('Enter'); await sleep(500);
  const sys = await page.evaluate(() => window.__calls[window.__calls.length - 1].system);
  check(/Цифры решают, физиология подтверждает/.test(sys) && !/==|\+\+/.test(sys), 'the tutor prompt carries the words without the marks');

  await page.click('.learn-head .marks-toggle'); await sleep(200);
  check(await page.$(card + ' mark.mk-essence') !== null, 'and the learner can turn them back on');

  // the author always sees them, whatever the learner chose
  await page.click('.learn-head .marks-toggle'); await sleep(200);   // learner: off
  await page.goto(BASE + '#/c/ripeness', { waitUntil: 'networkidle0' }); await sleep(700);
  check(await page.$('.lo mark.mk-essence') !== null, 'the author panel shows the marks even with the learner option off');
  await page.evaluate(() => [...document.querySelectorAll('.lo')].find((e) => /Цифры решают/.test(e.textContent)).querySelector('.pt-edit').click());
  await sleep(300);
  check(/==Цифры решают/.test(await page.$eval('.lo .form.edit textarea', (e) => e.value)) && /==суть==/.test(await text('.lo .form.edit .marks-hint')),
    'editing shows the raw marks and how to write them');

  await browser.close();
  console.log(failures ? 'MARKS CHECK FAILED' : 'MARKS CHECK OK');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('CHECK CRASHED', e); process.exit(1); });
