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
const G = require('./lib/graphs');
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
  const registry = () => page.evaluate(() => localStorage.getItem('loretile-graphs'));

  // a graph with its own ontology, the pre-2026-11-19 shape
  if (await G.graphFromOntologyFile(page, path.join(__dirname, '..', 'kg', 'ontologies', 'business.edn'), 'Магазин') === null) {
    console.log('SKIP: release build — the ontology-file door is internal until slice 3'); await browser.close(); process.exit(0);
  }
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
  await G.openGraph(page, BASE, /^Магазин$/);
  await page.goto(BASE + '#/ontology', { waitUntil: 'networkidle0' });
  await sleep(300);
  check(/поставщик/.test(await page.$eval('.ontology-page', (e) => e.textContent)), 'the bound graph took the new copy');

  // a fresh ontology must be whole before a graph can use it
  answer = 'Склад';
  await page.goto(BASE + '#/ontologies', { waitUntil: 'networkidle0' }); await sleep(300);
  await page.click('.ontologies-page .new-ontology');
  await sleep(700);
  check(/#\/ontology$/.test(await page.evaluate(() => location.hash)), 'a new ontology opens on its page');
  check(await nodes() === 0, 'and empty');
  answer = 'Склад: данные';
  await page.click('.new-graph-from-ontology');
  await sleep(700);
  check(/не готова/.test(await page.$eval('.error', (e) => e.textContent).catch(() => '')),
    'an empty ontology cannot be used yet, and says why');
  check(!/Склад: данные/.test(await registry()), 'and no graph is left behind for it');

  // the deep link reaches a graph's ontology page
  const oid = (reg.match(/:id "(o-[^"]+)"/) || [])[1];
  await page.evaluate((g) => { location.hash = '#/g/' + g + '/ontology'; }, oid);
  await sleep(700);
  check(await page.evaluate(() => location.hash) === '#/ontology' && await page.$('.ontology-users') !== null,
    'the deep link #/g/{ontology}/ontology opened that ontology graph\'s page');

  // the Graphs and Ontologies views manage them (2026-11-19): the drawer only navigates
  await page.goto(BASE + '#/', { waitUntil: 'networkidle0' }); await sleep(300);
  await page.click('.burger'); await sleep(350);
  const drawerText = await page.$eval('.drawer nav', (e) => e.textContent);
  check(await page.$('.drawer .nav-graphs') !== null && await page.$('.drawer .nav-ontologies') !== null,
    'the drawer links to the Graphs and Ontologies views');
  check(!/Новый граф|Экспорт|Импорт|Демо-графы/.test(drawerText) && await page.$('.drawer .graph-row') === null,
    'and no longer lists graphs, makes them, imports or exports');
  await page.keyboard.press('Escape'); await sleep(200);
  const dataRows = await G.listRows(page, BASE);
  check(dataRows.some((r) => /^\*?Магазин$/.test(r)) && !dataRows.some((r) => /Онтология:|Склад/.test(r)),
    `the Graphs view lists data graphs only (${dataRows.join(' | ')})`);
  check(await page.$$eval('.graphs-page .entity-row', (es) => es.every((e) => e.querySelector('.export-log') && e.querySelector('.export-agent') && e.querySelector('.export-ttl'))),
    'each graph row exports (edn, md, ttl)');
  const ontoRows = await G.listRows(page, BASE, 'ontologies');
  check(ontoRows.some((r) => /Онтология: Магазин/.test(r)) && ontoRows.some((r) => /Склад$/.test(r)), 'the Ontologies view lists the ontology graphs');
  const usedRow = await page.evaluateHandle(() => [...document.querySelectorAll('.ontologies-page .entity-row')].find((e) => /Онтология: Магазин/.test(e.textContent)));
  check(await usedRow.asElement().$('.delete') === null && /графов с ней: 1/.test(await usedRow.asElement().evaluate((e) => e.textContent)),
    'an ontology in use says by how many graphs, and has no delete');
  // rename
  answer = 'Склад (переименован)';
  await page.evaluate(() => [...document.querySelectorAll('.ontologies-page .entity-row')].find((e) => /^Склад$/.test(e.querySelector('.entity-title').textContent)).querySelector('.rename').click());
  await sleep(300);
  check(/Склад \(переименован\)/.test(await registry()), 'rename changes the title');
  // delete an unused one (the dialog is accepted)
  await page.evaluate(() => [...document.querySelectorAll('.ontologies-page .entity-row')].find((e) => /переименован/.test(e.querySelector('.entity-title').textContent)).querySelector('.delete').click());
  await sleep(400);
  check(!/переименован/.test(await registry()) && (await G.listRows(page, BASE, 'ontologies')).length === ontoRows.length - 1,
    'an unused ontology is deleted, its row and log gone');

  // both are in the command palette too
  const fromPalette = async (cmd, title) => {
    answer = title;
    await page.goto(BASE + '#/', { waitUntil: 'networkidle0' });
    await sleep(400);
    await page.keyboard.down('Control'); await page.keyboard.press('k'); await page.keyboard.up('Control');
    await sleep(300);
    await page.type('.cmd-input', cmd); await sleep(250);
    await page.keyboard.press('Enter'); await sleep(800);
  };
  const before = (await registry()).match(/:id "/g).length;
  await fromPalette('Новая онтология', 'Из палитры: онтология');
  check(/Из палитры: онтология",? :ontology\? true/.test(await registry()) && /#\/ontology$/.test(await page.evaluate(() => location.hash)),
    'the palette starts a new ontology and opens its page');
  await fromPalette('Новый граф', 'Из палитры: граф');
  const reg2 = await registry();
  check(/Из палитры: граф"/.test(reg2) && reg2.match(/:id "/g).length === before + 2 && await nodes() === 0,
    'the palette starts a new empty graph');

  await browser.close();
  console.log(failures ? 'ONTOLOGY GRAPH CHECK FAILED' : 'ONTOLOGY GRAPH CHECK OK');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('CHECK CRASHED', e); process.exit(1); });
