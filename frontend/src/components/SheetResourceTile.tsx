import { useState, type ReactElement } from 'react';
import type { ValueBreakdown } from '../mvp/contracts';
import { findResource, type ResourceOption } from '../utils/resources';
import ResourceHoverPreview from './ResourceHoverPreview';

const RESOURCE_LABELS: Record<string, string> = {
  action: 'Действие',
  bonus_action: 'Бонус',
  reaction: 'Реакция',
  second_wind: 'Второе дыхание',
  heroic_inspiration: 'Вдохновение',
};

const usableImageUrl = (url?: string): string | undefined =>
  url && !url.startsWith('/charges/') ? url : undefined;

type GlyphKind = 'action' | 'bonus_action' | 'reaction';

const GLYPH_KEYS: Record<string, GlyphKind> = {
  action: 'action',
  main_action: 'action',
  bonus_action: 'bonus_action',
  reaction: 'reaction',
};

const GLYPH_ORDER: Record<GlyphKind, number> = { action: 1, bonus_action: 2, reaction: 3 };
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX'];

const spellSlotLevel = (key: string): number | null => {
  const match = /^spell_slot_([1-9])$/.exec(key);
  return match ? Number(match[1]) : null;
};

const warlockSlotLevel = (key: string): number | null => {
  const match = /^warlock_spell_slot(?:_([1-9]))?$/.exec(key);
  return match ? (match[1] ? Number(match[1]) : 0) : null;
};

const monogram = (label: string): string => {
  const words = label.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  if (words.length === 1) return words[0].slice(0, 2);
  return (words[0][0] + words[1][0]).toUpperCase();
};

/** Shared ordering used by every character-sheet resource strip. */
export function sheetResourceTileOrder(key: string, options: ResourceOption[]): number {
  const glyph = GLYPH_KEYS[key];
  if (glyph) return GLYPH_ORDER[glyph];
  const slot = spellSlotLevel(key);
  if (slot != null) return 100 + slot;
  const warlock = warlockSlotLevel(key);
  if (warlock != null) return 150 + warlock;
  return 1000 + Math.min(findResource(options, key)?.sortOrder ?? 8999, 8999);
}

function ResourceGlyph({ kind, spent }: { kind: GlyphKind; spent: boolean }) {
  const className = `res-tile-glyph${spent ? ' res-tile-glyph--dim' : ''}`;
  if (kind === 'action') {
    return (
      <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="8" fill="#4f9e38" stroke="#9ade6f" strokeWidth="1.6" />
        <circle cx="12" cy="12" r="4.5" fill="#7cc757" opacity="0.55" />
      </svg>
    );
  }
  if (kind === 'bonus_action') {
    return (
      <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
        <polygon points="12,3.5 21,19.5 3,19.5" fill="#d98a2b" stroke="#f4bf6a" strokeWidth="1.6" strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <polygon points="12,3 21,12 12,21 3,12" fill="#8a79d6" stroke="#c2b6f2" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

export default function SheetResourceTile({
  resourceId,
  option,
  current,
  maximum,
  maximumBreakdown,
  selected = false,
  onSelect,
}: {
  resourceId: string;
  option?: ResourceOption;
  current: number;
  maximum: number;
  maximumBreakdown?: ValueBreakdown;
  selected?: boolean;
  onSelect?: () => void;
}) {
  const [failed, setFailed] = useState<Record<string, boolean>>({});
  const markFailed = (src: string) => setFailed((value) => ({ ...value, [src]: true }));
  const spent = current <= 0;
  const slotLevel = spellSlotLevel(resourceId);
  const warlockLevel = warlockSlotLevel(resourceId);
  const label = option?.label
    || (/^hit_dice_d\d+$/.test(resourceId) ? `Кости хитов (к${resourceId.slice('hit_dice_d'.length)})` : undefined)
    || (slotLevel != null ? `Ячейка ${slotLevel}-го круга` : undefined)
    || (warlockLevel != null ? 'Ячейка колдуна' : undefined)
    || RESOURCE_LABELS[resourceId]
    || resourceId;
  const customUrl = usableImageUrl(option?.imageUrl);
  const spentUrl = usableImageUrl(option?.imageUrlSpent);
  const glyphKind = GLYPH_KEYS[resourceId];
  const builtinUrl = slotLevel != null
    ? '/icons/resources/spell_slot.png'
    : warlockLevel != null
      ? '/icons/resources/warlock_spell_slot.png'
      : undefined;

  let icon: ReactElement;
  if (customUrl && !failed[customUrl]) {
    const useSpentImage = spent && !!spentUrl && !failed[spentUrl];
    const src = useSpentImage && spentUrl ? spentUrl : customUrl;
    icon = <img src={src} alt="" className={`res-tile-icon${spent && !useSpentImage ? ' res-tile-icon--dim' : ''}`} onError={() => markFailed(src)} />;
  } else if (glyphKind) {
    icon = <ResourceGlyph kind={glyphKind} spent={spent} />;
  } else if (builtinUrl && !failed[builtinUrl]) {
    icon = <img src={builtinUrl} alt="" className={`res-tile-icon${spent ? ' res-tile-icon--dim' : ''}`} onError={() => markFailed(builtinUrl)} />;
  } else {
    icon = <span className={`res-tile-mono${spent ? ' res-tile-mono--dim' : ''}`}>{monogram(label)}</span>;
  }

  const cornerLevel = slotLevel ?? (warlockLevel && warlockLevel > 0 ? warlockLevel : null);
  const className = `res-tile${spent ? ' res-tile--spent' : ''}${selected ? ' res-tile--selected' : ''}`;
  const contents = (
    <>
      {icon}
      {cornerLevel != null && <span className="res-tile-corner">{ROMAN[cornerLevel - 1]}</span>}
      {maximum > 1 && current !== 1 && <span className="res-tile-count">{current}</span>}
    </>
  );
  return (
    <ResourceHoverPreview resourceId={resourceId} option={option} maximum={maximumBreakdown}>
      {onSelect ? (
        <button
          type="button"
          className={className}
          aria-label={`${label}: ${current}/${maximum}`}
          aria-pressed={selected}
          onClick={onSelect}
        >
          {contents}
        </button>
      ) : (
        <span className={className} aria-label={`${label}: ${current}/${maximum}`}>
          {contents}
        </span>
      )}
    </ResourceHoverPreview>
  );
}
