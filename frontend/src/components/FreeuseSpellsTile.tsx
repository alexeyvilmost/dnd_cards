/**
 * Плитка «Бесплатные заклинания» (freeuse) в общем ряду ресурсов: одна иконка (из справочника
 * ресурсов, id `freeuse-spells`), при наведении — поповер со списком заклинаний и остатком
 * бесплатных использований («Туманный шаг 2/2»). Заменяет прежний список-блок под рядом.
 * Пулы freeuse-<spell> скрыты из ряда (isFreeusePoolKey) и агрегируются здесь.
 */
import { useState } from 'react';
import type { RuntimeState } from '../mvp/contracts';
import type { FreeuseSpec } from '../engine/freeuse';
import { freeuseKey, FREEUSE_SHOWCASE_KEY } from '../engine/freeuse';
import type { Spell } from '../types';
import { findResource } from '../utils/resources';
import type { ResourceOption } from '../utils/resources';

interface Props {
  runtime: RuntimeState;
  freeuseSpells: FreeuseSpec[];
  spells: Spell[];
  resourceOptions: ResourceOption[];
}

export default function FreeuseSpellsTile({ runtime, freeuseSpells, spells, resourceOptions }: Props) {
  const [hovered, setHovered] = useState(false);

  const rows = freeuseSpells
    .map((spec) => {
      const key = freeuseKey(spec.spell);
      const spell = spells.find((s) => s.card_number === spec.spell || s.id === spec.spell);
      return { key, name: spell?.name ?? spec.spell, cur: runtime.resources[key] ?? 0, max: runtime.maxResources[key] ?? 0 };
    })
    .filter((r) => r.max > 0);
  if (!rows.length) return null;

  const def = findResource(resourceOptions, FREEUSE_SHOWCASE_KEY);
  const label = def?.label || 'Бесплатные заклинания';
  const icon = def?.imageUrl && !def.imageUrl.startsWith('/charges/') ? def.imageUrl : undefined;
  const totalRemaining = rows.reduce((s, r) => s + Math.max(0, r.cur), 0);
  const allSpent = totalRemaining <= 0;
  return (
    <span
      className={`res-tile${allSpent ? ' res-tile--spent' : ''}`}
      style={{ position: 'relative' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {icon
        ? <img src={icon} alt="" className={`res-tile-icon${allSpent ? ' res-tile-icon--dim' : ''}`} />
        : <span className={`res-tile-mono${allSpent ? ' res-tile-mono--dim' : ''}`}>Бз</span>}
      {totalRemaining > 0 && <span className="res-tile-count">{totalRemaining}</span>}

      {hovered && (
        <div
          role="tooltip"
          style={{
            position: 'absolute', top: '100%', left: '50%', transform: 'translateX(-50%)',
            marginTop: 6, zIndex: 60, minWidth: 180, maxWidth: 260,
            padding: '6px 8px', borderRadius: 8,
            border: '1px solid #8a7320', background: '#1c1813', color: '#e8e0d0',
            boxShadow: '0 6px 20px rgba(0,0,0,0.5)', pointerEvents: 'none',
          }}
        >
          <div style={{ fontSize: 12, color: '#d8b978', marginBottom: 4 }}>{label}</div>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
            {rows.map((r) => (
              <li key={r.key} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13, opacity: r.cur <= 0 ? 0.5 : 1 }}>
                <span>{r.name}</span>
                <span style={{ color: r.cur <= 0 ? '#a99f8b' : '#d8b978', whiteSpace: 'nowrap' }}>{r.cur}/{r.max}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </span>
  );
}
