// Every string the UI asks for must exist, in every language (kintale gate).
// A missing key does not crash — `t` falls back to (str k) — so the screen
// would quietly show «:ui/foo» to a user. Text analysis catches it:
//   1. every :ui/… / :chat/… keyword handed to t / tn is in the dictionary;
//   2. every entry carries ru, de AND en;
//   3. no entry is defined twice (the later one silently wins);
//   4. no Cyrillic string literal is left in ui.cljs / chat.cljs outside the
//      LLM prompts (marked ;; i18n-ignore on the line before).
const fs = require('fs');
const path = require('path');
const SRC = path.join(__dirname, '..', 'src', 'loretile');
const read = (f) => fs.readFileSync(path.join(SRC, f), 'utf8');

let fail = 0;
const check = (ok, msg) => { console.log(ok ? '  ok  ' : '  FAIL', msg); if (!ok) fail = 1; };

const entries = new Map();
for (const f of ['i18n_ui.cljs', 'i18n_chat.cljs']) {
  const src = read(f);
  const start = src.indexOf('(def strings');
  for (const m of src.slice(start).matchAll(/(:[a-z]+\/[a-z0-9?!*<>=+-]+)\s*\{/g)) {
    const key = m[1];
    let depth = 0, end = -1;
    const from = start + m.index + m[0].length - 1;
    for (let i = from; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') { depth--; if (!depth) { end = i; break; } }
    }
    const body = src.slice(from, end + 1);
    const langs = new Set([...body.matchAll(/:(ru|de|en)\s+"/g)].map((x) => x[1]));
    const prev = entries.get(key);
    entries.set(key, { langs, count: (prev ? prev.count : 0) + 1 });
  }
}
check(entries.size > 0, `dictionary parsed: ${entries.size} entries`);
const dupes = [...entries].filter(([, v]) => v.count > 1).map(([k]) => k);
check(dupes.length === 0, `no duplicate entries${dupes.length ? ': ' + dupes.join(', ') : ''}`);
const half = [...entries].filter(([, v]) => v.langs.size < 3).map(([k]) => k);
check(half.length === 0, `every entry has ru+de+en${half.length ? ' — missing: ' + half.join(', ') : ''}`);

const used = new Set();
const cyr = [];
for (const f of ['ui.cljs', 'chat.cljs', 'learn.cljs', 'tour.cljs', 'fold.cljc', 'session.cljs', 'store.cljs', 'llm.cljs', 'guide.cljs', 'tools.cljs', 'tool_defs.cljs']) {
  const src = read(f);
  for (const m of src.matchAll(/\((?:i18n\/)?tn?\s+(:[a-z]+\/[a-z0-9?!*<>=+-]+)/g)) used.add(m[1]);
  for (const m of src.matchAll(/\(pop\*\s+"[^"]*"\s+(:[a-z]+\/[a-z0-9?!*<>=+-]+)\s+(:[a-z]+\/[a-z0-9?!*<>=+-]+)\)/g)) { used.add(m[1]); used.add(m[2]); }
  for (const m of src.matchAll(/\[(:[a-z]+\/[a-z0-9?!*<>=+-]+)\s+(:[a-z]+\/[a-z0-9?!*<>=+-]+)(?:\s+(:[a-z]+\/[a-z0-9?!*<>=+-]+))?\]/g)) {
    for (const k of m.slice(1)) if (k) used.add(k);
  }
  const lines = src.split('\n');
  lines.forEach((line, i) => {
    if (/"[^"]*[А-Яа-яЁё][^"]*"/.test(line) && !/i18n-ignore/.test(lines[i - 1] || '') && !/i18n-ignore/.test(line)) cyr.push(`${f}:${i + 1}`);
  });
}
const missing = [...used].filter((k) => !entries.has(k));
check(missing.length === 0, `every key the UI uses exists (${used.size} used)${missing.length ? ' — missing: ' + missing.join(', ') : ''}`);
check(cyr.length === 0, `no stray Russian literals in ui/chat${cyr.length ? ' — ' + cyr.slice(0, 8).join(', ') + (cyr.length > 8 ? ` +${cyr.length - 8}` : '') : ''}`);

console.log(fail ? 'I18N CHECK FAILED' : 'I18N CHECK PASSED');
process.exit(fail);
