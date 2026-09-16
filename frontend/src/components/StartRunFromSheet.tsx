import {useState} from 'react';
import {useNavigate} from 'react-router-dom';
import {roguelikeApi} from '../roguelike/api';
import {isRunEligible} from '../roguelike/eligibility';
import type {ForgeCharacter} from '../character/types';

export default function StartRunFromSheet({character, eligibleClassId}: {character: ForgeCharacter; eligibleClassId?: string}) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!isRunEligible(character, eligibleClassId)) return null;
  const start = async () => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const existing = (await roguelikeApi.list()).find(run => run.source_character_id === character.id && run.status === 'active');
      const run = existing ?? await roguelikeApi.create(character.id);
      navigate(`/roguelike/${run.id}`);
    } catch (e) {setError(e instanceof Error ? e.message : 'Не удалось начать забег');}
    finally {setBusy(false);}
  };
  return <>
    <button type="button" className="sheet-header-btn" disabled={busy} onClick={() => void start()}
      aria-description="Начать отдельный забег за этого персонажа. Исходный лист не изменится.">{busy ? 'Создаём…' : 'Начать забег'}</button>
    {error && <span role="alert">{error}</span>}
  </>;
}
