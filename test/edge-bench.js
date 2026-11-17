// Prerequisite-edge benchmark on LectureBank (Yale-LILY, 208 NLP/ML topics,
// 921 human-labelled directed prerequisite pairs). Measures the model's
// PAIRWISE judgment with the same step-2 instruction the intake chat uses —
// but with topic names only (no evidence, no engine signals), so this is a
// lower bound for the real intake. Precision / recall / reversals per run.
//
// Usage (OpenAI-shaped provider):
//   LLM_URL=https://.../chat/completions LLM_MODEL=... LLM_KEY=... \
//   node test/edge-bench.js [pairs=200] [batch=20] [seed=1]
// No key → prints the dataset summary and exits 0 (nothing to measure).

const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, 'data');
const topics = Object.fromEntries(
  fs.readFileSync(path.join(DATA, '208topics.csv'), 'utf8').trim().split('\n')
    .map((l) => l.split(',')).map(([id, name]) => [id, name]));
// CSV convention (verified against topic names, 2026-09-09): a row (a,b,1)
// means "a is a PREREQUISITE of b" — Bayes before LDA, backprop before
// BiRNNs. Our edge key is dependent>prerequisite ({from requires to}), so
// the truth key is b>a. The first run had this flipped and scored the
// model against inverted truth: 46 of its 47 correct edges as "reversals".
const truth = new Map(); // "dependent>prerequisite" -> 1
for (const line of fs.readFileSync(path.join(DATA, 'prerequisite_annotation.csv'), 'utf8').trim().split('\n')) {
  const [a, b, y] = line.split(',');
  if (y === '1') truth.set(b + '>' + a, 1);
}
const ids = Object.keys(topics);
console.log(`LectureBank: ${ids.length} topics, ${truth.size} prerequisite pairs`);

const { LLM_URL, LLM_MODEL, LLM_KEY } = process.env;
if (!LLM_URL || !LLM_MODEL || !LLM_KEY) { console.log('no LLM_URL/LLM_MODEL/LLM_KEY — nothing to measure'); process.exit(0); }

const N = +(process.argv[2] || 200), BATCH = +(process.argv[3] || 20);
let seed = +(process.argv[4] || 1);
const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

// sample: half positive (directed truth), half random negatives (neither direction)
const positives = [...truth.keys()].map((k) => k.split('>'));
const sample = [];
while (sample.length < N / 2) sample.push(positives.splice(Math.floor(rand() * positives.length), 1)[0]);
while (sample.length < N) {
  const a = ids[Math.floor(rand() * ids.length)], b = ids[Math.floor(rand() * ids.length)];
  if (a !== b && !truth.has(a + '>' + b) && !truth.has(b + '>' + a)) sample.push([a, b]);
}
// present unordered, shuffled, so the model can't read direction off the order
const pairs = sample.map(([a, b]) => (rand() < 0.5 ? [a, b] : [b, a]));

// the intake's step-2 instruction, verbatim from src/loretile/chat.cljs
const INSTRUCTION = `Ты помощник куратора базы знаний. Для КАЖДОЙ пары тем ниже определи связь,
опираясь на цитаты и подсказки движка (порядок упоминания, термин в определении):
requires — from нельзя понять без to (подсказка предлагает направление; если оно
неверно — поменяй местами); is-confused-with — темы путают; none — связи нет.
Отвечай ТОЛЬКО валидным JSON без markdown:
{"edges":[{"from":"slug","to":"slug","type":"requires|is-confused-with","why":"одна строка"}]}
Пары с type none не включай.`;

const slug = (id) => 't' + id;
const block = (batch) => 'Пары тем (' + batch.length + '):\n' + batch.map(([a, b]) =>
  `- ${slug(a)} («${topics[a]}»)\n  ${slug(b)} («${topics[b]}»)\n  подсказка: нет`).join('\n');

async function judge(batch) {
  const r = await fetch(LLM_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + LLM_KEY },
    body: JSON.stringify({ model: LLM_MODEL, messages: [
      { role: 'system', content: INSTRUCTION + '\n\n' + block(batch) },
      { role: 'user', content: 'Оцени каждую пару.' }] }),
  });
  if (!r.ok) throw new Error('LLM ' + r.status + ' ' + (await r.text()).slice(0, 200));
  const j = await r.json();
  const raw = j.choices[0].message.content.replace(/^```(json)?/, '').replace(/```\s*$/, '');
  return JSON.parse(raw).edges || [];
}

(async () => {
  const model = new Map(); // "a>b" -> true (requires only)
  for (let i = 0; i < pairs.length; i += BATCH) {
    const batch = pairs.slice(i, i + BATCH);
    const edges = await judge(batch);
    for (const e of edges) {
      if ((e.type || 'requires') !== 'requires') continue;
      const a = String(e.from).replace(/^t/, ''), b = String(e.to).replace(/^t/, '');
      model.set(a + '>' + b, true);
    }
    process.stdout.write('.');
  }
  console.log();
  let tp = 0, fp = 0, fn = 0, rev = 0;
  for (const [a, b] of sample) {
    const t_ab = truth.has(a + '>' + b), t_ba = truth.has(b + '>' + a);
    const m_ab = model.has(a + '>' + b), m_ba = model.has(b + '>' + a);
    if (t_ab && m_ab) tp++; else if (t_ab && m_ba) { rev++; fn++; fp++; } else if (t_ab) fn++;
    else if (m_ab || m_ba) fp++;
  }
  const prec = tp / Math.max(1, tp + fp), rec = tp / Math.max(1, tp + fn);
  console.log(`model=${LLM_MODEL} pairs=${N} (${N / 2} true prerequisites, ${N / 2} unrelated)`);
  console.log(`precision=${prec.toFixed(2)} recall=${rec.toFixed(2)} reversals=${rev} (true edges judged backwards)`);
  console.log(`tp=${tp} fp=${fp} fn=${fn}`);
})().catch((e) => { console.error('BENCH FAILED', e.message); process.exit(1); });
