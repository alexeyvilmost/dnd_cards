import { useEffect, useMemo, useState } from 'react';
import { Minus, Plus, Swords, X } from 'lucide-react';
import { monstersApi } from '../monsters/api';
import type { Monster } from '../monsters/types';
import './SoloCombatSetupDialog.css';

export default function SoloCombatSetupDialog({
  characterName,
  onClose,
  onStart,
}: {
  characterName: string;
  onClose: () => void;
  onStart: (selected: Array<{ monster: Monster; quantity: number }>) => void;
}) {
  const [monsters, setMonsters] = useState<Monster[]>([]);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    monstersApi.list({ limit: 100 })
      .then((response) => setMonsters(response.monsters))
      .catch((reason) => setError(reason instanceof Error ? reason.message : 'Не удалось загрузить противников'))
      .finally(() => setLoading(false));
  }, []);
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
        <p className="solo-setup__hint">Выберите отряд. Каждый противник получает отдельный токен, HP и место в инициативе.</p>
        {loading && <p>Загрузка бестиария…</p>}
        {error && <p className="solo-setup__error" role="alert">{error}</p>}
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
        <footer><span>{total ? `Противников: ${total}` : 'Противники не выбраны'}</span><button type="button" className="solo-setup__start" disabled={!total} onClick={() => onStart(selected)}><Swords size={18} /> Начать бой</button></footer>
      </section>
    </div>
  );
}
