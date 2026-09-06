/**
 * Where in a document something is.
 *
 * One type, so the reader never grows four incompatible ways of saying "take me
 * there". A Contents entry, a find hit, a bookmark and a kept passage all
 * produce one of these and all hand it to the same `goToLocation`, which is the
 * only thing that talks to the renderer.
 *
 * **`rect` is here and nothing sets it.** `react-native-pdf` reports the text of
 * a selection and no geometry, and `onPageSingleTap` reports a touch in view
 * coordinates — a different space from the page, and one that stops meaning
 * anything the moment somebody scrolls. So today every location is a page. The
 * field exists so that a renderer which one day reports quads is a change to the
 * two places that produce locations rather than to every place that consumes
 * one.
 */
export type DocumentLocation = {
  /** 1-based, as the reader sees it at the bottom of the screen. */
  page: number;
  /** Unset on this renderer. See above. */
  rect?: { x: number; y: number; width: number; height: number };
};

/**
 * Which half of the navigator is showing.
 *
 * Four answers to one question — where in this document do I want to be — so
 * they share a sheet rather than competing for buttons in a toolbar that
 * already has five. `contents` is the document's own outline, `bookmarks` and
 * `notes` are what the reader added to it, and `pages` is the document as
 * pictures.
 */
export type NavigatorSegment = 'contents' | 'bookmarks' | 'notes' | 'pages';
