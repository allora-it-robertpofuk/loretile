(ns loretile.agent-md
  "The graph as ONE markdown file for a coding agent (wiki/Profiles.md).
   Pure: the agent's input is a contract, so it is unit-tested. Every node
   carries its type, definition, typed relations in BOTH directions (the
   inverse label on the receiving end), its material, sources with anchors
   and a stale flag — what a README or a wiki dump cannot say."
  (:require [clojure.string :as str]
            [loretile.fold :as fold]
            [loretile.graph-tools :as gt]
            [loretile.profile :as profile]))

(defn- title [kg id] (get-in kg [:concepts id :title] id))

(defn- inferred
  "A link the source does not state: the model's conclusion, accepted by a
   person — the agent is told, with the reason."
  [e]
  (when (:inferred? e)
    (str " — *inferred, not stated in the source*"
         (when (seq (:justification e)) (str ": " (str/replace (fold/plain-text (:justification e)) #"\s+" " "))))))

(defn- node-section [kg p {:keys [id definition kind] :as c}]
  (let [es (remove #(= :grounded-in (:type %)) (:edges kg))
        out (sort-by :type (filter #(= id (:from %)) es))
        in (sort-by :type (filter #(= id (:to %)) es))
        objs (fold/concept-objects kg id)
        srcs (for [e (:edges kg) :when (and (= id (:from e)) (= :grounded-in (:type e)))]
               (get-in kg [:sources (:to e)]))]
    (str/join "\n"
              (remove nil?
                      [(str "## " (:title c) " `" id "`")
                       (str "- type: " (name (or kind :concept))
                            (when (fold/stale? kg id) " · **STALE** (its source changed; re-check before relying on it)"))
                       (when-let [a (gt/authorship kg c)] (str "- " a))
                       (when (seq definition) (str "\n" (fold/plain-text definition)))
                       (when (or (seq out) (seq in)) "")
                       (when (seq out)
                         (str/join "\n" (for [{:keys [to type] :as e} out]
                                          (str "- " (profile/label p type) " → [" (title kg to) "](#" to ")" (inferred e)))))
                       (when (seq in)
                         (str/join "\n" (for [{:keys [from type] :as e} in]
                                          (str "- " (profile/label p type true) " ← [" (title kg from) "](#" from ")" (inferred e)))))
                       (when (seq objs)
                         (str "\n" (str/join "\n\n" (for [o objs]
                                                      (str "> " (str/replace (fold/plain-text (:text o)) "\n" "\n> "))))))
                       (when (seq (remove nil? srcs))
                         (str "\nSources: " (str/join "; " (for [s (remove nil? srcs)]
                                                            (str (:title s) (when (:ref s) (str " (" (:ref s) ")")))))))
                       ""]))))

(defn markdown
  "The whole graph as markdown: a header naming the ontology, then one
   section per accepted node in a stable order (the ordering relation's
   foundations first, then by title)."
  [kg graph-title]
  (let [p (fold/profile kg)
        ids (fold/topo-order kg (set (keys (:concepts kg))) (profile/ordering-relation p))
        rest-ids (sort-by #(title kg %) (remove (set ids) (keys (:concepts kg))))]
    (str "# " graph-title "\n\n"
         (when-let [{:keys [team contact]} (not-empty (:owner kg))]
           (str "Owner: " team (when (seq contact) (str " (" contact ")")) "\n\n"))
         "Ontology: " (:title p) (when (seq (:brief p)) (str " — " (:brief p))) "\n\n"
         "Node types:\n"
         (str/join "\n" (for [t (profile/node-types p)]
                          (str "- `" (name (:id t)) "` " (:label t) (when (seq (:description t)) (str ": " (:description t))))))
         "\n\nRelations:\n"
         (str/join "\n" (for [r (profile/relations p) :when (not= :grounded-in (:id r))]
                          (str "- `" (name (:id r)) "` " (:label r)
                               (when (:inverse r) (str " / " (:inverse r)))
                               (when (seq (:description r)) (str ": " (:description r))))))
         "\n\nEvery node below was accepted by a person; a node marked STALE was written from a source that has since changed; "
         "a link marked *inferred* is the model's conclusion, not a quote.\n\n"
         (str/join "\n" (for [id (concat ids rest-ids)] (node-section kg p (get-in kg [:concepts id])))))))
