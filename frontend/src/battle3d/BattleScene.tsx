import {Component, useEffect, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject, type PointerEvent as ReactPointerEvent, type ReactNode} from 'react';
import {Canvas, useFrame, useThree, type ThreeEvent} from '@react-three/fiber';
import {ACESFilmicToneMapping, Group, MeshBasicMaterial, PCFShadowMap, Quaternion, Vector3} from 'three';
import {Focus, Scan, ZoomIn, ZoomOut} from 'lucide-react';
import {boardDimensions} from '../solo-combat/boardGeometry';
import {combatIdentity} from '../solo-combat/combatIdentity';
import {actorFootprint} from '../solo-combat/footprint';
import type {GridPosition} from '../solo-combat/types';
import type {BattleCellView, BattleSceneProps} from './types';
import CoinToken from './CoinToken';
import {coinMotionAt,shotPhaseAt} from './coinAnimation';
import {movementPathForTransition,positionOnMovementPath} from './movementAnimation';
import BattleTerrain from './BattleTerrain';
import BattleCamera, {type CameraCommand} from './BattleCamera';
import BattleLighting from './BattleLighting';
import FieldDice from './FieldDice';
import {combatRollModeFor,useSiteSettings} from '../settings';
import './BattleScene.css';

type TokenView = {
  id:string; position:GridPosition; footprint:number; name:string; accent:string;
  portraitUrl?:string; hp:number; maxHp:number;
  active:boolean; inspected:boolean; highlighted:boolean;
};
type MovementView={id:number;points:GridPosition[];startedAt:number};

class SceneBoundary extends Component<{onUnavailable:(reason:string)=>void;children:ReactNode},{failed:boolean}> {
  state={failed:false};
  static getDerivedStateFromError(){return {failed:true};}
  componentDidCatch(){this.props.onUnavailable('Не удалось запустить поле с монетками.');}
  render(){return this.state.failed?null:this.props.children;}
}

