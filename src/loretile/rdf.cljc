(ns loretile.rdf
  "The graph as RDF (Turtle), for an organisation's own knowledge-graph
   tools (2026-10-21, after Netflix's UDA: their domain models are RDF and
   SHACL). One way OUT — the boundary rule of wiki/Data-Model.md holds: a
   standard maps in or out, Loretile never adopts it as its format.

   What a reader gets: the ontology as OWL classes and object properties
   (labels, inverse labels, descriptions as rdfs:comment, endpoints as
   rdfs:domain / rdfs:range), every node typed by its class with its title,
   definition and material, every edge as a triple, a link the model
   inferred as a reified statement carrying `lt:inferred` and its reason,
   sources through prov:wasDerivedFrom, STALE and DEPRECATED flags, the
   competency questions, and who owns the graph. Pure, so it is
   unit-tested."
  (:require [clojure.string :as str]
            [loretile.fold :as fold]
            [loretile.graph-tools :as gt]
            [loretile.profile :as profile]))

(def lt "https://loretile.com/ns#")

(defn- enc
  "An id as an IRI path segment: UTF-8 percent-encoded except unreserved."
  [s]
  #?(:cljs (js/encodeURIComponent (str s))
     :clj (-> (java.net.URLEncoder/encode (str s) "UTF-8") (str/replace "+" "%20"))))

(defn- lit
  "A Turtle string literal, escaped; `lang` adds a language tag."
  ([s] (lit s nil))
  ([s lang]
   (str "\""
        (-> (str s)
            (str/replace "\\" "\\\\") (str/replace "\"" "\\\"")
            (str/replace "\n" "\\n") (str/replace "\r" "\\r") (str/replace "\t" "\\t"))
        "\""
        (when (seq lang) (str "@" lang)))))

(defn- iri [s] (str "<" s ">"))

