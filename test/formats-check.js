// Documents beyond PDF (2026-10-03): Word (.docx) and web pages (.html) are
// read in the browser itself — a .docx through the browser's own zip
// inflate (no library), html through DOMParser — and reach the intake as
// text: headings as markdown marks, paragraphs and table cells kept,
// scripts, styles and navigation dropped. Fixtures are built here: two real
// zips (deflated, as Word writes, and stored, as some tools do).
// Usage: serve public/ on :8291; node test/formats-check.js
const puppeteer = require('puppeteer-core');
const G = require('./lib/graphs');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const BASE = process.argv[2] || 'http://localhost:8291';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (ok, name) => { console.log((ok ? 'PASS' : 'FAIL') + ' ' + name); if (!ok) failures++; };

// a minimal zip writer: local headers, central directory, end record
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function zip(files, deflate) {
  const locals = []; const central = []; let off = 0;
  for (const [name, text] of files) {
    const raw = Buffer.from(text, 'utf8'); const data = deflate ? zlib.deflateRawSync(raw) : raw;
    const nm = Buffer.from(name, 'utf8'); const crc = crc32(raw); const method = deflate ? 8 : 0;
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x800, 6); lh.writeUInt16LE(method, 8);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(nm.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x800, 8); ch.writeUInt16LE(method, 10);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(nm.length, 28); ch.writeUInt32LE(off, 42);
    locals.push(lh, nm, data); central.push(ch, nm); off += 30 + nm.length + data.length;
  }
  const cd = Buffer.concat(central); const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...locals, cd, end]);
}
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const para = (t, style) => `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}<w:r><w:t>${t}</w:t></w:r></w:p>`;
const docXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W}><w:body>`
  + para('Обрезка винограда', 'Heading1') + para('Зимняя обрезка оставляет на лозе 8–12 глазков.')
  + `<w:p><w:r><w:t xml:space="preserve">Сухая </w:t></w:r><w:r><w:t>погода</w:t></w:r></w:p>`
  + para('Зелёные операции', 'Heading2')
  + `<w:tbl><w:tr><w:tc>${para('Пасынкование')}</w:tc><w:tc>${para('июнь')}</w:tc></w:tr></w:tbl>`
  + '</w:body></w:document>';
const parts = [['[Content_Types].xml', '<Types/>'], ['word/document.xml', docXml]];

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'formats-'));
const DOCX = path.join(dir, 'Обрезка.docx'); fs.writeFileSync(DOCX, zip(parts, true));
const DOCX0 = path.join(dir, 'Обрезка-stored.docx'); fs.writeFileSync(DOCX0, zip(parts, false));
// Russian Word: the heading's style id is «1», its NAME «heading 1» lives in
// styles.xml; a tab and a line break inside runs (they glued words)
const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ${W}>`
  + '<w:style w:type="paragraph" w:styleId="1"><w:name w:val="heading 1"/></w:style>'
  + '<w:style w:type="paragraph" w:styleId="a3"><w:name w:val="Normal"/></w:style></w:styles>';
const ruXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W}><w:body>`
  + para('Обрезка винограда', '1')
  + '<w:p><w:r><w:t>Слово</w:t><w:tab/><w:t>другое</w:t><w:br/><w:t>строка</w:t></w:r></w:p>'
  + '</w:body></w:document>';
const DOCXRU = path.join(dir, 'ru-word.docx');
fs.writeFileSync(DOCXRU, zip([['[Content_Types].xml', '<Types/>'], ['word/document.xml', ruXml], ['word/styles.xml', stylesXml]], true));
const HTML = path.join(dir, 'Статья.html');
fs.writeFileSync(HTML, `<!doctype html><html><head><title>t</title><style>.x{color:red}</style><script>var secret = "SCRIPT-TEXT";</script></head>
<body><nav><a href="/">Главная</a> · <a href="/blog">Блог</a> NAV-TEXT</nav>
<article><h1>Верезон</h1><p>Ягоды <b>меняют цвет</b> и<br>размягчаются.</p>
<h2>Сроки</h2><ul><li>Ранние сорта — июль</li><li>Поздние — август</li></ul>
<table><tr><th>Сорт</th><th>Начало</th></tr><tr><td>Шардоне</td><td>июль</td></tr></table></article>
<footer>FOOTER-TEXT © 2026</footer></body></html>`);

(async () => {
  // Chromium without a UTF-8 locale cannot open a non-ASCII path: the upload
  // of «Обрезка.docx» then silently does nothing (cloud sessions have no LANG)
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_BIN || '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--disable-gpu'],
    env: { ...process.env, LANG: process.env.LANG || 'C.UTF-8' }, });
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('PAGE ERROR', e.message));
  await page.setViewport({ width: 1280, height: 900 });
  await page.evaluateOnNewDocument(() => {
    const orig = window.fetch.bind(window);
    window.__sent = [];
    window.fetch = (url, opts) => {
      if (String(url).includes('api.anthropic.com')) {
        const body = JSON.parse(opts.body);
        window.__sent.push(body.messages[0].content);
        return Promise.resolve(new Response(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify({ concepts: [], note: 'Прочитал.' }) }] }), { status: 200 }));
      }
      return orig(url, opts);
    };
  });
  const text = (sel) => page.$eval(sel, (e) => e.textContent).catch(() => '');
  await page.goto(BASE, { waitUntil: 'networkidle0' });
  await page.evaluate(() => {
    localStorage.clear(); localStorage.setItem('loretile-locale', 'ru');
    for (const k of ['loretile-tour-done', 'loretile-chat-tour-done', 'loretile-learn-tour-done']) localStorage.setItem(k, '1');
    localStorage.setItem('loretile-llm-config', '{:preset :anthropic :shape :anthropic :url "https://api.anthropic.com/v1/messages" :model "test" :key "sk-test"}');
  });
  await page.goto(BASE + '#/chat', { waitUntil: 'networkidle0' }); await page.reload({ waitUntil: 'networkidle0' }); await sleep(400);
  check(/\.docx/.test(await page.$eval('.composer input[type=file]', (i) => i.accept)) && /\.html/.test(await page.$eval('.composer input[type=file]', (i) => i.accept)),
    'the file picker offers Word and web pages');
  check(/Word, веб-страницу/.test(await text('.chat .msgs')), 'and the empty sitting says so');

  const send = async (file) => {
    await page.evaluate(() => { window.__sent = []; });
    await (await page.$('.composer input[type=file]')).uploadFile(file); await sleep(500);
    await page.click('.composer .chat-sendbtn');
    await G.passTriage(page);   // nothing open yet: the one door asks first
    for (let i = 0; i < 40 && !(await page.evaluate(() => window.__sent.length)); i++) await sleep(150);
    await sleep(300);
    return page.evaluate(() => window.__sent.join('\n'));
  };

  const d = await send(DOCX);
  check(/# Обрезка винограда/.test(d) && /## Зелёные операции/.test(d), 'a .docx (deflated, as Word writes it): headings keep their outline as markdown marks');
  check(/Зимняя обрезка оставляет на лозе 8–12 глазков\./.test(d) && /Сухая погода/.test(d), 'paragraphs arrive whole, runs joined');
  check(/Пасынкование/.test(d) && /июнь/.test(d), 'table cells are read too');
  check(!/<w:|xmlns/.test(d), 'no XML reaches the model');
  check(/файл: Обрезка\.docx/.test(await text('.chat .msgs')), 'the chat names the file');

  await page.click('.chat-head .pt-new'); await sleep(300);
  const d0 = await send(DOCX0);
  check(/# Обрезка винограда/.test(d0) && /Пасынкование/.test(d0), 'a .docx with stored (uncompressed) entries reads the same');

  await page.click('.chat-head .pt-new'); await sleep(300);
  const r = await send(DOCXRU);
  check(/# Обрезка винограда/.test(r), 'a Russian Word heading (style id «1», named «heading 1» in styles.xml) keeps its outline');
  check(/Слово другое/.test(r) && /другое\s*\n\s*строка/.test(r), 'a tab is a space and a line break a newline, words never glued');

  await page.click('.chat-head .pt-new'); await sleep(300);
  const h = await send(HTML);
  check(/# Верезон/.test(h) && /## Сроки/.test(h), 'a web page: headings become markdown marks');
  check(/Ягоды меняют цвет и\s*\n\s*размягчаются\./.test(h) && /Ранние сорта — июль/.test(h) && /Шардоне/.test(h), 'paragraphs, list items, a line break and table cells survive');
  check(!/SCRIPT-TEXT|NAV-TEXT|FOOTER-TEXT|color:red/.test(h), 'scripts, styles, navigation and the footer are dropped');

  await browser.close();
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(failures ? 'FORMATS CHECK FAILED' : 'FORMATS CHECK OK');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('CHECK CRASHED', e); process.exit(1); });
