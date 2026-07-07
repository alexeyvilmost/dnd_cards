import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ChevronsUp, Dices, Pencil, Sun, Moon } from 'lucide-react';
import { cardsApi } from '../api/client';
import { charactersV3Api, type CharacterEventRow } from '../character/api';
import { loadAssembly, type AssembledCharacter } from '../character/assemble';
import { characterToDraft } from '../character/forgeHelpers';
import { collectEquippedCards } from '../character/inventory';
import { collectPassiveMechanics } from '../character/resourceInit';
import { collectItemMechanics } from '../character/attunement';
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
import { useSiteSettings } from '../settings';
import ForgeAbilityDisplay from '../components/forge/ForgeAbilityDisplay';
import SpellPreview from '../components/SpellPreview';
import SheetConditionsPanel from '../components/SheetConditionsPanel';
import SheetJournalFab from '../components/SheetJournalFab';
import SheetToasts, { useSheetToasts } from '../components/SheetToasts';
import { useDiceDialog } from '../contexts/DiceDialogContext';
import { plannedValuesRng } from '../engine/dicePlan';
import SheetActionsPanel from '../components/SheetActionsPanel';
import SheetEquipmentPanel from '../components/SheetEquipmentPanel';
import SheetHpPanel from '../components/SheetHpPanel';
import SheetRuntimePanel from '../components/SheetRuntimePanel';
import ValueBreakdownTip from '../components/ValueBreakdownTip';
import CharacterSheetV2 from './CharacterSheetV2';
import { rollEvent } from '../engine/events';
import { collectRollModifiers } from '../engine/modifiers';
import { rollD20 } from '../engine/roll';
import './CharacterForge.css';

const fmtMod = (n: number) => (n >= 0 ? `+${n}` : String(n));

