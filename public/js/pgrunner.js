// SQL for exercises (wiki/Exercises.md). PGlite lives in a WORKER: it runs
// on the thread that calls it and ignores statement_timeout, so a looping
// query used to freeze the tab (review 2026-10-02). Here the page terminates
// the worker instead. ONE database per distinct setup (the newest three
// kept), ONE transaction per execution, always rolled back.
// Served from js/ next to js/pglite/.
import { PGlite } from './pglite/index.js';

const MAX_DBS = 3;   // a Postgres instance is tens of MB
const dbs = [];      // [setup, Promise<PGlite>], oldest first

// Sequences are not transactional: a rolled-back `insert … returning id`
// still moves `nextval`, so the reference got id 6 and the identical answer
// id 7 — graded wrong (review 2026-10-16). Their state after the setup is
// kept and put back after every execution.
const seqsOf = async (db) => {
  const names = (await db.query("select c.oid::regclass::text as name from pg_class c where c.relkind = 'S'")).rows.map((r) => r.name);
  const out = [];
  for (const n of names) {
    const r = (await db.query(`select last_value, is_called from ${n}`)).rows[0];
    out.push([n, r.last_value, r.is_called]);
  }
  return out;
};

const dbFor = (setup) => {
  const hit = dbs.find(([s]) => s === setup);
  if (hit) return hit[1];
  const d = PGlite.create().then(async (db) => { await db.exec(setup); db.seqs = await seqsOf(db); return db; });
  // a setup that fails is not cached: the next attempt builds afresh
  d.catch(() => { const i = dbs.findIndex(([, x]) => x === d); if (i >= 0) dbs.splice(i, 1); });
  dbs.push([setup, d]);
  if (dbs.length > MAX_DBS) dbs.shift()[1].then((db) => db.close(), () => {});
  return d;
};

const msg = (e) => String((e && e.message) || e);

// Security review 2026-10-03: a worker shares its page origin, so it could
// read the app’s origin-private file system — the uploaded documents — and
// send them out (proved). Before any learner or model code runs, take away
// the only sensitive thing it can reach (OPFS/IndexedDB/Cache) and the ways
// to escape this lockdown (a nested unlocked worker, a service worker).
// fetch stays: the engines load with it, and with storage gone there is
// nothing secret left to send. ponytail: a same-origin worker cannot be
// fully walled from inside; the strong wall is a separate execution origin,
// which needs its own host (noted for Denis).
(function lockdown() {
  const gone = { get() { return undefined; }, configurable: false };
  const lock = (obj, key) => {
    for (let o = obj; o; o = Object.getPrototypeOf(o)) {
      if (Object.getOwnPropertyDescriptor(o, key)) { try { Object.defineProperty(o, key, gone); } catch (e) {} return; }
    }
    try { Object.defineProperty(obj, key, { value: undefined, configurable: false }); } catch (e) {}
  };
  lock(navigator, "storage"); lock(navigator, "serviceWorker");
  for (const k of ["indexedDB", "caches", "Worker", "SharedWorker"]) lock(self, k);
})();

self.postMessage({ ready: true });

self.onmessage = async ({ data: { id, setup, sql } }) => {
  let db;
  try { db = await dbFor(setup); } catch (e) { self.postMessage({ id, setupError: msg(e) }); return; }
  self.postMessage({ id, started: true });   // the page's 10 s count starts now, not through the boot
  await db.exec('begin');
  try {
    const r = await db.query(sql, [], { rowMode: 'array' });
    self.postMessage({ id, columns: r.fields.map((f) => f.name), rows: r.rows });
  } catch (e) {
    self.postMessage({ id, error: msg(e) });
  } finally {
    await db.exec('rollback');
    for (const [n, v, called] of db.seqs || []) await db.query('select setval($1::regclass, $2, $3)', [n, v, called]);
  }
};
