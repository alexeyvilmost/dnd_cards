import {BufferGeometry, ExtrudeGeometry, Float32BufferAttribute, Shape} from 'three';
import {Sculpt, type Point} from './sculpt';
import type {MiniatureWeapon} from './recipes';

function edgedBlade(s:Sculpt, origin:Point, length:number, width:number, curve=0) {
  const vertices:number[]=[], indices:number[]=[];
  const rows=[0,.065,.28,.54,.79,.94,1];
  // Independent faces leave a crisp central fuller and cutting edges while the silhouette can curve.
  for(let face=0;face<4;face+=1){
    const offset=vertices.length/3;
    rows.forEach(t=>{
      const w=width*(t>.79?Math.max(.012,(1-t)/.21):1-.17*t);
      const center=origin[0]+t*.075+curve*t*t;
      const cross=[[center-w,origin[2]],[center,origin[2]+width*.19],[center+w,origin[2]],[center,origin[2]-width*.19]];
      for(const corner of [face,(face+1)%4])vertices.push(cross[corner][0],origin[1]+t*length,cross[corner][1]);
    });
    for(let n=0;n<rows.length-1;n+=1){const a=offset+n*2;indices.push(a,a+1,a+2,a+1,a+3,a+2);}
  }
  const geometry=new BufferGeometry();geometry.setAttribute('position',new Float32BufferAttribute(vertices,3));geometry.setIndex(indices);geometry.computeVertexNormals();s.add(geometry,'metal');
}

export function sculptWeapon(s:Sculpt,type:MiniatureWeapon,hand:Point) {
  const [x,y,z]=hand;
  if(type==='none'||type==='bow')return;
  const sword=['sword','greatsword','scimitar','dagger'].includes(type);
  if(type==='spear'){
    s.rod('leather',[x-.017,.105,z],[x+.044,1.224,z],.011,.0095,20);
    edgedBlade(s,[x+.044,1.211,z],.199,.032);
    for(let n=0;n<7;n+=1)s.torus('dark',[x+.038,1.13+n*.009,z],.013,.003,[Math.PI/2,0,-.06],Math.PI*2,10);
    s.rod('metal',[x-.017,.106,z],[x-.014,.158,z],.012,.012);
    s.rod('metal',[x+.04,1.18,z],[x+.044,1.226,z],.016,.012);
    return;
  }
  s.rod('leather',[x-.006,y-.066,z],[x+.011,y+.087,z],.014,.013,20);
  for(let n=0;n<9;n+=1)s.torus('dark',[x-.002+n*.0014,y-.04+n*.012,z],.014,.0026,[Math.PI/2,0,-.08],Math.PI*2,10);
  s.oval('metal',[x-.008,y-.072,z],[.023,.029,.02],20);
  s.oval('accent',[x-.008,y-.072,z+.018],[.01,.014,.004],16);
  if(sword){
    s.curve('metal',[[x-.093,y+.06,z],[x-.06,y+.093,z],[x+.013,y+.087,z],[x+.082,y+.08,z],[x+.106,y+.103,z]],.008,20);
    s.oval('accent',[x+.01,y+.086,z],[.023,.025,.017],20);
    const length=type==='greatsword'?.56:type==='dagger'?.205:.392;
    edgedBlade(s,[x+.01,y+.107,z],length,type==='greatsword'?.031:type==='dagger'?.018:.022,type==='scimitar'?.065:0);
    s.rod('dark',[x+.018,y+.125,z+.003],[x+.055,y+length*.65,z+.003],.002,.0015,6);
    return;
  }
  s.rod('leather',[x,y+.03,z],[x+.057,y+.37,z],type==='club'?.034:.015,type==='club'?.04:.014,20);
  if(type==='club'){
    s.oval('leather',[x+.043,y+.283,z],[.064,.142,.052],24);
    for(let n=0;n<8;n+=1){const a=n/8*Math.PI*2;s.curve('dark',[[x+.038+Math.cos(a)*.046,y+.17,z+Math.sin(a)*.044],[x+.052+Math.cos(a)*.061,y+.27,z+Math.sin(a)*.05],[x+.062+Math.cos(a)*.032,y+.399,z+Math.sin(a)*.028]],.0022,10,5);}
    for(const ring of [.22,.32])s.torus('metal',[x+.05,y+ring,z],.063,.006,[Math.PI/2,0,-.08]);
  } else if(type==='mace'){
    s.oval('metal',[x+.055,y+.322,z],[.04,.065,.04],24);
    for(let n=0;n<7;n+=1){const a=n/7*Math.PI*2;s.rod('metal',[x+.055+Math.cos(a)*.038,y+.28,z+Math.sin(a)*.038],[x+.06+Math.cos(a)*.062,y+.357,z+Math.sin(a)*.062],.012,.004,8);}
    s.tip('metal',[x+.06,y+.37,z],[x+.066,y+.414,z],.02);
  } else if(type==='hammer'){
    s.box('metal',[x+.05,y+.327,z],[.145,.085,.071]);
    for(const side of [-1,1])s.box('accent',[x+.05+side*.059,y+.327,z],[.014,.093,.08]);
    s.box('dark',[x+.05,y+.327,z+.036],[.075,.048,.001]);
    s.box('accent',[x+.05,y+.327,z+.039],[.053,.003,.003]);
  } else {
    for(const side of [-1,1]){
      const shape=new Shape();shape.moveTo(0,0);shape.bezierCurveTo(side*.042,.012,side*.095,.057,side*.129,.074);shape.bezierCurveTo(side*.159,.009,side*.143,-.058,side*.108,-.095);shape.quadraticCurveTo(side*.054,-.028,0,-.028);shape.closePath();
      s.add(new ExtrudeGeometry(shape,{depth:.012,bevelEnabled:true,bevelThickness:.0025,bevelSize:.003,bevelSegments:2,steps:1,curveSegments:18}),'metal',[x+.052,y+.325,z-.006]);
      s.curve('dark',[[x+.052+side*.038,y+.324,z+.01],[x+.052+side*.075,y+.34,z+.01],[x+.052+side*.108,y+.364,z+.01]],.002,12,5);
    }
  }
}

