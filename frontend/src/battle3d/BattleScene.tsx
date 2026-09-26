import {Component, useEffect, useMemo, useRef, useState, type MutableRefObject, type PointerEvent as ReactPointerEvent, type ReactNode} from 'react';
import {Canvas, useFrame, useThree, type ThreeEvent} from '@react-three/fiber';
import {ACESFilmicToneMapping, Color, Group, PCFShadowMap, Quaternion, Vector3} from 'three';
import {Focus, RotateCcw, RotateCw, Scan, ZoomIn, ZoomOut} from 'lucide-react';
import {boardDimensions} from '../solo-combat/boardGeometry';
import {combatIdentity} from '../solo-combat/combatIdentity';
import {actorFootprint} from '../solo-combat/footprint';
import type {GridPosition} from '../solo-combat/types';
import {combatRelation} from '../solo-combat/types';
import type {BattleCellView, BattleSceneProps} from './types';
import {getMiniatureHeight, MiniatureModel, resolveMiniature} from './miniatures';
import BattleTerrain from './BattleTerrain';
import BattleCamera, {type CameraCommand} from './BattleCamera';
import BattleLighting from './BattleLighting';
import './BattleScene.css';

type TokenView = {
  id:string; position:GridPosition; footprint:number; name:string; accent:string;
  recipe:ReturnType<typeof resolveMiniature>; modelHeight:number; hp:number; maxHp:number; facingAngle:number;
  active:boolean; inspected:boolean; highlighted:boolean;
};