function useReducedMotion() {
  const [reduced,setReduced]=useState(()=>typeof window!=='undefined'&&window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(()=>{
    const media=window.matchMedia('(prefers-reduced-motion: reduce)');
    const update=()=>setReduced(media.matches);
    media.addEventListener('change',update);
    return ()=>media.removeEventListener('change',update);
  },[]);
  return reduced;
}

function Segment({from,to,color,radius=.023,height=.075}: {from:GridPosition;to:GridPosition;color:string;radius?:number;height?:number}) {
  const length=Math.hypot(to.x-from.x,to.y-from.y);
  const rotation=useMemo(()=>new Quaternion().setFromUnitVectors(new Vector3(0,1,0),new Vector3(to.x-from.x,0,to.y-from.y).normalize()),[from.x,from.y,to.x,to.y]);
  if(length<.001)return null;
  return <mesh position={[(from.x+to.x)/2,height,(from.y+to.y)/2]} quaternion={rotation}><cylinderGeometry args={[radius,radius,length,6]}/><meshBasicMaterial color={color} depthWrite={false}/></mesh>;
}

function CellMarks({cells,hovered}: {cells:BattleCellView[];hovered:GridPosition|null}) {
  return <group>{cells.map(cell=>{
    const hover=hovered?.x===cell.position.x&&hovered.y===cell.position.y;
    const color=cell.areaPreview?'#bc9bf6':cell.route&&cell.unavailable?'#ef786a':cell.route?'#f5d67e':cell.reachable?'#73b3bf':cell.areas.length?'#9a87cc':undefined;
    return <group key={`${cell.position.x}:${cell.position.y}`} position={[cell.position.x+.5,0,cell.position.y+.5]}>
      {color&&<mesh rotation={[-Math.PI/2,0,0]} position={[0,.054,0]}><planeGeometry args={[.94,.94]}/><meshBasicMaterial color={color} transparent opacity={cell.areaPreview?.32:cell.route?.24:.15} depthWrite={false}/></mesh>}
      {hover&&<mesh rotation={[-Math.PI/2,0,0]} position={[0,.063,0]}><ringGeometry args={[.34,.44,4]}/><meshBasicMaterial color="#f4e3b0" transparent opacity={.95} depthWrite={false}/></mesh>}
      {cell.light&&<mesh position={[0,.48,0]}><sphereGeometry args={[.115,10,8]}/><meshStandardMaterial color="#fff3b7" emissive="#ffd783" emissiveIntensity={2}/></mesh>}
      {cell.illusion&&<mesh position={[0,.35,0]}><octahedronGeometry args={[.28]}/><meshStandardMaterial color="#c9a1f4" transparent opacity={.45} emissive="#6c4c96" emissiveIntensity={.3}/></mesh>}
      {cell.groundItems.length>0&&<mesh castShadow position={[.27,.13,.27]} rotation={[0,.4,.1]}><boxGeometry args={[.25,.2,.22]}/><meshStandardMaterial color="#c8a568" roughness={.65}/></mesh>}
    </group>;
  })}</group>;
}

function CoinActor({token,tokens,movement,feedback,reducedMotion,onHover,onCell,canClick}: {
  token:TokenView;tokens:TokenView[];movement?:MovementView;feedback:BattleSceneProps['feedback'];reducedMotion:boolean;
  onHover:BattleSceneProps['onHover'];onCell:BattleSceneProps['onCell'];canClick:()=>boolean;
}) {
  const moving=useRef<Group>(null);
  const {invalidate}=useThree();
  const animation=useRef({startedAt:-Infinity,attack:'none' as 'none'|'melee'|'shot',hit:false,hitDelay:0,dx:0,dz:0,reach:0});
  const movementRef=useRef({startedAt:-Infinity,points:[] as GridPosition[]});
  useLayoutEffect(()=>{
    movementRef.current={startedAt:movement?.startedAt??performance.now(),points:movement?.points??[]};
    invalidate();
  },[movement?.id,invalidate]);
  useEffect(()=>{
    const confirmed=feedback&&feedback.rollPhase!=='before-reaction';
    const target=tokens.find(other=>other.id===feedback?.targetId);
    const attack=Boolean(confirmed&&feedback.sourceId===token.id&&feedback.visual&&target);
    const hit=Boolean(confirmed&&feedback.cues.some(cue=>cue.actorId===token.id&&cue.kind==='damage'));
    const kind=attack?(feedback?.visual==='ranged'||feedback?.visual==='magic'?'shot':'melee'):'none';
    const dx=target?target.position.x+target.footprint/2-token.position.x-token.footprint/2:0;
    const dz=target?target.position.y+target.footprint/2-token.position.y-token.footprint/2:0;
    const distance=Math.hypot(dx,dz)||1;
    // A miss lunges short; only a committed damage cue makes the defender wobble.
    animation.current={startedAt:reducedMotion?-Infinity:performance.now(),attack:kind,hit,
      hitDelay:feedback?.visual ? ((feedback.visual==='ranged'||feedback.visual==='magic') ? .53 : .4) : 0,
      dx:dx/distance,dz:dz/distance,reach:Math.min(.55*token.footprint,Math.max(.18,distance*.36))};
    invalidate();
  },[feedback?.id,feedback?.rollPhase,token.id,reducedMotion,invalidate]);
  useFrame(()=>{
    if(!moving.current)return;
    const anim=animation.current;
    const t=(performance.now()-anim.startedAt)/1000;
    if((anim.attack!=='none'||anim.hit)&&t<1.05)invalidate();
    const step=positionOnMovementPath(movementRef.current.points,(performance.now()-movementRef.current.startedAt)/1000);
    if(step.moving&&!reducedMotion)invalidate();
    const {travel,hop,tilt,wobble,side}=coinMotionAt(anim,t);
    moving.current.rotation.set(tilt*anim.dx,0,-tilt*anim.dz+wobble+(token.hp<=0?.16:0));
    const scale=token.footprint*.95;
    const offsetX=step.moving&&!reducedMotion?(step.position.x-token.position.x)/scale:0;
    const offsetZ=step.moving&&!reducedMotion?(step.position.y-token.position.y)/scale:0;
    moving.current.position.set(offsetX+anim.dx*travel+anim.dz*side,hop,offsetZ+anim.dz*travel-anim.dx*side);
  });
  const occupiedCell=(event:ThreeEvent<PointerEvent|MouseEvent>)=>({
    x:Math.max(token.position.x,Math.min(token.position.x+token.footprint-1,Math.floor(event.point.x))),
    y:Math.max(token.position.y,Math.min(token.position.y+token.footprint-1,Math.floor(event.point.z))),
  });
  const eventHover=(event:ThreeEvent<PointerEvent>)=>{
    event.stopPropagation();
    if(canClick())onHover(occupiedCell(event),{x:event.clientX,y:event.clientY});
  };
  const selected=token.active||token.inspected||token.highlighted;
  return <group position={[token.position.x+token.footprint/2,.055,token.position.y+token.footprint/2]}
    onPointerMove={eventHover} onPointerOut={event=>{if(!event.intersections.length)onHover(null);}}
    onClick={event=>{event.stopPropagation();if(event.button===0&&event.delta<6&&canClick())onCell(occupiedCell(event));}}>
    <group scale={token.footprint*.95}><group ref={moving}>
      {selected&&<mesh rotation={[-Math.PI/2,0,0]} position={[0,.015,0]}><ringGeometry args={[.41,.475,40]}/><meshBasicMaterial color={token.inspected?'#f5d994':token.highlighted?'#b3e5d5':'#e7bf6b'} transparent opacity={.95} depthWrite={false}/></mesh>}
      <CoinToken portraitUrl={token.portraitUrl} name={token.name} hp={token.hp} maxHp={token.maxHp} accent={token.accent}/>
    </group></group>
  </group>;
}

function ShotEffect({feedback,tokens,reducedMotion}: {feedback:NonNullable<BattleSceneProps['feedback']>;tokens:TokenView[];reducedMotion:boolean}) {
  const {invalidate}=useThree();
  const projectile=useRef<Group>(null);
  const impact=useRef<Group>(null);
  const impactMaterial=useRef<MeshBasicMaterial>(null);
  const startedAt=useRef(performance.now());
  const source=tokens.find(token=>token.id===feedback.sourceId);
  const target=tokens.find(token=>token.id===feedback.targetId);
  const from=source?new Vector3(source.position.x+source.footprint/2,.48,source.position.y+source.footprint/2):null;
  const to=target?new Vector3(target.position.x+target.footprint/2,.4,target.position.y+target.footprint/2):null;
  const miss=feedback.cues.some(cue=>cue.actorId===feedback.targetId&&cue.kind==='miss');
  if(to&&from&&miss){const dx=to.x-from.x,dz=to.z-from.z,length=Math.hypot(dx,dz)||1;to.x+=-dz/length*.38;to.z+=dx/length*.38;}
  const direction=from&&to?to.clone().sub(from).normalize():new Vector3(0,0,1);
  useFrame(()=>{
    if(!projectile.current||!impact.current||!from||!to)return;
    const t=(performance.now()-startedAt.current)/1000;
    if(t<.85)invalidate();
    const phase=shotPhaseAt(t);
    projectile.current.visible=!reducedMotion&&phase.visible;
    projectile.current.position.copy(from).lerp(to,phase.progress);
    projectile.current.position.y+=Math.sin(phase.progress*Math.PI)*.17;
    impact.current.visible=!reducedMotion&&!miss&&phase.impact;
    impact.current.position.copy(to);impact.current.position.y=.055+(target?.footprint??1)*.95*.22+.04;
    impact.current.scale.setScalar(phase.impactScale);
    if(impactMaterial.current)impactMaterial.current.opacity=phase.impactOpacity;
  });
  if(!from||!to)return null;
  const magical=feedback.visual==='magic';
  return <group name="coin-shot-effect">
    <group ref={projectile} quaternion={new Quaternion().setFromUnitVectors(new Vector3(0,1,0),direction)} visible={false}>
      {magical?<>
        <mesh><sphereGeometry args={[.09,12,10]}/><meshBasicMaterial color="#a6e9f5" toneMapped={false}/></mesh>
        <mesh position={[0,-.15,0]}><coneGeometry args={[.055,.3,8]}/><meshBasicMaterial color="#61b9d6" transparent opacity={.68} toneMapped={false}/></mesh>
      </>:<>
        <mesh><cylinderGeometry args={[.012,.012,.4,6]}/><meshStandardMaterial color="#b99b69" metalness={.35} roughness={.45}/></mesh>
        <mesh position={[0,.26,0]}><coneGeometry args={[.052,.13,6]}/><meshStandardMaterial color="#eee4cf" metalness={.58} roughness={.35}/></mesh>
        <mesh position={[0,-.23,0]}><coneGeometry args={[.07,.13,4]}/><meshBasicMaterial color="#e8d6b0" side={2}/></mesh>
      </>}
    </group>
    <group ref={impact} visible={false}>
      <mesh rotation={[-Math.PI/2,0,0]}><ringGeometry args={[.16,.2,32]}/><meshBasicMaterial ref={impactMaterial} color={magical?'#8cd8ed':'#f6df9a'} transparent opacity={.8} depthWrite={false} toneMapped={false}/></mesh>
    </group>
  </group>;
}

function CoinImpact({feedback,tokens,reducedMotion}: {feedback:NonNullable<BattleSceneProps['feedback']>;tokens:TokenView[];reducedMotion:boolean}) {
  const {invalidate}=useThree();
  const burst=useRef<Group>(null);
  const startedAt=useRef(performance.now());
  const target=tokens.find(token=>token.id===feedback.targetId);
  const delay=(feedback.visual==='ranged'||feedback.visual==='magic') ? 0.54 : 0.4;
  const strong=feedback.roll?.outcome==='crit'||(feedback.damage??[]).reduce((sum,hit)=>sum+hit.amount,0)>=Math.max(6,(target?.maxHp??20)*.25);
  useFrame(()=>{
    if(!burst.current)return;
    const t=(performance.now()-startedAt.current)/1000;
    if(t<delay+.35)invalidate();
    burst.current.visible=!reducedMotion&&t>=delay&&t<delay+.28;
    burst.current.scale.setScalar(.45+Math.max(0,t-delay)*2.4);
  });
  if(!target)return null;
  return <group ref={burst} name="coin-impact" position={[target.position.x+target.footprint/2,.055+target.footprint*.95*.22+.04,target.position.y+target.footprint/2]} visible={false}>
    <mesh rotation={[-Math.PI/2,0,0]}><ringGeometry args={[.18,.22,24]}/><meshBasicMaterial color="#e8d4a5" transparent opacity={.72} depthWrite={false} toneMapped={false}/></mesh>
    {strong&&[[.23,0],[-.23,0],[0,.23],[0,-.23]].map(([x,z],index)=><mesh key={index} position={[x,.07,z]} rotation={[index*.4,index*.7,0]}><icosahedronGeometry args={[.038,0]}/><meshStandardMaterial color="#898c83" roughness={.94}/></mesh>)}
    {strong&&Array.from({length:7},(_,index)=>{const angle=index*Math.PI*2/7;return <mesh key={`dust-${index}`} position={[Math.cos(angle)*.23,.04,Math.sin(angle)*.23]}><sphereGeometry args={[.035+index%3*.008,6,4]}/><meshBasicMaterial color="#bcb7a6" transparent opacity={.45} depthWrite={false}/></mesh>;})}
  </group>;
}

function ProjectLabels({tokens,movements,elements}: {tokens:TokenView[];movements:Record<string,MovementView>;elements:MutableRefObject<Map<string,HTMLDivElement>>}) {
  const {camera,size}=useThree();
  const point=useMemo(()=>new Vector3(),[]);
  useFrame(()=>{
    for(const token of tokens){
      const element=elements.current.get(token.id);
      if(!element)continue;
      const movement=movements[token.id];
      const step=movement&&positionOnMovementPath(movement.points,(performance.now()-movement.startedAt)/1000);
      const position=step?.moving?step.position:token.position;
      point.set(position.x+token.footprint/2,.58,position.y+token.footprint/2).project(camera);
      element.style.transform=`translate(${(point.x+1)*size.width/2}px,${(1-point.y)*size.height/2}px) translate(-50%,-100%)`;
      element.style.visibility=point.z<-1||point.z>1||Math.abs(point.x)>1.05||Math.abs(point.y)>1.1?'hidden':'visible';
      element.style.zIndex=String(Math.round((1-point.z)*1000));
    }
  });
  return null;
}

function SceneContent({props,tokens,movements,command,labels,canClick,reducedMotion}: {
  props:BattleSceneProps;tokens:TokenView[];movements:Record<string,MovementView>;command:CameraCommand|null;labels:MutableRefObject<Map<string,HTMLDivElement>>;canClick:()=>boolean;reducedMotion:boolean;
}) {
  const {width,height}=boardDimensions(props.state);
  const hero=tokens.find(token=>token.id===props.actorId);
  const toCell=(event:ThreeEvent<PointerEvent|MouseEvent>)=>({x:Math.max(0,Math.min(width-1,Math.floor(event.point.x))),y:Math.max(0,Math.min(height-1,Math.floor(event.point.z)))});
  return <>
    <BattleLighting width={width} height={height}/>
    <BattleCamera width={width} height={height} maxHeight={2.4} command={command} hero={hero?{x:hero.position.x+hero.footprint/2,y:hero.position.y+hero.footprint/2}:undefined} onUnavailable={props.onUnavailable}/>
    <BattleTerrain width={width} height={height} map={props.state.battleMap}/>
    <CellMarks cells={props.cells} hovered={props.hovered}/>
    <mesh rotation={[-Math.PI/2,0,0]} position={[width/2,.046,height/2]}
      onPointerMove={event=>{event.stopPropagation();if(canClick())props.onHover(toCell(event),{x:event.clientX,y:event.clientY});}}
      onPointerOut={event=>{if(!event.intersections.length)props.onHover(null);}}
      onClick={event=>{event.stopPropagation();if(event.button===0&&event.delta<6&&canClick())props.onCell(toCell(event));}}>
      <planeGeometry args={[width,height]}/><meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false}/>
    </mesh>
    {props.route&&props.route.points.slice(1).map((point,index)=><Segment key={index} from={{x:props.route!.points[index].x+props.route!.footprint/2,y:props.route!.points[index].y+props.route!.footprint/2}} to={{x:point.x+props.route!.footprint/2,y:point.y+props.route!.footprint/2}} color={props.route!.available?'#f8d378':'#ef716c'}/>)}
    {props.trajectory&&<Segment from={props.trajectory.from} to={props.trajectory.to} height={.48} color={props.trajectory.blocked?'#ed786b':'#f0d97b'} radius={.015}/>}
    {props.trajectory?.covered.map((segment,index)=><Segment key={`cover${index}`} from={segment.from} to={segment.to} height={.48} color="#ec9065" radius={.03}/>)}
    {props.ghost&&<mesh position={[props.ghost.position.x+props.ghost.footprint/2,.12,props.ghost.position.y+props.ghost.footprint/2]}><cylinderGeometry args={[props.ghost.footprint*.38,props.ghost.footprint*.4,.15,28]}/><meshStandardMaterial color={props.ghost.available?'#a5dce1':'#eb9185'} transparent opacity={.45} depthWrite={false}/></mesh>}
    {tokens.map(token=><CoinActor key={token.id} token={token} tokens={tokens} movement={movements[token.id]} feedback={props.feedback} reducedMotion={reducedMotion} onHover={props.onHover} onCell={props.onCell} canClick={canClick}/>)}
    {props.feedback?.rollPhase!=='before-reaction'&&(props.feedback?.visual==='ranged'||props.feedback?.visual==='magic')&&props.feedback.targetId
      &&<ShotEffect key={`${props.feedback.id}:${props.feedback.rollPhase}`} feedback={props.feedback} tokens={tokens} reducedMotion={reducedMotion}/>}
    {props.feedback?.rollPhase!=='before-reaction'&&props.feedback?.visual
      &&props.feedback.cues.some(cue=>cue.actorId===props.feedback?.targetId&&cue.kind==='damage')
      &&<CoinImpact key={`${props.feedback.id}:${props.feedback.rollPhase}`} feedback={props.feedback} tokens={tokens} reducedMotion={reducedMotion}/>}
    <ProjectLabels tokens={tokens} movements={movements} elements={labels}/>
  </>;
}