export function sculptShield(s:Sculpt,x:number) {
  const shield=new Shape();shield.moveTo(-.101,.137);shield.quadraticCurveTo(0,.161,.101,.137);shield.lineTo(.113,.033);shield.quadraticCurveTo(.101,-.084,0,-.18);shield.quadraticCurveTo(-.101,-.084,-.113,.033);shield.closePath();
  const origin:Point=[x,.707,.162];
  s.add(new ExtrudeGeometry(shield,{depth:.022,bevelEnabled:true,bevelThickness:.004,bevelSize:.005,bevelSegments:3,curveSegments:18}),'metal',origin);
  s.add(new ExtrudeGeometry(shield,{depth:.006,bevelEnabled:true,bevelThickness:.002,bevelSize:.001,bevelSegments:2,curveSegments:18}),'cloth',[x,.707,.188],[.9,.92,1]);
  for(const side of [-1,1]){
    s.curve('accent',[[x+side*.09,.831,.201],[x+side*.098,.751,.201],[x+side*.074,.626,.201],[x,.547,.201]],.0033,20,6);
    for(let n=0;n<5;n+=1)s.oval('accent',[x+side*(.08-n*.012),.806-n*.055,.204],[.004,.004,.004],10);
  }
  // Raised heraldic spear and paired laurel branches; readable at tabletop distance.
  s.rod('accent',[x,.616,.206],[x,.792,.206],.005,.005,8);s.tip('accent',[x,.775,.206],[x,.819,.206],.018);
  for(const side of [-1,1]){
    s.curve('accent',[[x,.623,.207],[x+side*.046,.661,.207],[x+side*.055,.729,.207]],.003,16,5);
    for(let n=0;n<4;n+=1)s.oval('accent',[x+side*(.026+n*.008),.652+n*.02,.208],[.012,.005,.003],12);
  }
}

export function sculptBow(s:Sculpt,x:number) {
  const bow:Point[]=[[x+.025,.327,.164],[x-.021,.386,.181],[x-.048,.513,.203],[x-.033,.657,.213],[x-.041,.8,.202],[x-.002,.953,.178],[x+.014,1.025,.155]];
  s.curve('leather',bow,.01,48,12);
  s.curve('accent',bow.map(point=>[point[0]-.007,point[1],point[2]+.004]),.0027,48,6);
  s.rod('bone',bow[0],bow[bow.length-1],.0015,.0015,6);
  s.rod('dark',[x-.033,.623,.213],[x-.033,.688,.213],.015,.015,12);
  for(let n=0;n<6;n+=1)s.torus('leather',[x-.033,.63+n*.009,.213],.015,.002,[Math.PI/2,0,0],Math.PI*2,10);
  s.rod('leather',[x-.031,.667,.213],[x+.195,.669,.28],.0026,.0026,6);
  s.tip('metal',[x-.029,.667,.213],[x-.064,.667,.201],.008);
}
