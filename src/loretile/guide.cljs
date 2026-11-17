(ns loretile.guide
  "The assistant in LEARNER mode, on the catalog (wiki/Assistant-Design,
   decided 2026-10-02: one assistant, living where you already are, mode by
   screen). It finds a course across every graph on the device and offers to
   start it; when nothing fits it says so plainly. Same engine as the author
   and tutor modes: the tool registry, the look-don't-touch loop, the token
   budget, one-tap action cards. Its own conversation — a learner's search is
   not an author's thread (decision #2)."
  (:require [clojure.string :as str]
            [promesa.core :as p]
            [reagent.core :as r]
            [loretile.chat :as chat]
            [loretile.i18n :as i18n :refer [t]]
            [loretile.icons :as icons]
            [loretile.llm :as llm]
            [loretile.store :as store]
            [loretile.tools :as tools]))

(defonce msgs (r/atom []))     ; {:who :user|:llm|:sys :text}
(defonce cards (r/atom []))    ; one-tap action cards
(defonce busy (r/atom false))

(def reads #{"search-catalog"})
(def acts #{"start-course" "build-from-material"})

(defn- system []
  (str
   ;; i18n-ignore
   "Ты — помощник ученика на платформе обучения. Помоги найти и начать курс." "\n"
   ;; i18n-ignore
   "Сначала ищи инструментом search-catalog — не выдумывай курсов. Если курс подходит, коротко скажи почему и предложи действие start-course." "\n"
   ;; i18n-ignore
   "Если подходящего курса нет — скажи прямо и предложи действие build-from-material с полем goal (чему ученик хочет научиться, коротко): курс соберётся из его собственного материала." "\n"
   ;; i18n-ignore
   "Отвечай ТОЛЬКО валидным JSON без markdown: {\"note\":\"ответ ученику\",\"actions\":[…]} или запрос инструментов." "\n"
   ;; i18n-ignore
   "Поле note пиши на языке ученика: " (name @i18n/locale) "."
   (tools/prompt-block {:only reads :acts acts})))

(defn- parse [raw]
  (let [s (-> (str/trim (str raw)) (str/replace #"(?s)^```(json)?" "") (str/replace #"```\s*$" "") str/trim)]
    (try (let [m (js->clj (js/JSON.parse s) :keywordize-keys true)] (if (map? m) m {:note s}))
         (catch :default _ {:note s}))))

(defn send! [text]
  (let [text (str/trim (or text ""))]
    (when (and (seq text) (not @busy))
      (swap! msgs conj {:who :user :text text})
      (reset! busy true)
      (-> (tools/converse!
           {:system (system) :user text :parse parse
            :ctx {:kg (store/kg) :graph-id @store/current :allowed reads}
            :on-call (fn [{:keys [name args]}]
                       (swap! msgs conj {:who :sys :text (t :chat/tool-used {"{name}" name "{args}" (js/JSON.stringify (clj->js args))})}))
            :on-limit #(swap! msgs conj {:who :sys :text (t :chat/tool-limit)})})
          (p/then (fn [reply]
                    (when (seq (:note reply)) (swap! msgs conj {:who :llm :text (:note reply)}))
                    (let [ctx {:kg (store/kg) :graph-id @store/current}]
                      (swap! cards into (keep #(when (acts (str (:name %))) (tools/action-card ctx %)) (:actions reply))))))
          (p/catch (fn [e] (swap! msgs conj {:who :sys :text (str (t :chat/error-prefix) (ex-message e))})))
          (p/finally #(reset! busy false))))))

(defn- drop-card! [c] (swap! cards (fn [cs] (vec (remove #(= % c) cs)))))

(defn view []
  (let [draft (r/atom "")]
    (fn []
      [:div.panel.guide
       [:div.chat-head
        [:h2 (t :guide/title)]
        [:span.mode-badge.learner (t :guide/mode)]]
       [:div.msgs
        (when (empty? @msgs) [:div.msg.msg-llm (t :guide/lead)])
        (for [[i m] (map-indexed vector @msgs)]
          ^{:key i} [:div {:class (str "msg msg-" (name (:who m)))} (:text m)])
        (when @busy [:div.msg.msg-sys (t :chat/thinking)])]
       (when (seq @cards)
         [:div.cards
          (for [c @cards]
            ^{:key (get-in c [:data :id])}
            [:div.card.card-action
             [:span.card-tag (t :chat/action-tag)]
             [:div.row
              [:button.primary.action-do {:on-click (fn [_] (drop-card! c)
                                                      (tools/run-action! {:kg (store/kg) :graph-id @store/current} (:data c)))}
               (get-in c [:data :label])]
              [:button.action-hide {:on-click #(drop-card! c)} (t :chat/action-hide)]]])])
       (if-not (llm/ready?)
         [:p.muted.locked (t :guide/nokey) " " [:a {:href "#/settings"} (t :ui/settings)]]
         [:div.composer
          [:div.chat-field
           [chat/grow-textarea {:value @draft :placeholder (t :guide/placeholder)
                                :on-change #(reset! draft %)
                                ;; a busy guide refuses the send: keep what was typed
                                :on-submit (fn [] (when (send! @draft) (reset! draft "")))}]
           [:button.primary.chat-sendbtn {:disabled @busy :title (t :chat/send)
                                          :on-click (fn [_] (when (send! @draft) (reset! draft "")))}
            [icons/icon :send]]]])])))
