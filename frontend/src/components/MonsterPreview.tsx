import { Link } from 'react-router-dom';
import { Heart, Shield, Footprints } from 'lucide-react';
import type { Monster } from '../monsters/types';
import SupportStatusBadge from './forge/SupportStatusBadge';

const ABILITY_LABELS = { str: 'СИЛ', dex: 'ЛВК', con: 'ТЕЛ', int: 'ИНТ', wis: 'МДР', cha: 'ХАР' } as const;

export default function MonsterPreview({ monster }: { monster: Monster }) {
  return (
    <article className="monster-card" data-testid={`monster-card-${monster.slug}`}>
      <div className="monster-card__token">
        {monster.token_url
          ? <img src={monster.token_url} alt={`Токен: ${monster.name}`} />
          : <span>{monster.name.slice(0, 1).toUpperCase()}</span>}
      </div>
      <div className="monster-card__body">
        <div className="monster-card__title-row">
          <div>
            <h3>{monster.name}</h3>
            <p>{monster.size} · {monster.creature_type} · ПО {monster.challenge_rating}</p>
          </div>
          <SupportStatusBadge entity={monster} compact />
        </div>
        <div className="monster-card__vitals">
          <span><Shield size={14} /> КЗ {monster.armor_class}</span>
          <span><Heart size={14} /> {monster.max_hp} HP</span>
          <span><Footprints size={14} /> {monster.speed} фт.</span>
        </div>
        <div className="monster-card__abilities">
          {Object.entries(ABILITY_LABELS).map(([ability, label]) => (
            <span key={ability}><b>{label}</b>{monster.abilities[ability as keyof typeof ABILITY_LABELS]}</span>
          ))}
        </div>
        <p className="monster-card__description">{monster.description}</p>
        <div className="monster-card__footer">
          <span>{monster.action_ids.length} действий · {monster.effect_ids.length} эффектов</span>
          <Link to={`/monster-forge/${monster.id}`}>Открыть конструктор</Link>
        </div>
      </div>
    </article>
  );
}
