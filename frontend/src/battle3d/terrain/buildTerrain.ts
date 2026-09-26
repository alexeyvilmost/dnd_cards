import {CircleGeometry, CylinderGeometry, Shape, ShapeGeometry} from 'three';
import {featureCells, type BattleMapDefinition, type BattleMapFeature} from '../../solo-combat/boardGeometry';
import {randomSource} from './materials';
import {TerrainSculpt, type Point} from './sculpt';

const STONE=['#a59e8d','#b2aa96','#908f85','#bcb39f','#9b9a8e'];
const SOIL=['#686148','#777059','#817762'];
const WOOD=['#8e7354','#a08865','#78614a','#998363'];
type Random=()=>number;
const choice=(values:string[],random:Random)=>values[Math.floor(random()*values.length)];

function tuft(s:TerrainSculpt,x:number,z:number,random:Random,size=1,y=.03) {
  for(let blade=0;blade<5;blade++)s.leaf([x+(random()-.5)*.075*size,y,z+(random()-.5)*.075*size],(.055+random()*.105)*size,.012+random()*.016,random()*Math.PI*2,choice(['#6f7750','#8a8c60','#606b45','#93916b'],random));
}

function column(s:TerrainSculpt,x:number,z:number,random:Random) {
  s.block([x,.08,z],[.84,.16,.84],'#a6a28f');
  s.block([x,.185,z],[.68,.09,.68],'#beb5a0');
  s.ring([x,.28,z],.27,.055,'#b5ad98');
  const height=.85+random()*.22,geometry=new CylinderGeometry(.237,.258,height,64,7);
  const vertices=geometry.getAttribute('position');
  for(let i=0;i<vertices.count;i++){
    const px=vertices.getX(i),py=vertices.getY(i),pz=vertices.getZ(i),radius=Math.hypot(px,pz),angle=Math.atan2(pz,px);
    const flute=radius>.01?1-.105*(.5+.5*Math.cos(angle*12)):1;
    const chip=py>height/2-.01?.038*(1+Math.sin(angle*3.1))+.021*Math.sin(angle*7):0;
    vertices.setXYZ(i,px*flute,py-chip,pz*flute);
  }
  geometry.computeVertexNormals();s.add(geometry,'stone','#b8b09a',[x,.29+height/2,z]);
  s.ring([x,.37,z],.247,.013,'#898779');
  s.ring([x,.41,z],.245,.009,'#c4bda9');
  const cap=.29+height;
  s.ring([x,cap-.06,z],.258,.035,'#aaa28e');
  s.block([x+.015,cap+.015,z-.015],[.57,.105,.57],'#b4ac97','stone',[.035,random()*.06,.025],.023);
  // The broken crown, loose stone chips and worn flutes read in silhouette as well as close up.
  for(let i=0;i<5;i++)s.rock([x+(random()-.5)*.62,.055,z+(random()-.5)*.65],[.05+random()*.06,.025+random()*.05,.05+random()*.06],choice(STONE,random),random()*8,0);
  tuft(s,x-.32,z+.23,random,1.25);tuft(s,x+.27,z-.26,random,.85);
}

