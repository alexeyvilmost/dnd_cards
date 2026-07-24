import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, ChevronLeft, ChevronRight, Pencil, Sparkles } from 'lucide-react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { backgroundsApi, classesApi, featsApi, racesApi, spellsApi } from '../api/client';
import { charactersV3Api } from '../character/api';
import { loadAssembly, type AssembledCharacter } from '../character/assemble';
import { AbilityAssigner, ChoiceResolver } from '../character/components';
import { buildCharacterContext } from '../character/runtime';
import { buildResourceRuntimePatch, syncRuntimeResources } from '../character/resourceInit';
import {
  buildSavePayload, characterToDraft, classSkillChoice, completionIssues,
} from '../character/forgeHelpers';
import { resolveCharacterRules } from '../character/rules/resolveCharacterRules';
import {
  ABILITY_KEYS, emptyDraft, type AbilityKey, type CharacterDraft, type ForgeCharacter,
} from '../character/types';
import { maxAvailableSpellSlotLevel } from '../engine/resources';
import type { PendingChoice } from '../mechanics/collectChoices';
import { labelOf, optionsForChoiceSource, SKILLS } from '../mechanics/registries';
import type { Background, CharacterClass, Feat, Race, Spell } from '../types';
import { getSpellLevelLabel } from '../types';
import { FormattedText } from '../utils/formattedText';
import { BackgroundEquipment } from '../components/BackgroundEquipment';
import MobileOverlay from './MobileOverlay';
import '../pages/CharacterForge.css';
import './mobile.css';

type WizardStep = 'basic' | 'race' | 'class' | 'background' | 'abilities' | 'choices' | 'review';

const BASE_STEPS: Array<{ id: WizardStep; label: string }> = [
  { id: 'basic', label: 'Основное' },
  { id: 'race', label: 'Вид' },
  { id: 'class', label: 'Класс' },
  { id: 'background', label: 'Предыстория' },
  { id: 'abilities', label: 'Характеристики' },
  { id: 'choices', label: 'Выборы' },
  { id: 'review', label: 'Проверка' },
];

const draftKey = (mode: string, id?: string) => `boh:mobile-wizard:v1:${mode}:${id ?? 'new'}`;

type Picker =
  | { kind: 'class-skills' }
  | { kind: 'mechanic'; choiceId: string }
  | { kind: 'class-equipment' }
  | { kind: 'background-equipment' }
  | { kind: 'background-feat' };

function WizardChoiceCard({
  title,
  description,
  selected,
  complete,
  onClick,
}: {
  title: string;
  description: string;
  selected: string[];
  complete: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" className={`m-wizard-choice-card${complete ? ' is-complete' : ''}`} onClick={onClick}>
      <span className="m-wizard-choice-copy">
        <strong>{title}</strong>
        <small>{description}</small>
        <span className={selected.length ? 'has-value' : ''}>
          {selected.length ? selected.join(', ') : 'Нажмите, чтобы выбрать'}
        </span>
      </span>
      {selected.length ? <Pencil size={18} aria-label="Изменить" /> : <ChevronRight size={20} />}
    </button>
  );
}

function EntityDetails({
  description,
  detailedDescription,
  abilityNames,
}: {
  description?: string | null;
  detailedDescription?: string | null;
  abilityNames: string[];
}) {
  return (
    <div className="m-wizard-entity-details">
      <details>
        <summary>Описание</summary>
        <div className="m-wizard-details-body">
          <FormattedText text={description || detailedDescription || ''} emptyText="Описание не заполнено." />
          {description && detailedDescription && <FormattedText text={detailedDescription} emptyText="" />}
        </div>
      </details>
      <details>
        <summary>Выдаваемые способности</summary>
        <div className="m-wizard-details-body">
          {abilityNames.length
            ? <ul>{abilityNames.map((name) => <li key={name}>{name}</li>)}</ul>
            : <p>Дополнительных способностей нет.</p>}
        </div>
      </details>
    </div>
  );
}

