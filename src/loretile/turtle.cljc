(ns loretile.turtle
  "Turtle (RDF 1.1) IN: a team that already keeps its ontology in Protégé,
   TopBraid or VocBench saves it as Turtle and starts a Loretile graph from
   it (2026-10-23 — the reverse of `loretile.rdf`). Two steps, both pure:
   `parse` reads Turtle into triples, `profile` maps OWL/RDFS onto a
   Loretile profile — classes become node types, object properties become
   relations — and says what it left out. The boundary rule of
   wiki/Data-Model.md holds: a standard maps in, Loretile never adopts it.

   The parser covers the Turtle grammar a modelling tool writes: @prefix /
   PREFIX, @base / BASE, IRIs, prefixed names, `a`, `;` and `,` lists,
   blank nodes ([] and _:x), collections ( ), literals in all four quote
   forms with language tags and datatypes, numbers and booleans, comments.
   No new dependency."
  (:require [clojure.string :as str]
            [loretile.profile :as profile]))

(def rdf "http://www.w3.org/1999/02/22-rdf-syntax-ns#")
(def rdfs "http://www.w3.org/2000/01/rdf-schema#")
(def owl "http://www.w3.org/2002/07/owl#")
(def skos "http://www.w3.org/2004/02/skos/core#")
(def dcterms "http://purl.org/dc/terms/")
(def lt "https://loretile.com/ns#")
;; schema.org (and SOSA, which borrows it) states endpoints as «includes»
(def schema-http "http://schema.org/")
(def schema-https "https://schema.org/")
;; Netflix's Upper (UDA, the 2026-10-21 comparison): its own class and
;; relationship terms, endpoints by upper:property / upper:class
(def upper "https://rdf.netflix.net/ns/upper#")

;; --- the tokenizer ------------------------------------------------------------