class SceneBoundary extends Component<{onUnavailable:(reason:string)=>void;children:ReactNode},{failed:boolean}> {
  state={failed:false};
  static getDerivedStateFromError(){return {failed:true};}
  componentDidCatch(){this.props.onUnavailable('Не удалось запустить 3D-поле.');}
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

function Miniature({token,feedback,reducedMotion,onHover,onCell,canClick}: {
  token:TokenView;feedback:BattleSceneProps['feedback'];reducedMotion:boolean;
  onHover:BattleSceneProps['onHover'];onCell:BattleSceneProps['onCell'];canClick:()=>boolean;
}) {
  const moving=useRef<Group>(null);
  const facing=useRef<Group>(null);
  const {invalidate}=useThree();
  const pedestalColor=useMemo(()=>`#${new Color(token.accent).lerp(new Color('#303932'),.82).getHexString()}`,[token.accent]);
  const animation=useRef({startedAt:-Infinity,attack:false,hit:false,hitDelay:0});
  const direction=useRef(token.facingAngle);
  useEffect(()=>{direction.current=token.facingAngle;invalidate();},[token.facingAngle,token.position.x,token.position.y,invalidate]);
  useEffect(()=>{
    const confirmed=feedback&&feedback.rollPhase!=='before-reaction';
    const attack=Boolean(confirmed&&feedback.sourceId===token.id&&feedback.visual);
    const hit=Boolean(confirmed&&feedback.cues.some(cue=>cue.actorId===token.id&&cue.kind==='damage'));
    // A confirmed attack reaches impact after its backswing; unaccompanied damage shakes immediately.
    animation.current={startedAt:reducedMotion?-Infinity:performance.now(),attack,hit,hitDelay:feedback?.visual ? .35 : 0};
    if(attack&&feedback?.to&&feedback.from)direction.current=Math.atan2(feedback.to.x-feedback.from.x,feedback.to.y-feedback.from.y);
    invalidate();
  },[feedback?.id,feedback?.rollPhase,token.id,reducedMotion,invalidate]);
  useFrame(()=>{
    if(!moving.current)return;
    if(facing.current)facing.current.rotation.y=direction.current;
    const anim=animation.current;
    // Real elapsed time also works after the demand renderer has been idle.
    const t=(performance.now()-anim.startedAt)/1000;
    if((anim.attack||anim.hit)&&t<1.15)invalidate();
    let lean=0;
    if(anim.attack&&t<.78){
      if(t<.24)lean=-.24*Math.sin(t/.24*Math.PI/2);
      else if(t<.4)lean=-.24+(t-.24)/.16*.72;
      else lean=.48*Math.cos((t-.4)/.38*Math.PI/2);
    }
    const hitTime=t-anim.hitDelay;
    const shaking=anim.hit&&hitTime>=0&&hitTime<.75;
    const shake=shaking?Math.sin(hitTime*43)*.14*Math.exp(-hitTime*3):0;
    moving.current.rotation.set(lean,0,shake);
    moving.current.position.x=shaking?Math.sin(hitTime*43)*.055*Math.exp(-hitTime*3):0;
  });
  const occupiedCell=(event:ThreeEvent<PointerEvent|MouseEvent>)=>({
    x:Math.max(token.position.x,Math.min(token.position.x+token.footprint-1,Math.floor(event.point.x))),
    y:Math.max(token.position.y,Math.min(token.position.y+token.footprint-1,Math.floor(event.point.z))),
  });
  const eventHover=(event:ThreeEvent<PointerEvent>)=>{
    event.stopPropagation();
    if(canClick())onHover(occupiedCell(event),{x:event.clientX,y:event.clientY});
  };
  const radius=token.footprint*.41;
  const selected=token.active||token.inspected||token.highlighted;
  return <group position={[token.position.x+token.footprint/2,.05,token.position.y+token.footprint/2]}
    onPointerMove={eventHover} onPointerOut={event=>{if(!event.intersections.length)onHover(null);}}
    onClick={event=>{event.stopPropagation();if(event.button===0&&event.delta<6&&canClick())onCell(occupiedCell(event));}}>
    {selected&&<mesh rotation={[-Math.PI/2,0,0]} position={[0,.015,0]}><ringGeometry args={[radius,radius+.065,40]}/><meshBasicMaterial color={token.inspected?'#ffe18b':token.highlighted?'#fff1c6':'#74c6f2'} transparent opacity={.95} depthWrite={false}/></mesh>}
    <group ref={facing} scale={token.footprint*.95}>
      <group ref={moving}><MiniatureModel recipe={token.recipe} pedestalColor={pedestalColor} damaged={token.hp>0&&token.hp<=token.maxHp/2} fallen={token.hp<=0}/></group>
    </group>
  </group>;
}

function ProjectLabels({tokens,elements}: {tokens:TokenView[];elements:MutableRefObject<Map<string,HTMLDivElement>>}) {
  const {camera,size}=useThree();
  const point=useMemo(()=>new Vector3(),[]);
  useFrame(()=>{
    for(const token of tokens){
      const element=elements.current.get(token.id);
      if(!element)continue;
      point.set(token.position.x+token.footprint/2,token.hp<=0?.52:token.modelHeight+.2,token.position.y+token.footprint/2).project(camera);
      element.style.transform=`translate(${(point.x+1)*size.width/2}px,${(1-point.y)*size.height/2}px) translate(-50%,-100%)`;
      element.style.visibility=point.z<-1||point.z>1||Math.abs(point.x)>1.05||Math.abs(point.y)>1.1?'hidden':'visible';
      element.style.zIndex=String(Math.round((1-point.z)*1000));
    }
  });
  return null;
}

function SceneContent({props,tokens,command,labels,canClick,reducedMotion}: {
  props:BattleSceneProps;tokens:TokenView[];command:CameraCommand|null;labels:MutableRefObject<Map<string,HTMLDivElement>>;canClick:()=>boolean;reducedMotion:boolean;
}) {
  const {width,height}=boardDimensions(props.state);
  const hero=tokens.find(token=>token.id===props.actorId);
  const toCell=(event:ThreeEvent<PointerEvent|MouseEvent>)=>({x:Math.max(0,Math.min(width-1,Math.floor(event.point.x))),y:Math.max(0,Math.min(height-1,Math.floor(event.point.z)))});
  return <>
    <BattleLighting width={width} height={height}/>
    <BattleCamera width={width} height={height} maxHeight={Math.max(1.6,...tokens.map(token=>token.modelHeight+.2))} command={command} hero={hero?{x:hero.position.x+hero.footprint/2,y:hero.position.y+hero.footprint/2}:undefined} onUnavailable={props.onUnavailable}/>
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
    {tokens.map(token=><Miniature key={token.id} token={token} feedback={props.feedback} reducedMotion={reducedMotion} onHover={props.onHover} onCell={props.onCell} canClick={canClick}/>)}
    <ProjectLabels tokens={tokens} elements={labels}/>
  </>;
}

export default function BattleScene(props:BattleSceneProps) {
  const [command,setCommand]=useState<CameraCommand|null>(null);
  const labels=useRef(new Map<string,HTMLDivElement>());
  const gesture=useRef({pointers:new Map<number,{x:number;y:number}>(),moved:false,blockedUntil:0});
  const reducedMotion=useReducedMotion();
  const tokens=useMemo<TokenView[]>(()=>Object.values(props.state.tokens).flatMap(token=>{
    const actor=props.state.world.actors[token.actorId];
    if(!actor)return [];
    const cell=props.cells.find(candidate=>candidate.actorId===token.actorId&&candidate.tokenAnchor)??props.cells.find(candidate=>candidate.actorId===token.actorId);
    const identity=combatIdentity(props.state,token.actorId);
    const presentation=props.state.actorPresentation?.[token.actorId];
    const footprint=cell?.footprint??actorFootprint(actor,props.state);
    const recipe=resolveMiniature({monsterId:token.templateId??actor.attackProfile?.sourceEntityIds[0],templateId:presentation?.templateId,portraitUrl:token.tokenUrl,creatureType:presentation?.creatureType,size:actor.attackProfile?.size,kind:actor.kind});
    const nearestOpponent=Object.values(props.state.tokens)
      .filter(other=>props.state.world.actors[other.actorId]?.runtime.hp.current>0&&combatRelation(props.state,token.actorId,other.actorId)==='enemy')
      .sort((left,right)=>Math.hypot(left.position.x-token.position.x,left.position.y-token.position.y)-Math.hypot(right.position.x-token.position.x,right.position.y-token.position.y))[0];
    const facingAngle=nearestOpponent?Math.atan2(nearestOpponent.position.x-token.position.x,nearestOpponent.position.y-token.position.y):0;
    return [{id:token.actorId,position:token.position,footprint,name:identity.displayName,accent:identity.accent,
      recipe,modelHeight:getMiniatureHeight(recipe)*footprint*.95,facingAngle,
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
  return <section className="battle-scene-3d" data-testid="battle-scene-3d" aria-label="Трёхмерная карта боя">
    <div className="battle-scene-3d__toolbar" role="toolbar" aria-label="Камера поля боя">
      <span className="battle-scene-3d__badge">3D</span>
      <button type="button" aria-label="Приблизить поле" onClick={()=>cameraAction('in')}><ZoomIn size={17}/></button>
      <button type="button" aria-label="Отдалить поле" onClick={()=>cameraAction('out')}><ZoomOut size={17}/></button>
      <span className="battle-scene-3d__separator"/>
      <button type="button" aria-label="Повернуть камеру влево" onClick={()=>cameraAction('left')}><RotateCcw size={17}/></button>
      <button type="button" aria-label="Повернуть камеру вправо" onClick={()=>cameraAction('right')}><RotateCw size={17}/></button>
      <button type="button" aria-label="Показать всё поле" onClick={()=>cameraAction('reset')}><Scan size={17}/></button>
      <button type="button" aria-label="Камера к персонажу" onClick={()=>cameraAction('hero')}><Focus size={17}/></button>
      <span className="battle-scene-3d__map-name">{props.state.battleMap?.name??'Поле боя'}</span>
      {props.state.pendingAdditionalMovement&&!props.state.playerMovement&&props.onDeclineAdditionalMovement&&<button type="button" className="battle-scene-3d__decline" onClick={props.onDeclineAdditionalMovement}>Остаться на месте</button>}
    </div>
    <div className="battle-scene-3d__viewport" data-testid="battle-scene-3d-viewport" onPointerDownCapture={pointerDown} onPointerMoveCapture={pointerMove} onPointerUpCapture={pointerUp} onPointerCancelCapture={pointerUp} onPointerLeave={()=>props.onHover(null)} onContextMenu={event=>event.preventDefault()}>
      <SceneBoundary onUnavailable={props.onUnavailable}>
        <Canvas shadows={{type:PCFShadowMap}} frameloop="demand" dpr={[1,1.75]} camera={{fov:42,near:.1,far:250,position:[10,16,20]}} gl={{antialias:true,alpha:false,powerPreference:'high-performance',toneMapping:ACESFilmicToneMapping,toneMappingExposure:1.05}} fallback={<span aria-hidden="true"/>}
          aria-label="Объёмное поле: нажмите клетку для действия, перетащите для вращения камеры">
          <SceneContent props={props} tokens={tokens} command={command} labels={labels} canClick={canClick} reducedMotion={reducedMotion}/>
        </Canvas>
      </SceneBoundary>
      <div className="battle-scene-3d__labels" aria-hidden="true">{tokens.map(token=>{
        const cue=props.feedback?.rollPhase!=='before-reaction'?props.feedback?.cues.filter(candidate=>candidate.actorId===token.id).map(candidate=>candidate.text).join(' · '):undefined;
        const animation=props.feedback?.rollPhase==='before-reaction'?'idle':props.feedback?.cues.some(candidate=>candidate.actorId===token.id&&candidate.kind==='damage')?'hit':props.feedback?.sourceId===token.id&&props.feedback.visual?'attack':'idle';
        const hovered=props.hovered&&props.hovered.x>=token.position.x&&props.hovered.x<token.position.x+token.footprint&&props.hovered.y>=token.position.y&&props.hovered.y<token.position.y+token.footprint;
        const expanded=hovered||token.active||token.inspected||token.highlighted||cue;
        return <div key={token.id} data-actor-id={token.id} data-animation={animation} className={`battle-scene-3d__label${expanded?' is-expanded':''}${token.active?' is-active':''}${token.hp<=0?' is-fallen':''}`} ref={element=>{if(element)labels.current.set(token.id,element);else labels.current.delete(token.id);}}>
          {cue&&<span className="battle-scene-3d__cue" key={props.feedback?.id}>{cue}</span>}
          <span className="battle-scene-3d__name">{token.name}</span>
          <span className="battle-scene-3d__health"><span style={{width:`${Math.max(0,Math.min(100,token.hp/Math.max(1,token.maxHp)*100))}%`,background:token.accent}}/></span>
        </div>;
      })}</div>
    </div>
    <p className="battle-scene-3d__help">Перетаскивание — вращение · колесо или два пальца — масштаб · правая кнопка — сдвиг</p>
  </section>;
}
