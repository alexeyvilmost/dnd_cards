import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, ChevronLeft, Sparkles } from 'lucide-react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { backgroundsApi, classesApi, featsApi, racesApi } from '../api/client';
import { charactersV3Api } from '../character/api';
import { loadAssembly, type AssembledCharacter } from '../character/assemble';
import { AbilityAssigner, ChoiceResolver } from '../character/components';
import {
  buildSavePayload, characterToDraft, classSkillChoice, completionIssues,
} from '../character/forgeHelpers';
import { resolveCharacterRules } from '../character/rules/resolveCharacterRules';
import {
  ABILITY_KEYS, emptyDraft, type AbilityKey, type CharacterDraft, type ForgeCharacter,
} from '../character/types';
import type { Background, CharacterClass, Feat, Race } from '../types';
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
  const [assembled, setAssembled] = useState<AssembledCharacter | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stale = false;
    (async () => {
      setLoading(true);
      try {
        const [raceResult, classResult, backgroundResult, featResult, character] = await Promise.all([
          racesApi.getRaces({ limit: 300 }),
          classesApi.getClasses({ limit: 300 }),
          backgroundsApi.getBackgrounds({ limit: 300 }),
          featsApi.getFeats({ limit: 300 }),
          id ? charactersV3Api.get(id) : Promise.resolve(null),
        ]);
        if (stale) return;
        setRaces(raceResult.races ?? []);
        setClasses(classResult.classes ?? []);
        setBackgrounds(backgroundResult.backgrounds ?? []);
        setFeats(featResult.feats ?? []);
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
  const classSkills = assembled ? classSkillChoice(assembled) : null;
  const buildChoices = assembled?.pendingChoices.filter((choice) => choice.context !== 'in_play') ?? [];

  const steps = useMemo(
    () => BASE_STEPS.filter((step) => step.id !== 'choices' || !!classSkills || buildChoices.length > 0),
    [classSkills, buildChoices.length],
  );
  const activeStep = steps[Math.min(stepIndex, steps.length - 1)] ?? steps[0];

  const patch = (value: Partial<CharacterDraft>) => setDraft((prev) => ({ ...prev, ...value }));
  const setResolved = useCallback((choiceId: string, values: string[]) => {
    setDraft((prev) => ({
      ...prev,
      resolvedChoices: { ...prev.resolvedChoices, [choiceId]: values },
    }));
  }, []);

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
      const ruleState = resolveCharacterRules({ draft, assembled });
      const payload = buildSavePayload(draft, assembled, ruleState, original?.current_hp);
      const character = original
        ? await charactersV3Api.update(original.id, payload)
        : await charactersV3Api.create(payload);
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
          </section>
        )}

        {activeStep.id === 'class' && (
          <section className="m-wizard-step">
            <h1>Выберите класс</h1>
            <p>Стартовое снаряжение выбирается рядом с классом.</p>
            <SelectGrid
              values={rootClasses}
              selected={draft.classId}
              onSelect={(klass) => patch({ classId: klass.id, subclassId: null, classSkillChoices: [] })}
            />
            {selectedClass?.equipment_options && (
              <div className="m-choice-strip">
                <span>Стартовое снаряжение</span>
                {(['a', 'b', 'c'] as const).map((value) => (
                  <button
                    type="button"
                    key={value}
                    className={draft.classEquipmentOption === value ? 'is-selected' : ''}
                    onClick={() => patch({ classEquipmentOption: value })}
                  >
                    Вариант {value.toUpperCase()}
                  </button>
                ))}
              </div>
            )}
            {subclasses.length > 0 && (
              <>
                <h2>Подкласс</h2>
                <SelectGrid values={subclasses} selected={draft.subclassId} onSelect={(klass) => patch({ subclassId: klass.id })} />
              </>
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
              onSelect={(background) => patch({ backgroundId: background.id })}
            />
            {selectedBackground?.equipment_options && (
              <div className="m-choice-strip">
                <span>Снаряжение предыстории</span>
                <button type="button" className={draft.equipmentOption === 'a' ? 'is-selected' : ''} onClick={() => patch({ equipmentOption: 'a' })}>
                  Снаряжение
                </button>
                <button type="button" className={draft.equipmentOption === 'b' ? 'is-selected' : ''} onClick={() => patch({ equipmentOption: 'b' })}>
                  Золото
                </button>
              </div>
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
            {classSkills && (
              <div className="choice-box">
                <div className="choice-title">Навыки класса · выберите {classSkills.count}</div>
                <div className="chips">
                  {classSkills.options.map((skill) => {
                    const selected = draft.classSkillChoices.includes(skill);
                    return (
                      <button
                        type="button"
                        key={skill}
                        className={`chip ${selected ? 'on' : ''}`}
                        onClick={() => {
                          const current = draft.classSkillChoices;
                          patch({
                            classSkillChoices: selected
                              ? current.filter((value) => value !== skill)
                              : [...current.slice(-(classSkills.count - 1)), skill],
                          });
                        }}
                      >
                        {skill}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            {buildChoices.map((choice) => (
              <ChoiceResolver
                key={choice.id}
                choice={choice}
                value={draft.resolvedChoices[choice.id] ?? []}
                onChange={(values) => setResolved(choice.id, values)}
                feats={feats}
              />
            ))}
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
    </main>
  );
}
