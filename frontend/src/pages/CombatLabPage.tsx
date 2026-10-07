import {useEffect, useState} from 'react';
import {Link, useNavigate, useParams} from 'react-router-dom';
import {charactersV3Api, characterV3ErrorMessage} from '../character/api';
import type {ForgeCharacterPreview} from '../character/types';
import {monstersApi} from '../monsters/api';
import type {Monster} from '../monsters/types';
import {clearLaboratorySession} from '../solo-combat/laboratorySession';
import SoloCombatPage from './SoloCombatPage';
import './CharacterForge.css';
import './CharactersRoster.css';

export default function CombatLabPage() {
  const {id} = useParams();
  const navigate = useNavigate();
  const [characters, setCharacters] = useState<ForgeCharacterPreview[]>([]);
  const [monsters, setMonsters] = useState<Monster[]>([]);
  const [characterId, setCharacterId] = useState('');
  const [monsterId, setMonsterId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    if(id) return;
    let active = true;
    void Promise.all([charactersV3Api.listPreviews(), monstersApi.list({page:1,limit:100})])
      .then(([rows, catalog]) => {
        if(!active) return;
        const owned = rows.filter(row => row.access_mode === 'owner' && row.character_type !== 'dungeon_crawl');
        setCharacters(owned); setMonsters(catalog.monsters);
        setCharacterId(owned[0]?.id ?? ''); setMonsterId(catalog.monsters[0]?.id ?? '');
      }).catch(reason => {if(active)setError(characterV3ErrorMessage(reason,'Не удалось загрузить участников'));})
      .finally(() => {if(active)setLoading(false);});
    return () => {active=false;};
  },[id]);
  if(id) return <SoloCombatPage key={id} laboratory />;
  const start = () => {
    if(!characterId || !monsterId) return;
    try {
      clearLaboratorySession(characterId);
      navigate(`/combat-lab/${characterId}?${monsterId}=${quantity}`);
    } catch {setError('Не удалось сохранить тестовую сцену в этом браузере.');}
  };
  return <main className="forge combat-lab-setup"><section className="sheet-scroll">
    <span className="forge-note">ПОЛИГОН</span><h1>Тестовый бой</h1>
    <p>Обычные правила, броски и заклинания. Сцена сохраняется в этом браузере; здоровье, предметы и ресурсы исходных персонажей не изменяются.</p>
    <p>Во время боя откройте «Сцена», чтобы сменить карту, добавить участников, изменить инициативу или восстановить ресурсы.</p>
    {error && <p className="issues" role="alert">{error}</p>}
    {loading ? <p role="status">Загружаем участников…</p> : <>
      {!characters.length ? <p>Сначала <Link to="/character-forge">создайте стандартного персонажа</Link>.</p> :
        <div className="combat-lab-fields">
          <label>Персонаж<select aria-label="Персонаж" value={characterId} onChange={event => setCharacterId(event.target.value)}>{characters.map(row => <option key={row.id} value={row.id}>{row.name} · уровень {row.level}</option>)}</select></label>
          <label>Противник<select aria-label="Противник" value={monsterId} onChange={event => setMonsterId(event.target.value)}>{monsters.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
          <label>Количество<input aria-label="Количество" type="number" min={1} max={12} value={quantity} onChange={event => setQuantity(Math.max(1,Math.min(12,Number(event.target.value) || 1)))} /></label>
          <button type="button" className="forge-btn" disabled={!monsterId || !characterId} onClick={start}>Создать тестовую сцену</button>
        </div>}
    </>}
    <Link to="/characters-forge" className="forge-btn ghost">К персонажам</Link>
  </section></main>;
}
