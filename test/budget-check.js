// The token budget (Ethics «caps day one, fail closed»; review 2026-10-02 #7):
// every reply capped for every provider; a day's tokens counted from what the
// provider reports; a call that could cross the budget refused BEFORE it is sent.
// Usage: make engines; serve public/ on :8291; node test/budget-check.js
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
      const u = String(url);
      if (u.includes('api.anthropic.com')) {
        window.__calls.push(JSON.parse(opts.body));
        if (window.__keyStatus) return Promise.resolve(new Response('', { status: window.__keyStatus }));
        return Promise.resolve(new Response(JSON.stringify({
          content: [{ type: 'text', text: 'Ответ репетитора.' }], usage: { input_tokens: 600, output_tokens: 50 } }), { status: 200 }));
      }
      if (u.includes('x.test')) {
        window.__calls.push(JSON.parse(opts.body));
        return new Promise((r) => setTimeout(r, window.__delay || 0)).then(() => window.__fail
          ? new Response('', { status: 500 })
          : new Response(JSON.stringify({
            choices: [{ message: { content: 'Ответ.' } }], usage: { total_tokens: 100 } }), { status: 200 }));
      }
      return orig(url, opts);
    };
  });
  const LIVE = '.qcard:not(.done)';
  const text = (sel) => page.$eval(sel, (e) => e.textContent).catch(() => '');
  const stage = () => page.$eval('.learn', (e) => e.dataset.stage).catch(() => '');
  const calls = () => page.evaluate(() => window.__calls.length);
  const usage = () => page.evaluate(() => localStorage.getItem('loretile-llm-usage') || '');
  const ask = async (q) => { await page.type('.learn .composer textarea', q); await page.keyboard.press('Enter'); await sleep(500); };
  const answer = async () => {
    const stem = await text(LIVE + ' .stem'); const key = KEY[stem];
    if (await page.$(LIVE + ' .options')) {
      const opts = await page.$$eval(LIVE + ' .opt', (els) => els.map((e) => e.textContent));
      await page.evaluate((i, sel) => document.querySelectorAll(sel + ' .opt')[i].click(), opts.indexOf(key), LIVE);
    } else { await page.type(LIVE + ' input', key); await page.click(LIVE + ' button.primary'); }
    await sleep(200);
  };

  await page.goto(BASE, { waitUntil: 'networkidle0' });
  await page.evaluate(() => {
    localStorage.clear(); localStorage.setItem('loretile-locale', 'ru');
    for (const k of ['loretile-tour-done', 'loretile-chat-tour-done', 'loretile-learn-tour-done']) localStorage.setItem(k, '1');
    localStorage.setItem('loretile-llm-config', '{:preset :anthropic :shape :anthropic :url "https://api.anthropic.com/v1/messages" :model "test" :key "sk-test"}');
    localStorage.setItem('loretile-llm-budget', '100000');
  });
  await page.reload({ waitUntil: 'networkidle0' }); await sleep(400);
  await page.evaluate(() => [...document.querySelectorAll('button.demo-row')].find((b) => /виноград/i.test(b.textContent)).click());
  await sleep(1500);
  await page.goto(BASE + '#/learn/vineyard-season', { waitUntil: 'networkidle0' }); await sleep(500);
  await page.click('.learn .start'); await sleep(300);
  let n = 0;
  while ((await stage()) === 'diagnostic' && n++ < 25) await answer();
  check((await stage()) === 'final-intro' && await page.$('.learn .composer textarea') !== null, 'the tutor is open at the final offer');

  await ask('что будет на итоговой?');
  check((await calls()) === 1 && /Ответ репетитора/.test(await text('.feed')), 'the first call fits the budget and goes out');
  check(/:tokens 650/.test(await usage()) && /:calls 1/.test(await usage()), 'the provider\'s reported usage is counted (600 in + 50 out)');
  check(await page.evaluate(() => window.__calls[0].max_tokens) === 4096, 'the reply is capped');

  // now leave room for less than one more call: used 650 + the reply cap + 100;
  // any real prompt is more than 100 tokens, so the worst case cannot fit
  await page.evaluate(() => localStorage.setItem('loretile-llm-budget', String(650 + 4096 + 100)));
  await ask('а ещё?');
  check((await calls()) === 1, 'the next call could cross the budget — it is NOT sent');
  check(/Дневной лимит токенов исчерпан/.test(await text('.feed')) && /не отправлен/.test(await text('.feed')),
    'and the learner is told why, with the way out');

  // an OpenAI-compatible provider: capped too, its usage counted
  await page.evaluate(() => {
    localStorage.setItem('loretile-llm-budget', '100000');
    localStorage.setItem('loretile-llm-config', '{:preset :custom :shape :openai-compat :url "https://x.test/v1/chat/completions" :model "m" :key "k"}');
  });
  await page.reload({ waitUntil: 'networkidle0' }); await sleep(500);
  await ask('ещё вопрос');
  const oc = await page.evaluate(() => window.__calls[window.__calls.length - 1]);
  check(oc && oc.max_tokens === 4096, 'an OpenAI-compatible request carries the reply cap too (it had none)');
  check(/:tokens 750/.test(await usage()), 'and its reported usage is counted (+100)');

  // Settings shows the day and edits the budget
  await page.goto(BASE + '#/settings', { waitUntil: 'networkidle0' }); await sleep(400);
  check(/750 из 100000/.test(await text('.budget-usage')) && /запросов: 2/.test(await text('.budget-usage')), 'Settings shows today\'s tokens and requests against the budget');
  await page.$eval('.budget-input', (e) => { e.value = ''; });
  await page.type('.budget-input', '250000');
  await sleep(200);
  check(await page.evaluate(() => localStorage.getItem('loretile-llm-budget')) === '250000', 'the budget can be changed there');
  // a new day starts at zero
  await page.evaluate(() => localStorage.setItem('loretile-llm-usage', '{:day "2000-01-01" :tokens 999999 :calls 9}'));
  await page.reload({ waitUntil: 'networkidle0' }); await sleep(400);
  check(/^Сегодня: 0 из/.test(await text('.budget-usage')), 'yesterday\'s spending does not count today');

  // fail closed on a damaged record (review 2026-10-02 (b)). chat! is called
  // directly — the dev build exposes namespaces on window.
  const DAY = await page.evaluate(() => new Date().toISOString().slice(0, 10));
  const chat = () => page.evaluate(() => loretile.llm.chat_BANG_('система', 'вопрос').then(() => 'sent').catch((e) => e.message));
  const setLS = (k, v) => page.evaluate((k, v) => localStorage.setItem(k, v), k, v);
  const DAMAGED = /повреждена/;
  await setLS('loretile-llm-budget', '100000');
  let before = await calls();
  await setLS('loretile-llm-usage', '{:day "' + DAY);
  check(DAMAGED.test(await chat()) && (await calls()) === before, 'an unreadable usage record counts as spent — nothing is sent');
  check((await usage()).includes(':day "' + DAY + '"'), 'and it is rewritten as today\'s, so the next UTC day starts clean');
  await page.reload({ waitUntil: 'networkidle0' }); await sleep(400);
  check(DAMAGED.test(await text('.budget')), 'Settings says the record is damaged');
  await setLS('loretile-llm-usage', '{:day "' + DAY + '" :tokens "abc" :calls 1}');
  check(DAMAGED.test(await chat()) && (await calls()) === before, 'non-numeric tokens count as spent — nothing is sent');
  await setLS('loretile-llm-usage', '{:day "2000-01-01" :tokens "abc" :calls 1}');
  check((await chat()) === 'sent', 'a damaged record from an earlier day does not block today');
  before = await calls();
  for (const b of ['abc', '-5', '{:x 1}', '(']) {
    await setLS('loretile-llm-budget', b);
    check(DAMAGED.test(await chat()) && (await calls()) === before, 'an invalid budget ' + b + ' refuses instead of the default');
  }
  await setLS('loretile-llm-budget', '100000');
  await page.evaluate(() => localStorage.removeItem('loretile-llm-usage'));

  // concurrency: room for one worst case, not two — the second is refused while the first is in flight
  const worst = Math.ceil(('система' + 'вопрос').length / 3) + 4096;
  await setLS('loretile-llm-budget', String(2 * worst - 1));
  before = await calls();
  const both = await page.evaluate(() => {
    window.__delay = 300;
    const one = () => loretile.llm.chat_BANG_('система', 'вопрос').then(() => 'sent').catch((e) => e.message);
    return Promise.all([one(), one()]).finally(() => { window.__delay = 0; });
  });
  check(both[0] === 'sent' && /исчерпан/.test(both[1]) && (await calls()) === before + 1, 'two concurrent calls that together could cross the budget are not both admitted');
  check(/:tokens 100\b/.test(await usage()), 'and the reservation is trued up to the reply\'s real usage');

  // a call that was sent and failed still counts its prompt (3 characters per token)
  await setLS('loretile-llm-budget', '100000');
  await page.evaluate(() => { window.__fail = true; });
  const failed = await chat();
  await page.evaluate(() => { window.__fail = false; });
  const prompt = Math.ceil(('система' + 'вопрос').length / 3);
  check(failed !== 'sent' && new RegExp(':tokens ' + (100 + prompt) + '\\b').test(await usage()) && /:calls 2/.test(await usage()),
    'a failed call is counted (its prompt estimate)');

  // --- key onboarding: where to get one, what it costs, does it work ----------
  // removed, not blanked: a blank usage record is unreadable and fails closed (as it should)
  await page.evaluate(() => { for (const k of ['loretile-llm-budget', 'loretile-llm-usage', 'loretile-llm-config']) localStorage.removeItem(k); });
  await page.goto(BASE + '#/settings', { waitUntil: 'networkidle0' }); await page.reload({ waitUntil: 'networkidle0' }); await sleep(400);
  check(/platform\.claude\.com\/settings\/keys/.test(await page.$eval('.key-help a', (a) => a.href).catch(() => '')) && /Платите вы/.test(await text('.key-cost')),
    'settings say where to get a key and who pays');
  check(await page.$eval('.key-check', (b) => b.disabled), 'nothing to check without a key');
  await page.type('.chat-setup input[type=password]', 'sk-test-key');
  await page.evaluate(() => { window.__calls = []; window.__keyStatus = 0; });
  await page.click('.key-check');
  for (let i = 0; i < 30 && !(await page.$('.key-status.ok, .key-status.bad')); i++) await sleep(100);
  const sent = await page.evaluate(() => window.__calls[0] || {});
  check(/Ключ работает/.test(await text('.key-status.ok')) && sent.max_tokens === 5, 'the check is one tiny real call, and says the key works');
  check(/:calls 1/.test(await usage()), 'and it counts against today\'s budget like any call');
  const cfgNow = await page.evaluate(() => localStorage.getItem('loretile-llm-config') || '');
  check(/sk-test-key/.test(cfgNow), 'checking saves the key');
  await page.evaluate(() => { window.__keyStatus = 401; });
  await page.click('.key-check');
  for (let i = 0; i < 30 && !(await page.$('.key-status.bad')); i++) await sleep(100);
  check(/не принял ключ/.test(await text('.key-status.bad')), 'a rejected key is named as such, in plain words');

  await browser.close();
  console.log(failures ? 'BUDGET CHECK FAILED' : 'BUDGET CHECK OK');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('CHECK CRASHED', e); process.exit(1); });
