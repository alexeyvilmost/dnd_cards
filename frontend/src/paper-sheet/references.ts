export const PAPER_ENTITY_TYPES = ['card', 'spell', 'action', 'feat', 'effect'] as const;
export type PaperEntityType = typeof PAPER_ENTITY_TYPES[number];
export interface PaperLibraryEntity { type: PaperEntityType; id: string; name: string }
const LABELS: Record<PaperEntityType, string> = { card: 'Предмет', spell: 'Заклинание', action: 'Действие', feat: 'Черта', effect: 'Эффект' };

// Use the site's existing [[label|type:id]] reference format. Names are snapshots;
// previews and detail views resolve the stable library ID through the shared registry.
export const PAPER_ENTITY_TOKEN_PATTERN = /\[\[[^\]|\r\n]+\|(?:card|spell|action|feat|effect):[\w-]+\]\]/g;

export function paperEntityToken(entity: PaperLibraryEntity): string {
  const name = entity.name.replace(/[[\]|{}\r\n]/g, ' ').replace(/\s+/g, ' ').trim();
  return `[[${name || LABELS[entity.type]}|${entity.type}:${entity.id}]]`;
}

export function parsePaperEntityToken(text: string): PaperLibraryEntity | null {
  const match = /^\[\[([^\]|\r\n]+)\|(card|spell|action|feat|effect):([\w-]+)\]\]$/.exec(text);
  return match ? { name: match[1], type: match[2] as PaperEntityType, id: match[3] } : null;
}

export function plainPaperEntities(text: string): string {
  return text.replace(PAPER_ENTITY_TOKEN_PATTERN, token => parsePaperEntityToken(token)?.name ?? token);
}
