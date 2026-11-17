(ns loretile.blobs
  "Content-addressed blob store — the documents the KG is grounded in.
   Git never sees a blob: the log references {hash}; bytes live here.
   M0: the browser's origin-private file system (OPFS). Online: the org
   bucket under the same names — moving is a copy, no event changes.
   Every fn fails soft (nil) where OPFS is unavailable."
  (:require [promesa.core :as p]))

(defn- root [] (.getDirectory js/navigator.storage))

(defn put!
  "name → bytes (Blob/ArrayBuffer) or text. Resolves to nil either way."
  [name data]
  (-> (p/let [dir (root)
              fh (.getFileHandle dir name #js {:create true})
              w (.createWritable fh)]
        (p/do (.write w data) (.close w)))
      (p/catch (fn [_] nil))))

(defn get-file [name]
  (-> (p/let [dir (root) fh (.getFileHandle dir name)] (.getFile fh))
      (p/catch (fn [_] nil))))

(defn get-text [name]
  (p/let [f (get-file name)] (when f (.text f))))

(defn names []
  (-> (p/let [dir (root)]
        (let [it (.keys dir)]
          (p/loop [acc []]
            (p/let [r (.next it)]
              (if (.-done r) acc (p/recur (conj acc (.-value r))))))))
      (p/catch (fn [_] []))))

(defn save-all-to-folder!
  "Copy every blob into a folder the curator picks (a synced drive, a NAS —
   not the repo). Needs a user gesture; Chrome's File System Access API.
   Resolves to the number of files written."
  []
  (p/let [dir (js/window.showDirectoryPicker #js {:mode "readwrite"})
          ns (names)]
    (p/let [_ (p/all (for [n ns]
                       (p/let [f (get-file n)
                               fh (.getFileHandle dir n #js {:create true})
                               w (.createWritable fh)]
                         (p/do (.write w f) (.close w)))))]
      (count ns))))
