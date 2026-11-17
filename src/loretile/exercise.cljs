(ns loretile.exercise
  "Items whose answer is EXECUTED (wiki/Exercises.md) — for any subject that
   has code in it, not one language. An exercise names its RUNTIME and its
   CHECK; the card, the attempt log and the author's gate are the same for
   every pair.

   Runtimes (kernel-shaped: execute code, get output or an error):
   - :pglite — real Postgres in WebAssembly, lazy-loaded from js/pglite/.
     ONE database per setup, ONE transaction per execution, rolled back.
   - :python — Pyodide in a worker (js/pyrunner.js + js/pyodide/), a FRESH
     namespace per execution, a timeout that terminates the worker.
   Further languages slot in here; R, C++ and the other xeus kernels need
   their environments built first (wiki «browser kernels»).

   Checks — deterministic and ours, never the engine's:
   - :rows   (SQL) the learner's rows = the solution's rows
   - :output the learner's printed output (+ last value) = the solution's
   - :assert hidden checks run after the learner's code; passing = no error
   Absent fields mean the first exercises' shape: :pglite with :rows."
  (:require [clojure.string :as str]
            [promesa.core :as p]
            [loretile.i18n :refer [t]]))

(defn- asset-url [rel]
  ;; document-relative: the app lives at /app/ live and at / in dev
  (.-href (js/URL. rel (.-baseURI js/document))))

(defn runtime [spec] (or (:runtime spec) :pglite))

(defn check-kind [spec]
  (or (:check spec) (if (= :pglite (runtime spec)) :rows :output)))