function spellMatchesChoice(spell: Spell, choice: PendingChoice, maxSlotLevel: number): boolean {
  const options = (choice.options || {}) as Record<string, unknown>;
  const filter = (options.filter || choice.filter || {}) as Record<string, unknown> | string | string[];
  if (Array.isArray(filter)) return filter.includes(spell.id);
  if (typeof filter === 'string') {
    if (filter === 'all') return true;
    if (filter === 'cantrip') return spell.level === 0;
    return spell.id === filter;
  }
  if (filter.only_available_slots) {
    if (spell.level < 1 || spell.level > maxSlotLevel) return false;
  } else {
    const levels = Array.isArray(filter.levels)
      ? filter.levels.map(Number)
      : typeof filter.level === 'number' ? [filter.level] : [];
    if (levels.length && !levels.includes(spell.level)) return false;
  }
  const classes = Array.isArray(filter.classes)
    ? filter.classes.map(String)
    : typeof filter.class === 'string' ? [filter.class] : [];
  return !classes.length || classes.some((klass) => (spell.classes || []).includes(klass));
}

function SelectGrid<T extends { id: string; name: string; image_url?: string }>({
  values,
  selected,
  onSelect,
}: {
  values: T[];
  selected?: string | null;
  onSelect: (value: T) => void;
}) {
  return (
    <div className="m-wizard-select-grid">
      {values.map((value) => (
        <button
          type="button"
          key={value.id}
          className={selected === value.id ? 'is-selected' : ''}
          onClick={() => onSelect(value)}
        >
          <span className="m-wizard-select-image">
            {value.image_url ? <img src={value.image_url} alt="" /> : value.name.slice(0, 1)}
          </span>
          <strong>{value.name}</strong>
          {selected === value.id && <Check size={16} />}
        </button>
      ))}
    </div>
  );
}
function safeDraft(raw: string | null): CharacterDraft | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as CharacterDraft;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export default function MobileCharacterWizard() {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const levelUp = location.pathname.endsWith('/level-up');
  const editing = !!id;
  const mode = levelUp ? 'level-up' : editing ? 'edit' : 'new';
  const storageKey = draftKey(mode, id);

  const [draft, setDraft] = useState<CharacterDraft>(() => safeDraft(localStorage.getItem(storageKey)) ?? emptyDraft());
  const [original, setOriginal] = useState<ForgeCharacter | null>(null);
  const [races, setRaces] = useState<Race[]>([]);
  const [classes, setClasses] = useState<CharacterClass[]>([]);
  const [backgrounds, setBackgrounds] = useState<Background[]>([]);
  const [feats, setFeats] = useState<Feat[]>([]);
  const [spells, setSpells] = useState<Spell[]>([]);
  const [assembled, setAssembled] = useState<AssembledCharacter | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [picker, setPicker] = useState<Picker | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stale = false;
    (async () => {
      setLoading(true);
      try {
        const [raceResult, classResult, backgroundResult, featResult, spellResult, character] = await Promise.all([
          racesApi.getRaces({ limit: 300 }),
          classesApi.getClasses({ limit: 300 }),
          backgroundsApi.getBackgrounds({ limit: 300 }),
          featsApi.getFeats({ limit: 300 }),
          spellsApi.getSpells({ limit: 1000 }),
          id ? charactersV3Api.get(id) : Promise.resolve(null),
        ]);
        if (stale) return;
        setRaces(raceResult.races ?? []);
        setClasses(classResult.classes ?? []);
        setBackgrounds(backgroundResult.backgrounds ?? []);
        setFeats(featResult.feats ?? []);
        setSpells(spellResult.spells ?? []);
        if (character) {
          setOriginal(character);
          const stored = safeDraft(localStorage.getItem(storageKey));
          if (!stored) {
            const fromCharacter = characterToDraft(character);
            setDraft(levelUp ? { ...fromCharacter, level: fromCharacter.level + 1 } : fromCharacter);
          }
        }
      } catch (e) {
        console.error(e);
        if (!stale) setError('Не удалось подготовить мастер персонажа');
      } finally {
        if (!stale) setLoading(false);
      }
    })();
    return () => { stale = true; };
  }, [id, levelUp, storageKey]);

  useEffect(() => {
    if (loading) return;
    localStorage.setItem(storageKey, JSON.stringify(draft));
  }, [draft, loading, storageKey]);

  const assemblySignature = useMemo(() => JSON.stringify({
    raceId: draft.raceId,
    lineageId: draft.lineageId,
    classId: draft.classId,
    subclassId: draft.subclassId,
    backgroundId: draft.backgroundId,
    level: draft.level,
    featIds: draft.featIds,
    spellIds: draft.spellIds,
    abilities: draft.abilities,
    classSkillChoices: draft.classSkillChoices,
    resolvedChoices: draft.resolvedChoices,
    equipmentOption: draft.equipmentOption,
    classEquipmentOption: draft.classEquipmentOption,
  }), [draft]);

  useEffect(() => {
    let stale = false;
    loadAssembly(draft)
      .then((next) => { if (!stale) setAssembled(next); })
      .catch((e) => {
        console.error(e);
        if (!stale) setError('Не удалось пересчитать персонажа');
      });
    return () => { stale = true; };
  }, [assemblySignature]);

  const rootRaces = useMemo(() => races.filter((race) => !race.is_subrace), [races]);
  const subraces = useMemo(
    () => races.filter((race) => race.is_subrace && race.parent_race_id === draft.raceId),
    [races, draft.raceId],
  );
  const rootClasses = useMemo(() => classes.filter((klass) => !klass.is_subclass), [classes]);
  const subclasses = useMemo(
    () => classes.filter((klass) => klass.is_subclass && klass.parent_class_id === draft.classId
      && (klass.subclass_level ?? 3) <= draft.level),
    [classes, draft.classId, draft.level],
  );
  const selectedBackground = backgrounds.find((background) => background.id === draft.backgroundId);
  const selectedClass = classes.find((klass) => klass.id === draft.classId);
  const selectedRace = races.find((race) => race.id === draft.raceId);
  const selectedLineage = races.find((race) => race.id === draft.lineageId);
  const classSkills = assembled ? classSkillChoice(assembled) : null;
  const buildChoices = assembled?.pendingChoices.filter((choice) => choice.context !== 'in_play') ?? [];
  const ruleState = useMemo(
    () => assembled ? resolveCharacterRules({ draft, assembled }) : null,
    [assembled, draft],
  );
  const maxSlotLevel = useMemo(
    () => assembled && ruleState
      ? maxAvailableSpellSlotLevel(
        syncRuntimeResources(
          buildCharacterContext(ruleState, draft, [], assembled.klass),
          assembled,
          undefined,
          ruleState.freeuseSpells,
        ).maxResources,
      )
      : 0,
    [assembled, ruleState, draft],
  );
  const hasEquipmentChoices = !!selectedClass?.equipment_options || !!selectedBackground?.equipment_options;

  const steps = useMemo(
    () => BASE_STEPS.filter(
      (step) => step.id !== 'choices' || !!classSkills || buildChoices.length > 0 || hasEquipmentChoices,
    ),
    [classSkills, buildChoices.length, hasEquipmentChoices],
  );
  const activeStep = steps[Math.min(stepIndex, steps.length - 1)] ?? steps[0];

  const patch = (value: Partial<CharacterDraft>) => setDraft((prev) => ({ ...prev, ...value }));
  const setResolved = useCallback((choiceId: string, values: string[]) => {
    setDraft((prev) => ({
      ...prev,
      resolvedChoices: { ...prev.resolvedChoices, [choiceId]: values },
    }));
  }, []);
  const activePickerChoice = picker?.kind === 'mechanic'
    ? buildChoices.find((choice) => choice.id === picker.choiceId)
    : undefined;
  const originFeats = feats.filter((feat) => feat.category === 'origin');
  const defaultBackgroundFeat = selectedBackground?.origin_feat
    ? feats.find((feat) => feat.id === selectedBackground.origin_feat || feat.card_number === selectedBackground.origin_feat)
    : undefined;
  const selectedBackgroundFeat = draft.swapFeat
    ? feats.find((feat) => draft.featIds.includes(feat.id))
    : defaultBackgroundFeat;
  const originAbilityNames = (kind: 'race' | 'class') => {
    if (!assembled) return [];
    return [
      ...assembled.effects.filter((entry) => entry.origin.kind === kind).map((entry) => entry.effect.name),
      ...assembled.actions.filter((entry) => entry.origin.kind === kind).map((entry) => entry.action.name),
    ];
  };
  const choiceValueLabels = (choice: PendingChoice, values: string[]) => values.map((id) => {
    const item = choice.items?.find((entry) => entry.id === id);
    const feat = feats.find((entry) => entry.id === id);
    const spell = spells.find((entry) => entry.id === id);
    const registry = optionsForChoiceSource(choice.source).find((entry) => entry.id === id);
    return item?.name || feat?.name || spell?.name || registry?.label || id;
  });

  const stepError = (): string | null => {
    switch (activeStep.id) {
      case 'basic': return draft.name.trim() ? null : 'Введите имя персонажа';
      case 'race': return draft.raceId ? null : 'Выберите вид';
      case 'class': return draft.classId ? null : 'Выберите класс';
      case 'background': return draft.backgroundId ? null : 'Выберите предысторию';
      case 'abilities':
        return ABILITY_KEYS.every((key) => typeof draft.abilities[key] === 'number')
          ? null
          : 'Распределите все характеристики';
      default: return null;
    }
  };

  const next = () => {
    const issue = stepError();
    if (issue) {
      setError(issue);
      return;
    }
    setError(null);
    setStepIndex((index) => Math.min(index + 1, steps.length - 1));
    window.scrollTo(0, 0);
  };

  const save = async () => {
    if (!assembled) return;
    const issues = completionIssues(draft, assembled);
    if (issues.length) {
      setError(issues[0]);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const resolvedRules = resolveCharacterRules({ draft, assembled });
      const payload = buildSavePayload(draft, assembled, resolvedRules, original?.current_hp);
      const character = original
        ? await charactersV3Api.update(original.id, payload)
        : await charactersV3Api.create(payload);
      const runtimePatch = buildResourceRuntimePatch(
        character,
        buildCharacterContext(resolvedRules, draft, [], assembled.klass),
        assembled,
        true,
        undefined,
        resolvedRules.freeuseSpells,
      ) ?? {};
      if (!original) {
        const backgroundOptions = assembled.background?.equipment_options;
        const backgroundOption = backgroundOptions?.[
          draft.equipmentOption === 'b' ? 'option_b' : 'option_a'
        ];
        const classOptions = selectedClass?.equipment_options;
        const classKey = draft.classEquipmentOption === 'b'
          ? 'option_b'
          : draft.classEquipmentOption === 'c' ? 'option_c' : 'option_a';
        const classOption = classOptions?.[classKey] ?? classOptions?.option_a;
        const quantities = new Map<string, number>();
        for (const item of [...(backgroundOption?.items || []), ...(classOption?.items || [])]) {
          quantities.set(item.card_id, (quantities.get(item.card_id) || 0) + (item.quantity ?? 1));
        }
        if (quantities.size) {
          runtimePatch.inventory_items = [...quantities].map(([card_id, qty]) => ({ card_id, qty }));
        }
        const gold = (backgroundOption?.gold || 0) + (classOption?.gold || 0);
        if (gold) runtimePatch.currency = { gold };
      }
      if (Object.keys(runtimePatch).length) {
        await charactersV3Api.patchRuntime(character.id, runtimePatch);
      }
      localStorage.removeItem(storageKey);
      navigate(`/m/characters/${character.id}`, { replace: true });
    } catch (e) {
      console.error(e);
      setError('Не удалось сохранить персонажа');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <main className="m-app"><div className="m-empty">Готовим мобильный мастер…</div></main>;

  return (
    <main className="m-app m-wizard">
      <header className="m-wizard-header">
        <button type="button" className="m-icon-button" onClick={() => navigate('/m/characters')} aria-label="Выйти из мастера">
          <ArrowLeft size={21} />
        </button>
        <div>
          <span>{levelUp ? 'Повышение уровня' : editing ? 'Редактирование' : 'Новый персонаж'}</span>
          <strong>{activeStep.label}</strong>
        </div>
        <span className="m-wizard-counter">{stepIndex + 1}/{steps.length}</span>
      </header>

      <div className="m-wizard-progress" aria-label="Прогресс создания">
        {steps.map((step, index) => <span key={step.id} className={index <= stepIndex ? 'is-done' : ''} />)}
      </div>

      <div className="m-wizard-body">
        {error && <div className="m-alert m-alert--error">{error}</div>}

        {activeStep.id === 'basic' && (
          <section className="m-wizard-step">
            <h1>{levelUp ? `Новый уровень для ${draft.name}` : 'Кто ваш герой?'}</h1>
            <p>{levelUp ? `Уровень будет повышен до ${draft.level}.` : 'Имя можно изменить позже в этом же мастере.'}</p>
            <label className="m-field">
              <span>Имя персонажа</span>
              <input value={draft.name} onChange={(event) => patch({ name: event.target.value })} autoFocus />
            </label>
            <label className="m-field">
              <span>Ссылка на портрет</span>
              <input value={draft.avatarUrl ?? ''} onChange={(event) => patch({ avatarUrl: event.target.value })} placeholder="https://…" />
            </label>
            <div className="m-level-card">
              <Sparkles size={21} />
              <span>Уровень</span>
              <strong>{draft.level}</strong>
            </div>
          </section>
        )}

        {activeStep.id === 'race' && (
          <section className="m-wizard-step">
            <h1>Выберите вид</h1>
            <p>Способности вида и подвид автоматически попадут в лист.</p>
            <SelectGrid
              values={rootRaces}
              selected={draft.raceId}
              onSelect={(race) => patch({ raceId: race.id, lineageId: null })}
            />
            {subraces.length > 0 && (
              <>
                <h2>Подвид</h2>
                <SelectGrid
                  values={subraces}
                  selected={draft.lineageId}
                  onSelect={(race) => patch({ lineageId: race.id })}
                />
              </>
            )}
            {selectedRace && (
              <EntityDetails
                description={[selectedRace.description, selectedLineage?.description].filter(Boolean).join('\n\n')}
                detailedDescription={[
                  selectedRace.detailed_description,
                  selectedLineage?.detailed_description,
                ].filter(Boolean).join('\n\n')}
                abilityNames={[
                  ...(selectedRace.traits || []).map((trait) => trait.name),
                  ...(selectedLineage?.traits || []).map((trait) => trait.name),
                  ...originAbilityNames('race'),
                ]}
              />
            )}
          </section>
        )}

        {activeStep.id === 'class' && (
          <section className="m-wizard-step">
            <h1>Выберите класс</h1>
            <p>Классовые способности первого уровня будут добавлены автоматически.</p>
            <SelectGrid
              values={rootClasses}
              selected={draft.classId}
                onSelect={(klass) => patch({ classId: klass.id, subclassId: null, classSkillChoices: [] })}
            />
            {subclasses.length > 0 && (
              <>
                <h2>Подкласс</h2>
                <SelectGrid values={subclasses} selected={draft.subclassId} onSelect={(klass) => patch({ subclassId: klass.id })} />
              </>
            )}
            {selectedClass && (
              <EntityDetails
                description={selectedClass.description}
                detailedDescription={selectedClass.detailed_description}
                abilityNames={originAbilityNames('class')}
              />
            )}
          </section>
        )}

        {activeStep.id === 'background' && (
          <section className="m-wizard-step">
            <h1>Выберите предысторию</h1>
            <p>Черта происхождения и владения применятся автоматически.</p>
            <SelectGrid
              values={backgrounds}
              selected={draft.backgroundId}
              onSelect={(background) => patch({
                backgroundId: background.id,
                swapFeat: false,
                featIds: [],
              })}
            />
            {selectedBackground && (
              <>
                <EntityDetails
                  description={selectedBackground.description}
                  detailedDescription={selectedBackground.detailed_description}
                  abilityNames={[
                    ...(selectedBackground.skill_proficiencies || []).map(
                      (skill) => `Навык: ${labelOf(SKILLS, skill)}`,
                    ),
                    ...(selectedBackground.tool_proficiency
                      ? [`Инструмент: ${selectedBackground.tool_proficiency}`]
                      : []),
                    ...(selectedBackgroundFeat ? [`Черта: ${selectedBackgroundFeat.name}`] : []),
                  ]}
                />
                {selectedBackground.origin_feat && (
                  <div className="m-wizard-background-feat">
                    <WizardChoiceCard
                      title="Черта происхождения"
                      description={draft.swapFeat ? 'Выбрана другая черта' : `Выдаёт ${selectedBackground.name}`}
                      selected={[selectedBackgroundFeat?.name || selectedBackground.origin_feat]}
                      complete
                      onClick={() => setPicker({ kind: 'background-feat' })}
                    />
                  </div>
                )}
              </>
            )}
          </section>
        )}

        {activeStep.id === 'abilities' && (
          <section className="m-wizard-step">
            <h1>Характеристики</h1>
            <AbilityAssigner
              abilities={draft.abilities}
              method={draft.abilityMethod}
              bonuses={draft.abilityBonuses}
              backgroundName={selectedBackground?.name}
              backgroundAbilities={(selectedBackground?.ability_scores ?? []).filter(
                (value): value is AbilityKey => ABILITY_KEYS.includes(value as AbilityKey),
              )}
              recommended={(selectedClass?.recommended_abilities ?? {}) as Partial<Record<AbilityKey, number>>}
              onSet={(key, value) => patch({ abilities: { ...draft.abilities, [key]: value }, abilitiesTouched: true })}
              onSetAll={(abilities) => patch({ abilities, abilitiesTouched: true })}
              onMethodChange={(abilityMethod) => patch({ abilityMethod })}
              onBonusesChange={(abilityBonuses) => patch({ abilityBonuses })}
            />
          </section>
        )}

        {activeStep.id === 'choices' && (
          <section className="m-wizard-step">
            <h1>Навыки и особенности</h1>
            <p>Каждый блок открывает отдельную карточку выбора. Заполненный выбор можно изменить.</p>
            {classSkills && (
              <WizardChoiceCard
                title="Навыки класса"
                description={`Выберите ${classSkills.count}`}
                selected={draft.classSkillChoices.map((skill) => labelOf(SKILLS, skill))}
                complete={draft.classSkillChoices.length >= classSkills.count}
                onClick={() => setPicker({ kind: 'class-skills' })}
              />
            )}
            {buildChoices.map((choice) => {
              const values = draft.resolvedChoices[choice.id] ?? [];
              return (
                <WizardChoiceCard
                key={choice.id}
                  title={choice.prompt}
                  description={`${choice.origin.name} · выберите ${choice.count}`}
                  selected={choiceValueLabels(choice, values)}
                  complete={values.length >= choice.count}
                  onClick={() => setPicker({ kind: 'mechanic', choiceId: choice.id })}
                />
              );
            })}
            {selectedClass?.equipment_options && (
              <WizardChoiceCard
                title="Стартовое снаряжение класса"
                description={selectedClass.name}
                selected={[`Вариант ${draft.classEquipmentOption.toUpperCase()}`]}
                complete
                onClick={() => setPicker({ kind: 'class-equipment' })}
              />
            )}
            {selectedBackground?.equipment_options && (
              <WizardChoiceCard
                title="Снаряжение предыстории"
                description={selectedBackground.name}
                selected={[draft.equipmentOption === 'a' ? 'Вариант А' : 'Вариант Б']}
                complete
                onClick={() => setPicker({ kind: 'background-equipment' })}
              />
            )}
          </section>
        )}

        {activeStep.id === 'review' && (
          <section className="m-wizard-step">
            <h1>Проверьте персонажа</h1>
            <div className="m-review-card">
              <div className="m-avatar">
                {draft.avatarUrl ? <img src={draft.avatarUrl} alt="" /> : draft.name.slice(0, 1).toUpperCase()}
              </div>
              <div><strong>{draft.name}</strong><span>Уровень {draft.level}</span></div>
            </div>
            <div className="m-detail-list">
              <p><span>Вид</span><strong>{races.find((race) => race.id === draft.raceId)?.name ?? '—'}</strong></p>
              <p><span>Класс</span><strong>{classes.find((klass) => klass.id === draft.classId)?.name ?? '—'}</strong></p>
              <p><span>Предыстория</span><strong>{selectedBackground?.name ?? '—'}</strong></p>
              <p><span>Максимум HP</span><strong>{assembled ? resolveCharacterRules({ draft, assembled }).maxHP : '—'}</strong></p>
            </div>
            {assembled && completionIssues(draft, assembled).length > 0 && (
              <div className="m-alert m-alert--error">
                {completionIssues(draft, assembled).map((issue) => <div key={issue}>{issue}</div>)}
              </div>
            )}
          </section>
        )}
      </div>

      <footer className="m-wizard-footer">
        <button
          type="button"
          className="m-button"
          disabled={stepIndex === 0 || saving}
          onClick={() => {
            setError(null);
            setStepIndex((index) => Math.max(0, index - 1));
            window.scrollTo(0, 0);
          }}
        >
          <ChevronLeft size={18} /> Назад
        </button>
        {activeStep.id === 'review' ? (
          <button type="button" className="m-button m-button--gold" disabled={saving || !assembled} onClick={save}>
            <Check size={18} /> {saving ? 'Сохраняем…' : original ? 'Сохранить' : 'Создать'}
          </button>
        ) : (
          <button type="button" className="m-button m-button--gold" onClick={next}>
            Далее <ArrowRight size={18} />
          </button>
        )}
      </footer>

      {picker && (
        <MobileOverlay
          title={
            picker.kind === 'class-skills' ? 'Навыки класса'
              : picker.kind === 'class-equipment' ? 'Снаряжение класса'
                : picker.kind === 'background-equipment' ? 'Снаряжение предыстории'
                  : picker.kind === 'background-feat' ? 'Черта происхождения'
                    : activePickerChoice?.prompt || 'Выбор'
          }
          onClose={() => setPicker(null)}
          footer={(
            <button type="button" className="m-button m-button--gold m-button--wide" onClick={() => setPicker(null)}>
              <Check size={18} /> Готово
            </button>
          )}
        >
          {picker.kind === 'class-skills' && classSkills && (
            <div className="m-wizard-option-list">
              <p className="m-picker-note">Выберите {classSkills.count}</p>
              {classSkills.options.map((skill) => {
                const selected = draft.classSkillChoices.includes(skill);
                return (
                  <button
                    type="button"
                    key={skill}
                    className={selected ? 'is-selected' : ''}
                    onClick={() => {
                      const current = draft.classSkillChoices;
                      patch({
                        classSkillChoices: selected
                          ? current.filter((value) => value !== skill)
                          : [...current.slice(-(classSkills.count - 1)), skill],
                      });
                    }}
                  >
                    <span>{labelOf(SKILLS, skill)}</span>
                    {selected && <Check size={18} />}
                  </button>
                );
              })}
            </div>
          )}

          {picker.kind === 'mechanic' && activePickerChoice?.source === 'spell' && (
            <div className="m-wizard-option-list m-wizard-spell-options">
              <p className="m-picker-note">Выберите {activePickerChoice.count}</p>
              {spells.filter((spell) => spellMatchesChoice(spell, activePickerChoice, maxSlotLevel)).map((spell) => {
                const values = draft.resolvedChoices[activePickerChoice.id] ?? [];
                const selected = values.includes(spell.id);
                return (
                  <button
                    type="button"
                    key={spell.id}
                    className={selected ? 'is-selected' : ''}
                    onClick={() => {
                      const nextValues = selected
                        ? values.filter((value) => value !== spell.id)
                        : values.length >= activePickerChoice.count
                          ? [...values.slice(1), spell.id]
                          : [...values, spell.id];
                      setResolved(activePickerChoice.id, nextValues);
                    }}
                  >
                    <span className="m-wizard-option-image">
                      {spell.image_url ? <img src={spell.image_url} alt="" /> : <Sparkles size={19} />}
                    </span>
                    <span>
                      <strong>{spell.name}</strong>
                      <small>{getSpellLevelLabel(spell.level)}</small>
                    </span>
                    {selected && <Check size={18} />}
                  </button>
                );
              })}
              {spells.filter((spell) => spellMatchesChoice(spell, activePickerChoice, maxSlotLevel)).length === 0 && (
                <div className="m-empty">Нет заклинаний, подходящих ограничениям выбора.</div>
              )}
            </div>
          )}

          {picker.kind === 'mechanic' && activePickerChoice?.source !== 'spell' && activePickerChoice && (
            <div className="m-wizard-choice-resolver">
              <ChoiceResolver
                choice={activePickerChoice}
                value={draft.resolvedChoices[activePickerChoice.id] ?? []}
                onChange={(values) => setResolved(activePickerChoice.id, values)}
                feats={feats}
              />
            </div>
          )}

          {picker.kind === 'class-equipment' && selectedClass?.equipment_options && (
            <BackgroundEquipment
              options={selectedClass.equipment_options}
              selectable
              selected={draft.classEquipmentOption}
              onSelect={(classEquipmentOption) => patch({ classEquipmentOption })}
            />
          )}

          {picker.kind === 'background-equipment' && selectedBackground?.equipment_options && (
            <BackgroundEquipment
              options={selectedBackground.equipment_options}
              selectable
              selected={draft.equipmentOption}
              onSelect={(equipmentOption) => {
                if (equipmentOption === 'a' || equipmentOption === 'b') patch({ equipmentOption });
              }}
            />
          )}

          {picker.kind === 'background-feat' && (
            <div className="m-wizard-option-list">
              {defaultBackgroundFeat && (
                <button
                  type="button"
                  className={!draft.swapFeat ? 'is-selected' : ''}
                  onClick={() => patch({ swapFeat: false, featIds: [] })}
                >
                  <span className="m-wizard-option-image">
                    {defaultBackgroundFeat.image_url
                      ? <img src={defaultBackgroundFeat.image_url} alt="" />
                      : <Sparkles size={19} />}
                  </span>
                  <span><strong>{defaultBackgroundFeat.name}</strong><small>Черта предыстории</small></span>
                  {!draft.swapFeat && <Check size={18} />}
                </button>
              )}
              {originFeats
                .filter((feat) => feat.id !== defaultBackgroundFeat?.id)
                .map((feat) => {
                  const selected = draft.swapFeat && draft.featIds.includes(feat.id);
                  return (
                    <button
                      type="button"
                      key={feat.id}
                      className={selected ? 'is-selected' : ''}
                      onClick={() => patch({ swapFeat: true, featIds: [feat.id] })}
                    >
                      <span className="m-wizard-option-image">
                        {feat.image_url ? <img src={feat.image_url} alt="" /> : <Sparkles size={19} />}
                      </span>
                      <span><strong>{feat.name}</strong><small>{feat.description || 'Черта происхождения'}</small></span>
                      {selected && <Check size={18} />}
                    </button>
                  );
                })}
            </div>
          )}
        </MobileOverlay>
      )}
    </main>
  );
}