(defn- ws? [c] (contains? #{\space \tab \newline \return} c))

(defn- pn-char?
  "A character a prefixed name may hold: letters of any script, digits,
   and _ - . : % (a trailing dot is cut afterwards)."
  [c]
  (or (re-matches #"[A-Za-z0-9_\-.:%]" (str c))
      #?(:cljs (> (.charCodeAt (str c) 0) 127) :clj (> (int c) 127))))

(defn- unescape [s]
  (-> s
      (str/replace #"\\u([0-9A-Fa-f]{4})" (fn [[_ h]] (str (char #?(:cljs (js/parseInt h 16) :clj (Integer/parseInt h 16))))))
      (str/replace #"\\([tbnrf\"'\\])" (fn [[_ c]] (case c "t" "\t" "b" "\b" "n" "\n" "r" "\r" "f" "\f" c)))))

(defn- whole
  "A regex match as the matched text (a pattern with groups returns a vector)."
  [m]
  (if (vector? m) (first m) m))

(defn- tokens
  "Turtle text → [{:t :iri|:pname|:bnode|:str|:num|:bool|:lang|:punct|:kw :v …}]."
  [text]
  (let [n (count text)]
    (loop [i 0 out (transient [])]
      (if (>= i n)
        (persistent! out)
        (let [c (nth text i)]
          (cond
            (ws? c) (recur (inc i) out)
            (= c \#) (recur (or (some-> (str/index-of text "\n" i) inc) n) out)
            (= c \<) (let [j (str/index-of text ">" i)]
                       (when-not j (throw (ex-info "unclosed <IRI>" {:at i})))
                       (recur (inc j) (conj! out {:t :iri :v (unescape (subs text (inc i) j))})))
            (or (= c \") (= c \'))
            (let [long? (= (subs text i (min n (+ i 3))) (str c c c))
                  q (if long? (str c c c) (str c))
                  start (+ i (count q))
                  end (loop [k start]
                        (cond (>= k n) (throw (ex-info "unclosed string" {:at i}))
                              (= (nth text k) \\) (recur (+ k 2))
                              (str/starts-with? (subs text k (min n (+ k (count q)))) q) k
                              :else (recur (inc k))))]
              (recur (+ end (count q)) (conj! out {:t :str :v (unescape (subs text start end))})))
            (= c \@) (let [m (re-find #"^@[A-Za-z][A-Za-z0-9\-]*" (subs text i (min n (+ i 40))))]
                       (cond (= m "@prefix") (recur (+ i 7) (conj! out {:t :kw :v "prefix"}))
                             (= m "@base") (recur (+ i 5) (conj! out {:t :kw :v "base"}))
                             m (recur (+ i (count m)) (conj! out {:t :lang :v (subs m 1)}))
                             :else (throw (ex-info "bad @" {:at i}))))
            (= (subs text i (min n (+ i 2))) "^^") (recur (+ i 2) (conj! out {:t :punct :v "^^"}))
            (contains? #{\. \; \, \[ \] \( \)} c)
            (if (and (= c \.) (< (inc i) n) (re-matches #"[0-9]" (str (nth text (inc i)))))
              (let [m (whole (re-find #"^\.[0-9]+([eE][+-]?[0-9]+)?" (subs text i (min n (+ i 40)))))]
                (recur (+ i (count m)) (conj! out {:t :num :v m})))
              (recur (inc i) (conj! out {:t :punct :v (str c)})))
            (re-matches #"[+\-0-9]" (str c))
            (let [m (whole (re-find #"^[+\-]?[0-9]*\.?[0-9]+([eE][+-]?[0-9]+)?" (subs text i (min n (+ i 60)))))]
              (when-not m (throw (ex-info "bad number" {:at i})))
              (recur (+ i (count m)) (conj! out {:t :num :v m})))
            (= (subs text i (min n (+ i 2))) "_:")
            (let [j (loop [k (+ i 2)] (if (and (< k n) (pn-char? (nth text k))) (recur (inc k)) k))
                  j (if (= \. (nth text (dec j))) (dec j) j)]
              (recur j (conj! out {:t :bnode :v (subs text i j)})))
            (pn-char? c)
            (let [j (loop [k i] (if (and (< k n) (pn-char? (nth text k))) (recur (inc k)) k))
                  ;; a name never ends in a dot: that dot ends the statement
                  j (loop [j j] (if (and (> j (inc i)) (= \. (nth text (dec j)))) (recur (dec j)) j))
                  w (subs text i j)]
              (recur j (conj! out (cond (= w "a") {:t :a}
                                        (#{"true" "false"} w) {:t :bool :v w}
                                        (= (str/upper-case w) "PREFIX") {:t :kw :v "prefix" :sparql true}
                                        (= (str/upper-case w) "BASE") {:t :kw :v "base" :sparql true}
                                        (str/includes? w ":") {:t :pname :v w}
                                        :else (throw (ex-info (str "unexpected «" w "»") {:at i}))))))
            :else (throw (ex-info (str "unexpected «" c "»") {:at i}))))))))

;; --- the parser -----------------------------------------------------------------

(defn parse
  "Turtle text → {:triples [[s p o] …] :prefixes {…}}. Subjects and
   predicates are IRI strings or blank-node ids (\"_:b3\"); an object is
   either, or a literal {:value :lang :datatype}. Throws ex-info with a
   message on bad input."
  [text]
  (let [toks (vec (tokens (str text)))
        st (atom {:i 0 :prefixes {} :base "" :triples (transient []) :bn 0})
        peek* (fn [] (get toks (:i @st)))
        next! (fn [] (let [t (peek*)] (swap! st update :i inc) t))
        expect! (fn [v] (let [t (next!)] (when-not (and (= :punct (:t t)) (= v (:v t)))
                                            (throw (ex-info (str "expected «" v "»") {:got t})))))
        fresh! (fn [] (str "_:g" (:bn (swap! st update :bn inc))))
        emit! (fn [s p o] (swap! st update :triples conj! [s p o]))
        resolve (fn [{:keys [t v]}]
                  (case t
                    :iri (if (re-find #"^[A-Za-z][A-Za-z0-9+.\-]*:" v) v (str (:base @st) v))
                    :pname (let [k (subs v 0 (str/index-of v ":"))
                                 ns (get (:prefixes @st) k)]
                             (when-not ns (throw (ex-info (str "unknown prefix «" k ":»") {})))
                             (str ns (subs v (inc (str/index-of v ":")))))))]
    (letfn [(iri-or-bnode! [] (let [t (next!)]
                                (case (:t t)
                                  (:iri :pname) (resolve t)
                                  :bnode (:v t)
                                  (throw (ex-info "expected an IRI" {:got t})))))
            (literal [t]
              (case (:t t)
                :str (let [nx (peek*)]
                       (cond (= :lang (:t nx)) (do (next!) {:value (:v t) :lang (str/lower-case (:v nx))})
                             (and (= :punct (:t nx)) (= "^^" (:v nx))) (do (next!) {:value (:v t) :datatype (iri-or-bnode!)})
                             :else {:value (:v t)}))
                :num {:value (:v t) :datatype (str "http://www.w3.org/2001/XMLSchema#" (if (re-find #"[.eE]" (:v t)) "decimal" "integer"))}
                :bool {:value (:v t) :datatype "http://www.w3.org/2001/XMLSchema#boolean"}))
            (object! []
              (let [t (peek*)]
                (cond
                  (#{:str :num :bool} (:t t)) (literal (next!))
                  (and (= :punct (:t t)) (= "[" (:v t))) (do (next!) (blank-list!))
                  (and (= :punct (:t t)) (= "(" (:v t))) (do (next!) (collection!))
                  :else (iri-or-bnode!))))
            (blank-list! []
              (let [b (fresh!)]
                (if (= "]" (:v (peek*)))
                  (do (next!) b)
                  (do (po-list! b) (expect! "]") b))))
            (collection! []
              (loop [items []]
                (if (= ")" (:v (peek*)))
                  (do (next!)
                      (if (empty? items)
                        (str rdf "nil")
                        (let [nodes (vec (repeatedly (count items) fresh!))]
                          (doseq [[k node] (map-indexed vector nodes)]
                            (emit! node (str rdf "first") (nth items k))
                            (emit! node (str rdf "rest") (if (< (inc k) (count nodes)) (nth nodes (inc k)) (str rdf "nil"))))
                          (first nodes))))
                  (recur (conj items (object!))))))
            (verb! [] (let [t (peek*)] (if (= :a (:t t)) (do (next!) (str rdf "type")) (iri-or-bnode!))))
            (po-list! [s]
              (loop []
                (let [p (verb!)]
                  (loop [] (emit! s p (object!))
                    (when (= "," (:v (peek*))) (next!) (recur)))
                  ;; ; may repeat, and may end the list
                  (when (= ";" (:v (peek*)))
                    (loop [] (when (= ";" (:v (peek*))) (next!) (recur)))
                    (let [nx (peek*)]
                      (when (and nx (not (and (= :punct (:t nx)) (#{"." "]"} (:v nx)))))
                        (recur)))))))]
      (loop []
        (when-let [t (peek*)]
          (cond
            (= :kw (:t t))
            (do (next!)
                (if (= "prefix" (:v t))
                  (let [pn (next!) iri (next!)]
                    (when-not (and (= :pname (:t pn)) (str/ends-with? (:v pn) ":") (= :iri (:t iri)))
                      (throw (ex-info "bad prefix declaration" {:got pn})))
                    (swap! st assoc-in [:prefixes (subs (:v pn) 0 (dec (count (:v pn))))] (resolve iri)))
                  (swap! st assoc :base (resolve (next!))))
                (when-not (:sparql t) (expect! ".")))
            (and (= :punct (:t t)) (= "[" (:v t)))
            (do (next!) (let [b (blank-list!)] (when-not (= "." (:v (peek*))) (po-list! b)) (expect! ".")))
            (and (= :punct (:t t)) (= "(" (:v t)))
            (do (next!) (let [c (collection!)] (po-list! c) (expect! ".")))
            :else
            (do (po-list! (iri-or-bnode!)) (expect! ".")))
          (recur)))
      {:triples (persistent! (:triples @st)) :prefixes (:prefixes @st)})))

;; --- OWL / RDFS → a Loretile profile -------------------------------------------------

(defn- local-name [iri]
  (let [s (str iri)]
    (or (last (re-find #"[#/:]([^#/:]+)$" s)) s)))

(defn- slug
  "An id Loretile can use: lower-case words joined by -, camelCase split.
   Letters of any script survive (no u flag — split on what is NOT a word)."
  [s]
  (-> (str s)
      (str/replace #"([a-z0-9])([A-Z])" "$1-$2")
      str/lower-case
      (str/replace #"[\s_./:#%()\[\],;'\"!?]+" "-")
      (str/replace #"-+" "-")
      (str/replace #"^-|-$" "")))

(defn- index
  "{:sp {s {p [o …]}} :order [s …]} — subjects in the order the file first
   names them, so types and relations keep the author's order."
  [triples]
  {:sp (reduce (fn [m [s p o]] (update-in m [s p] (fnil conj []) o)) {} triples)
   :order (vec (distinct (map first triples)))})

(defn- objs [ix s p] (get-in (:sp ix) [s p]))

(defn- types-of [ix s] (set (objs ix s (str rdf "type"))))

(defn- list-items
  "An RDF collection as a vector (rdf:first / rdf:rest)."
  [ix node]
  (loop [n node out []]
    (if (or (nil? n) (= n (str rdf "nil")) (> (count out) 200))
      out
      (recur (first (objs ix n (str rdf "rest"))) (conj out (first (objs ix n (str rdf "first"))))))))

(defn- pick-literal
  "The literal to use from several: the wanted language, then English,
   then one with no tag, then any."
  [lits lang]
  (let [ls (filter map? lits)
        by (fn [l] (first (filter #(= l (:lang %)) ls)))]
    (:value (or (by lang) (by "en") (first (filter #(nil? (:lang %)) ls)) (first ls)))))

(defn- class-ids
  "A domain or range: a named class, or the named members of an
   owl:unionOf; owl:Thing or nothing means any."
  [ix node]
  (cond
    (nil? node) #{}
    (= node (str owl "Thing")) #{}
    (str/starts-with? (str node) "_:")
    (if-let [u (first (objs ix node (str owl "unionOf")))]
      (set (remove #(str/starts-with? (str %) "_:") (list-items ix u)))
      #{})
    :else #{node}))

(def ^:private later-to-earlier
  ;; Loretile's order reads from the LATER node to the EARLIER one («B comes
  ;; after A» is B → A). Only these exact names are taken as the order: a
  ;; word match picked schema.org's «follows» (a person follows a person),
  ;; and «precedes», «before», «next» read the other way and would lay the
  ;; map out backwards (the business sample did, for a day: wiki/Profiles.md)
  #{:comes-after :is-after :preceded-by :is-preceded-by :triggered-by :is-triggered-by :depends-on :prerequisite})

(defn profile
  "Parsed triples → {:profile p :report {…}} or {:error message :report}.
   Classes (owl:Class, rdfs:Class) become node types; object properties
   (owl:ObjectProperty, or an rdf:Property whose range is a class here)
   become relations: label (`lang` first), rdfs:comment / skos:definition
   as the description, domain/range as from/to (owl:unionOf too), the
   inverse's label from owl:inverseOf or lt:inverseLabel, symmetric from
   owl:SymmetricProperty, acyclic from lt:acyclic or owl:TransitiveProperty.
   Exactly one relation is the ordering one: lt:ordering, else the one
   whose name says order between one type and itself, else the only
   relation from a type to itself. Learning's reserved ids are renamed
   (-x). What does not fit — data properties, individuals, SKOS concepts,
   restrictions — is counted in :report, never silently dropped."
  [{:keys [triples]} {:keys [lang id title]}]
  (let [ix (index triples)
        subjects (:order ix)
        pos (into {} (map-indexed (fn [i x] [x i]) subjects))
        typed (fn [& ts] (filter #(and (not (str/starts-with? (str %) "_:")) (some (set ts) (types-of ix %))) subjects))
        ;; schema.org's data types (Text, Number…) are rdfs:Class too — values, not things
        datatype? (fn [c] (some #{(str schema-http "DataType") (str schema-https "DataType")} (types-of ix c)))
        classes (distinct (remove datatype? (typed (str owl "Class") (str rdfs "Class") (str upper "DirectClass") (str upper "Class"))))
        class-set (set classes)
        domain-preds [(str rdfs "domain") (str schema-http "domainIncludes") (str schema-https "domainIncludes")]
        range-preds [(str rdfs "range") (str schema-http "rangeIncludes") (str schema-https "rangeIncludes") (str upper "class")]
        ;; Upper: a class lists its properties
        upper-owners (reduce (fn [m c] (reduce #(update %1 %2 (fnil conj []) c) m (objs ix c (str upper "property")))) {} classes)
        domains (fn [p] (concat (mapcat #(objs ix p %) domain-preds) (get upper-owners p)))
        ranges (fn [p] (mapcat #(objs ix p %) range-preds))
        obj-props (distinct (concat (typed (str owl "ObjectProperty") (str upper "Relationship"))
                                    (filter #(some class-set (ranges %)) (typed (str rdf "Property")))))
        ;; no label: the local name in words («BusinessRule» → «business rule»)
        label-of (fn [s] (or (pick-literal (concat (objs ix s (str rdfs "label")) (objs ix s (str skos "prefLabel")) (objs ix s (str upper "label"))) lang)
                             (str/replace (slug (local-name s)) "-" " ")))
        desc-of (fn [s] (pick-literal (concat (objs ix s (str rdfs "comment")) (objs ix s (str skos "definition")) (objs ix s (str upper "description"))
                                              (objs ix s (str dcterms "description"))) lang))
        true? (fn [s p] (some #(= "true" (:value %)) (filter map? (objs ix s p))))
        reserved (profile/reserved-ids)
        ;; ids: slugs of local names, unique, never a reserved learning id
        id-for (let [taken (atom #{})]
                 (memoize (fn [iri]
                            (let [base (let [b (slug (local-name iri))] (if (str/blank? b) "x" b))
                                  base (if (reserved (keyword base)) (str base "-x") base)
                                  id (loop [k 1] (let [c (if (= k 1) base (str base "-" k))]
                                                   (if (@taken c) (recur (inc k)) c)))]
                              (swap! taken conj id)
                              (keyword id)))))
        node-types (vec (for [c classes]
                          (cond-> {:id (id-for c) :label (label-of c)}
                            (desc-of c) (assoc :description (desc-of c)))))
        ;; owl:inverseOf, read both ways, once
        inverses (reduce (fn [m p] (reduce (fn [m q] (if (map? q) m (-> m (update p (fnil conj #{}) q) (update q (fnil conj #{}) p))))
                                           m (objs ix p (str owl "inverseOf"))))
                         {} obj-props)
        inverse-label (fn [p] (or (pick-literal (objs ix p (str lt "inverseLabel")) lang)
                                  (some-> (first (sort-by #(pos % 0) (get inverses p))) label-of)))
        ;; a property declared as the inverse of one already taken is the same
        ;; relation read backwards: one relation, its label the inverse
        ;; keep the one that states its endpoints; on a tie, the one named first
        ends (fn [p] (+ (count (domains p)) (count (ranges p))))
        prop-set (set obj-props)
        twin? (fn [p] (some (fn [q] (and (not= p q) (prop-set q)
                                         (or (> (ends q) (ends p))
                                             (and (= (ends q) (ends p)) (< (pos q 0) (pos p 0))))))
                            (get inverses p)))
        rels (vec (for [p obj-props :when (not (twin? p))
                        :let [from (set (keep #(when (class-set %) (id-for %)) (mapcat #(class-ids ix %) (domains p))))
                              to (set (keep #(when (class-set %) (id-for %)) (mapcat #(class-ids ix %) (ranges p))))
                              t (types-of ix p)]]
                    (cond-> {:id (id-for p) :label (label-of p) :from from :to to}
                      (inverse-label p) (assoc :inverse (inverse-label p))
                      (desc-of p) (assoc :description (desc-of p))
                      (t (str owl "SymmetricProperty")) (assoc :symmetric? true)
                      (or (true? p (str lt "acyclic")) (t (str owl "TransitiveProperty"))) (assoc :acyclic? true)
                      (true? p (str lt "ordering")) (assoc :ordering? true))))
        self? (fn [r] (and (= 1 (count (:from r))) (= (:from r) (:to r))))
        ord (or (first (filter :ordering? rels))
                (first (filter #(and (self? %) (later-to-earlier (:id %))) rels)))
        ;; none: Loretile needs one order relation, so it adds a neutral one
        ;; rather than guessing a direction it cannot know
        added (when-not ord
                {:id (id-for (str lt "comes-after")) :label "comes after" :inverse "comes before" :ordering? true
                 :description "A → B: A comes after B; B is earlier. Added on import: Loretile lays the map out along one order."})
        ;; the order is acyclic by definition: the flag would only repeat it
        rels (cond-> (mapv #(if (= (:id %) (:id ord)) (-> % (assoc :ordering? true) (dissoc :acyclic?)) (dissoc % :ordering?)) rels)
               added (conj added))
        onto (first (typed (str owl "Ontology") (str upper "DomainModel")))
        report {:types (count node-types) :relations (count rels)
                :ordering (name (:id (or ord added)))
                :ordering-added (boolean added)
                :renamed (vec (for [x (concat classes obj-props)
                                    :let [b (slug (local-name x))]
                                    :when (and (reserved (keyword b)) (not= (keyword b) (id-for x)))]
                                (str b " → " (name (id-for x)))))
                :skipped (into {} (remove (comp zero? val))
                               {:data-properties (count (typed (str owl "DatatypeProperty") (str owl "AnnotationProperty") (str upper "Attribute")))
                                 :enumerations (count (typed (str upper "Enumeration")))
                                :individuals (count (filter #(some class-set (types-of ix %)) subjects))
                                :skos-concepts (count (typed (str skos "Concept")))
                                :restrictions (count (filter #((types-of ix %) (str owl "Restriction")) subjects))})}
        p {:id (or id (some-> onto local-name slug not-empty) "imported")
           :title (or title (some-> onto (#(pick-literal (concat (objs ix % (str rdfs "label")) (objs ix % (str dcterms "title"))) lang)))
                      (some-> onto local-name) "Imported ontology")
           :brief (or (some-> onto desc-of) "")
           :node-types node-types
           :relations (mapv #(cond-> % (empty? (:from %)) (dissoc :from) (empty? (:to %)) (dissoc :to)) rels)}]
    (if (empty? node-types)
      {:error "no classes (owl:Class or rdfs:Class) in the file" :report report}
      {:profile p :report report})))
