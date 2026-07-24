import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft, Backpack, BookOpen, ChevronRight, Dices, Heart,
  History, Languages, MoreHorizontal, Plus, ScrollText, Shield,
  Swords, UserRound,
} from 'lucide-react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import SheetActionsPanel from '../components/SheetActionsPanel';
import SheetEquipmentPanel from '../components/SheetEquipmentPanel';
import SheetHpPanel from '../components/SheetHpPanel';
import SheetRuntimePanel from '../components/SheetRuntimePanel';
import { charactersV3Api } from '../character/api';
import { buildSavePayload, characterToDraft } from '../character/forgeHelpers';
import { ABILITY_KEYS, ABILITY_LABEL_RU, type AbilityKey } from '../character/types';
import { abilityOfSkill } from '../character/rules/foundation';
import { SKILLS } from '../mechanics/registries';
import { totalWeight } from '../engine/equipment';
import { rollD20 } from '../engine/roll';
import { rollEvent, describeEngineEvent } from '../engine/events';
import type { EngineEvent } from '../mvp/contracts';
import MobileOverlay from './MobileOverlay';
import { useMobileCharacter } from './useMobileCharacter';
import '../pages/CharacterForge.css';
import './mobile.css';

type SheetPage = 'general' | 'actions' | 'inventory' | 'passives' | 'more';

const TABS: Array<{ id: SheetPage; label: string; icon: typeof UserRound }> = [
  { id: 'general', label: 'Общее', icon: UserRound },
  { id: 'actions', label: 'Действия', icon: Swords },
  { id: 'inventory', label: 'Инвентарь', icon: Backpack },
  { id: 'passives', label: 'Пассивы', icon: ScrollText },
  { id: 'more', label: 'Ещё', icon: MoreHorizontal },
];

const SIZE_LABELS = ['Крошечный', 'Маленький', 'Средний', 'Большой', 'Огромный', 'Громадный'];
const SENSE_LABELS: Record<string, string> = {
  darkvision: 'Тёмное зрение',
  blindsight: 'Слепое зрение',
  tremorsense: 'Чувство вибрации',
  truesight: 'Истинное зрение',
};
const fmtMod = (value: number) => value >= 0 ? `+${value}` : String(value);

function collectDefenses(passives: Record<string, unknown>[]) {
  const rows: Array<{ type: string; level: string }> = [];
  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== 'object') return;
    const row = value as Record<string, unknown>;
    if (row.kind === 'resistance' && row.damage_type) {
      rows.push({ type: String(row.damage_type), level: String(row.value ?? 'resistance') });
    }
    for (const nested of Object.values(row)) visit(nested);
  };
  passives.forEach(visit);
  return rows.filter((row, index) =>
    rows.findIndex((other) => other.type === row.type && other.level === row.level) === index);
}

function Section({
  title,
  action,
  children,
  wide = false,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <section className={`m-section${wide ? ' m-section--wide' : ''}`}>
      <header className="m-section-header">
        <h2>{title}</h2>
        {action}
      </header>
      {children}
    </section>
  );
}

function EntityRow({
  name,
  detail,
  onClick,
}: {
  name: string;
  detail?: string;
  onClick?: () => void;
}) {
  return (
    <button type="button" className="m-entity-row" onClick={onClick}>
      <span>
        <strong>{name}</strong>
        {detail && <small>{detail}</small>}
      </span>
      <ChevronRight size={18} />
    </button>
  );
}

