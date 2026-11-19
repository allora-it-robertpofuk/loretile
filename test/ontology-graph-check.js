// The ontology as its own graph (wiki/Ontology-Graph.md, slice 1): a graph
// that carried its own ontology is moved over at load — an ontology graph is
// made from it and the data graph is bound by a copy; the ontology graph's
// map draws types as nodes and relations as edges (a loop for type → same
// type); a change made in the ontology graph flows into the bound graph; a
// fresh ontology must be whole before a graph can use it; the deep link
// reaches a graph's ontology page.
// Usage: serve public/ first, then: node test/ontology-graph-check.js [baseUrl]
const path = require('path');
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
  let answer = 'Магазин';
  page.on('dialog', (d) => d.accept(d.type() === 'prompt' ? answer : undefined));
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(BASE, { waitUntil: 'networkidle0' });
  await page.evaluate(() => {
    localStorage.clear(); localStorage.setItem('loretile-locale', 'ru');
    localStorage.setItem('loretile-tour-done', '1');
    localStorage.setItem('loretile-chat-tour-done', '1');
    localStorage.setItem('loretile-learn-tour-done', '1');
  });
  await page.reload({ waitUntil: 'networkidle0' });
  await sleep(300);

  const nodes = () => page.evaluate(() => document.querySelectorAll('.node').length);
  const openDrawer = async () => { await page.click('.burger'); await sleep(350); };
  const registry = () => page.evaluate(() => localStorage.getItem('loretile-graphs'));
  const graphRow = async (re) => {
    await openDrawer();
    await page.evaluate((src) => [...document.querySelectorAll('.drawer .graph-row')]
      .find((e) => new RegExp(src).test(e.textContent)).click(), re.source);
    await sleep(700);
  };

  // a graph with its own ontology, the pre-2026-11-19 shape
  await openDrawer();
  const input = await page.$('.new-graph-ontology input[type=file]');
  await input.uploadFile(path.join(__dirname, '..', 'kg', 'ontologies', 'business.edn'));
  await sleep(800);
  check(/:profile-set/.test(await page.evaluate(() => localStorage.getItem('loretile-kg-log'))),
    'a graph made from an ontology file carries the profile in its own log');

  // load: it is moved over
  await page.reload({ waitUntil: 'networkidle0' });
  await sleep(500);
  const reg = await registry();
  check(/:ontology\? true/.test(reg), 'at load an ontology graph was made from it');
  check(/:ontology "o-/.test(reg), 'and the data graph is bound to it in the registry');
  check(/:ontology-synced/.test(await page.evaluate(() => localStorage.getItem('loretile-kg-log'))),
    'the data graph carries a copy of its ontology');
  await page.goto(BASE + '#/ontology', { waitUntil: 'networkidle0' });
  await sleep(300);
  check(await page.$('.bound-note a') !== null, 'its ontology page names the ontology graph');
  check(await page.$('.node-type-form') === null && await page.$('.relation-form') === null,
    'and offers no vocabulary forms there: they live in the ontology graph');

  // the ontology graph: types are nodes, relations edges
  await page.click('.bound-note a');
  await sleep(900);
  check(/#\/ontology$/.test(await page.evaluate(() => location.hash)), 'the link opened the ontology graph on its ontology page');
  check(await page.$('.ontology-users li') !== null, 'which lists the graph that uses it');
  check(await page.$('.node-type-form') !== null, 'and can grow');
  await page.goto(BASE + '#/', { waitUntil: 'networkidle0' });
  await sleep(1500);
  const typeCount = await nodes();
  check(typeCount >= 6, `the ontology graph's map draws its node types (${typeCount})`);
  check(await page.$$eval('.edge', (es) => es.length).then((n) => n >= 8), 'and its relations as edges');
  check(await page.$('.edge-loop') !== null, 'a relation from a type to itself draws a loop');
  const rail = await page.evaluate(() => [...document.querySelectorAll('.rail .rbtn')].map((b) => b.title));
  check(!rail.includes('Тема') && !rail.includes('Связь'), 'no add or link on its rail yet (slice 2)');

  // a change in the ontology graph flows into the bound graph
  await page.goto(BASE + '#/ontology', { waitUntil: 'networkidle0' });
  await sleep(300);
  await page.type('.node-type-form input:nth-of-type(1)', 'supplier');
  await page.type('.node-type-form input:nth-of-type(2)', 'поставщик');
  await page.click('.node-type-form .node-type-add');
  await sleep(500);
  check(await page.$('.error') === null, 'a new type is accepted in the ontology graph');
  await page.goto(BASE + '#/', { waitUntil: 'networkidle0' });
  await sleep(1200);
  check(await nodes() === typeCount + 1, 'and appears on its map');
  await graphRow(/^(?!.*онтология).*Магазин/);
  await page.goto(BASE + '#/ontology', { waitUntil: 'networkidle0' });
  await sleep(300);
  check(/поставщик/.test(await page.$eval('.ontology-page', (e) => e.textContent)), 'the bound graph took the new copy');

  // a fresh ontology must be whole before a graph can use it
  answer = 'Склад';
  await openDrawer();
  await page.click('.drawer .new-ontology');
  await sleep(700);
  check(/#\/ontology$/.test(await page.evaluate(() => location.hash)), 'a new ontology opens on its page');
  check(await nodes() === 0, 'and empty');
  answer = 'Склад: данные';
  await page.click('.new-graph-from-ontology');
  await sleep(700);
  check(/не готова/.test(await page.$eval('.error', (e) => e.textContent).catch(() => '')),
    'an empty ontology cannot be used yet, and says why');

  // the deep link reaches a graph's ontology page
  const oid = (reg.match(/:id "(o-[^"]+)"/) || [])[1];
  await page.evaluate((g) => { location.hash = '#/g/' + g + '/ontology'; }, oid);
  await sleep(700);
  check(await page.evaluate(() => location.hash) === '#/ontology' && await page.$('.ontology-users') !== null,
    'the deep link #/g/{ontology}/ontology opened that ontology graph\'s page');

  await browser.close();
  console.log(failures ? 'ONTOLOGY GRAPH CHECK FAILED' : 'ONTOLOGY GRAPH CHECK OK');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('CHECK CRASHED', e); process.exit(1); });
