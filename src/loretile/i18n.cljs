(ns loretile.i18n
  "UI strings, kintale shape: ru first (the product's voice), de/en
   secondary. One dictionary, split across two files so the editor and
   the chat can be translated side by side: i18n_ui.cljs (:ui/…) and
   i18n_chat.cljs (:chat/…). The current locale is a reagent atom, so
   every `(t …)` in a render re-runs when it changes — no reload.
   Persisted under `loretile-locale`, the key the landing uses too, so
   one choice follows the visitor across both pages."
  (:require [clojure.string :as str]
            [reagent.core :as r]
            [loretile.i18n-ui :as ui]
            [loretile.i18n-chat :as chat]))

(def locales [:ru :de :en])

(def dict (merge ui/strings chat/strings))

(def ^:private storage-key "loretile-locale")

(defn- pick []
  (let [saved (keyword (or (.getItem js/localStorage storage-key) ""))]
    (or (some #{saved} locales)
        (some (fn [l] (some #{(keyword (str/lower-case (subs (str l) 0 2)))} locales))
              (or (seq (.-languages js/navigator)) [(.-language js/navigator)]))
        :en)))

(defonce locale (r/atom (pick)))

(defn set-locale! [l]
  (reset! locale l)
  (.setItem js/localStorage storage-key (name l))
  (set! (.-lang js/document.documentElement) (name l)))

(defn t
  "Look up k for the current locale, falling back to :en, then to (str k)
   — a missing key shows up on screen, never crashes. Optional replacements
   {\"{n}\" 3} are substituted into the resolved string."
  [k & [replacements]]
  (let [entry (get dict k)
        s (or (get entry @locale) (get entry :en) (str k))]
    (if (seq replacements)
      (reduce (fn [acc [from to]] (str/replace acc from (str to))) s replacements)
      s)))

(defn lang-name
  "A content language code (\"ru\", \"fr\" …) named in the interface
   language, by the browser's own Intl.DisplayNames; the code itself when
   the browser cannot name it."
  [code]
  (let [c (str code)]
    (try (or (.of (js/Intl.DisplayNames. #js [(name @locale)] #js {:type "language"}) c) c)
         (catch :default _ c))))

(defn enum-label
  "Label for a closed-vocabulary keyword: (enum-label \"okind\" :diagram)
   → (t :ui/okind-diagram). Falls back to the bare name for unknowns."
  [prefix k]
  (let [key (keyword "ui" (str prefix "-" (name k)))]
    (if (contains? dict key) (t key) (name k))))

(defn plural
  "Russian has three forms picked by the last digit (teens excepted);
   de/en have two. `forms` = [one few many]."
  [n [one few many]]
  (if (= :ru @locale)
    (let [n (js/Math.abs n) d (mod n 10) h (mod n 100)]
      (cond (and (= d 1) (not= h 11)) one
            (and (<= 2 d 4) (not (<= 12 h 14))) few
            :else (or many few)))
    (if (= n 1) one (or few many))))

(defn tn
  "t for a counted thing: `ks` = [one few many] keys; {n} substituted."
  [n ks & [replacements]]
  (t (plural n ks) (merge {"{n}" (str n)} replacements)))
