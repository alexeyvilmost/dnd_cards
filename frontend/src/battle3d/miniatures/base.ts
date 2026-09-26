import {CylinderGeometry,IcosahedronGeometry,LatheGeometry,Matrix4,Quaternion,TorusGeometry,Vector2,Vector3} from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** A painted plinth, beveled rather than a straight toy puck, with a sculpted terrain inset. */
export const miniatureBaseGeometry=new LatheGeometry([
  [0,0],[.323,0],[.341,.006],[.348,.019],[.348,.03],[.338,.038],[.329,.064],[.318,.074],[.316,.088],[.307,.093],[0,.093],
].map(([x,y])=>new Vector2(x,y)),64);
export const miniatureBaseTrimGeometry=new TorusGeometry(.337,.0023,6,64);
export const miniatureBaseGroundGeometry=new CylinderGeometry(.304,.307,.012,48,1);
const pieces=[];
for(let index=0;index<93;index+=1){
  const a=index*2.3999632297,radius=Math.sqrt((index+.5)/93)*.301;
  const size=.007+(index%7)*.0015;
  const geometry=new IcosahedronGeometry(1,index%9===0?1:0);
  geometry.applyMatrix4(new Matrix4().compose(new Vector3(Math.cos(a)*radius,.096+size*.17,Math.sin(a)*radius),
    new Quaternion().setFromAxisAngle(new Vector3(.5,.9,.2).normalize(),index*.37),new Vector3(size,size*.45,size*.73)));
  pieces.push(geometry);
}
export const miniatureBaseGritGeometry=mergeGeometries(pieces)!;
pieces.forEach(piece=>piece.dispose());
