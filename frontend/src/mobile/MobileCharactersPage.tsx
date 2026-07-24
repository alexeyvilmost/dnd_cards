import { useEffect, useMemo, useRef, useState } from 'react';
import { Copy, MoreVertical, Pencil, Plus, Shield, Sparkles, Trash2 } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { classesApi, racesApi } from '../api/client';
import { charactersV3Api } from '../character/api';
import type { ForgeCharacter, SaveForgeCharacterRequest } from '../character/types';
import type { CharacterClass, Race } from '../types';
import './mobile.css';

function clonePayload(character: ForgeCharacter): SaveForgeCharacterRequest {
  return {
    name: `${character.name || 'Без имени'} — копия`,
    avatar_url: character.avatar_url,
    description: character.description ?? '',
    notes: character.notes ?? '',
    race_id: character.race_id,
    lineage_id: character.lineage_id,
    class_id: character.class_id,
    background_id: character.background_id,
    level: character.level,
    feat_ids: [...(character.feat_ids ?? [])],
    spell_ids: [...(character.spell_ids ?? [])],
    action_ids: [...(character.action_ids ?? [])],
    effect_ids: [...(character.effect_ids ?? [])],
    resource_ids: [...(character.resource_ids ?? [])],
    abilities: { ...(character.abilities ?? {}) },
    skill_proficiencies: [...(character.skill_proficiencies ?? [])],
    skill_expertise: [...(character.skill_expertise ?? [])],
    saving_throw_proficiencies: [...(character.saving_throw_proficiencies ?? [])],
    tool_proficiencies: [...(character.tool_proficiencies ?? [])],
    tool_expertise: [...(character.tool_expertise ?? [])],
    languages: [...(character.languages ?? [])],
    resolved_choices: { ...(character.resolved_choices ?? {}) },
    rule_state: character.rule_state,
    max_hp: character.max_hp,
    current_hp: character.max_hp,
    speed: character.speed,
    proficiency_bonus: character.proficiency_bonus,
    armor_class: character.armor_class,
    initiative_bonus: character.initiative_bonus,
    passive_perception: character.passive_perception,
  };
}