function wall(s:TerrainSculpt,feature:BattleMapFeature,random:Random) {
  if(feature.width===1&&feature.height===1&&!feature.cells){column(s,feature.x+.5,feature.y+.5,random);return;}
  if(feature.cells){for(const cell of featureCells(feature))wall(s,{...feature,...cell,width:1,height:1,cells:undefined},random);return;}
  const alongZ=feature.height>feature.width,length=alongZ?feature.height:feature.width,thickness=alongZ?feature.width:feature.height;
  const cx=feature.x+feature.width/2,cz=feature.y+feature.height/2;
  s.block([cx,.075,cz],[feature.width-.065,.15,feature.height-.065],'#8e8c7d','stone',[0,0,0],.018);
  const core=Math.max(.5,thickness*.74);
  for(let course=0;course<4;course++){
    let offset=-length/2+.045-(course%2)*.28;
    while(offset<length/2-.045){
      const span=.47+random()*.23,start=Math.max(-length/2+.055,offset),end=Math.min(length/2-.055,offset+span-.025);
      const edge=Math.min(start+length/2,length/2-end);
      if(end>start+.12&&(course<2||edge>.13+random()*.3)){
        const center=(start+end)/2,h=.215+random()*.018,y=.19+course*.235+h/2;
        const cross=(random()-.5)*.055;
        s.block([cx+(alongZ?cross:center),y,cz+(alongZ?center:cross)],alongZ?[core,h,end-start]:[end-start,h,core],choice(STONE,random),'stone',[(random()-.5)*.025,(random()-.5)*.025,(random()-.5)*.028],.018);
        if(course===3&&random()>.62)s.block([cx+(alongZ?cross:center),y+h*.55+.045,cz+(alongZ?center:cross)],alongZ?[core*.93,.085,(end-start)*.9]:[(end-start)*.9,.085,core*.93],choice(STONE,random),'stone',[.02,0,-.03],.026);
      }
      offset+=span;
    }
  }
  for(const cell of featureCells(feature)){
    for(let i=0;i<3;i++){
      const x=cell.x+.15+random()*.7,z=cell.y+.15+random()*.7;
      s.rock([x,.08,z],[.08+random()*.075,.045+random()*.05,.065+random()*.075],choice(STONE,random),random()*8,0);
    }
    if(random()>.35)tuft(s,cell.x+.12+random()*.76,cell.y+.12+random()*.76,random,1.1,.14);
  }
}

function rubble(s:TerrainSculpt,x:number,z:number,random:Random) {
  for(let i=0;i<14;i++){
    const radius=.032+random()*.09,px=x+.1+random()*.8,pz=z+.1+random()*.8;
    s.rock([px,.025+radius*.42,pz],[radius,.03+radius*.48,radius*(.75+random()*.5)],choice(STONE,random),random()*20,i%4===0?1:0);
  }
  for(let i=0;i<2;i++)s.block([x+.2+random()*.6,.065,z+.2+random()*.6],[.17+random()*.13,.08+random()*.045,.1+random()*.11],choice(STONE,random),'stone',[random()*.25,random()*3,random()*.16],.019);
  if(random()>.25)tuft(s,x+.17+random()*.66,z+.17+random()*.66,random,.8);
}

function boulder(s:TerrainSculpt,feature:BattleMapFeature,random:Random) {
  const cx=feature.x+feature.width/2,cz=feature.y+feature.height/2,w=feature.width,d=feature.height;
  const height=feature.blocksSight?.73:.5;
  s.rock([cx,.37,cz],[w*.38,height,d*.37],'#979589',random()*10,2);
  s.rock([cx-w*.24,.21,cz+d*.22],[w*.2,.32,d*.2],'#b0aa98',random()*10,1);
  s.rock([cx+w*.27,.18,cz-d*.2],[w*.17,.24,d*.19],'#858779',random()*10,1);
  for(const cell of featureCells(feature))for(let i=0;i<4;i++)s.rock([cell.x+.15+random()*.7,.045,cell.y+.15+random()*.7],[.025+random()*.065,.025+random()*.04,.04+random()*.04],choice(STONE,random),random()*20,0);
}

function tree(s:TerrainSculpt,feature:BattleMapFeature,random:Random) {
  const x=feature.x+feature.width/2,z=feature.y+feature.height/2,radius=Math.min(feature.width,feature.height)*.255,height=1.15+random()*.3;
  const trunk=new CylinderGeometry(radius*.79,radius,height,36,8);
  const positions=trunk.getAttribute('position');
  for(let i=0;i<positions.count;i++){
    const px=positions.getX(i),py=positions.getY(i),pz=positions.getZ(i),a=Math.atan2(pz,px),r=Math.hypot(px,pz);
    const ridge=1+Math.sin(a*11+py*.8)*.055+Math.sin(a*23-py*1.2)*.022;
    positions.setXYZ(i,px*ridge,py+(py>height/2-.01&&r>.02?Math.sin(a*5)*.045:0),pz*ridge);
  }
  trunk.computeVertexNormals();s.add(trunk,'bark','#81755d',[x,height/2,z]);
  s.add(new CylinderGeometry(radius*.77,radius*.77,.014,36),'endgrain','#b3a17e',[x,height/2+height/2-.012,z]);
  for(let i=0;i<7;i++){
    const a=i*Math.PI*2/7+random()*.17,reach=Math.min(feature.width,feature.height)*(.37+random()*.09);
    const points:Point[]=[[x+Math.sin(a)*radius*.66,.17,z+Math.cos(a)*radius*.66],[x+Math.sin(a)*reach*.73,.07,z+Math.cos(a)*reach*.73],[x+Math.sin(a)*reach,.032,z+Math.cos(a)*reach]];
    s.root(points,radius*.13,'#74694f');
  }
  const branch=random()*Math.PI*2;
  s.rod([x,.66,z],[x+Math.sin(branch)*radius*1.4,.99,z+Math.cos(branch)*radius*1.4],radius*.26,'bark','#7b7059',radius*.18,9);
  for(let i=0;i<4;i++){const angle=random()*6.28;tuft(s,x+Math.sin(angle)*radius*1.3,z+Math.cos(angle)*radius*1.3,random,1.2);}
}

