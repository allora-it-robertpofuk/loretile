// Capture every UI state at 1280 and key ones at 390 for design review.
const puppeteer = require('puppeteer-core');
const BASE = 'http://localhost:8291';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SEED = [
  ['source-added', { source: { id: 'src', title: 'Учебник SQL' } }],
];
const CONCEPTS = [
  ['select-vyborka', 'SELECT: выборка', 'Как достать строки из таблицы'],
  ['filtry-where', 'Фильтры WHERE', 'Как отобрать нужные строки'],
  ['group-by', 'GROUP BY', 'Складывает строки в корзины по ключу'],
  ['having', 'HAVING', 'Фильтр по корзинам, не по строкам'],
  ['join', 'JOIN', 'Склеивает таблицы по ключу'],
  ['klyuchi', 'Ключи и связи', 'Первичные и внешние ключи'],
  ['agregaty', 'Агрегатные функции', 'COUNT, SUM, AVG над корзинами'],
];
const EDGES = [
  ['filtry-where', 'select-vyborka'], ['group-by', 'filtry-where'],
  ['having', 'group-by'], ['agregaty', 'group-by'], ['join', 'klyuchi'],
];

(async () => {
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_BIN || '/usr/bin/google-chrome',
    headless: 'new', args: ['--no-sandbox', '--disable-gpu', '--lang=ru'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  await page.goto(BASE, { waitUntil: 'networkidle0' });
  await page.evaluate(() => localStorage.setItem('loretile-locale', 'ru'));

  // seed a plausible KG straight into localStorage as EDN
  const edn = [];
  let n = 0;
  const ev = (type, rest) => `{:ev/id "e${n++}" :ev/type :${type} :ev/ns "demo" :ev/actor "denis" :ev/ts 1 ${rest}}`;
  edn.push(ev('source-added', ':source {:id "src" :title "Учебник SQL"}'));
  for (const [id, title, def] of CONCEPTS)
    edn.push(ev('concept-accepted', `:concept {:id "${id}" :title "${title}" :definition "${def}"}`));
  for (const [from, to] of EDGES)
    edn.push(ev('edge-accepted', `:edge {:from "${from}" :to "${to}" :type :requires :provenance :authored}`));
  edn.push(ev('edge-accepted', ':edge {:from "having" :to "filtry-where" :type :is-confused-with :provenance :authored}'));
  edn.push(ev('object-added', ':object {:id "o1" :concept-id "group-by" :kind :explanation :level :apprentice :locale "ru" :origin :authored :text "Представьте, что строки раскладывают по корзинам: одна корзина на каждое значение ключа. GROUP BY делает именно это." :grounded-in "src"}'));
  for (let i = 1; i <= 3; i++) {
    edn.push(ev('item-added', `:item {:id "i${i}" :primary-concept-id "group-by" :level :apprentice :kind :single-choice :spec {:stem "Вопрос №${i} про GROUP BY" :options ["A" "B"] :key 0}}`));
    edn.push(ev('item-accepted', `:id "i${i}"`));
  }
  edn.push(ev('source-updated', ':id "src" :change :material'));  // → group-by stale? no: stale shows amber
  await page.evaluate((s) => localStorage.setItem('loretile-kg-log', s), '[' + edn.join(' ') + ']');

  await page.goto(BASE + '#/', { waitUntil: 'networkidle0' });
  await page.reload({ waitUntil: 'networkidle0' }); await sleep(2500);
  await page.screenshot({ path: 'test/d1-map.png' });

  // command palette
  await page.keyboard.down('Control'); await page.keyboard.press('k'); await page.keyboard.up('Control');
  await sleep(250);
  await page.screenshot({ path: 'test/d6-palette.png' });
  await page.keyboard.press('Escape'); await sleep(200);

  await page.goto(BASE + '#/c/group-by', { waitUntil: 'networkidle0' }); await sleep(1200);
  await page.screenshot({ path: 'test/d2-panel.png' });

  await page.click('.rail .rbtn[title="Тема"]'); await sleep(250);   // + Тема modal
  await page.screenshot({ path: 'test/d3-modal.png' });
  await page.keyboard.press('Escape');
  await sleep(200);

  await page.setViewport({ width: 390, height: 844 }); await sleep(300);
  await page.goto(BASE + '#/', { waitUntil: 'networkidle0' }); await sleep(200);
  await page.screenshot({ path: 'test/d4-map-mobile.png' });
  await page.goto(BASE + '#/c/group-by', { waitUntil: 'networkidle0' }); await sleep(1000);
  await page.screenshot({ path: 'test/d5-panel-mobile.png', fullPage: false });

  await browser.close();
  console.log('SHOTS OK');
})().catch((e) => { console.error(e); process.exit(1); });
