// Sessions (kintale shape): the sitting survives a reload, «new
// conversation» shelves it instead of deleting it, and the palette brings
// a shelved one back. No LLM needed — an unconfigured key still produces
// a user bubble plus an error line, which is a conversation.
// Usage: serve public/ first, then: node test/session-check.js [baseUrl]
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
  await page.setViewport({ width: 1280, height: 800 });
  await page.goto(BASE + '#/chat', { waitUntil: 'networkidle0' });
  await page.evaluate(() => {
    localStorage.clear(); localStorage.setItem('loretile-locale', 'ru'); localStorage.setItem('loretile-tour-done','1'); localStorage.setItem('loretile-chat-tour-done','1'); localStorage.setItem('loretile-learn-tour-done','1');
    // a key that never answers: the request fails, the failure is a bubble
    localStorage.setItem('loretile-llm-config',
      '{:preset :anthropic :shape :anthropic :url "http://localhost:1/none" :model "test" :key "sk-test"}');
  });
  await page.reload({ waitUntil: 'networkidle0' });
  await sleep(300);

  const msgs = () => page.$$eval('.msg:not(.chat-lead)', (els) => els.map((e) => e.textContent));

  await page.type('.composer textarea', 'Первая беседа про SQL');
  await page.click('.composer button.primary');
  await sleep(600);
  check((await msgs()).length >= 1, 'a message lands in the conversation');

  await sleep(900); // debounce
  await page.reload({ waitUntil: 'networkidle0' });
  await sleep(400);
  check(/Первая беседа/.test((await msgs()).join(' ')), 'the sitting survives a reload');

  await page.click('.chat-head .pt-new');
  await sleep(300);
  check((await msgs()).length === 0, 'new conversation starts empty');

  await page.type('.composer textarea', 'Вторая беседа про GROUP BY');
  await page.click('.composer button.primary');
  await sleep(300); // deliberately inside the save debounce — shelving must flush it

  await page.keyboard.down('Control'); await page.keyboard.press('k'); await page.keyboard.up('Control');
  await sleep(200);
  await page.type('.cmd-input', 'Первая');
  await sleep(200);
  const hits = await page.$$eval('.cmd-list li', (els) => els.map((e) => e.textContent));
  check(hits.some((h) => /Первая беседа/.test(h)), 'the palette lists the shelved sitting by its first words');
  await page.keyboard.press('Enter');
  await sleep(400);
  const after = await msgs();
  check(/Первая беседа/.test(after.join(' ')) && !/Вторая/.test(after.join(' ')),
    'picking it brings the first sitting back' + (/Первая/.test(after.join(' ')) && !/Вторая/.test(after.join(' ')) ? '' : ' — got: ' + JSON.stringify(after)));

  await page.keyboard.down('Control'); await page.keyboard.press('k'); await page.keyboard.up('Control');
  await sleep(200);
  await page.type('.cmd-input', 'Вторая');
  await sleep(200);
  const hits2 = await page.$$eval('.cmd-list li', (els) => els.map((e) => e.textContent));
  check(hits2.some((h) => /Вторая беседа/.test(h)), 'and the second one was shelved, not lost');
  await page.keyboard.press('Escape');

  await browser.close();
  console.log(failures ? 'SESSION CHECK FAILED' : 'SESSION CHECK OK');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('CHECK CRASHED', e); process.exit(1); });
