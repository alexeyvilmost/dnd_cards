import {boardLightSources,illuminationAt} from './combatIllumination';
import {combatActorDisplayName} from '../character/familiarLabels';
import {boardDimensions,featureCells} from './boardGeometry';
import {actorFootprint,footprintCells} from './footprint';
import {auraSurfacesAt} from './auraTerrain';
import type {CombatAreaState,SoloCombatState} from './types';

/** Descriptive projection only. The caller memoizes by the complete immutable
 * state identity, so effects, equipment, actors, board and turn updates all
 * invalidate it. Hover, camera and selected-target overlays are separate. */
export function projectTacticalMapState(state:SoloCombatState){
  const {width:boardWidth,height:boardHeight}=boardDimensions(state);
  const featuresByCell=(()=>{
    const rows=new Map<string,NonNullable<SoloCombatState['battleMap']>['features']>();
    for(const feature of state.battleMap?.features??[])for(const p of featureCells(feature)){
      const key=`${p.x}:${p.y}`;rows.set(key,[...(rows.get(key)??[]),feature]);
    }
    return rows;
  })();
  // A fallen creature does not block a cell; a living occupant must remain selectable.
  const tokenByCell = new Map(Object.values(state.tokens).filter(token=>!token.attachedToActorId).sort((a, b) =>
    Number((state.world.actors[a.actorId]?.runtime.hp.current ?? 0) > 0)
    - Number((state.world.actors[b.actorId]?.runtime.hp.current ?? 0) > 0),
  ).flatMap((token) => footprintCells(token.position, actorFootprint(state.world.actors[token.actorId], state))
    .map(p => [`${p.x}:${p.y}`, token] as const)));
  const dancingLightByCell = new Map(Object.values(state.world.objects).flatMap((object) => {
    const position = state.worldObjectPositions?.[object.id];
    return object.dancingLight && position ? [[`${position.x}:${position.y}`, object] as const] : [];
  }));
  const illusionByCell = new Map(Object.values(state.world.objects).flatMap((object) => {
    const position = state.worldObjectPositions?.[object.id];
    return object.illusion && position ? [[`${position.x}:${position.y}`, object] as const] : [];
  }));
  const groundItemsByCell = new Map<string, {id:string;name:string;imageUrl?:string}[]>();
  for(const object of Object.values(state.world.objects)){
    const position=state.worldObjectPositions?.[object.id];
    if(object.kind!=='item'||!object.itemCardId||object.carriedByActorId||object.heldByActorId||!position)continue;
    const card=Object.values(state.world.actors).flatMap(actor=>actor.character.knownCards??actor.character.equippedCards??[]).find(card=>card.id===object.itemCardId);
    const key=`${position.x}:${position.y}`;
    groundItemsByCell.set(key,[...(groundItemsByCell.get(key)??[]),{id:object.id,name:object.name,imageUrl:card?.image_url??undefined}]);
  }
  const areasByCell = new Map<string, CombatAreaState[]>();
  for (const area of Object.values(state.combatAreas ?? {})) {
    for (const cell of area.cells) {
      const key = `${cell.x}:${cell.y}`;
      areasByCell.set(key, [...(areasByCell.get(key) ?? []), area]);
    }
  }
  const lightSources = boardLightSources(state);
  const cells = Array.from({length: boardWidth * boardHeight}, (_, index) => {
    const position = { x: index % boardWidth, y: Math.floor(index / boardWidth) };
    const illumination = illuminationAt(state, position, lightSources);
    const features=featuresByCell.get(`${position.x}:${position.y}`)??[];
    const terrainLabel=features.map(f=>`${f.name}${f.blocksMovement?' · непроходимо':''}${f.blocksSight?' · закрывает обзор':''}${f.cover==='half'?' · половинное укрытие, +2 КД':f.cover==='three_quarters'?' · укрытие на три четверти, +5 КД':''}`).join('; ');
    const token = tokenByCell.get(`${position.x}:${position.y}`);
    const dancingLight = dancingLightByCell.get(`${position.x}:${position.y}`);
    const illusion = illusionByCell.get(`${position.x}:${position.y}`);
    const persistentAreas = areasByCell.get(`${position.x}:${position.y}`) ?? [];
    const actor = token ? state.world.actors[token.actorId] : undefined;
    const tokenAnchor = token?.position.x === position.x && token.position.y === position.y;
    const dead = actor && actor.runtime.hp.current <= 0;
    const lightLabel = dancingLight
      ? `Танцующий огонёк, тусклый свет ${dancingLight.dancingLight!.dimRadiusFt} фт.`
      : '';
    const illusionLabel = illusion
      ? `Малая иллюзия: ${illusion.illusion!.description} · ${illusion.illusion!.form === 'sound' ? 'звук' : 'изображение'} · ${illusion.roundsLeft ?? 0} раундов · Изучение: Интеллект (Расследование) против СЛ ${illusion.illusion!.spellSaveDc}${illusion.illusion!.form === 'image' ? ' · физическое взаимодействие раскрывает иллюзию' : ''}`
      : '';
    const actorLabel = token ? `${actor ? combatActorDisplayName(actor) : ''}, ${actor?.runtime.hp.current}/${actor?.runtime.hp.max} HP` : '';
    const areaLabel = persistentAreas.map((area) => {
      const duration = area.duration.type === 'permanent' ? 'постоянная'
        : area.duration.type === 'concentration' ? 'концентрация'
          : `${area.duration.roundsLeft} раундов`;
      const triggerLabels = area.triggers.map((trigger) => (
        trigger === 'end_turn' && area.sourceTurnAffectsAllInside
          ? 'в конце хода источника — всем внутри'
          : ({
        created: 'при создании', enter: 'при входе', exit: 'при выходе',
        move: 'за каждые 5 фт. движения', start_turn: 'в начале хода', end_turn: 'в конце хода',
          })[trigger]
      )).join(', ');
      const hazard = area.hazard?.resolution === 'save'
        ? ` · спасбросок ${area.hazard.save.ability.toUpperCase()} СЛ ${area.hazard.save.dc}`
        : area.hazard?.resolution === 'automatic' ? ' · без спасброска' : '';
      const immunities = area.damageImmunities?.length
        ? ` · иммунитеты в области: ${area.damageImmunities.join(', ')}` : '';
      return `${area.name}: ${duration}${area.sourceAnchored ? ' · следует за источником' : ''}${area.difficultTerrain ? ' · труднопроходимая местность' : ''}${area.lightlyObscured ? ' · слабо заслонённая область' : ''}${area.heavilyObscured ? ' · сильно заслонённая область' : ''}${area.blocksVerbalComponents ? ' · блокирует Вербальные компоненты' : ''}${immunities}${hazard}${triggerLabels ? ` · ${triggerLabels}` : ''}`;
    }).join(' · ');
    const key = `${position.x}:${position.y}`;
    return {position, illumination, surfaces:auraSurfacesAt(state,position), features, token, dancingLight, illusion, persistentAreas, actor,
      tokenAnchor: Boolean(tokenAnchor), dead: Boolean(dead), terrainLabel, actorLabel, areaLabel, lightLabel, illusionLabel,
      label: [actorLabel, terrainLabel, areaLabel, lightLabel, illusionLabel,
        (groundItemsByCell.get(key) ?? []).map(item => `На земле: ${item.name}`).join(', '),
        `Клетка ${position.x + 1}, ${position.y + 1}`].filter(Boolean).join(' · '),
      actorId: token?.actorId, footprint: actorFootprint(actor, state),
      blocked: features.some(f => f.blocksMovement),
      light: dancingLight ? {label: lightLabel, radiusFt: dancingLight.dancingLight!.dimRadiusFt} : undefined,
      groundItems: groundItemsByCell.get(key) ?? [], areas: persistentAreas,
      // Keep source objects locally for the legacy renderer; the scene consumes
      // only their descriptive projection below.
      illusionView: illusion ? {id: illusion.id, label: illusionLabel,
        description: illusion.illusion!.description, form: illusion.illusion!.form} : undefined,
    };
  });
  return {cells,tokenByCell,groundItemsByCell};
}
