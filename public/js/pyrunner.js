// Python for exercises (wiki/Exercises.md). Pyodide lives in a WORKER so a
// learner's endless loop is stopped by terminating it, never by freezing
// the tab. Every execution gets a FRESH namespace: what a Run defined can
// never make a later Answer pass. Served from js/ next to js/pyodide/.
//
// Everything a run calls is captured HERE, at boot, before any learner code
// exists, inside a private namespace the learner's globals never see: every
// part is COMPILED before the first one runs and executed through builtins
// held by reference — `__main__.eval_code = …` silenced the hidden checks
// when the runner looked its executor up by name (review 2026-10-02).
// Hidden checks are rewritten (also before the learner's code runs) so that
// every compared value and every assert test must be a PLAIN value by exact
// type: builtin == on int/str/list/… cannot be patched, an object whose
// __eq__ always says True can (review 2026-10-02). The checker reaches the
// checks as a function ARGUMENT, handed over after the learner's code ran.
// ponytail: one interpreter cannot isolate a determined attacker — gc, frame
// and closure introspection, settrace, ctypes or `import js` still reach
// these references; names a check calls (sorted, len…) can be shadowed; and
// the browser is the learner's anyway: devtools can forge an attempt
// outright. Proctored verdicts need a server, which certificates will require.
import { loadPyodide } from './pyodide/pyodide.mjs';

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

const post = self.postMessage.bind(self);   // held before a learner can patch it via `import js`

const HELPER = `
def _lt_make():
    import io, sys, ast, traceback
    compile_, exec_, eval_, type_, repr_, str_ = compile, exec, eval, type, repr, str
    getvalue, StringIO, fmt = io.StringIO.getvalue, io.StringIO, traceback.format_exception_only
    pop, items = dict.pop, dict.items
    Expr, Expression, Call, Name, Load, Not = ast.Expr, ast.Expression, ast.Call, ast.Name, ast.Load, ast.Not
    copy_location, fix = ast.copy_location, ast.fix_missing_locations
    ONLY_AST, CHECK = ast.PyCF_ONLY_AST, "_lt_plain"
    SCALARS = (int, float, complex, str, bytes, bool, type(None))
    SEQS = (list, tuple, set, frozenset)

    def plain(x):
        # identity, never ==: a metaclass can answer == for a type too
        t = type_(x)
        for p in SCALARS:
            if t is p:
                return x
        if t is dict:
            for k, v in items(x):
                plain(k); plain(v)
            return x
        for p in SEQS:
            if t is p:
                for v in x:
                    plain(v)
                return x
        raise AssertionError("the checked value is not a plain value (int, float, complex, str, bytes, bool, None, list, tuple, dict, set, frozenset)")

    def wrap(node):
        return copy_location(Call(func=Name(id=CHECK, ctx=Load()), args=[node], keywords=[]), node)

    class Plain(ast.NodeTransformer):
        def visit_Compare(self, n):
            self.generic_visit(n)
            n.left = wrap(n.left)
            n.comparators = [wrap(c) for c in n.comparators]
            return n
        def visit_Assert(self, n):
            self.generic_visit(n)
            n.test = wrap(n.test)
            return n
        def visit_BoolOp(self, n):          # and/or ask the operand's own __bool__
            self.generic_visit(n)
            n.values = [wrap(v) for v in n.values]
            return n
        def visit_UnaryOp(self, n):
            self.generic_visit(n)
            if type_(n.op) is Not:
                n.operand = wrap(n.operand)
            return n

    def prep(src, name="<exec>"):
        tree = compile_(src, name, "exec", ONLY_AST, dont_inherit=True)
        last = None
        if tree.body and type_(tree.body[-1]) is Expr:
            last = compile_(Expression(tree.body.pop().value), name, "eval", dont_inherit=True)
        return compile_(tree, name, "exec", dont_inherit=True), last

    def prep_test(src):
        # the checks become the body of a function whose argument is the checker
        fn = compile_("def _lt_test(" + CHECK + "):\\n    pass\\n", "<test>", "exec", ONLY_AST, dont_inherit=True)
        body = Plain().visit(compile_(src, "<test>", "exec", ONLY_AST, dont_inherit=True)).body
        if body:
            fn.body[0].body = body
        return compile_(fix(fn), "<test>", "exec", dont_inherit=True)

    def run(parts, test):
        ns = {"__name__": "__main__"}
        buf = StringIO()
        so, se = sys.stdout, sys.stderr
        sys.stdout = sys.stderr = buf
        result = None
        try:
            codes = [prep(s) for s in parts if s and s.strip()]
            check = prep_test(test) if test and test.strip() else None
            for body, last in codes:
                exec_(body, ns)
                result = None if last is None else eval_(last, ns)
            if check is not None:
                exec_(check, ns)
                pop(ns, "_lt_test")(plain)
            return (getvalue(buf), None if result is None else repr_(result), None)
        except BaseException as e:
            try:
                msg = "".join(fmt(type_(e), e)).strip()
            except BaseException:
                msg = ""
            return (getvalue(buf), None, msg if type_(msg) is str_ and msg else "Error")
        finally:
            sys.stdout, sys.stderr = so, se

    return run

_lt_make()
`;

const boot = (async () => {
  const py = await loadPyodide({ indexURL: new URL('./pyodide/', import.meta.url).href });
  py.setStdin({ error: true });            // input() raises instead of waiting forever
  return py.runPython(HELPER, { globals: py.globals.get('dict')() });
})();

boot.then(() => post({ ready: true }),
          (e) => post({ bootError: String((e && e.message) || e) }));

self.onmessage = async (e) => {
  const { id, parts, test } = e.data;
  try {
    const run = await boot;
    const r = run(parts, test);
    const [stdout, result, error] = r.toJs();
    r.destroy();
    post({ id, stdout, result, error });
  } catch (err) {
    post({ id, stdout: '', result: null, error: String((err && err.message) || err) });
  }
};
