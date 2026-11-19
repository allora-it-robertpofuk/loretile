// Shared steps for browser checks since the drawer only navigates (Denis
// 2026-11-19): graphs and ontologies are opened, made, exported and deleted
// in the Graphs view, #/graphs — one set of graphs, each with an ontology.
const fs = require('fs');
const path = require('path');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// open the Graphs view and click the row whose title matches `re`
async function openGraph(page, base, re) {
  await page.goto(base + '#/graphs', { waitUntil: 'networkidle0' });
  await sleep(250);
  const ok = await page.evaluate((src) => {
    const a = [...document.querySelectorAll('.entity-row .entity-title')].find((e) => new RegExp(src).test(e.textContent));
    if (a) a.click();
    return !!a;
  }, re.source);
  await sleep(700);
  return ok;
}

// titles of the rows in the Graphs view; the open one is marked with «*»
async function listRows(page, base) {
  await page.goto(base + '#/graphs', { waitUntil: 'networkidle0' });
  await sleep(250);
  return page.$$eval('.entity-row', (es) => es.map((e) => (e.classList.contains('on') ? '*' : '') + e.querySelector('.entity-title').textContent));
}

// «Новый граф» in the Graphs view: the form takes a title and an ontology —
// "learning" (default), "ontology" (the graph describes types) or a graph id
async function newGraph(page, base, title, ontology = 'learning') {
  await page.goto(base + '#/graphs', { waitUntil: 'networkidle0' });
  await sleep(250);
  await page.click('.graphs-page .new-graph');
  await page.waitForSelector('.new-graph-form');
  await page.type('.new-graph-title', title);
  await page.select('.new-graph-ontology', ontology);
  await page.click('.new-graph-create');
  await sleep(700);
}

// THE DROPPED DOOR, kept for checks until slice 3 of wiki/Ontology-Graph.md
// replaces it with the assistant's cards: an ontology file (edn or Turtle)
// → a graph carrying that ontology in its own log (moved over to an
// ontology graph at the next load). Drives store internals: DEV BUILD ONLY —
// returns null on a release build so the check can skip.
async function graphFromOntologyFile(page, file, title) {
  const text = fs.readFileSync(file, 'utf8');
  return page.evaluate((text, fname, title) => {
    if (typeof loretile === 'undefined' || !loretile.store || !loretile.store.read_profile) return null;
    const kw = cljs.core.keyword, get = cljs.core.get;
    const r = loretile.store.read_profile(text, fname);
    const err = get(r, kw('error'));
    if (err) { cljs.core.reset_BANG_(loretile.store.last_error, err); return false; }
    loretile.store.new_graph_BANG_(title, cljs.core.PersistentArrayMap.fromArray([kw('profile'), get(r, kw('profile'))], true));
    location.hash = '#/';
    return true;
  }, text, path.basename(file), title);
}

module.exports = { openGraph, listRows, newGraph, graphFromOntologyFile, sleep };
