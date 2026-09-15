import type {Action} from '../types';

/** Presentation adapter for data-granted actions without a standalone DB row.
 * Executable mechanics remain unchanged; no rule is inferred from the name. */
export function grantedActionPresentation(source: {
  id: string; name: string; description: string; imageUrl?: string; mechanics: Record<string, unknown>;
}): Action {
  return {id: source.id, name: source.name, description: source.description,
    image_url: source.imageUrl, mechanics: source.mechanics, rarity: 'common', card_number: '',
    resource: 'free_action', action_type: 'base_action', created_at: '', updated_at: ''};
}