function barrel(s:TerrainSculpt,x:number,z:number,random:Random) {
  const y=.39,angle=random()*Math.PI*2;
  // Individual convex staves, narrow seams, iron bands and rivets.
  for(let stave=0;stave<16;stave++){
    const a=angle+stave*Math.PI*2/16;
    const shape=new CylinderGeometry(.277,.277,.68,3,4,false,a,.345);
    const vertices=shape.getAttribute('position');
    for(let i=0;i<vertices.count;i++){
      const py=vertices.getY(i),factor=1+.12*Math.cos(py/.34*Math.PI/2);
      vertices.setXYZ(i,vertices.getX(i)*factor,py,vertices.getZ(i)*factor);
    }
    shape.computeVertexNormals();s.add(shape,'wood',choice(WOOD,random),[x,y,z]);
  }
  for(const band of [.13,.3,.5,.66]){
    const radius=.281+.037*Math.cos((band-y)/.34*Math.PI/2);
    s.add(new CylinderGeometry(radius,radius,.036,32,1,true),'metal','#5d605a',[x,band,z]);
    for(let rivet=0;rivet<8;rivet++){const a=rivet*Math.PI/4+angle;s.pebble([x+Math.sin(a)*radius,band,z+Math.cos(a)*radius],[.009,.009,.009],'#807f70');}
  }
  s.add(new CylinderGeometry(.271,.271,.025,32),'endgrain','#a18c69',[x,.739,z]);
  for(const line of [-.11,0,.11])s.rod([x-.225,.755,z+line],[x+.225,.755,z+line],.004,'wood','#534a39',.004,4);
  s.add(new CylinderGeometry(.034,.034,.016,8),'wood','#78664b',[x+.075,.764,z-.025]);
}

function furniture(s:TerrainSculpt,feature:BattleMapFeature,random:Random) {
  const cx=feature.x+feature.width/2,cz=feature.y+feature.height/2,w=feature.width*.93,d=feature.height*.9;
  const count=Math.max(3,Math.round(d/.2)),plankDepth=d/count;
  for(let plank=0;plank<count;plank++){
    const z=cz-d/2+(plank+.5)*plankDepth;
    s.block([cx,.66+(random()-.5)*.008,z],[w,.092,plankDepth-.013],choice(WOOD,random),'wood',[0,0,(random()-.5)*.009],.004);
    for(const end of [-1,1])s.add(new CylinderGeometry(.011,.011,.003,7),'metal','#56574e',[cx+end*w*.43,.708,z]);
  }
  if(feature.sprite==='counter'){
    const faceCount=Math.max(2,Math.round(w/.22));
    for(let plank=0;plank<faceCount;plank++)for(const side of [-1,1])s.block([cx-w/2+(plank+.5)*w/faceCount,.31,cz+side*d*.38],[w/faceCount-.013,.57,.075],choice(WOOD,random),'wood',[0,0,0],.003);
    s.block([cx,.13,cz],[w*.98,.11,d*.81],'#73644a','wood');
  }else{
    for(const px of [-1,1])for(const pz of [-1,1]){
      s.block([cx+px*w*.36,.3,cz+pz*d*.31],[.105,.57,.105],'#76654c','wood',[0,0,px*.025],.003);
      s.block([cx+px*w*.36,.12,cz+pz*d*.31],[.14,.055,.14],'#7b6c51','wood');
    }
    for(const side of [-1,1])s.block([cx,.51,cz+side*d*.31],[w*.82,.12,.068],'#847054','wood');
    s.block([cx,.2,cz],[w*.74,.07,.08],'#746448','wood');
  }
}

