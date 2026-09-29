// Dev-only visual fixture. It uses the production map and animation catalog,
// but its fixed rolls never issue commands, write a save, or contact the API.
import {useEffect, useMemo, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import TacticalBattleMap from '../../src/components/TacticalBattleMap';
import {builtInAnimationCatalog, type CombatAnimationProfile} from '../../src/solo-combat/animationProfiles';
import compiled from '../../src/pages/rulesLabFixture.generated.json';
import {setSetting} from '../../src/settings';
import type {ActorState} from '../../src/rules-core/domain';
import type {CombatBeat} from '../../src/solo-combat/presentation';
import type {GridPosition, SoloCombatState} from '../../src/solo-combat/types';
import '../../src/pages/SoloCombatPage.css';
import './combat-animations-preview.css';

setSetting('combat3d', false);
const profiles = builtInAnimationCatalog.profiles;
const params = new URLSearchParams(location.search);
const firstProfile = profiles.find(profile => profile.key === params.get('profile')) ?? profiles[0];

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
  const [miss, setMiss] = useState(params.has('miss'));
  const [held, setHeld] = useState(false);
  const [repeat, setRepeat] = useState(!params.has('once'));
  const [feedback, setFeedback] = useState<CombatBeat | null>(null);
  const [targetPosition, setTargetPosition] = useState<GridPosition | null>(null);
  const [compact, setCompact] = useState(window.innerWidth < 850);
  const sequence = useRef(0);
  const profile = profiles.find(row => row.key === profileKey)!;
  const close = ['melee_slash', 'melee_pierce', 'melee_bash', 'bite'].includes(profile.primitive);
  const state = useMemo(() => makeState(targetPosition ?? {x: close ? 4 : 8, y: 4}), [targetPosition, close]);

  useEffect(() => {
    const resize = () => setCompact(window.innerWidth < 850);
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  const play = (animation: CombatAnimationProfile = profile) => {
    const sourceOnly = ['dash', 'hide', 'dodge', 'disengage', 'recover', 'search', 'aura', 'ward', 'heal'].includes(animation.primitive);
    const targetId = sourceOnly ? 'caster' : 'target';
    const cue = animation.primitive === 'heal' ? {actorId: targetId, kind: 'healing' as const, text: '+5', damageType: 'healing'}
      : {actorId: targetId, kind: 'miss' as const, text: 'Промах'};
    setFeedback({id: `animation-preview-${++sequence.current}`, sourceId: 'caster', targetId,
      sourceName: 'Заклинатель', targetName: targetId === 'caster' ? 'Заклинатель' : 'Цель', actionName: animation.key,
      animation, spellLevel, from: state.tokens.caster.position, to: state.tokens[targetId].position,
      rollKind: 'attack', rollPhase: held ? 'before-reaction' : undefined,
      roll: {kind: 'd20', dice: [{sides: 20, result: miss ? 3 : 17}], modifiers: [{source: 'Сохранённый модификатор', value: 3}],
        advantage: 'none', total: miss ? 6 : 20, target: {type: 'ac', value: 15}, outcome: miss ? 'miss' : 'hit',
        text: 'Фиксированный результат для визуальной проверки'},
      cues: held || (!miss && animation.primitive !== 'heal') ? [] : [cue], damage: [],
    });
  };

  useEffect(() => {
    play();
    if (!repeat) return;
    const timer = window.setInterval(() => play(), Math.max(2400, profile.motion.durationMs + 900));
    return () => window.clearInterval(timer);
    // A fresh ID restarts the canonical CSS animation, without changing a roll.
  }, [profileKey, spellLevel, miss, held, repeat, state]);

  const changeProfile = (key: string) => {
    setProfileKey(key);
    setTargetPosition(null);
  };
  return <main className="solo-combat-page animation-workshop">
    <header className="animation-workshop__header">
      <div><p className="animation-workshop__eyebrow">ЛОКАЛЬНАЯ МАСТЕРСКАЯ · 2D</p><h1>Магия в движении</h1>
        <p className="animation-workshop__intro">Удары, заклинания и действия на обычном поле боя.</p></div>
      <span className="animation-workshop__count">{profiles.length} профилей</span>
    </header>
    <div className="animation-workshop__layout">
      <aside className="animation-workshop__panel" aria-label="Управление анимациями">
        <label className="animation-workshop__field">Анимация<select aria-label="Профиль анимации" value={profileKey} onChange={event => changeProfile(event.target.value)}>
          {profiles.map(row => <option key={row.key} value={row.key}>{row.key}</option>)}
        </select></label>
        <div className="animation-workshop__palette" aria-hidden="true"><span style={{background: profile.palette.primary}}/><span style={{background: profile.palette.secondary}}/><b>{profile.primitive}</b></div>
        <label className="animation-workshop__field">Уровень заклинания <output>{spellLevel === 0 ? 'Заговор' : spellLevel}</output>
          <input aria-label="Уровень заклинания" type="range" min="0" max="9" value={spellLevel} onChange={event => setSpellLevel(Number(event.target.value))}/></label>
        <p className="animation-workshop__hint">Магические круги растут вместе с уровнем. Нажмите на клетку, чтобы переместить цель.</p>
        <div className="animation-workshop__toggles">
          <label><input type="checkbox" checked={miss} onChange={event => setMiss(event.target.checked)}/> Промах</label>
          <label><input type="checkbox" checked={held} onChange={event => setHeld(event.target.checked)}/> Ожидание реакции</label>
          <label><input type="checkbox" checked={repeat} onChange={event => setRepeat(event.target.checked)}/> Повторять</label>
        </div>
        <button className="animation-workshop__play" type="button" onClick={() => play()}>Повторить анимацию <span aria-hidden="true">↻</span></button>
        <div className="animation-workshop__step">
          <button type="button" onClick={() => changeProfile(profiles[(profiles.indexOf(profile) - 1 + profiles.length) % profiles.length].key)}>← Предыдущая</button>
          <button type="button" onClick={() => changeProfile(profiles[(profiles.indexOf(profile) + 1) % profiles.length].key)}>Следующая →</button>
        </div>
        <p className="animation-workshop__note">Это визуальная сцена с фиксированным результатом. Персонажи и сохранённые бои не изменяются.</p>
      </aside>
      <section className="animation-workshop__stage">
        <div className="animation-workshop__stage-heading"><span>{profile.key}</span><output data-testid="animation-profile">{profile.primitive} · {profile.motion.durationMs} мс</output></div>
        <div className="combat-map-wrap" aria-label="Поле визуальной проверки">
          <TacticalBattleMap key={`${close}:${compact}`} state={state} actorId="caster" selectedActionId={null} movementMode={false}
            feedback={feedback} onCell={position => setTargetPosition(position)}/>
        </div>
        <p className="animation-workshop__caption">Бирюзовый — источник · медный — цель · колесо мыши — масштаб</p>
      </section>
    </div>
  </main>;
}

createRoot(document.getElementById('root')!).render(<Preview/>);
