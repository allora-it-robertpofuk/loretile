(ns loretile.session
  "The assistant's conversations, kept across reloads (kintale.session,
   Denis 2026-09-08: «adopt sessions from kintale»). The whole sitting is
   kept — bubbles, open cards, the pending attachment — because a curator
   who comes back to cards without the talk has lost the thread.

   Plain localStorage, no vault: org knowledge, not family secrets
   (wiki/Architecture.md — no E2E here). Per DEVICE, never synced: a
   conversation is a workbench, the event log is what is shared.

   BOUNDED: the visible history and the shelf of past sittings are
   capped; an attachment's text (up to 100k chars) is dropped when a
   sitting is shelved — it only mattered until it was sent."
  (:require [cljs.reader :as reader]
            [clojure.string :as str]
            [loretile.store :as store]))

(def ^:private storage-key "loretile-sessions")
(def ^:private max-msgs 80)
(def ^:private max-archived 30)

(def ^:private unreadable-key "loretile-sessions-unreadable")

(defn- mend
  "A browser object printed into a sitting (#object[File [object File]] —
   an attachment's File, before 2026-10-16) cannot be read back; it reads
   as nil instead, so the rest of the sittings survive."
  [s]
  (str/replace s #"#object\[[^\[\]]*(?:\[[^\[\]]*\][^\[\]]*)*\]" "nil"))

(defn load!
  "{:current {...} :archived [{...} ...]} or nil. Never throws. A store
   that cannot be read even mended is copied aside once
   (`loretile-sessions-unreadable`) before anything writes over it."
  []
  (when-let [raw (.getItem js/localStorage storage-key)]
    (try (reader/read-string raw)
         (catch :default _
           ;; mended only when the plain read fails: a sitting's own text may
           ;; quote «#object[» and must stay as written
           (try (reader/read-string (mend raw))
                (catch :default _
                  (when-not (.getItem js/localStorage unreadable-key)
                    (store/write! unreadable-key raw))
                  nil))))))

(defn- put!
  "Reports a refused write in the app's error banner, like every graph
   write — a sitting full of cards must not vanish in silence."
  [all]
  (store/write! storage-key (pr-str all)))

(defn title-of
  "What a past sitting is CALLED: the author's own first words."
  [s]
  (or (some->> (:msgs s) (filter #(= :user (:who %))) first :text str/trim not-empty
               (#(if (> (count %) 60) (str (subs % 0 60) "…") %)))
      "—"))

(defn save-current! [state]
  (put! (assoc (or (load!) {})
               :current (assoc (update state :msgs #(vec (take-last max-msgs %)))
                               :at (or (:at (:current (load!))) (.toISOString (js/Date.)))))))

(defn archive-current!
  "«New conversation»: the sitting joins the shelf; nothing is deleted."
  []
  (let [all (load!) cur (:current all)]
    (put! {:current nil
           :archived (vec (take-last max-archived
                                     (cond-> (vec (:archived all))
                                       (seq (:msgs cur))
                                       (conj (-> cur (dissoc :doc) (assoc :title (title-of cur)))))))})))

(defn open-archived!
  "Bring a shelved sitting back as the current one, shelving whatever is
   open first. Returns the sitting, or nil."
  [at]
  (archive-current!)
  (let [all (load!)
        pick (first (filter #(= at (:at %)) (:archived all)))]
    (when pick
      (put! {:current pick :archived (vec (remove #(= at (:at %)) (:archived all)))})
      pick)))

(defn find-archived
  "The newest shelved sitting matching `pred`, or nil."
  [pred]
  (last (filter pred (:archived (load!)))))

(defn past
  "Every sitting reachable from the palette, the open one included and
   marked, newest last."
  []
  (let [all (load!) cur (:current all)]
    (cond-> (mapv #(select-keys % [:at :title]) (:archived all))
      (seq (:msgs cur)) (conj {:at (:at cur) :title (title-of cur) :current? true}))))
