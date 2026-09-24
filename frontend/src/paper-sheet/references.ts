export type PaperEntityType = 'card' | 'spell';
export interface PaperLibraryEntity { type: PaperEntityType; id: string; name: string }

// Use the site's existing [[label|type:id]] reference format. Names are snapshots;
// previews and detail views resolve the stable library ID through the shared registry.
export const PAPER_ENTITY_TOKEN_PATTERN = /\[\[[^\]|\r\n]+\|(?:card|spell):[\w-]+\]\]/g;

export function paperEntityToken(entity: PaperLibraryEntity): string {
  const name = entity.name.replace(/[[\]|{}\r\n]/g, ' ').replace(/\s+/g, ' ').trim();
  return `[[${name || (entity.type === 'card' ? 'Предмет' : 'Заклинание')}|${entity.type}:${entity.id}]]`;
}

export function parsePaperEntityToken(text: string): PaperLibraryEntity | null {
  const match = /^\[\[([^\]|\r\n]+)\|(card|spell):([\w-]+)\]\]$/.exec(text);
  return match ? { name: match[1], type: match[2] as PaperEntityType, id: match[3] } : null;
}
