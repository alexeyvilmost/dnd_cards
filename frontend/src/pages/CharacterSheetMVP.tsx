import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Pencil } from 'lucide-react';
import { charactersV3Api } from '../character/api';
import { loadAssembly, type AssembledCharacter } from '../character/assemble';
import { characterToDraft, finalSaves } from '../character/forgeHelpers';
import {
  ABILITY_KEYS,
  ABILITY_LABEL_RU,
  type ForgeCharacter,
} from '../character/types';
import { abilityMod, savingThrowBonus, skillBonus } from '../character/derive';
import { labelOf, SKILLS } from '../mechanics/registries';
import { getSpellLevelLabel } from '../types';
import './CharacterForge.css';

const fmtMod = (n: number) => (n >= 0 ? `+${n}` : String(n));

const CharacterSheetMVP = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [character, setCharacter] = useState<ForgeCharacter | null>(null);
  const [assembled, setAssembled] = useState<AssembledCharacter | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let stale = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const c = await charactersV3Api.get(id);
        if (stale) return;
        setCharacter(c);
        const draft = characterToDraft(c);
        const asm = await loadAssembly(draft);
        if (!stale) setAssembled(asm);
      } catch (e) {
        console.error(e);
        if (!stale) setError('Не удалось загрузить лист персонажа');
      } finally {
        if (!stale) setLoading(false);
      }
    })();
    return () => { stale = true; };
  }, [id]);

  const draft = useMemo(() => (character ? characterToDraft(character) : null), [character]);

  const lineageName = useMemo(() => {
    if (!draft?.lineageId || !assembled?.race?.lineages) return draft?.lineageId ?? null;
    return assembled.race.lineages.find((l) => l.name === draft.lineageId)?.name || draft.lineageId;
  }, [assembled?.race?.lineages, draft?.lineageId]);

  const spellsByLevel = useMemo(() => {
    const map = new Map<number, NonNullable<AssembledCharacter['spells']>>();
    for (const spell of assembled?.spells || []) {
      const lvl = spell.level ?? 0;
      if (!map.has(lvl)) map.set(lvl, []);
      map.get(lvl)!.push(spell);
    }
    return [...map.entries()].sort((a, b) => a[0] - b[0]);
  }, [assembled?.spells]);

  if (loading) {
    return (
      <div className="forge">
        <div className="forge-header">Лист персонажа</div>
        <div className="sheet-loading">Загрузка…</div>
      </div>
    );
  }

  if (error || !character || !assembled || !draft) {
    return (
      <div className="forge">
        <div className="forge-header">Лист персонажа</div>
        <div className="sheet-loading">
          <p className="issues">{error || 'Персонаж не найден'}</p>
          <button type="button" className="forge-btn ghost" onClick={() => navigate('/character-forge')}>
            К конструктору
          </button>
        </div>
      </div>
    );
  }

  const skills = character.skill_proficiencies || [];
  const saves = character.saving_throw_proficiencies || finalSaves(assembled);
  const scores = draft.abilities;
  const pb = character.proficiency_bonus ?? assembled.derived.proficiencyBonus;

  const { derived } = assembled;
  const maxHP = character.max_hp ?? derived.maxHP;
  const currentHP = character.current_hp ?? maxHP;
  const speed = character.speed ?? derived.speed;
  const ac = derived.ac;
  const initiative = derived.initiative;
  const spellcasting = derived.spellcasting;

  const headerLine = [
    assembled.race?.name,
    lineageName,
    assembled.klass ? `${assembled.klass.name} ${draft.level}` : null,
    assembled.background?.name,
  ].filter(Boolean).join(' · ');

  return (
    <div className="forge">
      <div className="forge-header sheet-header-bar">
        <button type="button" className="sheet-back" onClick={() => navigate(-1)} title="Назад">
          <ArrowLeft size={18} />
        </button>
        <span>Лист персонажа</span>
        <Link to={`/character-forge/${character.id}`} className="sheet-edit" title="Редактировать">
          <Pencil size={16} />
        </Link>
      </div>

      <div className="sheet-scroll">
        <section className="sheet-hero">
          <h1 className="sheet-name">{character.name}</h1>
          <p className="sheet-subtitle">{headerLine || '—'}</p>
        </section>

        <div className="sheet-grid">
          <section className="sheet-panel">
            <h2 className="sheet-h2">Характеристики</h2>
            <div className="sheet-abilities">
              {ABILITY_KEYS.map((k) => {
                const score = scores[k] ?? 10;
                const mod = abilityMod(scores[k]);
                return (
                  <div key={k} className="sheet-ab">
                    <div className="sheet-ab-label">{ABILITY_LABEL_RU[k]}</div>
                    <div className="sheet-ab-score">{score}</div>
                    <div className="sheet-ab-mod">{fmtMod(mod)}</div>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="sheet-panel">
            <h2 className="sheet-h2">Бой</h2>
            <div className="sheet-stats">
              <div className="sheet-stat"><span>КД</span><strong>{ac}</strong></div>
              <div className="sheet-stat"><span>HP</span><strong>{currentHP}/{maxHP}</strong></div>
              <div className="sheet-stat"><span>Скорость</span><strong>{speed} фт</strong></div>
              <div className="sheet-stat"><span>Инициатива</span><strong>{fmtMod(initiative)}</strong></div>
              <div className="sheet-stat"><span>БМ</span><strong>{fmtMod(pb)}</strong></div>
            </div>
            {spellcasting && (
              <div className="sheet-spellcasting">
                <div>Заклинания ({ABILITY_LABEL_RU[spellcasting.ability]})</div>
                <div>DC {spellcasting.saveDC} · атака {fmtMod(spellcasting.attack)}</div>
              </div>
            )}
          </section>

          <section className="sheet-panel">
            <h2 className="sheet-h2">Спасброски</h2>
            <ul className="sheet-list">
              {ABILITY_KEYS.map((k) => {
                const proficient = saves.includes(k);
                const bonus = savingThrowBonus(k, scores, proficient, pb);
                return (
                  <li key={k}>
                    <span className={proficient ? 'sheet-prof' : ''}>{ABILITY_LABEL_RU[k]}</span>
                    <span>{fmtMod(bonus)}</span>
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="sheet-panel sheet-panel-wide">
            <h2 className="sheet-h2">Навыки</h2>
            <ul className="sheet-list sheet-skills">
              {SKILLS.map((skill) => {
                const proficient = skills.includes(skill.id) || skills.includes(skill.label);
                const bonus = skillBonus(skill.id, scores, proficient, pb);
                return (
                  <li key={skill.id}>
                    <span className={proficient ? 'sheet-prof' : ''}>{skill.label}</span>
                    <span>{fmtMod(bonus)}</span>
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="sheet-panel sheet-panel-wide">
            <h2 className="sheet-h2">Черты и способности</h2>
            {assembled.feats.length > 0 && (
              <div className="sheet-group">
                <h3 className="sheet-h3">Черты</h3>
                <ul className="sheet-tags">
                  {assembled.feats.map((f) => <li key={f.id}>{f.name}</li>)}
                </ul>
              </div>
            )}
            {assembled.effects.length > 0 && (
              <div className="sheet-group">
                <h3 className="sheet-h3">Эффекты</h3>
                <ul className="sheet-abilities-list">
                  {assembled.effects.map(({ effect, origin }) => (
                    <li key={effect.id}>
                      <strong>{effect.name}</strong>
                      <span className="sheet-origin">{origin.name}</span>
                      {effect.description && <p>{effect.description}</p>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {assembled.actions.length > 0 && (
              <div className="sheet-group">
                <h3 className="sheet-h3">Действия</h3>
                <ul className="sheet-abilities-list">
                  {assembled.actions.map(({ action, origin }) => (
                    <li key={action.id}>
                      <strong>{action.name}</strong>
                      <span className="sheet-origin">{origin.name}</span>
                      {action.description && <p>{action.description}</p>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {assembled.feats.length === 0 && assembled.effects.length === 0 && assembled.actions.length === 0 && (
              <p className="forge-note">Нет привязанных способностей.</p>
            )}
          </section>

          {(character.languages?.length || character.tool_proficiencies?.length) ? (
            <section className="sheet-panel">
              <h2 className="sheet-h2">Прочие владения</h2>
              {character.tool_proficiencies?.length ? (
                <div className="sheet-group">
                  <h3 className="sheet-h3">Инструменты</h3>
                  <ul className="sheet-tags">
                    {character.tool_proficiencies.map((t) => <li key={t}>{labelOf([], t) || t}</li>)}
                  </ul>
                </div>
              ) : null}
              {character.languages?.length ? (
                <div className="sheet-group">
                  <h3 className="sheet-h3">Языки</h3>
                  <ul className="sheet-tags">
                    {character.languages.map((l) => <li key={l}>{l}</li>)}
                  </ul>
                </div>
              ) : null}
            </section>
          ) : null}

          {assembled.spells.length > 0 && (
            <section className="sheet-panel sheet-panel-wide">
              <h2 className="sheet-h2">Заклинания</h2>
              {spellsByLevel.map(([level, spellList]) => (
                <div key={level} className="sheet-group">
                  <h3 className="sheet-h3">{getSpellLevelLabel(level)}</h3>
                  <ul className="sheet-tags">
                    {spellList.map((s) => <li key={s.id}>{s.name}</li>)}
                  </ul>
                </div>
              ))}
            </section>
          )}
        </div>
      </div>
    </div>
  );
};

export default CharacterSheetMVP;
