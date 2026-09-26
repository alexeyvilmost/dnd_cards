// Dev-only acceptance fixture. These controls change isolated presentation state;
// they never issue combat commands, persist a combat, or contact an API.
import {useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import TacticalBattleMap from '../../src/components/TacticalBattleMap';
import SettingsPanel from '../../src/components/SettingsPanel';
import compiled from '../../src/pages/rulesLabFixture.generated.json';
import monsterCatalog from '../../src/battle3d/miniatures/catalog.snapshot.json';
import {BATTLE_MAPS, materializeMapAreas, packBattleMap} from '../../src/solo-combat/battleMaps';
import {boardCells, terrainFits} from '../../src/solo-combat/boardGeometry';
import type {CombatBeat} from '../../src/solo-combat/presentation';
import type {GridPosition, SoloCombatState} from '../../src/solo-combat/types';
import type {ActorState} from '../../src/rules-core/domain';
import '../../src/pages/SoloCombatPage.css';

const gallery = new URLSearchParams(location.search).has('gallery');
const templateIds = ['d2500000-0000-4000-8000-000000000001', 'd2500000-0000-4000-8000-000000000002', 'd2500000-0000-4000-8000-000000000003'];
const templates = ['swordsman', 'archer', 'line'];
const templateNames = ['Мечник', 'Лучник', 'Линейный боец'];
const sampleSlugs = ['goblin-warrior', 'ogre', 'skeleton', 'wolf', 'giant-wolf-spider', 'giant-rat', 'audit-20260905-dummy'];
const selectedMonsters = monsterCatalog.monsters.filter(monster => gallery || sampleSlugs.includes(monster.slug));
const sizes: Record<string, number> = {tiny:0, small:1, medium:2, large:3, huge:4, gargantuan:5};

function makeActor(id: string, name: string, size = 'medium'): ActorState {
  const actor = structuredClone(compiled.roots.magicInitiateFighter.actor) as unknown as ActorState;
  return {...actor, id, name, kind:id.startsWith('monster-') ? 'monster' : 'playerCharacter',
    character: {...actor.character, baseSize: sizes[size] ?? 2},
    runtime: {...actor.runtime, hp: {current:20, max:20, temp:0}, activeEffects: []}};
}

function initialState(mapIndex = 0): SoloCombatState {
  const actors = Object.fromEntries([
    ...templates.map((_, i) => [`hero-${i}`, makeActor(`hero-${i}`, templateNames[i])]),
    ...selectedMonsters.map(monster => [`monster-${monster.slug}`, makeActor(`monster-${monster.slug}`, monster.name, monster.size)]),
  ]) as Record<string, ActorState>;
  const map = structuredClone(BATTLE_MAPS[mapIndex]);
  const partyIds = templates.map((_, i) => `hero-${i}`);
  const positions = packBattleMap(map, Object.values(actors), partyIds);
  if (!positions) throw new Error('Fixture roster does not fit the selected board');
  const tokens = Object.fromEntries(Object.keys(actors).map(id => [id, {
    actorId:id, color:partyIds.includes(id) ? '#60bac3' : '#d68769', position:positions[id],
  }]));
  templates.forEach((slug, i) => Object.assign(tokens[`hero-${i}`], {
    templateId:templateIds[i], tokenUrl:`/portraits/presets/${slug}.png`,
  }));
  selectedMonsters.forEach(monster => Object.assign(tokens[`monster-${monster.slug}`], {templateId:monster.id}));
  return {
    schemaVersion:1, tacticalFootprints:'sized', characterId:'hero-0', runtimeRevision:0,
    world:{actors, objects:{}, scene:{mode:'encounter', initiative:Object.keys(actors), activeIndex:0, round:1}},
    battleMap:map, tokens, catalogActions:[], combatAreas:materializeMapAreas(map),
    sideByActorId:Object.fromEntries(Object.keys(actors).map(id => [id, partyIds.includes(id) ? 'party' : 'enemy'])),
    actorPresentation:Object.fromEntries(selectedMonsters.map(monster => [`monster-${monster.slug}`, {
      templateId:monster.id, creatureType:monster.creature_type, size:monster.size, actionIds:[], traits:[],
    }])),
    controlledCharacterIds:partyIds, playerActionIds:[], certifiedPlayerActionIds:[],
    monsterActionIds:{}, opportunityActionIds:{}, resourceBindings:{}, boardRevision:0,
    movementRemainingFt:Object.fromEntries(Object.keys(actors).map(id => [id, 30])),
    initiativeBonuses:{}, initiative:[], log:[], outcome:'active',
  } as unknown as SoloCombatState;
}

function Preview() {
  const [state, setState] = useState(initialState);
  const [feedback, setFeedback] = useState<CombatBeat | null>(null);
  const [clicks, setClicks] = useState<{position:GridPosition; actorId?:string}[]>([]);
  const [inspected, setInspected] = useState<string | null>(null);
  const sequence = useRef(0);
  const targetId = 'monster-goblin-warrior';
  const beat = (kind: 'before' | 'hit' | 'miss') => {
    const held = kind === 'before';
    setFeedback({
      id:`fixture-${++sequence.current}`, sourceId:'hero-0', targetId,
      sourceName:'Мечник', targetName:'Гоблин-воин', actionName:'Атака мечом', visual:'slashing', rollKind:'attack',
      rollPhase:held ? 'before-reaction' : 'after-reaction',
      from:state.tokens['hero-0'].position, to:state.tokens[targetId].position,
      roll:{kind:'d20', dice:[{sides:20,result:kind === 'miss' ? 3 : 17}], modifiers:[{source:'Сила',value:3}],
        advantage:'none', total:kind === 'miss' ? 6 : 20, target:{type:'ac',value:15},
        outcome:kind === 'miss' ? 'miss' : 'hit', text:'Сохранённый бросок для визуальной проверки'},
      cues:held ? [] : [{actorId:targetId, kind:kind === 'miss' ? 'miss' : 'damage', text:kind === 'miss' ? 'Промах' : '−5', damageType:kind === 'hit' ? 'slashing' : undefined}],
    });
  };
  const setHp = (current:number) => setState(previous => ({...previous, world:{...previous.world,
    actors:{...previous.world.actors, [targetId]:{...previous.world.actors[targetId],
      runtime:{...previous.world.actors[targetId].runtime, hp:{current,max:20,temp:0}}}}}}));
  const move = () => setState(previous => {
    const occupied = new Set(Object.values(previous.tokens).map(token => `${token.position.x}:${token.position.y}`));
    const destination = boardCells(previous).find(position => position.y > 2 && position.y < 7
      && terrainFits(previous, position, 1) && !occupied.has(`${position.x}:${position.y}`));
    return destination ? {...previous, tokens:{...previous.tokens, 'hero-0':{...previous.tokens['hero-0'],position:destination}}} : previous;
  });
  return <main className="solo-combat-page battle-3d-fixture">
    <style>{`
      .battle-3d-fixture {padding:16px;box-sizing:border-box;font:14px Inter,system-ui,sans-serif}
      .battle-3d-fixture h1 {font-size:22px;margin:0 0 10px}
      .fixture-toolbar {display:flex;flex-wrap:wrap;gap:6px;margin:12px 0}
      .fixture-toolbar button,.fixture-toolbar select {padding:8px;border-radius:6px;border:1px solid #655039;background:#31271e;color:#f0dfc4}
      .fixture-controls {display:grid;grid-template-columns:minmax(260px,1fr) 2fr;gap:16px}
      .fixture-controls .settings-panel {max-width:620px}
      .fixture-controls .settings-panel-categories,.fixture-controls nav {display:none}
      .fixture-results {display:flex;flex-wrap:wrap;gap:12px;font-size:12px;margin:8px 0}
      .fixture-results output {white-space:pre-wrap;overflow-wrap:anywhere}
      .battle-3d-fixture .combat-map-wrap {height:min(72vh,760px);min-height:440px;border:1px solid #63513b;border-radius:12px;overflow:hidden}
      @media(max-width:600px){.battle-3d-fixture{padding:8px}.fixture-controls{grid-template-columns:1fr;gap:0}.battle-3d-fixture .combat-map-wrap{height:64vh;min-height:440px}.fixture-controls .settings-panel-saved{display:none}}
    `}</style>
    <h1>3D бои · локальная проверка</h1>
    <div className="fixture-controls">
      <SettingsPanel initialPage="combat"/>
      <div className="fixture-toolbar" aria-label="Контролы визуальной проверки">
        <label>Карта <select aria-label="Карта" value={state.battleMap?.id} onChange={event => {
          setState(initialState(BATTLE_MAPS.findIndex(map => map.id === event.target.value))); setFeedback(null);
        }}>{BATTLE_MAPS.filter(map => map.maxActors >= Object.keys(state.tokens).length).map(map => <option key={map.id} value={map.id}>{map.name}</option>)}</select></label>
        <button onClick={() => beat('before')}>До реакции</button>
        <button onClick={() => beat('hit')}>Подтверждённое попадание</button>
        <button onClick={() => beat('miss')}>Подтверждённый промах</button>
        <button onClick={() => setFeedback(null)}>Убрать эффект</button>
        <button onClick={() => setHp(10)}>50% здоровья</button>
        <button onClick={() => setHp(0)}>0% здоровья</button>
        <button onClick={() => setHp(20)}>Восстановить</button>
        <button onClick={move}>Переместить миниатюру</button>
      </div>
    </div>
    <div className="fixture-results">
      <span>Выборов: <output data-testid="selection-count">{clicks.length}</output></span>
      <output data-testid="selection">{JSON.stringify(clicks.at(-1) ?? null)}</output>
      <output data-testid="inspected">{inspected ?? '—'}</output>
      <output data-testid="fixture-health">{state.world.actors[targetId].runtime.hp.current}</output>
      <output data-testid="roster-count">{Object.keys(state.tokens).length}</output>
    </div>
    <section className="combat-map-wrap" aria-label="Проверочное поле боя">
      <TacticalBattleMap state={state} actorId="hero-0" selectedActionId={null} movementMode={false}
        feedback={feedback} inspectedActorId={inspected} onInspectActor={setInspected}
        onCell={(position, actorId) => setClicks(previous => [...previous, {position, actorId}])}/>
    </section>
  </main>;
}

createRoot(document.getElementById('root')!).render(<Preview/>);
