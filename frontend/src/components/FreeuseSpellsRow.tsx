/**
 * Витрина «Бесплатные заклинания» (freeuse): список заклинаний с бесплатными
 * использованиями и их запасом («Туманный шаг 1/2»). Пулы freeuse-<spell> скрыты из
 * общего ряда плиток и агрегируются здесь. Иконка/название — из справочника ресурсов
 * (id `freeuse-spells`, создан владельцем). Рендерится в SheetRuntimePanel и SheetActionsPanel.
 */
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

export default function FreeuseSpellsRow({ runtime, freeuseSpells, spells, resourceOptions }: Props) {
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

  return (
    <div style={{
      marginTop: 6, padding: '6px 8px', borderRadius: 8,
      border: '1px solid #6b5836', background: '#1c1813', color: '#e8e0d0',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, fontSize: 12, color: '#d8b978' }}>
        {def?.imageUrl && !def.imageUrl.startsWith('/charges/') && (
          <img src={def.imageUrl} alt="" style={{ width: 16, height: 16, objectFit: 'contain' }} />
        )}
        <span>{label}</span>
      </div>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        {rows.map((r) => (
          <li key={r.key} style={{
            display: 'flex', justifyContent: 'space-between', fontSize: 13,
            opacity: r.cur <= 0 ? 0.5 : 1,
          }}>
            <span>{r.name}</span>
            <span style={{ color: r.cur <= 0 ? '#a99f8b' : '#d8b978' }}>{r.cur}/{r.max}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
