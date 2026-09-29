// Dev-only visual fixture. It uses the production map and animation catalog,
// but its fixed rolls never issue commands, write a save, or contact the API.
import {useEffect, useMemo, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import TacticalBattleMap from '../../src/components/TacticalBattleMap';
import {builtInAnimationCatalog, combatAnimationForOutcome, type CombatAnimationProfile} from '../../src/solo-combat/animationProfiles';
import compiled from '../../src/pages/rulesLabFixture.generated.json';
import {setSetting} from '../../src/settings';
import type {ActorState} from '../../src/rules-core/domain';
import {presentCombatEntries, type CombatBeat} from '../../src/solo-combat/presentation';
import {areaEffectOrigin, areaPositionsForAction, tacticalAreaGeometry} from '../../src/solo-combat/tacticalGrid';
import {getDamageLabel} from '../../src/utils/damageTypes';
import type {GridPosition, SoloCombatState} from '../../src/solo-combat/types';
import '../../src/pages/SoloCombatPage.css';
import './combat-animations-preview.css';

setSetting('combat3d', false);
const profiles = builtInAnimationCatalog.profiles;
const params = new URLSearchParams(location.search);
const firstProfile = profiles.find(profile => profile.key === params.get('profile')) ?? profiles[0];
const areaKinds = ['cone', 'line', 'cube', 'sphere', 'cylinder', 'emanation'] as const;
type AreaKind = typeof areaKinds[number];
type PreviewOutcome = 'hit' | 'miss' | 'crit' | 'crit_miss' | 'held';
const areaLabels: Record<AreaKind, string> = {cone: 'Конус', line: 'Линия', cube: 'Куб', sphere: 'Сфера', cylinder: 'Цилиндр', emanation: 'Эманация'};
const defaultArea: Record<string, AreaKind> = {area_cone: 'cone', area_line: 'line', area_wave: 'cube', area_burst: 'sphere'};

function makeActor(id: string, name: string): ActorState {
  const actor = structuredClone(compiled.roots.magicInitiateFighter.actor) as unknown as ActorState;
  return {...actor, id, name, kind: id === 'target' ? 'monster' : 'playerCharacter',
    character: {...actor.character, baseSize: 2},
    runtime: {...actor.runtime, hp: {current: 20, max: 20, temp: 0}, activeEffects: []}};
}

function makeState(targetPosition: GridPosition): SoloCombatState {
  return {
    schemaVersion: 1, tacticalFootprints: 'sized', characterId: 'caster', runtimeRevision: 0,
    world: {actors: {caster: makeActor('caster', 'Заклинатель'), target: makeActor('target', 'Цель')},
      objects: {}, scene: {mode: 'encounter', initiative: ['caster', 'target'], activeIndex: 0, round: 1}},
    battleMap: {id: 'animation-workshop', name: 'Лесная поляна', description: 'Изолированное поле для просмотра анимаций.',
      width: 12, height: 8, maxFootprint: 2, maxActors: 2, artVersion: 2, ambientLight: 'bright',
      background: '/assets/battle-maps/forest-floor-v1.png', features: []},
    tokens: {
      caster: {actorId: 'caster', color: '#68cdc8', tokenUrl: '/portraits/presets/swordsman.png', position: {x: 3, y: 4}},
      target: {actorId: 'target', color: '#d79276', tokenUrl: '/portraits/presets/line.png', position: targetPosition},
    },
    catalogActions: [], combatAreas: {}, sideByActorId: {caster: 'party', target: 'enemy'}, actorPresentation: {},
    controlledCharacterIds: ['caster'], playerActionIds: [], certifiedPlayerActionIds: [], monsterActionIds: {},
    opportunityActionIds: {}, resourceBindings: {}, boardRevision: 0, movementRemainingFt: {caster: 30, target: 30},
    initiativeBonuses: {}, initiative: [], log: [], outcome: 'active',
  } as unknown as SoloCombatState;
}

function Preview() {
  const [profileKey, setProfileKey] = useState(firstProfile.key);
  const [spellLevel, setSpellLevel] = useState(Math.min(9, Math.max(0, Number(params.get('level')) || 0)));
  const [outcome, setOutcome] = useState<PreviewOutcome>(params.has('held') ? 'held' : params.has('crit-miss') ? 'crit_miss'
    : params.has('miss') ? 'miss' : params.has('critical') || firstProfile.strikeStyle === 'critical' ? 'crit' : 'hit');
  const [damageType, setDamageType] = useState(params.get('damage') ?? '');
  const [repeat, setRepeat] = useState(!params.has('once'));
  const [feedback, setFeedback] = useState<CombatBeat | null>(null);
  const [targetPosition, setTargetPosition] = useState<GridPosition | null>(null);
  const [compact, setCompact] = useState(window.innerWidth < 850);
  const [snapshot, setSnapshot] = useState<SoloCombatState | null>(null);
  const [snapshotError, setSnapshotError] = useState('');
  const [savedBeatKey, setSavedBeatKey] = useState('');
  const [areaKindOverride, setAreaKindOverride] = useState<AreaKind | null>(areaKinds.find(kind => kind === params.get('area')) ?? null);
  const [areaSizeFt, setAreaSizeFt] = useState(15);
  const sequence = useRef(0);
  const selectedProfile = profiles.find(row => row.key === profileKey)!;
  const profile = profiles.find(row => row.key === selectedProfile.baseProfileKey) ?? selectedProfile;
  const miss = outcome === 'miss' || outcome === 'crit_miss';
  const held = outcome === 'held';
  const critical = outcome === 'crit';
  const previewAnimation = combatAnimationForOutcome(profile, {outcome: held ? 'hit' : outcome,
    rollPhase: held ? 'before-reaction' : undefined, damageType: damageType || undefined});
  const close = ['melee_slash', 'melee_pierce', 'melee_bash', 'bite', 'claws', 'tail', 'tentacle', 'sting', 'natural_slam'].includes(profile.primitive);
  const hasArea = profile.primitive.startsWith('area_');
  const areaKind = areaKindOverride ?? defaultArea[profile.primitive] ?? 'sphere';
  const state = useMemo(() => makeState(targetPosition ?? {x: close ? 4 : 8, y: 4}), [targetPosition, close]);
  const savedBeats = useMemo(() => snapshot ? presentCombatEntries(snapshot, snapshot.log).filter(beat => beat.animation) : [], [snapshot]);
  const savedBeat = savedBeats.find(beat => beat.id === savedBeatKey) ?? savedBeats[0];
  const shownState = snapshot ?? state;
  const shownProfile = snapshot ? savedBeat?.animation ?? profile : previewAnimation;

  useEffect(() => {
    const resize = () => setCompact(window.innerWidth < 850);
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  const play = (animation: CombatAnimationProfile = previewAnimation) => {
    if (snapshot && savedBeat) {
      setFeedback({...savedBeat, id: `animation-replay-${++sequence.current}`});
      return;
    }
    const sourceOnly = ['dash', 'hide', 'dodge', 'disengage', 'recover', 'search', 'aura', 'ward', 'heal'].includes(animation.primitive);
    const targetId = sourceOnly ? 'caster' : 'target';
    const cue = animation.primitive === 'heal' ? {actorId: targetId, kind: 'healing' as const, text: '+5', damageType: 'healing'}
      : {actorId: targetId, kind: 'miss' as const, text: 'Промах'};
    const areaAction = {mechanics: {targeting: {shape: 'area', area: {kind: areaKind,
      size_ft: areaSizeFt, length_ft: areaSizeFt, width_ft: 5, radius_ft: areaSizeFt}}}, targeting: {rangeFt: 120}};
    const projection = {board: state, action: areaAction, sourcePosition: state.tokens.caster.position, aimPosition: state.tokens.target.position};
    const geometry = tacticalAreaGeometry(areaAction)!;
    setFeedback({id: `animation-preview-${++sequence.current}`, sourceId: 'caster', targetId,
      sourceName: 'Заклинатель', targetName: targetId === 'caster' ? 'Заклинатель' : 'Цель', actionName: animation.key,
      animation, spellLevel, from: state.tokens.caster.position, to: state.tokens[targetId].position,
      ...(hasArea ? {area: {geometry, sourcePosition: projection.sourcePosition, aim: projection.aimPosition,
        origin: areaEffectOrigin(projection), cells: areaPositionsForAction(projection)}} : {}),
      rollKind: 'attack', rollPhase: held ? 'before-reaction' : undefined,
      roll: {kind: 'd20', dice: [{sides: 20, result: critical ? 20 : outcome === 'crit_miss' ? 1 : miss ? 3 : 17}], modifiers: [{source: 'Сохранённый модификатор', value: 3}],
        advantage: 'none', total: critical ? 23 : outcome === 'crit_miss' ? 4 : miss ? 6 : 20, target: {type: 'ac', value: 15}, outcome: held ? 'hit' : outcome,
        text: 'Фиксированный результат для визуальной проверки'},
      cues: held || (!miss && animation.primitive !== 'heal') ? [] : [cue], damage: [],
    });
  };

  useEffect(() => {
    play();
    if (!repeat) return;
    const timer = window.setInterval(() => play(), Math.max(2400, shownProfile.motion.durationMs + 900));
    return () => window.clearInterval(timer);
    // A fresh ID restarts the canonical CSS animation, without changing a roll.
  }, [profileKey, spellLevel, outcome, damageType, repeat, state, snapshot, savedBeatKey, areaKind, areaSizeFt]);

  const loadSnapshot = async (file?: File) => {
    if (!file) return;
    try {
      const value = JSON.parse(await file.text());
      const candidate = value.combat_state ?? value.combat_envelope?.state ?? value;
      if (!candidate.world?.actors || !candidate.tokens || !Array.isArray(candidate.catalogActions) || !Array.isArray(candidate.log)) {
        throw new Error('В файле нет сохранённого состояния боя.');
      }
      setSnapshot(candidate as SoloCombatState);
      setSavedBeatKey('');
      setSnapshotError('');
      setRepeat(false);
    } catch (error) {
      setSnapshotError(error instanceof Error ? error.message : 'Не удалось прочитать снимок.');
    }
  };

  const changeProfile = (key: string) => {
    setProfileKey(key);
    if (profiles.find(row => row.key === key)?.strikeStyle === 'critical') setOutcome('crit');
    setTargetPosition(null);
    setAreaKindOverride(null);
  };
  return <main className="solo-combat-page animation-workshop">
    <header className="animation-workshop__header">
      <div><p className="animation-workshop__eyebrow">ЛОКАЛЬНАЯ МАСТЕРСКАЯ · 2D</p><h1>Магия в движении</h1>
        <p className="animation-workshop__intro">Удары, заклинания и действия на обычном поле боя.</p></div>
      <span className="animation-workshop__count">{profiles.length} профилей</span>
    </header>
    <div className="animation-workshop__layout">
      <aside className="animation-workshop__panel" aria-label="Управление анимациями">
        {snapshot ? <>
          <label className="animation-workshop__field">Сохранённое событие<select aria-label="Сохранённое событие" value={savedBeat?.id ?? ''} onChange={event => setSavedBeatKey(event.target.value)}>
            {savedBeats.map((beat, index) => <option key={beat.id} value={beat.id}>{index + 1}. {beat.sourceName}: {beat.actionName} · {beat.animation?.key}</option>)}
          </select></label>
          <p className="animation-workshop__hint">Отображаются сохранённые результаты и привязки сущностей. Файл читается только в браузере.</p>
          <button type="button" className="animation-workshop__reset" onClick={() => {setSnapshot(null); setSavedBeatKey('');}}>Вернуться к профилям</button>
        </> : <>
        <label className="animation-workshop__field">Анимация<select aria-label="Профиль анимации" value={profileKey} onChange={event => changeProfile(event.target.value)}>
          {profiles.map(row => <option key={row.key} value={row.key}>{row.key}</option>)}
        </select></label>
        <div className="animation-workshop__palette" aria-hidden="true"><span style={{background: shownProfile.palette.primary}}/><span style={{background: shownProfile.palette.secondary}}/><b>{shownProfile.primitive}</b></div>
        <label className="animation-workshop__field">Палитра урона<select aria-label="Палитра урона" value={damageType} onChange={event => setDamageType(event.target.value)}>
          <option value="">Из профиля</option>{Object.keys(builtInAnimationCatalog.defaults.damage).map(type => <option key={type} value={type}>{getDamageLabel(type)}</option>)}
        </select></label>
        <label className="animation-workshop__field">Уровень заклинания <output>{spellLevel === 0 ? 'Заговор' : spellLevel}</output>
          <input aria-label="Уровень заклинания" type="range" min="0" max="9" value={spellLevel} onChange={event => setSpellLevel(Number(event.target.value))}/></label>
        <p className="animation-workshop__hint">Магические круги растут вместе с уровнем. Нажмите на клетку, чтобы переместить цель.</p>
        {hasArea && <div className="animation-workshop__area">
          <label className="animation-workshop__field">Геометрия области<select aria-label="Геометрия области" value={areaKind} onChange={event => setAreaKindOverride(event.target.value as AreaKind)}>
            {areaKinds.map(kind => <option key={kind} value={kind}>{areaLabels[kind]}</option>)}
          </select></label>
          <label className="animation-workshop__field">Размер области <output>{areaSizeFt} фт</output>
            <input aria-label="Размер области" type="range" min="5" max="30" step="5" value={areaSizeFt} onChange={event => setAreaSizeFt(Number(event.target.value))}/></label>
        </div>}
        </>}
        <div className="animation-workshop__toggles">
          {!snapshot && <><label><input type="checkbox" checked={critical} onChange={event => setOutcome(event.target.checked ? 'crit' : 'hit')}/> Критический удар</label>
          <label><input type="checkbox" checked={outcome === 'miss'} onChange={event => setOutcome(event.target.checked ? 'miss' : 'hit')}/> Промах</label>
          <label><input type="checkbox" checked={outcome === 'crit_miss'} onChange={event => setOutcome(event.target.checked ? 'crit_miss' : 'hit')}/> Критический промах</label>
          <label><input type="checkbox" checked={held} onChange={event => setOutcome(event.target.checked ? 'held' : 'hit')}/> Ожидание реакции</label></>}
          <label><input type="checkbox" checked={repeat} onChange={event => setRepeat(event.target.checked)}/> Повторять</label>
        </div>
        <button className="animation-workshop__play" type="button" onClick={() => play()}>Повторить анимацию <span aria-hidden="true">↻</span></button>
        {!snapshot && <div className="animation-workshop__step">
          <button type="button" onClick={() => changeProfile(profiles[(profiles.indexOf(profile) - 1 + profiles.length) % profiles.length].key)}>← Предыдущая</button>
          <button type="button" onClick={() => changeProfile(profiles[(profiles.indexOf(profile) + 1) % profiles.length].key)}>Следующая →</button>
        </div>}
        <label className="animation-workshop__field animation-workshop__snapshot">Открыть локальный снимок боя
          <input type="file" accept="application/json,.json" aria-label="Локальный снимок боя" onChange={event => {void loadSnapshot(event.target.files?.[0]); event.target.value = '';}}/>
        </label>
        {snapshotError && <p className="animation-workshop__error" role="alert">{snapshotError}</p>}
        <p className="animation-workshop__note">Это визуальная сцена с фиксированным результатом. Персонажи и сохранённые бои не изменяются.</p>
      </aside>
      <section className="animation-workshop__stage">
        <div className="animation-workshop__stage-heading"><span>{shownProfile.key}</span><output data-testid="animation-profile">{shownProfile.primitive} · {shownProfile.motion.durationMs} мс</output></div>
        <div className="combat-map-wrap" aria-label="Поле визуальной проверки">
          <TacticalBattleMap key={`${close}:${compact}:${Boolean(snapshot)}`} state={shownState} actorId={shownState.characterId} selectedActionId={null} movementMode={false}
            feedback={feedback} onCell={position => {if (!snapshot) setTargetPosition(position);}}/>
        </div>
        <p className="animation-workshop__caption">{snapshot ? `${savedBeat?.sourceName ?? ''} → ${savedBeat?.targetName ?? ''} · ${savedBeat?.actionName ?? ''} · сохранённый результат` : 'Бирюзовый — источник · медный — цель · колесо мыши — масштаб'}</p>
      </section>
    </div>
  </main>;
}

createRoot(document.getElementById('root')!).render(<Preview/>);
