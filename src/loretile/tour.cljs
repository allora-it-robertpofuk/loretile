(ns loretile.tour
  "First-time walkthroughs on driver.js (kintale.tour verbatim in shape):
   the MAP tour (controls + the legend — what colours and glyphs mean),
   the CHAT tour (fires with the first proposal cards), and the LEARN tour
   (fires on the first learning session — where the tutor lives, what is
   locked). Selectors are stable CSS classes, never localized titles.
   Flags are set the moment a tour STARTS — an abandoned tour counts as
   seen. Never throws: onboarding is a nice-to-have, not load-bearing."
  (:require ["driver.js" :refer [driver]]
            [loretile.i18n :refer [t]]))

(defn- drive! [steps]
  (try
    (.drive (driver #js {:showProgress true
                         :allowClose true
                         :overlayClickBehavior "close"
                         :nextBtnText (t :tour/next)
                         :prevBtnText (t :tour/prev)
                         :doneBtnText (t :tour/done)
                         ;; driver.js's default is English «1 of 13» in every language
                         :progressText (t :tour/progress)
                         :skipMissingElement true
                         :steps (clj->js steps)}))
    (catch :default e (js/console.error "tour failed:" e))))

(defn- pop* [el title desc] {:element el :popover {:title (t title) :description (t desc)}})

(defn start-map-tour! []
  (drive!
   [(pop* "svg.graph" :tour/map-t :tour/map)
    (pop* "svg.graph" :tour/legend-t :tour/legend)
    ;; five steps, not thirteen (UX review 2026-10-02 #7): what the map is,
    ;; what it shows, the flagship, where it leads, the two hats. The rail
    ;; tools explain themselves by tooltip when the author reaches for them
    ;; the assistant is the flagship — kintale learned to never skip it
    (pop* ".rail .nav-chat" :tour/chat-t :tour/chat)
    (pop* ".rail .nav-course" :tour/course-t :tour/course)
    (pop* ".hats" :tour/hats-t :tour/hats)]))

(defn start-chat-tour! []
  (drive!
   [(pop* ".cards" :ctour/cards-t :ctour/cards)
    (pop* ".cards .card .row" :ctour/accept-t :ctour/accept)
    (pop* ".composer" :ctour/more-t :ctour/more)]))

(defn start-learn-tour! []
  (drive!
   [(pop* ".feed" :ltour/feed-t :ltour/feed)
    (pop* ".qcard:not(.done)" :ltour/check-t :ltour/check)
    (pop* ".learn .locked" :ltour/locked-t :ltour/locked)
    (pop* ".tutor-composer" :ltour/tutor-t :ltour/tutor)
    (pop* ".learn-head .restart" :ltour/restart-t :ltour/restart)]))

;; --- first-time triggers ------------------------------------------------------

(defn- once! [flag-key start! delay-ms]
  (when-not (try (.getItem js/localStorage flag-key) (catch :default _ true))
    (try (.setItem js/localStorage flag-key "1") (catch :default _ nil))
    (js/setTimeout start! delay-ms)))

(defn maybe-map-tour! [] (once! "loretile-tour-done" start-map-tour! 1500))
(defn maybe-chat-tour! [] (once! "loretile-chat-tour-done" start-chat-tour! 600))
(defn maybe-learn-tour! [] (once! "loretile-learn-tour-done" start-learn-tour! 800))
