// One assistant across the app (wiki/Assistant-Design, decided 2026-10-02):
// on the catalog it runs in LEARNER mode — searches courses across every graph
// on the device and offers to start one; the author's chat knows which topic
// was in view; each mode wears a badge. The model is a scripted mock.
// Usage: make engines; serve public/ on :8291; node test/guide-check.js
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
  page.on('dialog', (d) => d.accept());
  await page.setViewport({ width: 1280, height: 900 });
  await page.evaluateOnNewDocument(() => {
    const orig = window.fetch.bind(window);
    window.__calls = []; window.__q = { guide: [], intake: [] };
    window.fetch = (url, opts) => {
      if (String(url).includes('api.anthropic.com')) {
        const body = JSON.parse(opts.body);
        window.__calls.push({ system: body.system, user: body.messages[0].content });
        const q = /помощник ученика/.test(body.system) ? window.__q.guide
          : /учебные концепты/.test(body.system) ? window.__q.intake : null;
        const reply = q ? (q.length > 1 ? q.shift() : q[0]) : { edges: [] };
        return Promise.resolve(new Response(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(reply) }] }), { status: 200 }));
      }
      return orig(url, opts);
    };
  });
  const text = (sel) => page.$eval(sel, (e) => e.textContent).catch(() => '');
  const calls = (re) => page.evaluate((src) => window.__calls.filter((c) => new RegExp(src).test(c.system)), re);

  await page.goto(BASE, { waitUntil: 'networkidle0' });
  await page.evaluate(() => {
    localStorage.clear(); localStorage.setItem('loretile-locale', 'ru');
    for (const k of ['loretile-tour-done', 'loretile-chat-tour-done', 'loretile-learn-tour-done']) localStorage.setItem(k, '1');
    localStorage.setItem('loretile-llm-config', '{:preset :anthropic :shape :anthropic :url "https://api.anthropic.com/v1/messages" :model "test" :key "sk-test"}');
  });
  await page.reload({ waitUntil: 'networkidle0' }); await sleep(400);
  // two graphs: vineyard, then SQL (left open) — the catalog must span both
  await page.evaluate(() => [...document.querySelectorAll('button.demo-row')].find((b) => /виноград/i.test(b.textContent)).click());
  await sleep(1800);
  await page.click('.burger'); await sleep(300);
  await page.evaluate(() => [...document.querySelectorAll('.drawer nav a')].find((a) => /Демо-графы/.test(a.textContent)).click());
  await sleep(300);
  await page.evaluate(() => [...document.querySelectorAll('.modal .demo-row')].find((b) => b.textContent.includes('SQL')).click());
  await sleep(2000);

  // --- learner mode on the catalog -------------------------------------------
  await page.goto(BASE + '#/courses', { waitUntil: 'networkidle0' }); await sleep(600);
  check(await page.$('.guide') !== null && /режим ученика/.test(await text('.guide .mode-badge')), 'the catalog has the assistant, in learner mode');
  await page.evaluate(() => { window.__q.guide = [
    { tools: [{ name: 'search-catalog', args: { query: 'виноград сезон' } }] },
    { note: 'Есть курс «Сезон на винограднике» — с него и начните.', actions: [{ name: 'start-course', args: { course: 'vineyard-season' } }] }]; window.__calls = []; });
  await page.type('.guide .composer textarea', 'хочу научиться ухаживать за виноградником');
  await page.keyboard.press('Enter'); await sleep(1500);
  const g = await calls('помощник ученика');
  check(g.length === 2, 'it searches once, then answers (' + g.length + ' calls)');
  check(/- search-catalog/.test(g[0].system) && /- start-course/.test(g[0].system)
    && !/- search-nodes|- open-node|- learner-gaps|- go-to-node|- draft-exercises/.test(g[0].system),
    'learner mode offers catalog search and «start a course» — not the author\'s tools');
  check(/vineyard-season — Сезон на винограднике \[graph «[^»]+», ru\]: \d+ topics, already proven \d+/.test(g[1].user),
    'the search spans graphs: it finds the vineyard course while the SQL graph is open');
  check(/Сезон на винограднике» — с него и начните/.test(await text('.guide .msgs')), 'the answer arrives in the catalog');
  check(/Открыть курс «Сезон на винограднике»/.test(await text('.guide .card-action')), 'and «start the course» waits as a one-tap card');
  check(/#\/courses/.test(page.url()), 'nothing started on its own');
  await page.click('.guide .card-action .action-do'); await sleep(700);
  check(/#\/learn\/vineyard-season/.test(page.url()) && await page.$('.learn .start') !== null,
    'one tap: the course opens, though it lives in another graph');

  // a tool the learner mode was not given is refused
  await page.goto(BASE + '#/courses', { waitUntil: 'networkidle0' }); await sleep(400);
  await page.evaluate(() => { window.__q.guide = [{ tools: [{ name: 'open-node', args: { id: 'group-by' } }] }, { note: 'ок' }]; window.__calls = []; });
  await page.type('.guide .composer textarea', 'открой GROUP BY');
  await page.keyboard.press('Enter'); await sleep(1200);
  const g2 = await calls('помощник ученика');
  check(/open-node is not available here/.test(g2[1].user), 'an author tool asked for in learner mode is refused');

  // --- author mode: the chat knows which topic was in view --------------------
  await page.goto(BASE + '#/c/group-by', { waitUntil: 'networkidle0' }); await sleep(600);
  await page.goto(BASE + '#/chat', { waitUntil: 'networkidle0' }); await sleep(400);
  check(/режим автора/.test(await text('.chat .mode-badge')), 'the author\'s chat wears its own badge');
  await page.evaluate(() => { window.__q.intake = [{ concepts: [], note: 'Про эту тему: всё на месте.' }]; window.__calls = []; });
  await page.type('.chat .composer textarea', 'что тут не хватает?');
  await page.keyboard.press('Enter'); await sleep(1200);
  const a = await calls('учебные концепты');
  check(a.length && /Сейчас перед пользователем тема group-by/.test(a[0].system), 'it is told the topic last in view, so «this topic» needs no repeating');

  await browser.close();
  console.log(failures ? 'GUIDE CHECK FAILED' : 'GUIDE CHECK OK');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('CHECK CRASHED', e); process.exit(1); });
