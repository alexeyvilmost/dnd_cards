import type { PaperSheetDocument } from './model';

export const PAPER_BLOCKS = [
  { id: 'proficiencies', label: 'Владение снаряжением и умения', page: 'Персонаж', zone: 'info-left', lssKey: 'prof' },
  { id: 'weapons', label: 'Оружие и боевые заговоры', page: 'Персонаж', zone: 'info-right', lssKey: 'weapons' },
  { id: 'features', label: 'Умения и способности', page: 'Персонаж', zone: 'info-right', lssKey: 'features' },
  { id: 'attacks', label: 'Атаки и заклинания', page: 'Персонаж', zone: 'info-right', lssKey: 'attacks' },
  { id: 'traits', label: 'Черты', page: 'Персонаж', zone: 'info-right', lssKey: 'feats' },
  { id: 'portrait', label: 'Портрет', page: 'История', zone: 'subinfo-left', lssKey: 'avatar' },
  { id: 'inventory', label: 'Инвентарь', page: 'История', zone: 'subinfo-left', lssKey: 'inventory' },
  { id: 'equipped-items', label: 'Снаряжение', page: 'История', zone: 'subinfo-right', lssKey: 'equipment' },
  { id: 'allies', label: 'Союзники и организации', page: 'История', zone: 'subinfo-right', lssKey: 'allies' },
  { id: 'additional', label: 'Дополнительные способности и умения', page: 'История', zone: 'subinfo-right', lssKey: 'traits' },
  ...Array.from({ length: 6 }, (_, index) => ({ id: `notes${index + 1}`, label: `Заметки ${index + 1}`, page: 'Заметки', zone: index % 2 ? 'notes-right' : 'notes-left', lssKey: `notes-${index + 1}` })),
  { id: 'spell-statistics', label: 'Заклинательные характеристики', page: 'Заклинания', zone: '', lssKey: '' },
  { id: 'spell-slots', label: 'Ячейки заклинаний', page: 'Заклинания', zone: '', lssKey: '' },
  { id: 'prepared-spells', label: 'Заговоры и подготовленные заклинания', page: 'Заклинания', zone: '', lssKey: '' },
  { id: 'appearance', label: 'Внешность', page: 'Заклинания', zone: '', lssKey: '' },
  { id: 'backstory', label: 'Предыстория и личные качества', page: 'Заклинания', zone: '', lssKey: '' },
  { id: 'equipment', label: 'Снаряжение и настройка', page: 'Заклинания', zone: '', lssKey: '' },
  { id: 'coins', label: 'Монеты', page: 'Заклинания', zone: '', lssKey: '' },
] as const;

export type PaperBlockId = typeof PAPER_BLOCKS[number]['id'];
const blockIds = new Set<string>(PAPER_BLOCKS.map(block => block.id));
export const isPaperBlockId = (value: string): value is PaperBlockId => blockIds.has(value);
export const blockVisible = (doc: PaperSheetDocument, id: PaperBlockId): boolean => !doc.hiddenBlocks.includes(id);
export const visibleBlocks = (doc: PaperSheetDocument, ids: readonly PaperBlockId[]) => ids.filter(id => blockVisible(doc, id));
export const hideBlock = (doc: PaperSheetDocument, id: PaperBlockId): PaperSheetDocument => doc.hiddenBlocks.includes(id) ? doc : { ...doc, hiddenBlocks: [...doc.hiddenBlocks, id] };
export const restoreBlock = (doc: PaperSheetDocument, id: PaperBlockId): PaperSheetDocument => ({ ...doc, hiddenBlocks: doc.hiddenBlocks.filter(block => block !== id) });
