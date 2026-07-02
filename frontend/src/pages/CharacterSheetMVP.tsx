import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Dices, Pencil } from 'lucide-react';
import { cardsApi } from '../api/client';
import { charactersV3Api, type CharacterEventRow } from '../character/api';
import { loadAssembly, type AssembledCharacter } from '../character/assemble';
import { characterToDraft } from '../character/forgeHelpers';
import { collectEquippedCards } from '../character/inventory';
import { collectPassiveMechanics } from '../character/resourceInit';
import { buildCharacterContext, forgeToRuntimeState } from '../character/runtime';
import { breakdownValue } from '../engine/breakdown';
import { getSkillGrantSource, grantReason, resolveCharacterRules } from '../character/rules/resolveCharacterRules';
import { abilityOfSkill } from '../character/rules/foundation';
import {
  ABILITY_KEYS,
  ABILITY_LABEL_RU,
  type ForgeCharacter,
} from '../character/types';
import { labelOf, SKILLS } from '../mechanics/registries';
import { getSpellLevelLabel, type Card, type Spell } from '../types';
import ForgeAbilityLine from '../components/forge/ForgeAbilityLine';
import SpellPreview from '../components/SpellPreview';
import EventJournal from '../components/EventJournal';
import SheetActionsPanel from '../components/SheetActionsPanel';
import SheetEquipmentPanel from '../components/SheetEquipmentPanel';
import SheetHpPanel from '../components/SheetHpPanel';
import SheetRuntimePanel from '../components/SheetRuntimePanel';
import ValueBreakdownTip from '../components/ValueBreakdownTip';
import { rollEvent } from '../engine/events';
import { rollD20 } from '../engine/roll';
import './CharacterForge.css';

const fmtMod = (n: number) => (n >= 0 ? `+${n}` : String(n));
const originLabel = (kind: string) => {
  switch (kind) {
    case 'race': return 'Способность вида';
    case 'class': return 'Способность класса';
    case 'feat': return 'Способность черты';
    case 'background': return 'Способность предыстории';
    default: return 'Способность';
  }
};

