import type {BattleMapDefinition, BattleMapFeature} from '../solo-combat/boardGeometry';
import {featureCells} from '../solo-combat/boardGeometry';
import sprites from '../solo-combat/data/battleMapSprites.json';

type Sprite = {image:string; columns:number; rows:number; view:number[]; repeat?:boolean};
export function mapSprite(feature:BattleMapFeature,map:BattleMapDefinition):Sprite {
  const catalog=map.artVersion===2?sprites.current:sprites.legacy;
  return (catalog as Record<string,Sprite>)[feature.sprite]??sprites.current.rock;
}
/** Native proportions; long obstacles are assembled from cell-sized segments.
 * A baked river has mechanics but no duplicated floating sprite. */
export default function BattleMapScenery({map}:{map?:BattleMapDefinition}){
  if(!map)return null;
  return <div className="battle-map-scenery" aria-hidden="true">{map.features.filter(f=>!f.baked).map(feature=>{
    const sprite=mapSprite(feature,map);
    const repeat=sprite.repeat||(feature.sprite==='fire'&&feature.width!==feature.height);
    const pieces=repeat?featureCells(feature).map(p=>({...p,width:1,height:1})):[feature];
    return pieces.map((piece,index)=><div key={`${feature.id}:${index}`} data-feature-id={feature.id}
      className={`battle-map-feature is-${feature.sprite}`} style={{left:`${piece.x/map.width*100}%`,top:`${piece.y/map.height*100}%`,width:`${piece.width/map.width*100}%`,height:`${piece.height/map.height*100}%`}}>
      <svg className="battle-map-feature__sprite" viewBox={sprite.view.join(' ')} preserveAspectRatio="xMidYMid meet">
        <svg x={sprite.view[0]} y={sprite.view[1]} width={sprite.view[2]} height={sprite.view[3]} viewBox={sprite.view.join(' ')} overflow="hidden">
          <image href={sprite.image} x="0" y="0" width={sprite.columns} height={sprite.rows} preserveAspectRatio="none"/>
        </svg>
      </svg>
    </div>);
  })}</div>;
}