(defn- term
  "A vocabulary id as `v:id` when it is a plain name, else a full IRI."
  [base id]
  (let [n (name id)]
    (if (re-matches #"[A-Za-z][A-Za-z0-9_-]*" n) (str "v:" n) (iri (str base "vocab#" (enc n))))))

(defn- prop-term
  "A free property's key as `vp:key` when it is a plain name, else a full IRI
   (its own namespace: a property never collides with a type or relation)."
  [base k]
  (let [n (name k)]
    (if (re-matches #"[A-Za-z][A-Za-z0-9_-]*" n) (str "vp:" n) (iri (str base "vocab/prop#" (enc n))))))

(defn- block
  "«subject p1 o1 ;\\n    p2 o2 .» from [p o] pairs (nil pairs dropped)."
  [subject pairs]
  (let [ps (remove nil? pairs)]
    (str subject " " (str/join " ;\n    " (for [[p o] ps] (str p " " o))) " .\n")))

(defn- endpoint [base types]
  (case (count types)
    0 nil
    1 (term base (first types))
    (str "[ a owl:Class ; owl:unionOf ( " (str/join " " (map #(term base %) (sort types))) " ) ]")))

(defn turtle
  "The graph as one Turtle document. `base` is the graph's IRI (ending in
   «/»); `lang` tags the profile's words and the nodes' titles and
   definitions (material carries its own locale)."
  [kg {:keys [title base lang]}]
  (let [p (fold/profile kg)
        node (fn [id] (iri (str base "node/" (enc id))))
        source (fn [id] (iri (str base "source/" (enc id))))
        es (:edges kg)
        owner (not-empty (:owner kg))
        ;; the learning profile's own words are English, whatever the graph's language
        plang (if (profile/learning? p) "en" lang)]
    (str
     "@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .\n"
     "@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .\n"
     "@prefix owl: <http://www.w3.org/2002/07/owl#> .\n"
     "@prefix skos: <http://www.w3.org/2004/02/skos/core#> .\n"
     "@prefix dcterms: <http://purl.org/dc/terms/> .\n"
     "@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .\n"
     "@prefix prov: <http://www.w3.org/ns/prov#> .\n"
     "@prefix lt: <" lt "> .\n"
     "@prefix v: <" base "vocab#> .\n"
     "@prefix vp: <" base "vocab/prop#> .\n\n"
     ;; the graph and who answers for it
     (block (iri base)
            [["a" "lt:Graph"]
             (when (seq title) ["dcterms:title" (lit title)])
             ["lt:ontology" (iri (str base "vocab"))]
             (when owner ["lt:owner" (str "[ a lt:Owner ; lt:team " (lit (:team owner))
                                          (when (seq (:contact owner)) (str " ; lt:contact " (lit (:contact owner))))
                                          " ]")])])
     "\n# --- the ontology ---\n"
     (block (iri (str base "vocab"))
            [["a" "owl:Ontology"]
             ["rdfs:label" (lit (:title p) plang)]
             (when (seq (:brief p)) ["rdfs:comment" (lit (:brief p) plang)])])
     (str/join
      (for [t (profile/node-types p)]
        (block (term base (:id t))
               [["a" "owl:Class"]
                ["rdfs:label" (lit (:label t) plang)]
                (when (seq (:description t)) ["rdfs:comment" (lit (:description t) plang)])
                (when (:learnable? t) ["lt:learnable" "true"])])))
     (str/join
      (for [r (profile/relations p) :when (not= :grounded-in (:id r))]
        (block (term base (:id r))
               [["a" (if (:symmetric? r) "owl:ObjectProperty , owl:SymmetricProperty" "owl:ObjectProperty")]
                ["rdfs:label" (lit (:label r) plang)]
                (when (seq (:inverse r)) ["lt:inverseLabel" (lit (:inverse r) plang)])
                (when (seq (:description r)) ["rdfs:comment" (lit (:description r) plang)])
                (when-let [d (endpoint base (:from r))] ["rdfs:domain" d])
                (when-let [d (endpoint base (:to r))] ["rdfs:range" d])
                ;; the layout's order: it reads from the LATER node to the EARLIER one
                (when (:ordering? r) ["lt:ordering" "true"])
                (when (or (:acyclic? r) (:ordering? r)) ["lt:acyclic" "true"])])))
     (when (seq (:cqs kg))
       (str "\n# --- competency questions: what the graph must answer ---\n"
            (str/join
             (for [[id {:keys [question pattern]}] (sort-by key (:cqs kg))]
               (block (iri (str base "cq/" (enc id)))
                      [["a" "lt:CompetencyQuestion"]
                       ["rdfs:label" (lit question lang)]
                       (when (:relation pattern) ["lt:relation" (term base (:relation pattern))])
                       (when (:from-type pattern) ["lt:fromType" (term base (:from-type pattern))])
                       (when (:inverse? pattern) ["lt:inverse" "true"])])))))
     (when (seq (:sources kg))
       (str "\n# --- sources ---\n"
            (str/join
             (for [[id s] (sort-by key (:sources kg))]
               (block (source id)
                      [["a" "lt:Source"]
                       (when (seq (:title s)) ["rdfs:label" (lit (:title s))])
                       (when (seq (:ref s)) ["lt:ref" (lit (:ref s))])])))))
     "\n# --- nodes: every one accepted by a person ---\n"
     (str/join
      (for [[id c] (sort-by key (:concepts kg))
            :let [learning? (profile/learning? p)
                  srcs (for [e es :when (and (= id (:from e)) (= :grounded-in (:type e)))] (:to e))]]
        (block (node id)
               (concat
                [["a" (term base (if learning? :concept (or (:kind c) :node)))]
                 ["rdfs:label" (lit (:title c) lang)]
                 (when (seq (:definition c)) ["skos:definition" (lit (fold/plain-text (:definition c)) lang)])
                 ;; in learning the kind (fact, definition…) is a tag, not a class
                 (when (and learning? (:kind c)) ["lt:kind" (lit (name (:kind c)))])
                 (when (fold/stale? kg id) ["lt:stale" "true"])
                 (when-let [a (:added-by c)] ["dcterms:creator" (lit (fold/author-name kg a))])
                 (when-let [b (:changed-by c)] ["lt:lastChangedBy" (lit (fold/author-name kg b))])
                 (when-let [d (gt/day (:changed-at c))] ["dcterms:modified" (str (lit d) "^^xsd:date")])
                 (when (= :deprecated (:status c)) ["owl:deprecated" "true"])]
                ;; what a person set on the node, under its own key
                (for [[k v] (fold/node-props c)] [(prop-term base k) (lit (str v) lang)])
                (for [o (fold/concept-objects kg id) :when (seq (:text o))]
                  ["lt:material" (lit (fold/plain-text (:text o)) (:locale o))])
                (for [s srcs] ["prov:wasDerivedFrom" (source s)])))))
     "\n# --- edges ---\n"
     (str/join
      (for [{:keys [from to type]} (sort-by (juxt (comp name :type) :from :to) es)
            :when (and (not= :grounded-in type) (get-in kg [:concepts from]) (get-in kg [:concepts to]))]
        (str (node from) " " (term base type) " " (node to) " .\n")))
     ;; what is said ABOUT an edge — a link the source does not state, or the
     ;; properties a person set on it: the triple above, and a statement about
     ;; it — RDF 1.1 reification, so every Turtle reader takes it
     (str/join
      (for [{:keys [from to type justification] :as e} (sort-by (juxt (comp name :type) :from :to) es)
            :let [ps (fold/edge-props e)]
            :when (and (not= :grounded-in type) (or (:inferred? e) (seq ps))
                       (get-in kg [:concepts from]) (get-in kg [:concepts to]))]
        (block "[]"
               (concat
                [["a" "rdf:Statement"]
                 ["rdf:subject" (node from)] ["rdf:predicate" (term base type)] ["rdf:object" (node to)]
                 (when (:inferred? e) ["lt:inferred" "true"])
                 (when (and (:inferred? e) (seq justification)) ["lt:justification" (lit justification lang)])]
                (for [[k v] ps] [(prop-term base k) (lit (str v) lang)]))))))))