function tomb(s:TerrainSculpt,feature:BattleMapFeature,random:Random) {
  const x=feature.x+feature.width/2,z=feature.y+feature.height/2,w=feature.width,d=feature.height;
  s.block([x,.08,z],[w*.95,.16,d*.94],'#a3a08f');
  s.block([x,.33,z],[w*.85,.45,d*.82],'#999888');
  s.block([x,.585,z],[w*.96,.09,d*.96],'#c1b8a2','stone',[0,0,.01]);
  s.block([x,.64,z],[w*.91,.035,d*.89],'#aaa591');
  for(const side of [-1,1])for(let inset=0;inset<Math.max(1,Math.floor(w));inset++)s.block([x+(inset-(Math.floor(w)-1)/2)*.73,.33,z+side*d*.415],[.5,.21,.025],'#777e71');
  s.block([x,.669,z],[w*.48,.023,.052],'#8a8c7e');s.block([x,.67,z],[.055,.023,d*.5],'#8a8c7e');
  for(let i=0;i<3;i++)s.rock([x+(random()-.5)*w*.8,.025,z+(random()-.5)*d*.8],[.04,.03,.05],choice(STONE,random),random()*10,0);
}

function puddle(s:TerrainSculpt,x:number,z:number,random:Random) {
  for(let patch=0;patch<5;patch++){
    const shape=new Shape(),radius=.13+random()*.13,cx=x+.25+random()*.5,cz=z+.25+random()*.5;
    for(let i=0;i<=16;i++){const angle=i*Math.PI*2/16,r=radius*(.8+random()*.2),px=Math.cos(angle)*r,py=Math.sin(angle)*r;if(!i)shape.moveTo(px,py);else shape.lineTo(px,py);}
    const geometry=new ShapeGeometry(shape);s.add(geometry,'earth',choice(SOIL,random),[cx,.022+patch*.0004,cz],[1,1,1],[-Math.PI/2,0,0]);
  }
  for(let i=0;i<5;i++)s.pebble([x+.07+random()*.86,.025,z+.07+random()*.86],[.015+random()*.027,.01,.025],'#77735c');
}

function fire(s:TerrainSculpt,x:number,z:number,random:Random) {
  for(let i=0;i<10;i++){const a=i*Math.PI/5;s.rock([x+Math.sin(a)*.37,.07,z+Math.cos(a)*.37],[.07,.055,.08],'#848073',a,0);}
  for(let i=0;i<4;i++){const a=i*Math.PI/4;s.rod([x-Math.sin(a)*.29,.08,z-Math.cos(a)*.29],[x+Math.sin(a)*.29,.115,z+Math.cos(a)*.29],.05,'charcoal','#4c443a',.043,9);}
  for(let i=0;i<9;i++){
    const a=random()*Math.PI*2,r=random()*.15,high=.2+random()*.25;
    const geometry=new CylinderGeometry(.006,.043+random()*.04,high,7,3);const vertices=geometry.getAttribute('position');
    for(let p=0;p<vertices.count;p++){const y=vertices.getY(p);vertices.setX(p,vertices.getX(p)+Math.sin(y*11+i)*.035*(y/high+.5));}geometry.computeVertexNormals();
    s.add(geometry,'flame',i%3===0?'#eab36a':'#c9823c',[x+Math.sin(a)*r,.11+high/2,z+Math.cos(a)*r]);
  }
}

function web(s:TerrainSculpt,x:number,z:number,random:Random) {
  const center:Point=[x+.5,.055,z+.5];
  for(let i=0;i<12;i++){const angle=i*Math.PI/6;s.rod(center,[center[0]+Math.sin(angle)*.45,.065+random()*.04,center[2]+Math.cos(angle)*.45],.002,'web','#c6c1ac',.001,3);}
  for(const radius of [.13,.23,.34,.43])for(let i=0;i<12;i++){
    const a=i*Math.PI/6,b=(i+1)*Math.PI/6;s.rod([center[0]+Math.sin(a)*radius,.07,center[2]+Math.cos(a)*radius],[center[0]+Math.sin(b)*radius,.06,center[2]+Math.cos(b)*radius],.0015,'web','#c6c1ac',.0015,3);
  }
}