const CharacterSheetMVP = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [character, setCharacter] = useState<ForgeCharacter | null>(null);
  const [assembled, setAssembled] = useState<AssembledCharacter | null>(null);
  const [hoveredSpell, setHoveredSpell] = useState<Spell | null>(null);
  const [spellMouse, setSpellMouse] = useState({ x: 0, y: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [journal, setJournal] = useState<CharacterEventRow[]>([]);
  const [journalLoading, setJournalLoading] = useState(false);
  const [rollingInit, setRollingInit] = useState(false);
  const [equipCards, setEquipCards] = useState<Map<string, Card>>(new Map());

  const loadJournal = useCallback(async (characterId: string) => {
    setJournalLoading(true);
    try {
      const rows = await charactersV3Api.getEvents(characterId);
      setJournal(rows);
    } catch (e) {
      console.error('journal load', e);
    } finally {
      setJournalLoading(false);
    }
  }, []);

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
        if (!stale) await loadJournal(id);
      } catch (e) {
        console.error(e);
        if (!stale) setError('Не удалось загрузить лист персонажа');
      } finally {
        if (!stale) setLoading(false);
      }
    })();
    return () => { stale = true; };
  }, [id, loadJournal]);

  const draft = useMemo(() => (character ? characterToDraft(character) : null), [character]);
  const ruleState = useMemo(
    () => (draft && assembled ? resolveCharacterRules({ draft, assembled }) : null),
    [draft, assembled],
  );

  const equipCardIds = useMemo(() => {
    if (!character) return [];
    const ids = new Set<string>();
    for (const row of character.inventory_items ?? []) ids.add(row.card_id);
    for (const id of Object.values(character.equipment ?? {})) if (id) ids.add(id);
    return [...ids];
  }, [character]);

  useEffect(() => {
    if (!equipCardIds.length) {
      setEquipCards(new Map());
      return;
    }
    let stale = false;
    (async () => {
      const map = new Map<string, Card>();
      for (const id of equipCardIds) {
        try {
          map.set(id, await cardsApi.getCard(id));
        } catch {
          /* skip */
        }
      }
      if (!stale) setEquipCards(map);
    })();
    return () => { stale = true; };
  }, [equipCardIds.join('|')]);

  const runtimeState = useMemo(
    () => (character ? forgeToRuntimeState(character) : null),
    [character],
  );

  const passives = useMemo(
    () => (assembled ? collectPassiveMechanics(assembled) : []),
    [assembled],
  );

  const sheetCtx = useMemo(() => {
    if (!ruleState || !draft || !runtimeState) return null;
    const equipped = collectEquippedCards(runtimeState.equipment, equipCards);
    return buildCharacterContext(ruleState, draft, equipped, assembled?.klass ?? null);
  }, [ruleState, draft, runtimeState, equipCards, assembled?.klass]);

  const acBreakdown = useMemo(() => {
    if (!sheetCtx || !runtimeState) return null;
    return breakdownValue('ac', sheetCtx, runtimeState, passives);
  }, [sheetCtx, runtimeState, passives]);

  const maxHpBreakdown = useMemo(() => {
    if (!sheetCtx || !runtimeState) return null;
    return breakdownValue('max_hp', sheetCtx, runtimeState, passives);
  }, [sheetCtx, runtimeState, passives]);

  const initBreakdown = useMemo(() => {
    if (!sheetCtx || !runtimeState) return null;
    return breakdownValue('initiative', sheetCtx, runtimeState, passives);
  }, [sheetCtx, runtimeState, passives]);

  const speedBreakdown = useMemo(() => {
    if (!sheetCtx || !runtimeState) return null;
    return breakdownValue('speed', sheetCtx, runtimeState, passives);
  }, [sheetCtx, runtimeState, passives]);

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

  if (error || !character || !assembled || !draft || !ruleState) {
    return (
      <div className="forge">
        <div className="forge-header">Лист персонажа</div>
        <div className="sheet-loading">
          <p className="issues">{error || 'Персонаж не найден'}</p>
          <button type="button" className="forge-btn ghost" onClick={() => navigate('/characters-forge')}>
            К списку персонажей
          </button>
        </div>
      </div>
    );
  }

  const skills = ruleState.proficiencies.skills;
  const saves = ruleState.proficiencies.savingThrows;
  const scores = draft.abilities;
  const pb = ruleState.proficiencyBonus;

  const maxHP = ruleState.maxHP;
  const currentHP = character.current_hp ?? maxHP;
  const speed = speedBreakdown?.value ?? ruleState.speed;
  const ac = acBreakdown?.value ?? ruleState.armorClass;
  const initiative = initBreakdown?.value ?? ruleState.initiativeBonus;
  const spellcasting = ruleState.spellcasting;

  const rollInitiative = async () => {
    if (!id || rollingInit) return;
    setRollingInit(true);
    try {
      const roll = rollD20({
        modifiers: [{ value: initiative, source: 'инициатива', reason: 'бонус инициативы' }],
        rng: () => Math.random(),
      });
      const event = rollEvent('Инициатива', roll);
      const saved = await charactersV3Api.postEvents(id, [{ type: 'roll', payload: event }]);
      setJournal((prev) => [...saved, ...prev]);
      document.getElementById('sheet-journal')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (e) {
      console.error('initiative roll', e);
    } finally {
      setRollingInit(false);
    }
  };

  const appendRuntimeEvents = async (events: import('../mvp/contracts').EngineEvent[]) => {
    if (!id || !events.length) return;
    try {
      const items = events.map((payload) => ({ type: payload.type, payload }));
      const saved = await charactersV3Api.postEvents(id, items);
      setJournal((prev) => [...saved, ...prev]);
    } catch (e) {
      console.error('runtime events', e);
    }
  };

  const journalPanel = (
    <section className="sheet-panel sheet-panel-wide sheet-journal-panel" id="sheet-journal">
      <div className="sheet-journal-head">
        <h2 className="sheet-h2">Журнал</h2>
        <button
          type="button"
          className="forge-btn ghost sheet-roll-btn"
          onClick={rollInitiative}
          disabled={rollingInit}
          title="Бросок инициативы (к20 + бонус инициативы)"
        >
          <Dices size={16} />
          {rollingInit ? 'Бросок…' : 'Инициатива'}
        </button>
      </div>
      {journalLoading ? (
        <p className="forge-note">Загрузка журнала…</p>
      ) : (
        <EventJournal rows={journal} />
      )}
    </section>
  );

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
        <div className="sheet-header-center">
          <span className="sheet-header-name">{character.name || 'Без имени'}</span>
          <span className="sheet-header-sub">Лист персонажа</span>
        </div>
        <div className="sheet-header-actions">
          <button
            type="button"
            className="sheet-header-btn"
            onClick={rollInitiative}
            disabled={rollingInit}
            title="Бросок инициативы"
          >
            <Dices size={16} />
            <span className="sheet-header-btn-label">{rollingInit ? '…' : 'Инициатива'}</span>
          </button>
          <Link to={`/character-forge/${character.id}`} className="sheet-edit" title="Редактировать">
            <Pencil size={16} />
          </Link>
        </div>
      </div>

      <div className="sheet-scroll">
        <section className="sheet-hero">
          <h1 className="sheet-name">{character.name}</h1>
          <p className="sheet-subtitle">{headerLine || '—'}</p>
        </section>

        <div className="sheet-grid sheet-grid-journal-first">
          <SheetActionsPanel
            character={character}
            assembled={assembled}
            ruleState={ruleState}
            equipCards={equipCards}
            onUpdated={setCharacter}
            onEvents={appendRuntimeEvents}
          />

          {journalPanel}

          <SheetEquipmentPanel
            character={character}
            ruleState={ruleState}
            onUpdated={setCharacter}
          />

          <SheetRuntimePanel
            character={character}
            assembled={assembled}
            ruleState={ruleState}
            onUpdated={setCharacter}
            onEvents={appendRuntimeEvents}
          />

          <SheetHpPanel
            character={character}
            maxHp={maxHP}
            maxHpBreakdown={maxHpBreakdown}
            onUpdated={setCharacter}
            onEvents={appendRuntimeEvents}
          />

          <section className="sheet-panel">
            <h2 className="sheet-h2">Характеристики</h2>
            <div className="sheet-abilities">
              {ABILITY_KEYS.map((k) => {
                const score = scores[k] ?? 10;
                const mod = ruleState.abilityMods[k];
                return (
                  <div key={k} className="sheet-ab" title={`${ABILITY_LABEL_RU[k]}: значение ${score}, модификатор ${fmtMod(mod)}`}>
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
              {acBreakdown && (
                <div className="sheet-stat">
                  <span>КД</span>
                  <ValueBreakdownTip breakdown={acBreakdown} label="Класс доспеха">
                    <strong>{ac}</strong>
                  </ValueBreakdownTip>
                </div>
              )}
              {maxHpBreakdown && (
                <div className="sheet-stat">
                  <span>Max HP</span>
                  <ValueBreakdownTip breakdown={maxHpBreakdown} label="Максимум HP">
                    <strong>{maxHP}</strong>
                  </ValueBreakdownTip>
                </div>
              )}
              {speedBreakdown && (
                <div className="sheet-stat">
                  <span>Скорость</span>
                  <ValueBreakdownTip breakdown={speedBreakdown} label="Скорость">
                    <strong>{speed} фт</strong>
                  </ValueBreakdownTip>
                </div>
              )}
              {initBreakdown && (
                <div className="sheet-stat">
                  <span>Инициатива</span>
                  <ValueBreakdownTip breakdown={initBreakdown} label="Инициатива">
                    <strong>{fmtMod(initiative)}</strong>
                  </ValueBreakdownTip>
                </div>
              )}
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
                const bonus = ruleState.savingThrowBonuses[k];
                const saveBd = sheetCtx && runtimeState
                  ? breakdownValue(`save:${k}`, sheetCtx, runtimeState, passives)
                  : null;
                return (
                  <li key={k}>
                    <span className={proficient ? 'sheet-prof' : ''}>{ABILITY_LABEL_RU[k]}</span>
                    {saveBd ? (
                      <ValueBreakdownTip breakdown={saveBd} label={`Спасбросок ${ABILITY_LABEL_RU[k]}`}>
                        <span>{fmtMod(bonus)}</span>
                      </ValueBreakdownTip>
                    ) : (
                      <span>{fmtMod(bonus)}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="sheet-panel sheet-panel-wide">
            <h2 className="sheet-h2">Навыки</h2>
            <ul className="sheet-list sheet-skills">
              {SKILLS.map((skill) => {
                const proficient = skills.includes(skill.id);
                const expert = ruleState.expertise.skills.includes(skill.id);
                const bonus = ruleState.skillBonuses[skill.id];
                const ability = abilityOfSkill(skill.id);
                const skillBd = sheetCtx && runtimeState
                  ? breakdownValue(`skill:${skill.id}`, sheetCtx, runtimeState, passives)
                  : null;
                const grant = getSkillGrantSource(ruleState, skill.id);
                const formula = [
                  `${ABILITY_LABEL_RU[ability]} ${fmtMod(ruleState.abilityMods[ability])}`,
                  proficient ? `владение ${fmtMod(pb)}${grant ? ` (${grantReason(grant)})` : ''}` : null,
                  expert ? `экспертиза ${fmtMod(pb)}` : null,
                ].filter(Boolean).join(' + ');
                return (
                  <li key={skill.id} title={`${fmtMod(bonus)} = ${formula}`}>
                    <span className={proficient ? 'sheet-prof' : ''}>{skill.label}{expert ? ' (эксп.)' : ''}</span>
                    {skillBd && !proficient ? (
                      <ValueBreakdownTip breakdown={skillBd} label={skill.label}>
                        <span>{fmtMod(bonus)}</span>
                      </ValueBreakdownTip>
                    ) : (
                      <span>{fmtMod(bonus)}</span>
                    )}
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
                <div className="sheet-ability-lines">
                  {assembled.effects.map(({ effect, origin }) => (
                    <ForgeAbilityLine
                      key={effect.id}
                      name={effect.name}
                      imageUrl={effect.image_url}
                      sourceLabel={`${originLabel(origin.kind)} · ${origin.name}`}
                      effect={effect}
                    />
                  ))}
                </div>
              </div>
            )}
            {assembled.actions.length > 0 && (
              <div className="sheet-group">
                <h3 className="sheet-h3">Способности (описание)</h3>
                <div className="sheet-ability-lines">
                  {assembled.actions.map(({ action, origin }) => (
                    <ForgeAbilityLine
                      key={action.id}
                      name={action.name}
                      imageUrl={action.image_url}
                      sourceLabel={`${originLabel(origin.kind)} · ${origin.name}`}
                      action={action}
                    />
                  ))}
                </div>
              </div>
            )}
            {assembled.feats.length === 0 && assembled.effects.length === 0 && assembled.actions.length === 0 && (
              <p className="forge-note">Нет привязанных способностей.</p>
            )}
          </section>

          {ruleState.conflicts.length > 0 && (
            <section className="sheet-panel sheet-panel-wide">
              <h2 className="sheet-h2">Конфликты правил</h2>
              <ul className="issues">
                {ruleState.conflicts.map((conflict, i) => <li key={i}>{conflict.message}</li>)}
              </ul>
            </section>
          )}

          {(ruleState.proficiencies.languages.length || ruleState.proficiencies.tools.length) ? (
            <section className="sheet-panel">
              <h2 className="sheet-h2">Прочие владения</h2>
              {ruleState.proficiencies.tools.length ? (
                <div className="sheet-group">
                  <h3 className="sheet-h3">Инструменты</h3>
                  <ul className="sheet-tags">
                    {ruleState.proficiencies.tools.map((t) => <li key={t}>{labelOf([], t) || t}</li>)}
                  </ul>
                </div>
              ) : null}
              {ruleState.proficiencies.languages.length ? (
                <div className="sheet-group">
                  <h3 className="sheet-h3">Языки</h3>
                  <ul className="sheet-tags">
                    {ruleState.proficiencies.languages.map((l) => <li key={l}>{l}</li>)}
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
                  <div className="forge-spell-icon-grid sheet-spell-grid">
                    {spellList.map((spell) => (
                      <button
                        key={spell.id}
                        type="button"
                        className="forge-spell-icon ready"
                        title={spell.name}
                        onMouseEnter={(e) => { setHoveredSpell(spell); setSpellMouse({ x: e.clientX, y: e.clientY }); }}
                        onMouseMove={(e) => setSpellMouse({ x: e.clientX, y: e.clientY })}
                        onMouseLeave={() => setHoveredSpell(null)}
                      >
                        {spell.image_url ? (
                          <img
                            src={spell.image_url}
                            alt={spell.name}
                            onError={(e) => { (e.currentTarget as HTMLImageElement).src = '/default_image.png'; }}
                          />
                        ) : (
                          <span className="sheet-spell-fallback">{spell.name.slice(0, 1)}</span>
                        )}
                        <span className="forge-spell-badge">{level === 0 ? 'З' : level}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              {hoveredSpell && (
                <div
                  className="fixed z-50 pointer-events-none"
                  style={{
                    left: Math.min(spellMouse.x + 16, window.innerWidth - 360),
                    top: Math.min(Math.max(spellMouse.y - 40, 10), window.innerHeight - 20),
                    transform: spellMouse.y > window.innerHeight / 2 ? 'translateY(-100%)' : 'translateY(0)',
                  }}
                >
                  <SpellPreview spell={hoveredSpell} disableHover={true} />
                </div>
              )}
            </section>
          )}

        </div>
      </div>
    </div>
  );
};

export default CharacterSheetMVP;
