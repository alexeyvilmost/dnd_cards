import '../components/PreviewMotion.css';

/** A virtual pointer at the entity icon's centre; never follows mouse movement.
 * Rows use their thumbnail; text-only links use the whole trigger. Viewport
 * fitting remains the responsibility of the existing popover implementation. */
export function previewAnchor(trigger: Element): { x: number; y: number } {
  const icon = trigger.querySelector('.sheet-item-row-thumb, .forge-square-card-media, .forge-entity-icon, .forge-entity-icon--placeholder')
    ?? trigger.querySelector('img');
  const bounds = (icon ?? trigger).getBoundingClientRect();
  return { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 };
}
