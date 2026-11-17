(ns loretile.core
  (:require [reagent.dom.client :as rdc]
            [loretile.i18n :as i18n]
            [loretile.chat :as chat]
            [loretile.merge :as mrg]
            [loretile.store :as store]
            [loretile.tool-defs]                ; registers the assistant's read tools
            [loretile.ui :as ui]
            [loretile.vectors :as vectors]))

(defonce root (atom nil))

(defn ^:export init []
  ;; clickjacking (security review 2026-10-03): frame-ancestors can't be set in
  ;; a meta tag and this host sends no headers, so refuse to run framed — a
  ;; hostile page can't trick taps on «Принять» or delete through an iframe
  (if-not (identical? js/window.top js/window.self)
    (set! (.. js/document -body -textContent) "Loretile cannot run inside a frame.")
    (do
  (store/load!)
  (vectors/load!)
  (chat/restore!)
  (mrg/refresh!)                    ; merge files waiting for the open graph
  (ui/apply-theme!)
  (store/watch-other-tabs!)
  (set! (.-lang js/document.documentElement) (name @i18n/locale))
  (ui/read-route!)
  (js/window.addEventListener "hashchange" ui/read-route!)
  (ui/global-keys!)
  (reset! root (rdc/create-root (js/document.getElementById "app")))
  (rdc/render @root [ui/app]))))