export default function MobileCharacterSheet() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const data = useMobileCharacter(id);
  const [page, setPage] = useState<SheetPage>('general');
  const [overlay, setOverlay] = useState<
    | { type: 'hp' }
    | { type: 'ac' }
    | { type: 'check'; label: string; bonus: number }
    | { type: 'notes'; description: string; notes: string }
    | { type: 'entity'; title: string; description?: string | null; detail?: string }
    | null
  >(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [savingNotes, setSavingNotes] = useState(false);

  const flash = useCallback((text: string) => {
    setNotice(text);
    window.setTimeout(() => setNotice((current) => current === text ? null : current), 3600);
  }, []);

  useEffect(() => {
    const incoming = (location.state as { notice?: string } | null)?.notice;
    if (!incoming) return;
    flash(incoming);
    navigate(location.pathname, { replace: true, state: null });
  }, [flash, location.pathname, location.state, navigate]);

  const appendEvents = useCallback(async (events: EngineEvent[]) => {
    await data.appendEvents(events);
    const first = events.find((event) => event.type !== 'turn_started' && event.type !== 'turn_ended');
    if (first) flash(describeEngineEvent(first));
  }, [data.appendEvents, flash]);

  const runCheck = async (label: string, bonus: number) => {
    const roll = rollD20({
      modifiers: [{ value: bonus, source: label }],
      rng: Math.random,
    });
    await appendEvents([rollEvent(label, roll)]);
    setOverlay(null);
    flash(`${label}: ${roll.total}`);
  };

  const saveNotes = async () => {
    if (overlay?.type !== 'notes' || !data.character || !data.assembled || !data.ruleState) return;
    setSavingNotes(true);
    try {
      const draft = characterToDraft(data.character);
      draft.description = overlay.description;
      draft.notes = overlay.notes;
      const updated = await charactersV3Api.update(
        data.character.id,
        buildSavePayload(draft, data.assembled, data.ruleState, data.character.current_hp),
      );
      data.updateCharacter(updated);
      setOverlay(null);
      flash('Описание и заметки применены');
    } finally {
      setSavingNotes(false);
    }
  };

  const defenses = useMemo(() => collectDefenses(data.passives), [data.passives]);

  if (data.loading) {
    return <main className="m-app"><div className="m-empty">Собираем лист персонажа…</div></main>;
  }

  if (data.error || !data.character || !data.assembled || !data.ruleState || !data.runtimeState) {
    return (
      <main className="m-app">
        <div className="m-empty m-empty--panel">
          <h2>Лист недоступен</h2>
          <p>{data.error ?? 'Персонаж не найден'}</p>
          <button type="button" className="m-button" onClick={() => navigate('/m/characters')}>К персонажам</button>
        </div>
      </main>
    );
  }

  const { character, assembled, ruleState, runtimeState } = data;
  const maxHp = data.maxHpBreakdown?.value ?? ruleState.maxHP;
  const armorClass = data.acBreakdown?.value ?? ruleState.armorClass;
  const initiative = data.initiativeBreakdown?.value ?? ruleState.initiativeBonus;
  const speed = data.speedBreakdown?.value ?? ruleState.speed;
  const size = data.sizeBreakdown?.value ?? ruleState.size;
  const weight = totalWeight(runtimeState, data.equipCards);
  const activeNonConditions = runtimeState.activeEffects.filter(
    (effect) => (effect.mechanics as Record<string, unknown>)?.kind !== 'condition',
  );
  const activeConditions = runtimeState.activeEffects.filter(
    (effect) => (effect.mechanics as Record<string, unknown>)?.kind === 'condition',
  );

  const addButton = (type?: string) => (
    <button
      type="button"
      className="m-section-add"
      aria-label={`Добавить${type ? `: ${type}` : ''}`}
      onClick={() => navigate(`/m/characters/${character.id}/add${type ? `/${type}` : ''}`)}
    >
      <Plus size={18} />
    </button>
  );

  return (
    <main className="m-app m-sheet">
      <header className="m-sheet-header">
        <button type="button" className="m-icon-button" onClick={() => navigate('/m/characters')} aria-label="К персонажам">
          <ArrowLeft size={21} />
        </button>
        <button type="button" className="m-sheet-name" onClick={() => setPage('general')}>
          <span>{character.name || 'Без имени'}</span>
          <small>{assembled.klass?.name ?? 'Персонаж'} · {character.level} ур.</small>
        </button>
        <button type="button" className="m-vital m-vital--hp" onClick={() => setOverlay({ type: 'hp' })}>
          <Heart size={16} />
          <span>{runtimeState.hp.current}/{maxHp}</span>
          {runtimeState.hp.temp > 0 && <small>+{runtimeState.hp.temp}</small>}
        </button>
        <button type="button" className="m-vital" onClick={() => setOverlay({ type: 'ac' })}>
          <Shield size={16} />
          <span>{armorClass}</span>
        </button>
        <button type="button" className="m-icon-button m-icon-button--gold" onClick={() => navigate(`/m/characters/${character.id}/add`)} aria-label="Добавить в лист">
          <Plus size={21} />
        </button>
      </header>

      <div className={`m-sheet-content m-sheet-page--${page}`}>
        {page === 'general' && (
          <>
            <Section title="Ключевые показатели">
              <div className="m-stat-grid">
                <button type="button" onClick={() => setOverlay({ type: 'check', label: 'Инициатива', bonus: initiative })}>
                  <span>Инициатива</span><strong>{fmtMod(initiative)}</strong>
                </button>
                <div><span>Скорость</span><strong>{speed} фт</strong></div>
                <div><span>БМ</span><strong>{fmtMod(ruleState.proficiencyBonus)}</strong></div>
                <div><span>КЗ</span><strong>{armorClass}</strong></div>
              </div>
            </Section>

            <Section title="Характеристики и спасброски" wide>
              <div className="m-ability-grid">
                {ABILITY_KEYS.map((ability) => {
                  const score = ruleState.abilities[ability] ?? 10;
                  const mod = ruleState.abilityMods[ability];
                  const save = ruleState.savingThrowBonuses[ability];
                  const proficient = ruleState.proficiencies.savingThrows.includes(ability);
                  return (
                    <article key={ability} className="m-ability-card">
                      <span>{ABILITY_LABEL_RU[ability]}</span>
                      <strong>{score}</strong>
                      <button
                        type="button"
                        onClick={() => setOverlay({ type: 'check', label: `Проверка: ${ABILITY_LABEL_RU[ability]}`, bonus: mod })}
                      >
                        <Dices size={14} /> {fmtMod(mod)}
                      </button>
                      <button
                        type="button"
                        className={proficient ? 'is-proficient' : ''}
                        onClick={() => setOverlay({ type: 'check', label: `Спасбросок: ${ABILITY_LABEL_RU[ability]}`, bonus: save })}
                      >
                        Спас {fmtMod(save)}
                      </button>
                    </article>
                  );
                })}
              </div>
            </Section>

            <Section title="Навыки" wide>
              <div className="m-skill-list">
                {SKILLS.map((skill) => {
                  const ability = abilityOfSkill(skill.id);
                  const bonus = ruleState.skillBonuses[skill.id] ?? ruleState.abilityMods[ability as AbilityKey];
                  const proficient = ruleState.proficiencies.skills.includes(skill.id);
                  const expert = ruleState.expertise.skills.includes(skill.id);
                  return (
                    <button
                      type="button"
                      key={skill.id}
                      onClick={() => setOverlay({ type: 'check', label: `Проверка: ${skill.label}`, bonus })}
                    >
                      <span className={proficient ? 'is-proficient' : ''}>{skill.label}{expert ? ' · эксперт' : ''}</span>
                      <strong>{fmtMod(bonus)}</strong>
                      <Dices size={14} />
                    </button>
                  );
                })}
              </div>
            </Section>

            <Section title="Персонаж">
              <div className="m-detail-list">
                <p><span>Вид</span><strong>{assembled.race?.name ?? '—'}</strong></p>
                <p><span>Класс</span><strong>{assembled.klass?.name ?? '—'}</strong></p>
                <p><span>Предыстория</span><strong>{assembled.background?.name ?? '—'}</strong></p>
                <p><span>Уровень</span><strong>{character.level}</strong></p>
              </div>
              <button
                type="button"
                className="m-notes-placeholder"
                onClick={() => setOverlay({
                  type: 'notes',
                  description: character.description ?? '',
                  notes: character.notes ?? '',
                })}
              >
                <BookOpen size={18} />
                <span>
                  {character.description || character.notes
                    ? [character.description, character.notes].filter(Boolean).join(' · ')
                    : 'Добавить описание и заметки'}
                </span>
                <ChevronRight size={17} />
              </button>
            </Section>
          </>
        )}

        {page === 'actions' && (
          <>
            <div className="m-reused-panel m-actions-runtime">
              <SheetRuntimePanel
                character={character}
                assembled={assembled}
                ruleState={ruleState}
                onUpdated={data.updateCharacter}
                onEvents={appendEvents}
              />
            </div>
            <div className="m-reused-panel">
              <SheetActionsPanel
                character={character}
                assembled={assembled}
                ruleState={ruleState}
                equipCards={data.equipCards}
                maxHp={maxHp}
                onUpdated={data.updateCharacter}
                onEvents={appendEvents}
                showResources={false}
                showEffects={false}
              />
            </div>
          </>
        )}

        {page === 'inventory' && (
          <>
            <Section title="Нагрузка">
              <div className="m-stat-grid">
                <div><span>Размер</span><strong>{SIZE_LABELS[size] ?? size}</strong></div>
                <div><span>Вес</span><strong>{weight.toFixed(1)} фнт</strong></div>
                <div><span>Предел</span><strong>{ruleState.carryingCapacity} фнт</strong></div>
              </div>
            </Section>
            <div className="m-reused-panel">
              <SheetEquipmentPanel
                character={character}
                ruleState={ruleState}
                onUpdated={data.updateCharacter}
                passives={data.passives}
              />
            </div>
          </>
        )}

        {page === 'passives' && (
          <>
            <Section title="Черты и способности" action={addButton('feats')} wide>
              <div className="m-entity-list">
                {assembled.feats.map((feat) => (
                  <EntityRow
                    key={feat.id}
                    name={feat.name}
                    detail="Черта"
                    onClick={() => setOverlay({ type: 'entity', title: feat.name, description: feat.description, detail: 'Пассивная черта' })}
                  />
                ))}
                {assembled.effects.map(({ effect, origin }) => (
                  <EntityRow
                    key={`${effect.id}:${origin.id}`}
                    name={effect.name}
                    detail={origin.name}
                    onClick={() => setOverlay({ type: 'entity', title: effect.name, description: effect.description, detail: `Источник: ${origin.name}` })}
                  />
                ))}
                {!assembled.feats.length && !assembled.effects.length && <p className="m-muted">Нет черт и способностей.</p>}
              </div>
            </Section>

            <Section title="Чувства">
              <div className="m-chip-list">
                {ruleState.senses.map((sense) => (
                  <span key={sense.sense}>{SENSE_LABELS[sense.sense] ?? sense.sense} · {sense.range} фт</span>
                ))}
                {!ruleState.senses.length && <span>Особых чувств нет</span>}
              </div>
            </Section>

            <Section title="Защиты">
              <div className="m-chip-list">
                {defenses.map((defense) => (
                  <span key={`${defense.level}:${defense.type}`}>{defense.level}: {defense.type}</span>
                ))}
                {!defenses.length && <span>Нет сопротивлений, иммунитетов или уязвимостей</span>}
              </div>
            </Section>

            <Section title="Состояния" action={addButton('conditions')} wide>
              <div className="m-entity-list">
                {activeConditions.map((effect) => (
                  <EntityRow
                    key={effect.id}
                    name={effect.name}
                    detail={[effect.source, effect.expiry].filter(Boolean).join(' · ')}
                    onClick={() => setOverlay({
                      type: 'entity',
                      title: effect.name,
                      detail: `Источник: ${effect.source}`,
                    })}
                  />
                ))}
                {!activeConditions.length && <p className="m-muted">Нет активных состояний.</p>}
              </div>
            </Section>

            <Section title="Эффекты" action={addButton('effects')} wide>
              <div className="m-entity-list">
                {activeNonConditions.map((effect) => (
                  <EntityRow
                    key={effect.id}
                    name={effect.name}
                    detail={[effect.source, effect.expiry].filter(Boolean).join(' · ')}
                    onClick={() => setOverlay({ type: 'entity', title: effect.name, detail: `Источник: ${effect.source}` })}
                  />
                ))}
                {!activeNonConditions.length && <p className="m-muted">Нет активных эффектов.</p>}
              </div>
            </Section>
          </>
        )}

        {page === 'more' && (
          <>
            <Section title="Владения">
              <div className="m-more-groups">
                <div><h3>Оружие</h3><p>{ruleState.proficiencies.weapons.join(', ') || '—'}</p></div>
                <div><h3>Доспехи</h3><p>{ruleState.proficiencies.armor.join(', ') || '—'}</p></div>
                <div><h3>Инструменты</h3><p>{ruleState.proficiencies.tools.join(', ') || '—'}</p></div>
              </div>
            </Section>
            <Section title="Языки">
              <div className="m-chip-list">
                {ruleState.proficiencies.languages.map((language) => <span key={language}><Languages size={13} /> {language}</span>)}
                {!ruleState.proficiencies.languages.length && <span>Языки не указаны</span>}
              </div>
            </Section>
            <Section title="Журнал событий" wide>
              <div className="m-journal">
                {data.journal.slice().reverse().map((entry) => (
                  <article key={entry.id}>
                    <History size={15} />
                    <div>
                      <p>{describeEngineEvent(entry.payload)}</p>
                      <time>{new Date(entry.ts || entry.created_at || Date.now()).toLocaleString('ru-RU')}</time>
                    </div>
                  </article>
                ))}
                {!data.journal.length && <p className="m-muted">Журнал пока пуст.</p>}
              </div>
            </Section>
          </>
        )}
      </div>

      <nav className="m-bottom-nav" aria-label="Разделы листа">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              type="button"
              key={tab.id}
              className={page === tab.id ? 'is-active' : ''}
              aria-current={page === tab.id ? 'page' : undefined}
              onClick={() => {
                setPage(tab.id);
                window.scrollTo({ top: 0, behavior: 'auto' });
              }}
            >
              <Icon size={20} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </nav>

      {notice && <div className="m-toast" role="status">{notice}</div>}

      {overlay?.type === 'hp' && (
        <MobileOverlay title="Хиты" onClose={() => setOverlay(null)}>
          <div className="m-reused-panel m-embedded-panel">
            <SheetHpPanel
              character={character}
              maxHp={maxHp}
              maxHpBreakdown={data.maxHpBreakdown}
              onUpdated={data.updateCharacter}
              onEvents={appendEvents}
              conSaveBonus={ruleState.savingThrowBonuses.con}
              sheetCtx={data.sheetCtx}
              passives={data.passives}
              embedded
            />
          </div>
        </MobileOverlay>
      )}

      {overlay?.type === 'ac' && (
        <MobileOverlay title="Класс доспеха" onClose={() => setOverlay(null)}>
          <div className="m-breakdown">
            <strong>{armorClass}</strong>
            {(data.acBreakdown?.parts ?? []).map((part, index) => (
              <p key={`${part.source}:${index}`}><span>{part.source}</span><b>{fmtMod(part.value)}</b></p>
            ))}
          </div>
        </MobileOverlay>
      )}

      {overlay?.type === 'check' && (
        <MobileOverlay
          title={overlay.label}
          onClose={() => setOverlay(null)}
          footer={(
            <button type="button" className="m-button m-button--wide m-button--gold" onClick={() => runCheck(overlay.label, overlay.bonus)}>
              <Dices size={18} /> Бросить {fmtMod(overlay.bonus)}
            </button>
          )}
        >
          <div className="m-check-preview">
            <Dices size={44} />
            <span>к20 {fmtMod(overlay.bonus)}</span>
            <p>Результат будет записан в журнал событий.</p>
          </div>
        </MobileOverlay>
      )}

      {overlay?.type === 'entity' && (
        <MobileOverlay title={overlay.title} onClose={() => setOverlay(null)}>
          {overlay.detail && <p className="m-entity-detail">{overlay.detail}</p>}
          <div className="m-entity-description">{overlay.description || 'Подробное описание отсутствует.'}</div>
        </MobileOverlay>
      )}

      {overlay?.type === 'notes' && (
        <MobileOverlay
          title="Описание и заметки"
          onClose={() => !savingNotes && setOverlay(null)}
          footer={(
            <div className="m-confirm-actions">
              <button className="m-button" type="button" disabled={savingNotes} onClick={() => setOverlay(null)}>Отмена</button>
              <button className="m-button m-button--gold" type="button" disabled={savingNotes} onClick={saveNotes}>
                {savingNotes ? 'Сохраняем…' : 'Применить'}
              </button>
            </div>
          )}
        >
          <div className="m-notes-editor">
            <label>
              <span>Описание персонажа</span>
              <textarea
                rows={7}
                value={overlay.description}
                onChange={(event) => setOverlay({ ...overlay, description: event.target.value })}
                placeholder="Внешность, характер, цели…"
              />
            </label>
            <label>
              <span>Игровые заметки</span>
              <textarea
                rows={9}
                value={overlay.notes}
                onChange={(event) => setOverlay({ ...overlay, notes: event.target.value })}
                placeholder="Зацепки, имена, планы…"
              />
            </label>
          </div>
        </MobileOverlay>
      )}
    </main>
  );
}