// RU-подписи категорий владений класса (PHB 2024).
const ARMOR_LABEL_RU: Record<string, string> = {
  light: 'лёгкие доспехи',
  medium: 'средние доспехи',
  heavy: 'тяжёлые доспехи',
  shields: 'щиты',
};
const WEAPON_LABEL_RU: Record<string, string> = {
  simple: 'простое оружие',
  martial: 'воинское оружие',
};
const armorLabel = (v: string) => ARMOR_LABEL_RU[v] || v;
const weaponLabel = (v: string) => WEAPON_LABEL_RU[v] || v;

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
  const [journalOpen, setJournalOpen] = useState(false);
  const [unseen, setUnseen] = useState(0);
  const { toasts, push: pushToast } = useSheetToasts();
  const { entityDisplay } = useSiteSettings();
  const diceDialog = useDiceDialog();
  const [rollingInit, setRollingInit] = useState(false);
  const [equipCards, setEquipCards] = useState<Map<string, Card>>(new Map());
  const [paperTheme, setPaperTheme] = useState<boolean>(() => {
    try { return localStorage.getItem('sheet-theme') === 'paper'; } catch { return false; }
  });
  const toggleTheme = useCallback(() => {
    setPaperTheme((prev) => {
      const next = !prev;
      try { localStorage.setItem('sheet-theme', next ? 'paper' : 'dark'); } catch { /* ignore */ }
      return next;
    });
  }, []);
  const rootCls = paperTheme ? 'forge sheet-paper' : 'forge';
  const [useV2, setUseV2] = useState<boolean>(() => {
    try { return localStorage.getItem('sheet-layout') === 'v2'; } catch { return false; }
  });
  const toggleLayout = useCallback(() => {
    setUseV2((prev) => {
      const next = !prev;
      try { localStorage.setItem('sheet-layout', next ? 'v2' : 'classic'); } catch { /* ignore */ }
      return next;
    });
  }, []);

  const loadJournal = useCallback(async (characterId: string) => {
    setJournalLoading(true);
    try {
      const rows = await charactersV3Api.getEvents(characterId);
      setJournal([...rows].reverse());
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

  // Пассивки персонажа + механики надетых предметов (с учётом настройки).
  const passives = useMemo(() => {
    const base = assembled ? collectPassiveMechanics(assembled) : [];
    if (!character) return base;
    const items = collectItemMechanics(character.equipment ?? {}, equipCards, character.turn_state)
      .map((im) => im.mechanics);
    return [...base, ...items];
  }, [assembled, character, equipCards]);

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
      <div className={rootCls}>
        <div className="forge-header">Лист персонажа</div>
        <div className="sheet-loading">Загрузка…</div>
      </div>
    );
  }

  if (error || !character || !assembled || !draft || !ruleState) {
    return (
      <div className={rootCls}>
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

  const maxHP = maxHpBreakdown?.value ?? ruleState.maxHP;
  const speed = speedBreakdown?.value ?? ruleState.speed;
  const ac = acBreakdown?.value ?? ruleState.armorClass;
  const initiative = initBreakdown?.value ?? ruleState.initiativeBonus;
  const spellcasting = ruleState.spellcasting;

  const rollInitiative = async () => {
    if (!id || rollingInit) return;
    setRollingInit(true);
    try {
      const decision = await diceDialog.request([{ sides: 20, label: 'Инициатива' }], 'Бросок инициативы');
      if (decision.mode === 'cancel') return;
      const rng = decision.mode === 'manual'
        ? plannedValuesRng([{ sides: 20, label: 'Инициатива' }], decision.values)
        : () => Math.random();
      const roll = rollD20({
        modifiers: [{ value: initiative, source: 'инициатива', reason: 'бонус инициативы' }],
        rng,
      });
      const event = rollEvent('Инициатива', roll);
      pushToast([event]);
      if (!journalOpen) setUnseen((u) => u + 1);
      const saved = await charactersV3Api.postEvents(id, [{ type: 'roll', payload: event }]);
      setJournal((prev) => [...prev, ...saved]);
    } catch (e) {
      console.error('initiative roll', e);
    } finally {
      setRollingInit(false);
    }
  };

  // Как в трекере: событие показывается всплывающей подсказкой, полная
  // история копится в журнале (FAB), который открывается только вручную.
  const appendRuntimeEvents = async (events: import('../mvp/contracts').EngineEvent[]) => {
    if (!id || !events.length) return;
    pushToast(events);
    if (!journalOpen) setUnseen((u) => u + 1);
    try {
      const items = events.map((payload) => ({ type: payload.type, payload }));
      const saved = await charactersV3Api.postEvents(id, items);
      setJournal((prev) => [...prev, ...saved]);
    } catch (e) {
      console.error('runtime events', e);
    }
  };

  // Клик по заклинанию в секции «Заклинания» — прокрутка к его действию с подсветкой.
  const scrollToAction = (actionId: string) => {
    const el = document.querySelector(`[data-action-id="${actionId}"]`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('sheet-action-flash');
    window.setTimeout(() => el.classList.remove('sheet-action-flash'), 1600);
  };

  // Клик по спасброску/навыку — бросок к20 с разбивкой в журнал.
  const rollCheck = async (
    label: string,
    parts: import('../mvp/contracts').RollModifier[],
    rollKind: 'saving_throw' | 'ability_check',
    filter?: Record<string, unknown>,
  ) => {
    const collected = runtimeState
      ? collectRollModifiers(runtimeState, passives, { roll: rollKind, ...(filter ? { filter } : {}) })
      : { advantage: 'none' as const, modifiers: [] };
    const plan = Array.from(
      { length: collected.advantage === 'none' ? 1 : 2 },
      () => ({ sides: 20, label }),
    );
    const decision = await diceDialog.request(plan, label);
    if (decision.mode === 'cancel') return;
    const rng = decision.mode === 'manual'
      ? plannedValuesRng(plan, decision.values)
      : () => Math.random();
    const roll = rollD20({
      advantage: collected.advantage,
      modifiers: [...parts, ...collected.modifiers],
      rng,
    });
    await appendRuntimeEvents([rollEvent(label, roll)]);
  };

  const headerLine = [
    assembled.race?.name,
    lineageName,
    assembled.klass ? `${assembled.klass.name} ${draft.level}` : null,
    assembled.background?.name,
  ].filter(Boolean).join(' · ');

  return (
    <div className={rootCls}>
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
            onClick={toggleLayout}
            title={useV2 ? 'Классический макет' : 'Новый макет (кокпит)'}
          >
            <span className="sheet-header-btn-label">{useV2 ? 'Классический' : '✦ Новый'}</span>
          </button>
          <button
            type="button"
            className="sheet-header-btn"
            onClick={toggleTheme}
            title={paperTheme ? 'Тёмная тема' : 'Светлая (бумажная) тема'}
          >
            {paperTheme ? <Moon size={16} /> : <Sun size={16} />}
            <span className="sheet-header-btn-label">{paperTheme ? 'Тёмная' : 'Бумага'}</span>
          </button>
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
          <Link
            to={`/character-forge/${character.id}?levelup=1`}
            className="sheet-header-btn"
            title={`Поднять уровень (сейчас ${character.level})`}
          >
            <ChevronsUp size={16} />
            <span className="sheet-header-btn-label">Уровень {character.level} ↑</span>
          </Link>
          <Link to={`/character-forge/${character.id}`} className="sheet-edit" title="Редактировать">
            <Pencil size={16} />
          </Link>
        </div>
      </div>

      {useV2 ? (
        <CharacterSheetV2
          character={character}
          assembled={assembled}
          ruleState={ruleState}
          draft={draft}
          sheetCtx={sheetCtx}
          runtimeState={runtimeState}
          passives={passives}
          equipCards={equipCards}
          acBreakdown={acBreakdown}
          maxHpBreakdown={maxHpBreakdown}
          initBreakdown={initBreakdown}
          speedBreakdown={speedBreakdown}
          spellsByLevel={spellsByLevel}
          lineageName={lineageName}
          onUpdated={setCharacter}
          onEvents={appendRuntimeEvents}
        />
      ) : (
      <div className="sheet-scroll">
        <section className="sheet-hero">
          <h1 className="sheet-name">{character.name}</h1>
          <p className="sheet-subtitle">{headerLine || '—'}</p>
        </section>

        <div className="sheet-grid">
          <SheetActionsPanel
            character={character}
            assembled={assembled}
            ruleState={ruleState}
            showResources={false}
            showEffects={false}
            equipCards={equipCards}
            onUpdated={setCharacter}
            onEvents={appendRuntimeEvents}
          />

          <SheetEquipmentPanel
            character={character}
            ruleState={ruleState}
            onUpdated={setCharacter}
            passives={passives}
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
            conSaveBonus={ruleState.savingThrowBonuses.con}
          />

          <SheetConditionsPanel
            character={character}
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
                const parts = saveBd?.parts
                  ?? [{ value: bonus, source: ABILITY_LABEL_RU[k], reason: 'спасбросок' }];
                return (
                  <li key={k}>
                    <span className={proficient ? 'sheet-prof' : ''}>{ABILITY_LABEL_RU[k]}</span>
                    <span className="sheet-roll-cell">
                      {saveBd ? (
                        <ValueBreakdownTip breakdown={saveBd} label={`Спасбросок ${ABILITY_LABEL_RU[k]}`}>
                          <span>{fmtMod(bonus)}</span>
                        </ValueBreakdownTip>
                      ) : (
                        <span>{fmtMod(bonus)}</span>
                      )}
                      <button
                        type="button"
                        className="sheet-dice-btn"
                        title={`Бросить спасбросок ${ABILITY_LABEL_RU[k]}`}
                        onClick={() => rollCheck(`Спасбросок (${ABILITY_LABEL_RU[k]})`, parts, 'saving_throw', { ability: k })}
                      >
                        <Dices size={13} />
                      </button>
                    </span>
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
                const parts = skillBd?.parts
                  ?? [{ value: bonus, source: skill.label, reason: 'навык' }];
                return (
                  <li key={skill.id} title={`${fmtMod(bonus)} = ${formula}`}>
                    <span className={proficient ? 'sheet-prof' : ''}>{skill.label}{expert ? ' (эксп.)' : ''}</span>
                    <span className="sheet-roll-cell">
                      {skillBd ? (
                        <ValueBreakdownTip breakdown={skillBd} label={skill.label}>
                          <span>{fmtMod(bonus)}</span>
                        </ValueBreakdownTip>
                      ) : (
                        <span>{fmtMod(bonus)}</span>
                      )}
                      <button
                        type="button"
                        className="sheet-dice-btn"
                        title={`Проверка: ${skill.label}`}
                        onClick={() => rollCheck(`Проверка (${skill.label})`, parts, 'ability_check', { skill: skill.id })}
                      >
                        <Dices size={13} />
                      </button>
                    </span>
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
                <ForgeAbilityDisplay
                  mode={entityDisplay.effects}
                  linesClassName="sheet-ability-lines"
                  entries={assembled.effects.map(({ effect, origin }) => ({
                    key: effect.id,
                    name: effect.name,
                    imageUrl: effect.image_url,
                    sourceLabel: `${originLabel(origin.kind)} · ${origin.name}`,
                    effect,
                  }))}
                />
              </div>
            )}
            {assembled.actions.length > 0 && (
              <div className="sheet-group">
                <h3 className="sheet-h3">Способности (описание)</h3>
                <ForgeAbilityDisplay
                  mode={entityDisplay.actions}
                  linesClassName="sheet-ability-lines"
                  entries={assembled.actions.map(({ action, origin }) => ({
                    key: action.id,
                    name: action.name,
                    imageUrl: action.image_url,
                    sourceLabel: `${originLabel(origin.kind)} · ${origin.name}`,
                    action,
                  }))}
                />
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

          {(ruleState.proficiencies.languages.length || ruleState.proficiencies.tools.length
            || ruleState.proficiencies.armor.length || ruleState.proficiencies.weapons.length) ? (
            <section className="sheet-panel">
              <h2 className="sheet-h2">Владения</h2>
              {ruleState.proficiencies.armor.length ? (
                <div className="sheet-group">
                  <h3 className="sheet-h3">Доспехи</h3>
                  <ul className="sheet-tags">
                    {ruleState.proficiencies.armor.map((a) => <li key={a}>{armorLabel(a)}</li>)}
                  </ul>
                </div>
              ) : null}
              {ruleState.proficiencies.weapons.length ? (
                <div className="sheet-group">
                  <h3 className="sheet-h3">Оружие</h3>
                  <ul className="sheet-tags">
                    {ruleState.proficiencies.weapons.map((w) => <li key={w}>{weaponLabel(w)}</li>)}
                  </ul>
                </div>
              ) : null}
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
                  {entityDisplay.spells === 'row' ? (
                    <div className="forge-spell-rows">
                      {spellList.map((spell) => (
                        <button
                          key={spell.id}
                          type="button"
                          className="forge-spell-row"
                          title={`${spell.name} — к действию`}
                          onMouseEnter={(e) => { setHoveredSpell(spell); setSpellMouse({ x: e.clientX, y: e.clientY }); }}
                          onMouseMove={(e) => setSpellMouse({ x: e.clientX, y: e.clientY })}
                          onMouseLeave={() => setHoveredSpell(null)}
                          onClick={() => scrollToAction(spell.id)}
                        >
                          {spell.image_url ? (
                            <img
                              className="forge-spell-row-img"
                              src={spell.image_url}
                              alt={spell.name}
                              onError={(e) => { (e.currentTarget as HTMLImageElement).src = '/default_image.png'; }}
                            />
                          ) : (
                            <span className="forge-spell-row-fallback">{spell.name.slice(0, 1)}</span>
                          )}
                          <span className="forge-spell-row-name">{spell.name}</span>
                          <span className="forge-spell-row-meta">{getSpellLevelLabel(level)}</span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="forge-spell-icon-grid sheet-spell-grid">
                      {spellList.map((spell) => (
                        <button
                          key={spell.id}
                          type="button"
                          className="forge-spell-icon ready"
                          title={`${spell.name} — к действию`}
                          onMouseEnter={(e) => { setHoveredSpell(spell); setSpellMouse({ x: e.clientX, y: e.clientY }); }}
                          onMouseMove={(e) => setSpellMouse({ x: e.clientX, y: e.clientY })}
                          onMouseLeave={() => setHoveredSpell(null)}
                          onClick={() => scrollToAction(spell.id)}
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
                  )}
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
                  <SpellPreview
                    spell={hoveredSpell}
                    disableHover={true}
                    spellcasting={spellcasting ? { saveDC: spellcasting.saveDC, attack: spellcasting.attack } : undefined}
                  />
                </div>
              )}
            </section>
          )}

        </div>
      </div>
      )}

      <SheetToasts toasts={toasts} />
      <SheetJournalFab
        open={journalOpen}
        onOpenChange={(o) => { setJournalOpen(o); if (o) setUnseen(0); }}
        rows={journal}
        loading={journalLoading}
        onRollInitiative={rollInitiative}
        rollingInit={rollingInit}
        unseen={unseen}
      />
    </div>
  );
};

export default CharacterSheetMVP;
