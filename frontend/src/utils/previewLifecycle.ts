/** A picker/navigation change invalidates previews anchored to its old content. */
export const DISMISS_ENTITY_PREVIEWS = 'boh:dismiss-entity-previews';
let awaitPointerMotion = false;
const resumePointerPreviews = () => { awaitPointerMotion = false; };
export const pointerPreviewsSuppressed = () => awaitPointerMotion;
export function dismissEntityPreviews() {
  // A layout transition can put a new card under a stationary pointer. Do not
  // interpret that synthetic enter as a new request to pin another preview.
  awaitPointerMotion = true;
  window.removeEventListener('pointermove',resumePointerPreviews);
  window.addEventListener('pointermove',resumePointerPreviews,{once:true});
  window.dispatchEvent(new Event(DISMISS_ENTITY_PREVIEWS));
}
