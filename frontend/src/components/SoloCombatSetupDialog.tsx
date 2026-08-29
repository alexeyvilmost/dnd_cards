import { useEffect, useMemo, useState } from 'react';
import { Minus, Plus, Swords, X } from 'lucide-react';
import { monstersApi } from '../monsters/api';
import type { Monster } from '../monsters/types';
import { charactersV3Api } from '../character/api';
import type { ForgeCharacterPreview } from '../character/types';
import './SoloCombatSetupDialog.css';

export default function SoloCombatSetupDialog({
  characterName,
  characterId,
  onClose,
  onStart,
}: {
  characterName: string;
  characterId: string;
  onClose: () => void;
  onStart: (selection: {
    opponents: Array<{ monster: Monster; quantity: number }>;
    allyId: string | null;
  }) => void;
}) {
  const [monsters, setMonsters] = useState<Monster[]>([]);
  const [allies, setAllies] = useState<ForgeCharacterPreview[]>([]);
  const [selectedAllyId, setSelectedAllyId] = useState<string | null>(null);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    Promise.all([monstersApi.list({ limit: 100 }), charactersV3Api.listPreviews()])
      .then(([response, characters]) => {
        setMonsters(response.monsters);
        setAllies(characters.filter((candidate) => (
          candidate.id !== characterId
          && candidate.access_mode === 'owner'
          && !candidate.current_encounter_id
        )));
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : 'Не удалось загрузить участников'))
      .finally(() => setLoading(false));
  }, [characterId]);
  const total = Object.values(quantities).reduce((sum, value) => sum + value, 0);
  const selected = useMemo(() => monsters.flatMap((monster) => {
    const quantity = quantities[monster.id] ?? 0;
    return quantity > 0 ? [{ monster, quantity }] : [];
  }), [monsters, quantities]);
  const adjust = (id: string, delta: number) => setQuantities((current) => ({
    ...current, [id]: Math.max(0, Math.min(6, (current[id] ?? 0) + delta)),
  }));
  return (
    <div className="solo-setup-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="solo-setup" role="dialog" aria-modal="true" aria-labelledby="solo-setup-title">
        <header><div><p>БОЕВАЯ ПРОВЕРКА</p><h2 id="solo-setup-title">Противники для {characterName}</h2></div><button type="button" onClick={onClose} aria-label="Закрыть"><X /></button></header>
        <p className="solo-setup__hint">Выберите противников и при необходимости пригласите одного союзника из другого своего листа. Каждый участник получает отдельный токен, HP и инициативу.</p>
        {loading && <p>Загрузка бестиария…</p>}
        {error && <p className="solo-setup__error" role="alert">{error}</p>}
        {!loading && (
          <section className="solo-setup__allies" aria-labelledby="solo-setup-allies-title">
            <div><h3 id="solo-setup-allies-title">Союзник из другого листа</h3><p>Союзник получает собственный ход и управляется вами.</p></div>
            {allies.length ? <div className="solo-setup__ally-list">
              {allies.map((ally) => {
                const selectedAlly = ally.id === selectedAllyId;
                return <button
                  type="button"
                  key={ally.id}
                  className={selectedAlly ? 'is-selected' : ''}
                  aria-pressed={selectedAlly}
                  aria-label={selectedAlly ? `Убрать союзника ${ally.name}` : `Пригласить союзника ${ally.name}`}
                  onClick={() => setSelectedAllyId((current) => current === ally.id ? null : ally.id)}
                >
                  <span className="solo-setup__ally-token">{ally.avatar_url ? <img src={ally.avatar_url} alt="" /> : ally.name.slice(0, 1)}</span>
                  <span><b>{ally.name}</b><small>Уровень {ally.level} · HP {ally.current_hp}/{ally.max_hp}</small></span>
                </button>;
              })}
            </div> : <p className="solo-setup__no-allies">Нет доступных союзников.</p>}
          </section>
        )}
        <div className="solo-setup__list">
          {monsters.map((monster) => {
            const quantity = quantities[monster.id] ?? 0;
            return <article key={monster.id} className={quantity ? 'is-selected' : ''}>
              <div className="solo-setup__token">{monster.token_url ? <img src={monster.token_url} alt="" /> : monster.name.slice(0, 1)}</div>
              <div><h3>{monster.name}</h3><p>КЗ {monster.armor_class} · {monster.max_hp} HP · скорость {monster.speed} · ПО {monster.challenge_rating}</p></div>
              <div className="solo-setup__counter"><button type="button" onClick={() => adjust(monster.id, -1)} disabled={!quantity}><Minus size={15} /></button><output aria-label={`Количество ${monster.name}`}>{quantity}</output><button type="button" onClick={() => adjust(monster.id, 1)}><Plus size={15} /></button></div>
            </article>;
          })}
        </div>
        <footer><span>{total ? `Противников: ${total}${selectedAllyId ? ' · союзник приглашён' : ''}` : 'Противники не выбраны'}</span><button type="button" className="solo-setup__start" disabled={!total} onClick={() => onStart({ opponents: selected, allyId: selectedAllyId })}><Swords size={18} /> Начать бой</button></footer>
      </section>
    </div>
  );
}