/** Decorative terrain only: every feature consumes the original authored rectangle or mask. */
export function buildTerrain(map:BattleMapDefinition|undefined,width:number,height:number) {
  const s=new TerrainSculpt(),borderRandom=randomSource(`${map?.id??'board'}:bedrock:${width}:${height}`);
  // A layered, chipped stone foundation replaces the uniform extruded rectangle.
  s.block([width/2,-.26,height/2],[width+.32,.44,height+.32],'#5d5e58','stone',[0,0,0],.018);
  for(const alongX of [true,false])for(const side of [-1,1]){
    const length=alongX?width:height;
    for(let edge=0;edge<length;edge++){
      const a=edge+.5,jitter=(borderRandom()-.5)*.045,position:Point=alongX?[a,-.19,(side===-1?-.075:height+.075)+jitter]:[(side===-1?-.075:width+.075)+jitter,-.19,a];
      s.block(position,alongX?[.95,.32+borderRandom()*.08,.23]:[.23,.32+borderRandom()*.08,.95],choice(['#72766b','#858779','#929181'],borderRandom),'stone',[0,0,0],.022);
      if(edge%2===0){const x=alongX?a:side===-1?.13:width-.13,z=alongX?(side===-1?.13:height-.13):a;tuft(s,x,z,borderRandom,.7,.015);}
    }
  }
  for(const feature of map?.features??[]){
    const random=randomSource(`${map?.id}:${feature.id}:${feature.sprite}:${feature.x}:${feature.y}`);
    if(feature.sprite==='wall'){wall(s,feature,random);continue;}
    if(feature.sprite==='trunk'&&!feature.cells){tree(s,feature,random);continue;}
    if(feature.sprite==='rock'&&!feature.cells){boulder(s,feature,random);continue;}
    if((feature.sprite==='table'||feature.sprite==='counter')&&!feature.cells){furniture(s,feature,random);continue;}
    if(feature.sprite==='stone'&&!feature.cells){tomb(s,feature,random);continue;}
    const cells=featureCells(feature),cellSet=new Set(cells.map(cell=>`${cell.x}:${cell.y}`));
    for(const cell of cells){
      const x=cell.x,z=cell.y;
      switch(feature.sprite){
        case 'rubble':rubble(s,x,z,random);break;
        case 'barrel':barrel(s,x+.5,z+.5,random);break;
        case 'mud':puddle(s,x,z,random);break;
        case 'fire':fire(s,x+.5,z+.5,random);break;
        case 'web':web(s,x,z,random);break;
        case 'trunk':tree(s,{...feature,...cell,width:1,height:1,cells:undefined},random);break;
        case 'table':case 'counter':furniture(s,{...feature,...cell,width:1,height:1,cells:undefined},random);break;
        case 'stone':tomb(s,{...feature,...cell,width:1,height:1,cells:undefined},random);break;
        case 'water':{
          const shape=new Shape();shape.moveTo(-.5,-.5);shape.lineTo(.5,-.5);shape.lineTo(.5,.5);shape.lineTo(-.5,.5);shape.closePath();
          s.add(new ShapeGeometry(shape),'water','#687f7c',[x+.5,.029,z+.5],[1,1,1],[-Math.PI/2,0,0]);
          for(const [dx,dz] of [[-1,0],[1,0],[0,-1],[0,1]])if(!cellSet.has(`${x+dx}:${z+dz}`)){
            const px=x+.5+dx*.43,pz=z+.5+dz*.43;
            s.rock([px,.028,pz],[.07,.018,.065],'#8a8c75',random()*10,0);
            if(random()>.55)tuft(s,px,pz,random,1.4,.03);
          }
          break;
        }
        default:boulder(s,{...feature,...cell,width:1,height:1,cells:undefined},random);
      }
    }
  }
  // Sparse grit sits flush with the printed floor and never changes traversal or the targeting plane.
  const random=randomSource(`${map?.id}:floor-grit`);
  for(let i=0;i<width*height*.8;i++){
    const x=.1+random()*(width-.2),z=.1+random()*(height-.2);
    s.add(new CircleGeometry(.007+random()*.016,5),'earth',choice(SOIL,random),[x,.013,z],[1,1,1],[-Math.PI/2,0,random()*6.28]);
  }
  return s.finish();
}
