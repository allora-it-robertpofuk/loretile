(ns loretile.icons
  "Stroke line icons — ported verbatim from kintale (itself vintry-derived):
   24x24, currentColor, no fill. One visual language across the family.")

(def ^:private paths
  {:search ["M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z" "M21 21l-4.3-4.3"]
   :close ["M6 6l12 12" "M6 18L18 6"]
   :person ["M12 11.5a3.6 3.6 0 1 0 0-7.2 3.6 3.6 0 0 0 0 7.2z"
            "M5 20c.5-3.5 3.2-5.5 7-5.5s6.5 2 7 5.5"]
   :pin ["M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"
         "M12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z"]
   :clock ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z" "M12 8v4l3 2"]
   :notes ["M5 4h10l4 4v12H5z" "M15 4v4h4" "M8 12h8" "M8 16h6"]
   :link ["M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"
          "M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"]
   :photo ["M3 7h4l2-2.5h6L17 7h4v12H3z" "M12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z"]
   :chat ["M21 11.5a7.5 7.5 0 0 1-7.5 7.5H8l-4 3.5V11.5A7.5 7.5 0 0 1 11.5 4h2a7.5 7.5 0 0 1 7.5 7.5z"
          "M8.5 10h7" "M8.5 13.5h4.5"]
   :graph ["M12 14a2.4 2.4 0 1 0 0-4.8 2.4 2.4 0 0 0 0 4.8z"
           "M5 7a1.9 1.9 0 1 0 0-3.8A1.9 1.9 0 0 0 5 7z"
           "M19 7a1.9 1.9 0 1 0 0-3.8A1.9 1.9 0 0 0 19 7z"
           "M12 22a1.9 1.9 0 1 0 0-3.8 1.9 1.9 0 0 0 0 3.8z"
           "M10.4 10.2 6.3 6.4" "M13.6 10.2l4.1-3.8" "M12 14.1v4"]
   :rows ["M9.5 6h11" "M9.5 12h11" "M9.5 18h11"
          "M4.5 6h0.01" "M4.5 12h0.01" "M4.5 18h0.01"]
   :mic ["M12 3a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3z"
         "M6.5 11a5.5 5.5 0 0 0 11 0" "M12 16.5V20" "M9 20h6"]
   ;; A voice: the level meter every phone shows while recording,
   ;; symmetrical about a single centre bar (Denis 2026-08-02).
   ;;
   ;; FIVE bars, and the count follows from the symmetry rather than from
   ;; taste — an even number has no middle, so four can only be symmetric
   ;; as a flat-topped PAIR, which reads as a pause glyph. Five was once
   ;; rejected here for merging into a smudge at the 16px this renders
   ;; at; graduated heights, rather than a lower count, is what keeps
   ;; every bar legible.
   ;;
   ;; These are kintale.speech/rest-bars drawn at x=4,8,12,16,20 — the
   ;; static icon IS the live meter at silence, and the two must stay
   ;; identical or the button changes shape the instant recording starts.
   :voice ["M4 10.25v3.5" "M8 8.5v7" "M12 6v12" "M16 8.5v7" "M20 10.25v3.5"]
   :stop ["M7.5 7.5h9v9h-9z"]
   :camera ["M4 8h3.2l1.6-2h6.4l1.6 2H20a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"
            "M12 17a3.4 3.4 0 1 0 0-6.8 3.4 3.4 0 0 0 0 6.8z"]
   :open-ext ["M13.5 4.5H19a0.5 0.5 0 0 1 0.5 0.5v5.5" "M19 5l-8.5 8.5"
              "M19 13.5V19a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5.5"]
   :sun ["M12 7.3a4.7 4.7 0 1 0 0 9.4 4.7 4.7 0 0 0 0-9.4z"
         "M12 1.6v2.4" "M12 20v2.4" "M1.6 12h2.4" "M20 12h2.4"
         "M4.5 4.5l1.7 1.7" "M17.8 17.8l1.7 1.7"
         "M19.5 4.5l-1.7 1.7" "M6.2 17.8l-1.7 1.7"]
   :moon ["M20.5 14.8A8 8 0 0 1 9.2 3.5 7 7 0 1 0 20.5 14.8z"]
   :minus ["M6 12h12"]
   :expand ["M8 3H3v5" "M16 3h5v5" "M3 16v5h5" "M21 16v5h-5"]
   :shrink ["M8 3v5H3" "M16 3v5h5" "M8 21v-5H3" "M16 21v-5h5"]
   :back ["M15 5l-7 7 7 7"]
   :plus ["M12 5v14" "M5 12h14"]
   ;; the composer's send: an arrow, not the word «Отправить» — a full
   ;; word button ate composer width on a phone (Denis 2026-08-01)
   ;; a paper plane, tilted the way Telegram's is — the composer's send
   ;; is the one button people find without reading (Denis 2026-08-01)
   :send ["M21 3.2L3.4 10.6l7.1 2.9 2.9 7.1z" "M10.5 13.5L21 3.2"]
   ;; an action card's RUN: a plain arrow up, not the verb spelled out —
   ;; «Спросить»/«Начать»/«Искать» ate the card's width and pushed the
   ;; label it belongs to onto a second line (Denis 2026-08-02). The
   ;; word survives as the button's accessible name.
   :arrow-up ["M12 19V5" "M6 11l6-6 6 6"]
   ;; action-card glyphs, drawn in the same 1.8 stroke as the rest —
   ;; emoji in a card label are somebody else's design (Denis
   ;; 2026-08-01: «question mark icon must match our theme»)
   ;; a paperclip: what gets dropped into a family archive is a scan, a
   ;; document or a recording as often as a photograph
   :clip ["M17.5 9.5l-6.9 6.9a3.1 3.1 0 0 1-4.4-4.4l7.6-7.6a2.1 2.1 0 0 1 3 3l-7.6 7.6a1 1 0 0 1-1.5-1.5l6.9-6.9"]
   :question ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z"
              "M9.3 9.2a2.8 2.8 0 1 1 3.4 2.8c-.7.2-1 .8-1 1.6"
              "M11.7 16.6h.01"]
   :inbox ["M4 13h4.5l1.6 2.6h3.8L15.5 13H20" "M6.2 5.4h11.6L20 13v5.6H4V13z"]
   :info ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z" "M12 8h.01" "M12 11v5"]
   :filter ["M3 5h18l-7 8.5V19l-4 2v-7.5z"]
   :locate ["M12 19a7 7 0 1 0 0-14 7 7 0 0 0 0 14z" "M12 2v3" "M12 19v3" "M2 12h3" "M19 12h3"
            "M12 13.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z"]
   :lineage ["M12 6.8a1.9 1.9 0 1 0 0-3.8 1.9 1.9 0 0 0 0 3.8z"
             "M6 21a1.9 1.9 0 1 0 0-3.8A1.9 1.9 0 0 0 6 21z"
             "M18 21a1.9 1.9 0 1 0 0-3.8 1.9 1.9 0 0 0 0 3.8z"
             "M12 6.8V12" "M12 12l-5.2 5.5" "M12 12l5.2 5.5"]
   :bug ["M12 20a5 5 0 0 0 5-5v-3a5 5 0 0 0-10 0v3a5 5 0 0 0 5 5z"
         "M12 20v-8" "M7 13H3" "M21 13h-4" "M7.5 17.5L4.5 19.5" "M16.5 17.5L19.5 19.5"
         "M7.5 9L5 6.5" "M16.5 9L19 6.5" "M9 7.5a3 3 0 0 1 6 0"]
   :trash ["M4 7h16" "M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"
           "M18 7l-1 13a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L6 7" "M10 11v6" "M14 11v6"]
   :burger ["M4 7h16" "M4 12h16" "M4 17h16"]
   :tidy ["M8 3v4H4" "M16 3v4h4" "M8 21v-4H4" "M16 21v-4h4" "M12 9v6" "M9 12h6"]
   ;; a real gear: Настройки used to borrow the CHAT bubble, so the menu
   ;; showed the assistant's own glyph next to a page that is not it.
   ;; Six straight teeth, computed (the Feather outline, hand-rounded, went
   ;; lumpy and read as a flower at 16–18 px — Denis 2026-10-02)
   :gear ["M10.14 5.05L10.64 2.09L13.36 2.09L13.86 5.05L17.09 6.91L19.9 5.87L21.26 8.22L18.95 10.14L18.95 13.86L21.26 15.78L19.9 18.13L17.09 17.09L13.86 18.95L13.36 21.91L10.64 21.91L10.14 18.95L6.91 17.09L4.1 18.13L2.74 15.78L5.05 13.86L5.05 10.14L2.74 8.22L4.1 5.87L6.91 6.91Z"
          "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"]
   :pencil ["M17 3.5l3.5 3.5L8 19.5H4.5V16z" "M14.5 6l3.5 3.5"]})

(defn icon
  ([k] (icon k nil))
  ([k cls]
   (into [:svg.ico {:viewBox "0 0 24 24" :class cls :aria-hidden true}]
         (map (fn [d] [:path {:d d}]) (paths k)))))

(defn icon-paths
  "Raw 24x24 path data for `k` — for embedding an icon inside an existing
   SVG scene (the 2D graph draws kind glyphs inside node circles) where a
   nested <svg.ico> and its CSS sizing don't apply."
  [k]
  (paths k))