export default function BattleScene(props:BattleSceneProps) {
  const settings=useSiteSettings();
  const [command,setCommand]=useState<CameraCommand|null>(null);
  const [keyboardCell,setKeyboardCell]=useState<GridPosition|null>(null);
  const [movements,setMovements]=useState<Record<string,MovementView>>({});
  const previousState=useRef<BattleSceneProps['state']|null>(null);
  const movementSequence=useRef(0);
  useLayoutEffect(()=>{
    const before=previousState.current;
    previousState.current=props.state;
    if(!before)return;
    const changes=Object.fromEntries(Object.keys(props.state.tokens).flatMap(actorId=>{
      const points=movementPathForTransition(before,props.state,actorId);
      return points ? [[actorId,{id:++movementSequence.current,points,startedAt:performance.now()}]] : [];
    })) as Record<string,MovementView>;
    if(Object.keys(changes).length)setMovements(previous=>({...previous,...changes}));
  },[props.state]);
  const labels=useRef(new Map<string,HTMLDivElement>());
  const gesture=useRef({pointers:new Map<number,{x:number;y:number}>(),moved:false,blockedUntil:0});
  const reducedMotion=useReducedMotion();
  const tokens=useMemo<TokenView[]>(()=>Object.values(props.state.tokens).flatMap(token=>{
    const actor=props.state.world.actors[token.actorId];
    if(!actor)return [];
    const cell=props.cells.find(candidate=>candidate.actorId===token.actorId&&candidate.tokenAnchor)??props.cells.find(candidate=>candidate.actorId===token.actorId);
    const identity=combatIdentity(props.state,token.actorId);
    const footprint=cell?.footprint??actorFootprint(actor,props.state);
    return [{id:token.actorId,position:token.position,footprint,name:identity.displayName,accent:identity.accent,
      portraitUrl:token.tokenUrl,
      hp:actor.runtime.hp.current,maxHp:actor.runtime.hp.max,active:token.actorId===props.activeId,inspected:Boolean(cell?.inspected),highlighted:Boolean(cell?.highlighted)}];
  }),[props.state,props.cells,props.activeId]);
  const canClick=()=>!gesture.current.moved&&performance.now()>gesture.current.blockedUntil;
  const pointerDown=(event:ReactPointerEvent)=>{
    const current=gesture.current;
    if(!current.pointers.size)current.moved=false;
    current.pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
    if(current.pointers.size>1){current.moved=true;props.onHover(null);}
  };
  const pointerMove=(event:ReactPointerEvent)=>{
    const current=gesture.current,start=current.pointers.get(event.pointerId);
    if(start&&!current.moved&&Math.hypot(event.clientX-start.x,event.clientY-start.y)>6){current.moved=true;props.onHover(null);}
  };
  const pointerUp=(event:ReactPointerEvent)=>{
    const current=gesture.current;
    current.pointers.delete(event.pointerId);
    if(current.moved)current.blockedUntil=performance.now()+300;
    if(!current.pointers.size)current.moved=false;
  };
  const cameraAction=(kind:CameraCommand['kind'])=>setCommand(previous=>({id:(previous?.id??0)+1,kind}));
  return <section className="battle-scene-3d" data-testid="battle-scene-3d" aria-label="Поле боя с объёмными токенами"
    aria-description="Стрелки перемещают фокус по клеткам, Enter выбирает клетку, колесо меняет масштаб."
    tabIndex={0} data-keyboard-cell={keyboardCell ? `${keyboardCell.x}:${keyboardCell.y}` : undefined}
    onKeyDown={event=>{
      if(event.target!==event.currentTarget)return;
      const {width,height}=boardDimensions(props.state);
      const start=keyboardCell??props.state.tokens[props.activeId]?.position??{x:Math.floor(width/2),y:Math.floor(height/2)};
      const delta=event.key==='ArrowLeft'?[-1,0]:event.key==='ArrowRight'?[1,0]:event.key==='ArrowUp'?[0,-1]:event.key==='ArrowDown'?[0,1]:null;
      if(delta){event.preventDefault();const next={x:Math.max(0,Math.min(width-1,start.x+delta[0])),y:Math.max(0,Math.min(height-1,start.y+delta[1]))};setKeyboardCell(next);props.onHover(next);}
      else if(event.key==='Enter'||event.key===' '){event.preventDefault();props.onCell(start);}
    }}>
    <div className="battle-scene-3d__toolbar" role="toolbar" aria-label="Камера поля боя">
      <span className="battle-scene-3d__badge">Монетки</span>
      <button type="button" aria-label="Приблизить поле" onClick={()=>cameraAction('in')}><ZoomIn size={17}/></button>
      <button type="button" aria-label="Отдалить поле" onClick={()=>cameraAction('out')}><ZoomOut size={17}/></button>
      <span className="battle-scene-3d__separator"/>
      <button type="button" aria-label="Показать всё поле" onClick={()=>cameraAction('reset')}><Scan size={17}/></button>
      <button type="button" aria-label="Камера к персонажу" onClick={()=>cameraAction('hero')}><Focus size={17}/></button>
      <span className="battle-scene-3d__map-name">{props.state.battleMap?.name??'Поле боя'}</span>
      {props.state.pendingAdditionalMovement&&!props.state.playerMovement&&props.onDeclineAdditionalMovement&&<button type="button" className="battle-scene-3d__decline" onClick={props.onDeclineAdditionalMovement}>Остаться на месте</button>}
    </div>
    <div className="battle-scene-3d__viewport" data-testid="battle-scene-3d-viewport" onPointerDownCapture={pointerDown} onPointerMoveCapture={pointerMove} onPointerUpCapture={pointerUp} onPointerCancelCapture={pointerUp} onPointerLeave={()=>props.onHover(null)} onContextMenu={event=>event.preventDefault()}>
      <SceneBoundary onUnavailable={props.onUnavailable}>
        <Canvas shadows={{type:PCFShadowMap}} frameloop="demand" dpr={[1,1.75]} camera={{fov:42,near:.1,far:250,position:[0,25,0]}} gl={{antialias:true,alpha:false,powerPreference:'high-performance',toneMapping:ACESFilmicToneMapping,toneMappingExposure:1.05}} fallback={<span aria-hidden="true"/>}
          aria-label="Поле с монетками: нажмите клетку для действия, перетащите для сдвига камеры">
          <SceneContent props={props} tokens={tokens} movements={movements} command={command} labels={labels} canClick={canClick} reducedMotion={reducedMotion}/>
        </Canvas>
      </SceneBoundary>
      <div className="battle-scene-3d__labels" aria-hidden="true">{tokens.map(token=>{
        const cue=props.feedback?.rollPhase!=='before-reaction'?props.feedback?.cues.filter(candidate=>candidate.actorId===token.id).map(candidate=>candidate.text).join(' · '):undefined;
        const animation=props.feedback?.rollPhase==='before-reaction'?'idle':props.feedback?.cues.some(candidate=>candidate.actorId===token.id&&candidate.kind==='damage')?'hit':props.feedback?.sourceId===token.id&&props.feedback.visual?'attack':'idle';
        const hovered=props.hovered&&props.hovered.x>=token.position.x&&props.hovered.x<token.position.x+token.footprint&&props.hovered.y>=token.position.y&&props.hovered.y<token.position.y+token.footprint;
        const expanded=hovered||token.inspected||token.highlighted;
        return <div key={token.id} data-actor-id={token.id} data-animation={animation} className={`battle-scene-3d__label${expanded?' is-expanded':''}${token.active?' is-active':''}${token.hp<=0?' is-fallen':''}`} ref={element=>{if(element)labels.current.set(token.id,element);else labels.current.delete(token.id);}}>
          {cue&&<span className="battle-scene-3d__cue" key={props.feedback?.id}>{cue}</span>}
          <span className="battle-scene-3d__name">{token.name}</span>
          <span className="battle-scene-3d__health">{Math.max(0,token.hp)} / {token.maxHp} хп</span>
        </div>;
      })}</div>
      {props.feedback?.rollPhase!=='before-reaction'&&props.feedback&&combatRollModeFor(settings,props.feedback.audience)==='field'
        &&<FieldDice key={props.feedback.id} beat={props.feedback}/>}
    </div>
    <p className="battle-scene-3d__help">Перетаскивание — сдвиг · колесо или два пальца — масштаб</p>
  </section>;
}
