(ns loretile.schema
  "Malli schemas for KG-stream events — the one contract, shared by the
   fold (cljc), the UI, and (later) the backend appender. Event vocabulary
   is wiki/Data-Model.md's canonical inventory, KG stream only (M0)."
  (:require [loretile.profile :as profile]
            [malli.core :as m]
            [malli.error :as me]))

(def level [:enum :novice :apprentice :professional])
(def concept-kind [:enum :fact :definition :procedure :principle :judgment])
;; the learning vocabulary (concept-kind, edge-type) is one PROFILE since
;; 2026-10-14 (wiki/Profiles.md): a graph may carry its own ontology, so the
;; shape here is open (:keyword) and the GUARD checks ids against the
;; graph's profile — `loretile.profile` holds the schema of a profile
(def edge-type :keyword)
(def node-kind :keyword)
(def object-kind [:enum :explanation :worked-example :diagram :video :audio :interactive :reading])
;; :exercise = an item whose answer is EXECUTED (wiki/Exercises.md); its spec:
;; {:stem :setup :solution :schema? :ordered?} — runtime is PGlite for now
;; links BETWEEN learning objects (2026-10-07, after looking at Онто's typed
;; relations): from → to reads «from is an example OF to», «from is a simpler
;; version OF to», «read from AFTER to». Within one topic (the guard).
(def object-link-type [:enum :example-of :simpler-of :follows])
(def object-link [:map [:from :string] [:to :string] [:type object-link-type]])
(def item-kind [:enum :single-choice :multi-choice :order :match :cloze :numeric :scenario :explain-back :exercise])
(def provenance [:enum :authored :llm-drafted :inferred-from-data])
;; :drafted = LLM-drafted, curator-accepted (review A4); :generated = unreviewed variant
(def origin [:enum :authored :oer :drafted :generated])

(def base
  "Every event carries these (:ev/type is added per event by `ev`)."
  [:map
   [:ev/id :string]
   [:ev/ns :string]                 ; namespace (team) — the KG stream key
   [:ev/actor :string]
   [:ev/ts :int]])

(defn ev [type & kvs]
  (into base (cons [:ev/type [:= type]] (map vec (partition 2 kvs)))))

(def concept-payload
  [:map
   [:id :string]
   [:title :string]
   [:definition :string]
   [:kind {:optional true} node-kind]
   [:tags {:optional true} [:vector :string]]
   [:evidence {:optional true} :string]        ; source quote the proposal rests on
   [:source-id {:optional true} :string]])     ; on accept the fold adds concept→source grounded-in

(def edge-payload
  [:map
   [:from :string] [:to :string]
   [:type edge-type]
   [:provenance provenance]
   [:justification {:optional true} :string]
   ;; the model said the source does NOT state this link — its own inference,
   ;; accepted by a person. An agent reading the graph is told (2026-10-21)
   [:inferred? {:optional true} :boolean]
   ;; requires only: depth the prerequisite is needed at; absent = the
   ;; dependent's own level (review A1)
   [:min-level {:optional true} level]])

(def object-payload
  [:map
   [:id :string] [:concept-id :string]
   [:kind object-kind] [:level level] [:locale :string]
   [:origin origin]
   ;; for whom (open role tags, org vocabulary); empty/absent = general.
   ;; Orthogonal to :level (how deep) and :namespace (who wrote it)
   [:audience {:optional true} [:set :string]]
   [:text {:optional true} :string]
   [:media-ref {:optional true} :string]
   [:grounded-in {:optional true} :string]     ; source id
   [:anchor {:optional true} :string]])        ; where in it: "p12" (page) or a heading slug

(def item-payload
  [:map
   [:id :string]
   [:primary-concept-id :string]
   [:secondary-concept-ids {:optional true} [:vector :string]]
   [:level level] [:kind item-kind]
   [:origin {:optional true} origin]           ; :drafted = bench draft a curator accepted (2026-10-02)
   [:locale :string]                           ; the stem is in a language (review B5)
   [:spec :map]                                ; typed per kind; widget renders this
   [:template-id {:optional true} :string]])

(def change-op
  [:or
   [:tuple [:= :graph-set] [:map-of :keyword :any]]
   [:tuple [:= :node-set] :string [:map-of :keyword :any]]
   [:tuple [:= :node-remove] :string]
   [:tuple [:= :edge-set] :string :keyword :string [:map-of :keyword :any]]
   [:tuple [:= :edge-remove] :string :keyword :string]])

