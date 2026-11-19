// Missing steps (business dogfood A8, 2026-10-16): the model proposed no
// node for two numbered steps of the review list, and a step with no node
// can be ordered by nothing. After a document's intake the engine names the
// numbered steps no node sits under (`fold/missing-steps`) on one pinned
// card; one tap reads just those sections again, with the list as the step
// context, so the new node pairs with the steps before and after it. A
// system quoted under a step heading is not that step.
// Usage: serve public/ on :8291; node test/steps-check.js
const puppeteer = require('puppeteer-core');
const G = require('./lib/graphs');
const fs = require('fs');
const os = require('os');
const path = require('path');
const BASE = process.argv[2] || 'http://localhost:8291';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (ok, name) => { console.log((ok ? 'PASS' : 'FAIL') + ' ' + name); if (!ok) failures++; };

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'steps-'));
const DOC = path.join(dir, 'review.md');
fs.writeFileSync(DOC, [
  '## Purchasing', 'Every purchase goes through the review steps below.',
  '### Review Steps', 'A request passes these reviews in order.',
  '#### 1. Sanctions Screening', 'Risk Rate screens the vendor name.',
  '#### 2.A. Buyer Review', 'The buyer checks the documents.',
  '#### 2.B. New Supplier Onboarding', 'Coupa asks the supplier for banking data.',
  '#### 3. FP&A Review', 'FP&A checks the budget.',
  '### Urgent requests', 'Ask in the procurement channel.', ''].join('\n'));
const ONTO = path.join(__dirname, '..', 'kg', 'ontologies', 'business.edn');

(async () => {
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_BIN || '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('PAGE ERROR', e.message));
  page.on('dialog', (d) => d.accept(d.type() === 'prompt' ? 'Purchasing' : undefined));
  await page.setViewport({ width: 1280, height: 900 });
  await page.evaluateOnNewDocument(() => {
    const orig = window.fetch.bind(window);
    window.__topics = []; window.__pairs = [];
    const node = (id, type, title, evidence) => ({ id, type, title, definition: title + '.', evidence });
    window.fetch = (url, opts) => {
      if (!String(url).includes('api.anthropic.com')) return orig(url, opts);
      const body = JSON.parse(opts.body);
      const user = body.messages[0].content;
      let reply;
      if (body.system.includes('Пары тем')) {
        window.__pairs.push(body.system);
        reply = { edges: [] };
      } else if (/у которых в базе нет своего узла-шага/.test(user)) {
        window.__topics.push(user);
        reply = { concepts: [node('supplier-onboarding', 'process', 'New supplier onboarding', 'Coupa asks the supplier for banking data.')] };
      } else {
        window.__topics.push(user);
        // step 2.B gets no process node: only the system quoted under it
        reply = { concepts: [
          node('sanctions-screening', 'process', 'Sanctions screening', 'Risk Rate screens the vendor name.'),
          node('buyer-review', 'process', 'Buyer review', 'The buyer checks the documents.'),
          node('coupa', 'system', 'Coupa', 'Coupa asks the supplier for banking data.'),
          node('fpa-review', 'process', 'FP&A review', 'FP&A checks the budget.')] };
      }
      return Promise.resolve(new Response(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(reply) }] }), { status: 200 }));
    };
  });
  const text = (sel) => page.$eval(sel, (e) => e.textContent).catch(() => '');
  await page.goto(BASE, { waitUntil: 'networkidle0' });
  await page.evaluate(() => {
    localStorage.clear(); localStorage.setItem('loretile-locale', 'ru');
    for (const k of ['loretile-tour-done', 'loretile-chat-tour-done', 'loretile-learn-tour-done']) localStorage.setItem(k, '1');
    localStorage.setItem('loretile-llm-config', '{:preset :anthropic :shape :anthropic :url "https://api.anthropic.com/v1/messages" :model "test" :key "sk-test"}');
  });
  await page.reload({ waitUntil: 'networkidle0' }); await sleep(400);
  if (await G.graphFromOntologyFile(page, ONTO, 'Purchasing') === null) { console.log('SKIP: release build — the ontology-file door is internal until slice 3 (wiki/Ontology-Graph.md)'); await browser.close(); process.exit(0); }
  await sleep(1000);
  await page.goto(BASE + '#/chat', { waitUntil: 'networkidle0' }); await sleep(400);

  await (await page.$('.composer input[type=file]')).uploadFile(DOC); await sleep(700);
  await page.click('.composer .chat-sendbtn');
  for (let i = 0; i < 60 && (await page.$('.intake-progress') || !(await page.evaluate(() => window.__topics.length))); i++) await sleep(200);
  await sleep(400);

  const card = await text('.card-missing-steps');
  check(/Review Steps/.test(card) && /2\.B\. New Supplier Onboarding/.test(card), 'one card names the step with no node: ' + card.slice(0, 120));
  check(!/Sanctions|Buyer Review|FP&A/.test(await text('.card-missing-steps ul')), 'the steps that have a node are not listed');
  check(!/Purchasing|Urgent/.test(card), 'only numbered lists are reported');

  await page.click('.missing-steps-read');
  for (let i = 0; i < 60 && (await page.evaluate(() => window.__topics.length)) < 2; i++) await sleep(200);
  for (let i = 0; i < 60 && await page.$('.intake-progress'); i++) await sleep(200);
  await sleep(400);
  const reread = await page.evaluate(() => window.__topics[1] || '');
  check(/2\.B\. New Supplier Onboarding/.test(reread) && !/Sanctions Screening|FP&A checks/.test(reread),
    'the re-read sends only the missing step\'s section');
  check(/Дай КАЖДОМУ шагу отдельный узел типа process/.test(reread),
    'and asks for a node of the type that can be a step, even beside a similar one');
  check(await page.$('.card-missing-steps') === null, 'the card is gone once read');
  const pairs = await page.evaluate(() => window.__pairs[window.__pairs.length - 1] || '');
  check(/supplier-onboarding/.test(pairs) && /sanctions-screening/.test(pairs) && /fpa-review/.test(pairs),
    'the new step is paired with the steps before and after it');
  check(/шаг 1 того же нумерованного списка, этот — шаг 2/.test(pairs) || /шаг 2 того же нумерованного списка, этот — шаг 3/.test(pairs),
    'and the pair carries the step-order hint');
  check(/Шаги прочитаны, предложено узлов: 1/.test(await text('.chat .msgs')), 'the chat reports the re-read');

  await browser.close();
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(failures ? 'STEPS CHECK FAILED' : 'STEPS CHECK OK');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('CHECK CRASHED', e); process.exit(1); });