export default function MobileCharactersPage() {
  const navigate = useNavigate();
  const [characters, setCharacters] = useState<ForgeCharacter[]>([]);
  const [races, setRaces] = useState<Race[]>([]);
  const [classes, setClasses] = useState<CharacterClass[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let stale = false;
    (async () => {
      setLoading(true);
      try {
        const [list, raceResult, classResult] = await Promise.all([
          charactersV3Api.list(),
          racesApi.getRaces({ limit: 200 }).catch(() => ({ races: [] as Race[] })),
          classesApi.getClasses({ limit: 200 }).catch(() => ({ classes: [] as CharacterClass[] })),
        ]);
        if (stale) return;
        setCharacters(list);
        setRaces(raceResult.races ?? []);
        setClasses(classResult.classes ?? []);
      } catch (e) {
        console.error(e);
        if (!stale) setError('Не удалось загрузить персонажей');
      } finally {
        if (!stale) setLoading(false);
      }
    })();
    return () => { stale = true; };
  }, []);

  useEffect(() => {
    if (!menuId) return;
    const close = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuId(null);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [menuId]);

  const raceNames = useMemo(() => new Map(races.map((race) => [race.id, race.name])), [races]);
  const classNames = useMemo(() => new Map(classes.map((klass) => [klass.id, klass.name])), [classes]);

  const subtitle = (character: ForgeCharacter) => [
    character.race_id ? raceNames.get(character.race_id) : null,
    character.class_id ? classNames.get(character.class_id) : null,
    `ур. ${character.level}`,
  ].filter(Boolean).join(' · ');

  const duplicate = async (character: ForgeCharacter) => {
    setBusyId(character.id);
    setError(null);
    try {
      const created = await charactersV3Api.create(clonePayload(character));
      setCharacters((prev) => [created, ...prev]);
      setMenuId(null);
    } catch (e) {
      console.error(e);
      setError('Не удалось дублировать персонажа');
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (character: ForgeCharacter) => {
    setBusyId(character.id);
    setError(null);
    try {
      await charactersV3Api.remove(character.id);
      setCharacters((prev) => prev.filter((item) => item.id !== character.id));
      setConfirmDeleteId(null);
      setMenuId(null);
    } catch (e) {
      console.error(e);
      setError('Не удалось удалить персонажа');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <main className="m-app m-character-list">
      <header className="m-page-header">
        <div>
          <span className="m-eyebrow">Bag of Holding</span>
          <h1>Персонажи</h1>
        </div>
        <Link to="/m/characters/new" className="m-icon-button m-icon-button--gold" aria-label="Создать персонажа">
          <Plus size={22} />
        </Link>
      </header>

      <div className="m-page-body">
        {error && <div className="m-alert m-alert--error">{error}</div>}
        {loading && <div className="m-empty">Загружаем ваших героев…</div>}

        {!loading && characters.length === 0 && (
          <section className="m-empty m-empty--panel">
            <Sparkles size={34} />
            <h2>Пора создать первого героя</h2>
            <p>Мобильный мастер проведёт по основным шагам создания персонажа первого уровня.</p>
            <Link to="/m/characters/new" className="m-button m-button--gold">
              <Plus size={18} /> Создать персонажа
            </Link>
          </section>
        )}

        <div className="m-character-grid">
          {characters.map((character) => (
            <article key={character.id} className="m-character-card">
              <div className="m-character-card-top">
                <div className="m-avatar" aria-hidden>
                  {character.avatar_url
                    ? <img src={character.avatar_url} alt="" />
                    : <span>{(character.name || '?').slice(0, 1).toUpperCase()}</span>}
                </div>
                <div className="m-character-meta">
                  <h2>{character.name || 'Без имени'}</h2>
                  <p>{subtitle(character)}</p>
                </div>
                <div className="m-card-menu" ref={menuId === character.id ? menuRef : undefined}>
                  <button
                    type="button"
                    className="m-icon-button"
                    aria-label={`Действия: ${character.name}`}
                    aria-expanded={menuId === character.id}
                    onClick={() => setMenuId((prev) => prev === character.id ? null : character.id)}
                  >
                    <MoreVertical size={20} />
                  </button>
                  {menuId === character.id && (
                    <div className="m-menu" role="menu">
                      <button type="button" role="menuitem" onClick={() => navigate(`/m/characters/${character.id}/edit`)}>
                        <Pencil size={16} /> Редактировать
                      </button>
                      <button type="button" role="menuitem" onClick={() => navigate(`/m/characters/${character.id}/level-up`)}>
                        <Sparkles size={16} /> Повысить уровень
                      </button>
                      <button type="button" role="menuitem" disabled={busyId === character.id} onClick={() => duplicate(character)}>
                        <Copy size={16} /> Дублировать
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        className="is-danger"
                        onClick={() => setConfirmDeleteId(character.id)}
                      >
                        <Trash2 size={16} /> Удалить
                      </button>
                    </div>
                  )}
                </div>
              </div>

              <div className="m-character-stats">
                <span><strong>{character.current_hp}</strong>/{character.max_hp} HP</span>
                <span><Shield size={14} /> КЗ <strong>{character.armor_class ?? 10}</strong></span>
                {character.current_encounter_id && <span className="is-battle">В бою</span>}
              </div>

              <Link to={`/m/characters/${character.id}`} className="m-button m-button--wide m-button--gold">
                Открыть
              </Link>

              {confirmDeleteId === character.id && (
                <div className="m-inline-confirm" role="alertdialog" aria-label="Удалить персонажа?">
                  <p>Удалить «{character.name}»? Это действие нельзя отменить.</p>
                  <div>
                    <button type="button" className="m-button" onClick={() => setConfirmDeleteId(null)}>Отмена</button>
                    <button
                      type="button"
                      className="m-button m-button--danger"
                      disabled={busyId === character.id}
                      onClick={() => remove(character)}
                    >
                      Удалить
                    </button>
                  </div>
                </div>
              )}
            </article>
          ))}
        </div>
      </div>

      {characters.length > 0 && (
        <Link to="/m/characters/new" className="m-create-fab">
          <Plus size={20} /> Новый персонаж
        </Link>
      )}
    </main>
  );
}
