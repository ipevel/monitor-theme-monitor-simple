/**
 * Session key guarding the single automatic reload that follows a failed chunk
 * load.
 *
 * A theme is replaced in place and the panel switches to it without a restart,
 * while the filenames in `dist/` carry a content hash. A visitor still holding
 * the previous `index.html` therefore asks for chunks that are gone: the lazy
 * import rejects, nothing catches it, and the page goes blank -- and reloading
 * by hand does not help either, because the browser serves the same stale HTML
 * from cache. One reload gets fresh HTML, and this key stops that from looping.
 */
export const CHUNK_RELOAD_KEY = "monitor-simple:chunk-reload"
