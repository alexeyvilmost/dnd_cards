export type LibraryContentType = 'cards' | 'effects' | 'actions' | 'spells' | 'feats' | 'backgrounds' | 'races' | 'classes';
export type LibraryViewMode = 'grid' | 'list';

export interface LibraryFilters {
  contentType: LibraryContentType;
  search: string;
  rarity: string;
  properties: string;
  templateType: string;
  slot: string;
  armorType: string;
  sortBy: string;
  viewMode: LibraryViewMode;
}

const FILTER_KEYS = ['type', 'q', 'rarity', 'properties', 'template', 'slot', 'armor', 'sort', 'view'] as const;

export function parseLibrarySearchParams(params: URLSearchParams): LibraryFilters {
  const type = params.get('type');
  const view = params.get('view');

  return {
    contentType:
      type === 'effects' || type === 'actions' || type === 'spells' || type === 'feats' || type === 'backgrounds' || type === 'races' || type === 'classes'
        ? type
        : 'cards',
    search: params.get('q') ?? '',
    rarity: params.get('rarity') ?? '',
    properties: params.get('properties') ?? '',
    templateType: params.get('template') ?? 'cards',
    slot: params.get('slot') ?? '',
    armorType: params.get('armor') ?? '',
    sortBy: params.get('sort') ?? 'created_desc',
    viewMode: view === 'grid' ? 'grid' : 'list',
  };
}

export function buildLibrarySearchParams(
  filters: LibraryFilters,
  existing?: URLSearchParams
): URLSearchParams {
  const params = new URLSearchParams(existing ?? undefined);

  for (const key of FILTER_KEYS) {
    params.delete(key);
  }

  if (filters.contentType !== 'cards') {
    params.set('type', filters.contentType);
  }
  if (filters.search) {
    params.set('q', filters.search);
  }
  if (filters.rarity) {
    params.set('rarity', filters.rarity);
  }
  if (filters.properties) {
    params.set('properties', filters.properties);
  }
  if (filters.templateType && filters.templateType !== 'cards') {
    params.set('template', filters.templateType);
  }
  if (filters.slot) {
    params.set('slot', filters.slot);
  }
  if (filters.armorType) {
    params.set('armor', filters.armorType);
  }
  if (filters.sortBy && filters.sortBy !== 'created_desc') {
    params.set('sort', filters.sortBy);
  }
  if (filters.viewMode === 'grid') {
    params.set('view', 'grid');
  }

  return params;
}

export function libraryParamsMatch(a: URLSearchParams, b: URLSearchParams): boolean {
  const normalize = (params: URLSearchParams) => {
    const entries = [...params.entries()]
      .filter(([key]) => key !== 'card')
      .sort(([ka, va], [kb, vb]) => ka.localeCompare(kb) || va.localeCompare(vb));
    return JSON.stringify(entries);
  };
  return normalize(a) === normalize(b);
}