(defn graph-setup
  "The setup this graph's exercises in runtime `rt` already use — preferring
   the topic's own — so a course keeps one seed and its engine boots once."
  ([kg rt] (graph-setup kg rt nil))
  ([kg rt concept-id]
   (let [exs (filter #(and (= :exercise (:kind %)) (= rt (runtime (:spec %)))) (vals (:items kg)))]
     (get-in (or (first (filter #(= concept-id (:primary-concept-id %)) exs)) (first exs)) [:spec :setup] ""))))

(defn graph-runtime
  "The runtime a graph's exercises already use; Python for a graph without any."
  [kg]
  (or (some #(when (= :exercise (:kind %)) (runtime (:spec %))) (vals (:items kg))) :python))

(defn error-text
  "The gate speaks in its own terms: which part failed, and the runtime's
   own words for why."
  [{:keys [error message]}]
  (case error
    :setup (str (t :ui/exercise-setup-failed) message)
    :solution (str (t :ui/exercise-solution-failed) message)
    :empty (t :ui/exercise-empty)
    :no-output (t :ui/exercise-no-output)
    :vacuous (t :ui/exercise-vacuous)
    :empty-passes (t :ui/exercise-empty-passes)
    :accepts-wrong (str (t :ui/exercise-accepts-wrong) message)
    :engine (str (t :learn/ex-engine-failed) message)
    (str message)))

(defn prose-error? [{:keys [error]}] (contains? #{:empty :no-output :vacuous :empty-passes} error))

;; Executions on one engine must not interleave: a second Run while the
;; first is inside its transaction would share it. One queue PER RUNTIME, so
;; a Python that never boots cannot hold up a SQL exercise.
(defonce ^:private queues (atom {}))

(defn- serially [rt f]
  (let [next (p/handle (get @queues rt (p/resolved nil)) (fn [_ _] (f)))]
    (swap! queues assoc rt next)
    next))

;; --- workers --------------------------------------------------------------------
;; Both runtimes live in WORKERS (js/pyrunner.js, js/pgrunner.js), so a
;; learner's endless loop is stopped by terminating one — never by freezing
;; the tab.

(def ^:private run-ms
  ;; counted from READY (SQL: from the setup being built), never through a
  ;; boot — a slow tablet's boot is not a loop
  10000)

(def ^:private boot-ms
  ;; a worker that neither boots nor fails in this long has failed
  60000)

(defn- drop! [a st] (swap! a #(if (identical? % st) nil %)))

(defn- spawn-worker
  "{:worker :pending :ready :dead}. `ready` REJECTS on a load error or after
   boot-ms (ex-data {:engine true}), so nothing waits forever on a worker
   that never came up; `on-fail` gets this state."
  [path on-fail]
  (let [w (js/Worker. (asset-url path) #js {:type "module"})
        pending (atom {})
        ready (p/deferred)
        st {:worker w :pending pending :ready ready :dead (atom false)}
        fail! (fn [why]
                (when (p/pending? ready)
                  (.terminate w)
                  (on-fail st)
                  (p/reject! ready (ex-info (str why) {:engine true}))))
        timer (js/setTimeout #(fail! "timeout") boot-ms)]
    (p/catch ready (fn [_] nil))          ; a spare nobody took fails quietly
    (set! (.-onerror w) (fn [^js e] (.preventDefault e) (fail! (or (.-message e) path))))
    (set! (.-onmessage w)
          (fn [^js e]
            (let [d (.-data e)]
              (cond
                (.-ready d) (do (js/clearTimeout timer) (p/resolve! ready true))
                (.-bootError d) (fail! (.-bootError d))
                :else (when-let [f (get @pending (.-id d))] (f d))))))
    st))

(defn- exec-on!
  "The worker's raw reply to `msg`, or :timeout. A run past its time
   terminates the worker (`on-kill`). The clock is `first-ms` until the
   worker says `started`, then run-ms."
  [{:keys [^js worker pending ready dead]} msg first-ms on-kill]
  ;; a worker killed by a timeout answers nothing again: fail at once rather
  ;; than wait out a second timeout on a dead worker
  (if @dead
    (p/resolved :timeout)
    (p/then ready
            (fn [_]
              (p/create
               (fn [resolve _]
                 (let [id (str (random-uuid))
                       timer (atom nil)
                       arm! (fn [ms]
                              (js/clearTimeout @timer)
                              (reset! timer (js/setTimeout
                                             (fn [] (when (contains? @pending id)
                                                      (swap! pending dissoc id)
                                                      (.terminate worker) (reset! dead true) (on-kill)
                                                      (resolve :timeout)))
                                             ms)))]
                   (arm! first-ms)
                   (swap! pending assoc id (fn [^js d]
                                             (if (.-started d)
                                               (arm! run-ms)
                                               (do (js/clearTimeout @timer)
                                                   (swap! pending dissoc id)
                                                   (resolve d)))))
                   (.postMessage worker (clj->js (assoc msg :id id))))))))))

;; --- :pglite ------------------------------------------------------------------

(defonce ^:private pg (atom nil))   ; the SQL worker, rebuilt lazily after a kill

(defn- pg-worker []
  (or @pg (reset! pg (spawn-worker "js/pgrunner.js" #(drop! pg %)))))

(def ^:private tx-control
  ;; the learner may not end the transaction the attempt runs in — a COMMIT
  ;; would make their changes outlive the attempt
  #"(?i)^\s*(begin|commit|rollback|end|abort|start|savepoint|release|set\s+transaction|prepare\s+transaction)\b")

(defn- skip-comments
  "`sql` after its leading comments — `/**/ commit` is a commit. Postgres
   nests /* */, hence the depth count."
  [sql]
  (let [s (str/triml sql)]
    (cond
      (str/starts-with? s "--") (if-let [n (str/index-of s "\n")] (recur (subs s (inc n))) "")
      (str/starts-with? s "/*") (loop [i 2 depth 1]
                                  (cond
                                    (zero? depth) (skip-comments (subs s i))
                                    (>= i (count s)) ""
                                    (= "/*" (subs s i (+ i 2))) (recur (+ i 2) (inc depth))
                                    (= "*/" (subs s i (+ i 2))) (recur (+ i 2) (dec depth))
                                    :else (recur (inc i) depth)))
      :else s)))

(defn- sql-exec!
  "{:columns [..] :rows [[..] ..]} or {:error msg}. One statement only
   (PGlite's query uses the extended protocol, which refuses several), inside
   a transaction that is always rolled back. Rejects when the SETUP fails."
  [setup sql]
  (if (re-find tx-control (skip-comments sql))
    (p/resolved {:error :tx-control})
    (serially :pglite
     (fn []
       (let [st (pg-worker)]
         ;; before `started` the worker builds the setup's database: boot time
         (p/let [^js d (exec-on! st {:setup setup :sql sql} boot-ms #(drop! pg st))]
           (cond
             (= :timeout d) {:error :timeout}
             (.-setupError d) (throw (js/Error. (.-setupError d)))
             (.-error d) {:error (.-error d)}
             :else {:columns (vec (.-columns d)) :rows (mapv vec (.-rows d))})))))))

(def ^:private tables-sql
  "The learner's table list, read from Postgres rather than typed by hand."
  "select table_name, string_agg(column_name, ', ' order by ordinal_position)
   from information_schema.columns where table_schema = 'public'
   group by table_name order by table_name")

;; --- :python --------------------------------------------------------------------
;; Two kinds of worker. The SHARED one serves Run and the scratchpad: warm,
;; but whatever a learner's code did to `builtins` or `sys.modules` lives on
;; in it (fresh globals are not a fresh interpreter). Every GRADED run gets
;; CLEAN workers of its own, thrown away afterwards — proved necessary
;; 2026-10-02: a Run patching `builtins` made an empty Answer pass.

(defonce ^:private py (atom nil))       ; the shared worker
(defonce ^:private spares (atom []))    ; clean workers booting ahead of the next verdict

(def ^:private n-spares
  ;; ponytail: each spare is one more Python in memory (tens of MB); two
  ;; because an :output verdict takes two (reference and answer apart) —
  ;; drop to one if tablets run short
  2)

(defn- py-worker []
  (or @py (reset! py (spawn-worker "js/pyrunner.js" #(drop! py %)))))

(defn- py-run!
  "{:stdout :result :error} — `parts` in order in one fresh namespace of
   worker `st`, then the hidden checks `test` (rewritten by the worker)."
  [st parts test on-kill]
  (p/let [^js d (exec-on! st {:parts (vec parts) :test test} run-ms on-kill)]
    (if (= :timeout d)
      {:error :timeout}
      {:stdout (or (.-stdout d) "") :result (.-result d) :error (.-error d)})))

(defn- unspare! [st] (swap! spares (fn [v] (filterv #(not (identical? % st)) v))))

(defn- boot-spares! []
  ;; a spare that fails removes ITSELF only: one already taken is not in the
  ;; list, so its late error cannot orphan the spare that replaced it
  (dotimes [_ (- n-spares (count @spares))]
    (swap! spares conj (spawn-worker "js/pyrunner.js" unspare!))))

(defn- clean-worker!
  "A worker for exactly ONE party of a verdict: a spare if one is booting
   (the boot is then hidden behind reading time); replacements start at once."
  []
  (let [st (or (first @spares) (spawn-worker "js/pyrunner.js" (fn [_])))]
    (unspare! st)
    (boot-spares!)
    st))

(defn- py-exec! [parts]
  (serially :python #(let [st (py-worker)] (py-run! st parts nil (fn [] (drop! py st))))))

;; --- the shared surface -----------------------------------------------------------

(defn- exec!
  "Run `code` after the exercise's setup, in its runtime (shared engine)."
  [spec code]
  (case (runtime spec)
    :pglite (sql-exec! (:setup spec) code)
    :python (py-exec! [(:setup spec) code])))

(defn- judged
  "Run `f` for a VERDICT. `f` gets `fresh`; each call returns a `run` fn
   `(run code)` / `(run code test)` on an engine of its own. For Python that
   is a CLEAN worker, discarded after the verdict: callers take one per
   party, trusted code first, the learner's last, and a reference never
   shares a worker with an answer — `gc.get_objects()` found the reference's
   namespace (review 2026-10-02). Postgres needs nothing: every execution is
   a rolled-back transaction."
  [spec f]
  (if (= :python (runtime spec))
    (serially :python
     (fn []
       (let [taken (atom [])
             fresh (fn []
                     (let [st (clean-worker!)]
                       (swap! taken conj st)
                       (fn [code & [test]] (py-run! st [(:setup spec) code] test (fn [])))))]
         (-> (p/do (f fresh))
             (p/finally (fn [] (doseq [st @taken] (.terminate ^js (:worker st)))))))))
    (f (constantly (fn [code & _] (exec! spec code))))))

(defn warm!
  "Start the engine before the learner needs it — the boot is seconds on a
   tablet, the material takes longer to read than that."
  [spec]
  (-> (case (runtime spec)
        :pglite (sql-exec! (:setup spec) "select 1")
        :python (do (boot-spares!) (:ready (py-worker))))
      (p/catch (fn [_] nil))))

(defn try-run!
  "The exercise's own Run button: the learner sees what their code produces.
   Not graded, not logged — allowed in every mode, by design. Shared engine."
  [spec code]
  (exec! spec code))

(defn- cell [v] (if (nil? v) "∅" (str v)))

(defn- norm-rows
  "Values only — column names are the learner's to choose. Unordered unless
   the task asks for an order."
  [rows ordered?]
  (let [rs (mapv #(mapv cell %) rows)]
    (if ordered? rs (vec (sort rs)))))

(defn output-text
  "What a run showed: printed output, then the last expression's value —
   `print(13.0)` and a bare `13.0` count the same. Trailing spaces ignored."
  [{:keys [stdout result]}]
  (->> (str/split-lines (str stdout (when result (str "\n" result))))
       (map str/trimr)
       (remove str/blank?)
       (str/join "\n")))

(defn grade!
  "{:correct? bool :result what-the-learner's-code-showed}. A learner error is
   a wrong answer, never a crash; a broken REFERENCE rejects, and the card
   says so instead of recording a verdict nobody earned. Hidden checks never
   reach the screen: the learner sees their own code's run. Runs in a clean
   engine, the reference before the learner's code."
  [spec code]
  ;; only the pairs the engines can judge: an imported spec with :pglite +
  ;; :output compared "" with "" and passed any answer (review 2026-10-16)
  (if-not (#{[:pglite :rows] [:python :output] [:python :assert]} [(runtime spec) (check-kind spec)])
    (p/rejected (ex-info (str "unsupported exercise: " (name (runtime spec)) " + " (name (check-kind spec))) {}))
  (judged spec
   (fn [fresh]
     (case (check-kind spec)
       :rows (p/let [run (fresh)
                     want (run (:solution spec))
                     got (run code)]
               (when (:error want) (throw (ex-info (str "reference solution failed: " (:error want)) {})))
               {:correct? (and (not (:error got))
                               (= (norm-rows (:rows want) (:ordered? spec)) (norm-rows (:rows got) (:ordered? spec))))
                :result got})
       ;; two workers: the answer cannot reach the reference's memory
       :output (p/let [ref (fresh)
                       mine (fresh)
                       want (ref (:solution spec))
                       got (mine code)]
                 (when (:error want) (throw (ex-info (str "reference solution failed: " (:error want)) {})))
                 {:correct? (and (not (:error got)) (= (output-text want) (output-text got)))
                  :result got})
       ;; the deciding run goes first, in the untouched engine; the display run after
       :assert (p/let [run (fresh)
                       verdict (run code (:test spec))
                       ;; a verdict that timed out killed its worker: show that, not a second wait
                       shown (if (= :timeout (:error verdict)) verdict (run code))]
                 {:correct? (and (not (:error shown)) (not (:error verdict)))
                  :result shown}))))))

(defn- msg [e] (if (keyword? e) (name e) (str e)))

(defn check-solution!
  "The AUTHOR's gate, before an exercise is saved — the runtime is the judge.
   The setup must run; the reference solution must pass its own check; and
   the check must be able to FAIL: an empty expected result, an empty
   expected output, an output an EMPTY answer already produces (the setup
   prints it), or hidden checks that pass with no answer at all would accept
   anything. Resolves {:schema? …} or
   {:error :setup|:solution|:empty|:no-output|:empty-passes|:vacuous :message}."
  [spec]
  (-> (judged spec
       (fn [fresh]
         (let [run (fresh)]
         (case (check-kind spec)
           :rows (p/let [want (run (:solution spec))
                         tables (run tables-sql)]
                   (cond
                     (:error want) {:error :solution :message (msg (:error want))}
                     (empty? (:rows want)) {:error :empty}
                     :else {:schema (str/join "\n" (map (fn [[t cols]] (str t "(" cols ")")) (:rows tables)))}))
           :output (p/let [bare (run "")
                           want (run (:solution spec))]
                     (cond
                       (:error bare) {:error :setup :message (msg (:error bare))}
                       (:error want) {:error :solution :message (msg (:error want))}
                       (str/blank? (output-text want)) {:error :no-output}
                       (= (output-text bare) (output-text want)) {:error :empty-passes}
                       :else {}))
           :assert (p/let [bare (run "")
                           passes (run (:solution spec) (:test spec))
                           vacuous (run "" (:test spec))]
                     (cond
                       (:error bare) {:error :setup :message (msg (:error bare))}
                       (:error passes) {:error :solution :message (msg (:error passes))}
                       (not (:error vacuous)) {:error :vacuous}
                       :else {}))))))
      ;; a runtime that never started rejects with {:engine true}; a SQL
      ;; setup that does not build rejects too
      (p/catch (fn [e] {:error (if (:engine (ex-data e)) :engine :setup) :message (ex-message e)}))))