(def events
  {;; the graph's ontology, first in a custom graph's log; absent = learning
   :profile-set        (ev :profile-set :profile profile/schema)
   ;; THE PROPERTY-GRAPH CORE (wiki/Property-Graph.md): one generic event,
   ;; a list of operations applied atomically and guarded together. Meaning
   ;; lives in properties. Every graph names its ontology in `:ontology`:
   ;; absent = the built-in learning one, "ontology" = the built-in one for
   ;; describing vocabularies (nodes are types, edges relations, with their
   ;; words and flags as edge properties), any other = a graph of the set,
   ;; carried as `:ontology-copy` at `:ontology-version`. `:color-scheme`
   ;; names how its map is drawn. A nil value removes a property.
   :change             (ev :change :ops [:vector {:min 1} change-op])
   ;; the ontology grows ADDITIVELY (wiki/Profiles.md, competency questions):
   ;; a relation or node type may join a custom profile any time; nothing
   ;; in use is ever removed
   :relation-added     (ev :relation-added :relation profile/relation-schema)
   :node-type-added    (ev :node-type-added :node-type profile/node-type-schema)
   ;; one sentence a model reads: what a node type or relation means (empty
   ;; clears it). Words only — the meaning of an edge in the log never moves
   :vocabulary-described (ev :vocabulary-described :of [:enum :relation :node-type] :id :keyword
                             :description :string)
   ;; who answers for the graph: a team and how to reach it (Netflix UDA,
   ;; 2026-10-21 — every domain model there has an owner). Any graph, any profile
   :graph-owner-set    (ev :graph-owner-set :owner [:map [:team [:string {:min 1}]]
                                                   [:contact {:optional true} :string]])
   ;; the name behind an author id (2026-10-21: every change was «denis»).
   ;; :ev/actor is a stable per-device id; this event, in the graph's own
   ;; log, says whose it is, so an exported graph still names its authors.
   ;; Only an author names themself (the guard)
   :author-named       (ev :author-named :author [:map [:id :string] [:name [:string {:min 1}]]])
   ;; a COMPETENCY QUESTION: what the graph must be able to answer. Its
   ;; :pattern is the query that answers it — a relation from a node type —
   ;; so the fold can CHECK it over the graph, not a model
   :cq-raised          (ev :cq-raised :cq [:map [:id :string] [:question :string]
                                          [:pattern {:optional true}
                                           ;; :inverse? = the node is the relation's `to` end («who performs X?»)
                                           [:map [:relation :keyword] [:from-type {:optional true} :keyword]
                                            [:inverse? {:optional true} :boolean]]]])
   :cq-retired         (ev :cq-retired :id :string)
   :concept-proposed   (ev :concept-proposed :concept concept-payload :provenance provenance)
   :concept-accepted   (ev :concept-accepted :concept concept-payload)
   :concept-discarded  (ev :concept-discarded :id :string)
   :concept-deprecated (ev :concept-deprecated :id :string)
   :concept-split      (ev :concept-split :id :string
                           :into [:vector concept-payload]
                           :item-remap [:map-of :string :string]
                           :object-remap [:map-of :string :string])
   :edge-proposed      (ev :edge-proposed :edge edge-payload)
   :edge-accepted      (ev :edge-accepted :edge edge-payload)
   :edge-discarded     (ev :edge-discarded :edge edge-payload)
   :object-added       (ev :object-added :object object-payload)
   :object-promoted    (ev :object-promoted :id :string)
   :object-demoted     (ev :object-demoted :id :string)
   :object-linked      (ev :object-linked :link object-link)
   :object-unlinked    (ev :object-unlinked :link object-link)
   :item-added         (ev :item-added :item item-payload)
   :item-accepted      (ev :item-accepted :id :string)
   :item-retired       (ev :item-retired :id :string)
   :version-created    (ev :version-created :entity [:enum :object :item :concept]
                           :id :string :change [:enum :patch :material]
                           :payload :map)
   :source-added       (ev :source-added :source [:map [:id :string] [:title :string]
                                                  [:ref {:optional true} :string]])
   ;; :concepts scopes it to those topics — the re-upload card asks per topic
   ;; (decided 2026-10-02, #7); absent = every topic written from the source
   :source-updated     (conj (ev :source-updated :id :string :change [:enum :patch :material])
                             [:concepts {:optional true} [:vector :string]])
   :question-raised    (ev :question-raised :id :string :concept-id :string :question :string)
   :question-answered  (ev :question-answered :id :string :answer :string)
   :course-published   (ev :course-published :course
                           [:map [:id :string] [:title :string]
                            [:targets [:vector [:tuple :string level]]]
                            [:locale {:optional true} :string]           ; which pools/objects it deals
                            [:pass-threshold {:optional true} :int]      ; overall %, wiki/MVP.md
                            [:diagnostic-items {:optional true} :int]
                            [:final-items {:optional true} :int]
                            [:series {:optional true} :string]])})

(defn valid? [e] (when-let [s (get events (:ev/type e))] (m/validate s e)))

(defn explain [e]
  (if-let [s (get events (:ev/type e))]
    (some-> (m/explain s e) me/humanize)
    {:ev/type ["unknown event type"]}))
