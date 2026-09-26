import {BufferGeometry,Float32BufferAttribute,Quaternion, SphereGeometry, Vector3} from 'three';
import {Sculpt, type Paint, type Point} from './sculpt';
import {sculptBow, sculptShield, sculptWeapon} from './equipment';
import type {MiniatureRecipe} from './recipes';

function muscle(s:Sculpt,paint:Paint,a:Point,b:Point,radius:number,depth=1){
  const start=new Vector3(...a),end=new Vector3(...b),middle=start.clone().add(end).multiplyScalar(.5);
  s.add(new SphereGeometry(1,24,16),paint,middle.toArray() as Point,[radius,start.distanceTo(end)*.61,radius*depth],
    new Quaternion().setFromUnitVectors(new Vector3(0,1,0),end.sub(start).normalize()));
}

function angularMuzzle(s:Sculpt,y:number){
  const rings=[{z:.036,w:.041,top:y-.013,bottom:y-.055},{z:.085,w:.032,top:y-.023,bottom:y-.057},
    {z:.131,w:.023,top:y-.031,bottom:y-.056}];
  const sections=rings.map(({z,w,top,bottom})=>[[0,top+.004,z],[w*.74,top,z],[w,top-.008,z],
    [w,bottom+.005,z],[w*.68,bottom,z],[-w*.68,bottom,z],[-w,bottom+.005,z],[-w,top-.008,z],[-w*.74,top,z]]);
  const vertices:number[]=[];
  for(let row=0;row<sections.length-1;row+=1)for(let side=0;side<9;side+=1){
    const next=(side+1)%9,a=sections[row][side],b=sections[row][next],c=sections[row+1][side],d=sections[row+1][next];
    vertices.push(...a,...c,...b,...b,...c,...d);
  }
  const front=sections[sections.length-1],center=[0,y-.045,.131];
  for(let side=0;side<9;side+=1)vertices.push(...center,...front[(side+1)%9],...front[side]);
  const geometry=new BufferGeometry();geometry.setAttribute('position',new Float32BufferAttribute(vertices,3));
  geometry.computeVertexNormals();s.add(geometry,'skin');
}

function headSculpt(s:Sculpt,r:MiniatureRecipe){
  const skull=r.head==='skull',reptile=r.head==='reptile',orc=r.head==='orc',goblin=r.head==='goblin',furry=r.head==='furry',helmet=r.head==='helmet';
  const y=1.058, width=orc||furry?.064:goblin?.061:.054;
  s.profile('skin',[[y-.077,orc?.039:.028,.031,.006],[y-.066,width*(orc?.9:.77),.047,.015],[y-.043,width*.96,.049,.012],
    [y-.01,width,.052,0],[y+.025,width*.94,.057,-.007],[y+.056,width*.72,.045,-.007],[y+.076,.018,.019,-.008]],orc?20:32);
  // Jaw, cheekbones, the bridge and nostrils create a face rather than dots on a sphere.
  if(!skull&&!helmet){
    if(!reptile)s.oval('skin',[0,y-.061,.038],[width*(orc?.78:.69),orc?.014:.023,.028],24);
    for(const side of [-1,1]){
      if(orc||reptile){
        s.profile('skin',[[y-.043,.01,.005,.04],[y-.026,.018,.01,.044],[y-.011,.013,.006,.04]],12,side*width*.63);
        s.oval('dark',[side*.027,y+.005,.052],[.014,.006,.004],20);
        if(!reptile)s.oval('bone',[side*.027,y+.003,.055],[.007,.0013,.001],14);
        s.oval(reptile?'eyes':'leather',[side*.027,y+.003,.056],[reptile?.006:.0025,.0019,.001],14);
        s.oval('dark',[side*.027,y+.003,.057],[reptile?.001:.0015,.002,.0008],12);
        s.curve('skin',[[side*.01,y+.01,.054],[side*.027,y+.019,.056],[side*.047,y+.026,.044]],orc?.007:.006,18,8);
        s.curve('skin',[[side*.014,y-.002,.054],[side*.029,y-.003,.054],[side*.041,y+.003,.048]],.0032,14,6);
        if(orc)s.curve('leather',[[side*.016,y+.02,.055],[side*.031,y+.027,.052],[side*.045,y+.031,.044]],.0019,14,6);
      }else{
        s.oval('skin',[side*width*.59,y-.019,.045],[.022,.018,.018],20);
        s.oval('dark',[side*.025,y+.006,.052],[.013,.0054,.0038],16);
        s.oval('bone',[side*.025,y+.006,.055],[.009,.0027,.0018],14);
        s.oval('eyes',[side*.025,y+.006,.057],[.0026,.0025,.0016],12);
        s.oval('dark',[side*.025,y+.006,.058],[.0014,.0021,.001],10);
        s.curve('skin',[[side*.012,y+.013,.054],[side*.026,y+.017,.055],[side*.04,y+.011,.047]],.004,12,6);
        s.curve('leather',[[side*.014,y+.021,.049],[side*.027,y+.022,.051],[side*.039,y+.016,.046]],.0028,12,6);
      }
      if(goblin||orc||furry){
        const ear=orc?.5:1;
        s.curve('skin',[[side*width*.85,y+.002,-.004],[side*(width+.027*ear),y+.031*ear,-.012],[side*(width+.051*ear),y+.046*ear,-.02]],orc?.009:.012,12,8);
        s.tip('skin',[side*(width+.023*ear),y+.03*ear,-.012],[side*(width+.06*ear),y+.047*ear,-.023],orc?.009:.014);
        s.curve('leather',[[side*width,y-.003,.004],[side*(width+.025*ear),y+.021*ear,-.004],[side*(width+.045*ear),y+.038*ear,-.017]],.002,10,5);
      }else{
        s.oval('skin',[side*(width+.002),y-.006,-.009],[.012,.024,.01],20);
        s.curve('leather',[[side*(width+.007),y+.006,0],[side*(width+.01),y-.004,.002],[side*(width+.004),y-.017,0]],.0018,10,5);
      }
    }
    if(reptile){
      angularMuzzle(s,y);
      s.curve('dark',[[-.029,y-.043,.075],[-.022,y-.052,.122],[0,y-.053,.133],[.022,y-.052,.122],[.029,y-.043,.075]],.0014,24,6);
      for(const side of [-1,1]){
        s.oval('dark',[side*.017,y-.033,.13],[.0045,.0023,.0017],16);
        s.curve('scale',[[side*.012,y-.027,.126],[side*.018,y-.027,.127],[side*.023,y-.032,.117]],.002,12,5);
      }
      for(let row=0;row<4;row+=1)for(let col=-2;col<=2;col+=1){
        const irregular=Math.sin(row*12.7+col*7.1),px=col*.016+(row%2)*.003,py=y+.059-row*.019+irregular*.003,pz=.043-Math.abs(col)*.004;
        s.oval('scale',[px,py,pz],[.0065+irregular*.0015,.009-irregular*.002,.0012],12);}
      for(let crest=0;crest<5;crest+=1)s.tip('skin',[0,y+.063-crest*.01,-.022-crest*.008],[0,y+.089-crest*.008,-.026-crest*.01],.01);
    }else{
      s.oval('skin',[0,y-.016,.053],[goblin?.014:orc?.012:.008,.022,.014],20);
      s.oval('skin',[0,y-.028,.065],[goblin?.015:orc?.016:.011,orc?.006:.008,orc?.008:.011],20);
      for(const side of [-1,1])s.oval('dark',[side*.007,y-.032,.067],[.003,.002,.003],12);
      s.curve('dark',[[-.023,y-(orc?.053:.045),.054],[0,y-.047,.061],[.024,y-(orc?.053:.044),.053]],.0016,16,5);
      s.curve('skin',[[-.019,y-(orc?.056:.049),.057],[0,y-.052,.062],[.019,y-(orc?.056:.048),.056]],orc?.0024:.003,16,6);
      if(orc||furry)for(const side of [-1,1]){
        s.curve('bone',[[side*.026,y-.056,.053],[side*.029,y-.038,.065],[side*.026,y-.023,.063]],.005,12,8);
        s.tip('bone',[side*.028,y-.032,.065],[side*.024,y-.018,.062],.0037);
      }
    }
  }
  if(skull){
    for(const side of [-1,1]){
      s.oval('dark',[side*.027,y+.001,.044],[.017,.019,.013],24);
      s.curve('skin',[[side*.009,y+.016,.051],[side*.029,y+.025,.052],[side*.047,y+.01,.04]],.005,18,8);
      s.oval('skin',[side*.041,y-.022,.04],[.014,.02,.016],24);
    }
    s.oval('dark',[0,y-.025,.054],[.008,.012,.008],16);
    s.oval('skin',[0,y-.063,.027],[.04,.016,.024],24);
    for(let tooth=-3;tooth<=3;tooth+=1)for(const row of [0,1])s.oval('bone',[tooth*.008,y-.043-row*.011,.055-Math.abs(tooth)*.003],[.0036,.006,.004],12);
    s.curve('leather',[[-.03,y+.055,.029],[0,y+.062,.04],[.024,y+.05,.035]],.001,14,4);
  }
  if(helmet){
    s.add(new SphereGeometry(1,32,20,0,Math.PI*2,0,Math.PI*.58),'armor',[0,y+.011,-.009],[.067,.085,.069]);
    s.curve('accent',[[-.062,y+.002,.021],[-.039,y+.009,.058],[0,y+.012,.066],[.039,y+.009,.058],[.062,y+.002,.021]],.0035,28,8);
    s.box('dark',[0,y-.009,.054],[.089,.009,.008]);
    s.box('armor',[0,y-.024,.061],[.009,.073,.011]);
    for(const side of [-1,1]){
      s.oval('armor',[side*.049,y-.038,.024],[.014,.04,.031],24);
      s.oval('metal',[side*.059,y-.026,.035],[.003,.003,.003],12);
    }
    s.curve('metal',[[0,y+.09,-.012],[0,y+.073,.04],[0,y+.02,.063]],.006,20,8);
    // Ventilation slots, inset instead of a luminous cartoon visor.
    for(let hole=-2;hole<=2;hole+=1)s.box('dark',[hole*.012,y-.055,.052-Math.abs(hole)*.005],[.004,.009,.002]);
  }else if(r.hood){
    s.add(new SphereGeometry(1,32,22,Math.PI*.72,Math.PI*1.56,0,Math.PI*.75),'cloth',[0,y+.007,-.015],[.068,.09,.075]);
    s.curve('cloth',[[-.055,y-.072,.028],[-.065,y-.015,.045],[-.055,y+.055,.038],[0,y+.088,.027],[.055,y+.055,.038],[.064,y-.015,.045],[.054,y-.072,.028]],.007,40,8);
    s.curve('leather',[[-.054,y-.07,.035],[-.058,y+.01,.051],[0,y+.084,.037],[.058,y+.01,.051],[.054,y-.07,.035]],.0017,40,5);
  }else if(!skull&&!reptile){
    s.add(new SphereGeometry(1,24,16,0,Math.PI*2,0,Math.PI*.48),'leather',[0,y+.032,-.018],[width*1.06,.06,.054]);
    for(let strand=0;strand<26;strand+=1){const a=strand/26*Math.PI*2;
      s.curve('leather',[[Math.cos(a)*width*.42,y+.077,Math.sin(a)*.032-.012],[Math.cos(a)*width*.86,y+.058,Math.sin(a)*.051-.015],[Math.cos(a)*width*1.02,y+.026,Math.sin(a)*.052-.016]],.003,12,5);}
  }
  if(r.beard||furry)for(let strand=0;strand<26;strand+=1){const a=(strand/25-.5)*Math.PI;
    const x=Math.sin(a)*.037,z=.036+Math.cos(a)*.019;
    s.curve('leather',[[x,y-.035,z],[x*.86,y-.063,z+.005],[x*.6,y-.087+(Math.abs(x)*.3),z-.006]],.0033,10,5);}
  if(r.horns)for(const side of [-1,1]){
    s.curve('bone',[[side*.045,y+.06,-.023],[side*.073,y+.098,-.047],[side*.085,y+.142,-.068]],.01,20,10);
    s.tip('bone',[side*.081,y+.13,-.06],[side*.078,y+.174,-.079],.0075);
    for(let ring=0;ring<4;ring+=1)s.oval('leather',[side*(.052+ring*.006),y+.072+ring*.009,-.03-ring*.006],[.009,.002,.009],12);
  }
  if(r.plume)for(let strand=0;strand<20;strand+=1){const x=(strand%4-1.5)*.006,z=Math.floor(strand/4)*.013-.03;
    s.curve('cloth',[[x,y+.079,z],[x,y+.153,z-.024],[x,y+.176,z-.074]],.0037,18,6);}
}

function chainmail(s:Sculpt,bulk:number){
  for(let row=0;row<6;row+=1)for(let col=0;col<18;col+=1){const a=col/18*Math.PI*2+(row%2)*.08;
    const x=Math.cos(a)*.116*bulk,z=Math.sin(a)*.076;
    s.torus(row%2?'metal':'armor',[x,.595+row*.013,z],.0082,.002,[0,-a+Math.PI/2,0],Math.PI*2,9);
  }
}

export function buildHumanoid(s:Sculpt,r:MiniatureRecipe){
  const bulk=1+(r.bulk-1)*.8,skeleton=r.head==='skull',bodyPaint:Paint=r.armored?'armor':r.mane?'skin':'cloth';
  for(const side of [-1,1]){
    const hip:Point=[side*.073*bulk,.612,0],knee:Point=[side*.088*bulk,.369,side===1?-.031:.041],ankle:Point=[side*.111*bulk,.147,side===1?-.043:.073];
    if(skeleton){
      s.rod('skin',hip,knee,.012,.011);s.oval('skin',knee,[.019,.019,.016],20);
      for(const delta of [-.009,.009])s.rod('skin',[knee[0]+delta,.357,knee[2]],[ankle[0]+delta*.6,.16,ankle[2]],.006,.0048);
      for(let toe=0;toe<4;toe+=1)s.curve('skin',[[ankle[0]+(toe-1.5)*.01,.15,ankle[2]],[ankle[0]+(toe-1.5)*.011,.111,ankle[2]+.035],[ankle[0]+(toe-1.5)*.012,.103,ankle[2]+.057]],.004,10,6);
    }else{
      muscle(s,'cloth',hip,knee,.047*bulk,1.08);muscle(s,r.armored?'armor':'leather',knee,ankle,.032*bulk,1.12);
      s.oval('leather',[ankle[0],.123,ankle[2]+.027],[.038,.035,.079],28);
      s.oval('dark',[ankle[0],.098,ankle[2]+.026],[.039,.012,.079],24);
      s.curve('leather',[[ankle[0]-.025,.125,ankle[2]+.065],[ankle[0],.146,ankle[2]+.08],[ankle[0]+.025,.125,ankle[2]+.065]],.0028,20,6);
      for(let lace=0;lace<4;lace+=1)s.rod('accent',[ankle[0]-.016,.155+lace*.014,ankle[2]+.028],[ankle[0]+.016,.166+lace*.014,ankle[2]+.029],.0015,.0015,6);
      if(r.armored){
        s.oval('armor',[knee[0],.373,knee[2]+.027],[.039,.046,.022],28);
        s.curve('accent',[[knee[0]-.023,.386,knee[2]+.043],[knee[0],.412,knee[2]+.031],[knee[0]+.023,.386,knee[2]+.043]],.0026,18,6);
        s.rod('metal',[knee[0],.324,knee[2]+.035],[ankle[0],.18,ankle[2]+.032],.003,.002,8);
      }
    }
  }
  if(skeleton){
    for(let vertebra=0;vertebra<15;vertebra+=1)s.oval('skin',[0,.586+vertebra*.022,-.017],[.016,.013,.017],16);
    s.oval('skin',[0,.612,-.015],[.072,.043,.049],28);
    for(const side of [-1,1])for(let rib=0;rib<7;rib+=1){const y=.87-rib*.026,wide=.107-rib*.005;
      s.curve('skin',[[0,y,-.031],[side*wide*.77,y-.008,-.025],[side*wide,y-.018,.012],[side*wide*.77,y-.035,.062],[side*.014,y-.04,.068]],.0052,24,8);}
    s.rod('skin',[0,.682,.066],[0,.854,.067],.007,.01);
    for(const side of [-1,1])s.curve('skin',[[0,.9,.001],[side*.078,.898,.015],[side*.143,.893,-.002]],.01,20,8);
  }else{
    s.profile('cloth',[[.572,.077*bulk,.047],[.605,.112*bulk,.075],[.654,.098*bulk,.069],[.703,.084*bulk,.054]],32);
    s.profile(bodyPaint,[[.657,.088*bulk,.057],[.718,.092*bulk,.066],[.791,.129*bulk,.075],
      [.841,.142*bulk,.072],[.883,.119*bulk,.061],[.909,.056*bulk,.042]],40);
    if(r.armored){
      chainmail(s,bulk);
      for(let plate=0;plate<3;plate+=1){const y=.671+plate*.029;
        s.profile('armor',[[y,.102*bulk,.071],[y+.009,.105*bulk,.075],[y+.028,.098*bulk,.068]],32);
        s.curve('metal',[[-.09*bulk,y+.009,.045],[0,y+.003,.075],[.09*bulk,y+.009,.045]],.0025,22,6);}
      s.curve('metal',[[-.113*bulk,.856,.049],[-.078*bulk,.833,.067],[0,.773,.08],[.078*bulk,.833,.067],[.113*bulk,.856,.049]],.003,28,8);
      for(const side of [-1,1])for(let rivet=0;rivet<5;rivet+=1)s.oval('accent',[side*(.104-rivet*.018)*bulk,.851-rivet*.015,.061+rivet*.004],[.0033,.0033,.0033],12);
      s.fabric('cloth',.146,.67,.443,.087,4);
    }else{
      for(const side of [-1,1])s.curve('cloth',[[side*.077*bulk,.708,.047],[side*.061*bulk,.737,.064],[side*.094*bulk,.782,.06]],.003,18,6);
      if(r.mane)for(const side of [-1,1])s.oval('skin',[side*.061*bulk,.819,.052],[.063*bulk,.047,.036],28);
    }
    s.profile('leather',[[.67,.106*bulk,.077],[.689,.108*bulk,.078],[.699,.102*bulk,.075]],32);
    s.box('accent',[.01,.684,.081],[.032,.024,.008]);s.box('dark',[.01,.684,.087],[.018,.013,.003]);s.rod('accent',[-.007,.684,.091],[.023,.684,.091],.0018,.0018,6);
    for(const side of [-1,1]){
      s.oval('leather',[side*.101*bulk,.63,.052],[.031,.048,.019],24);
      s.oval('dark',[side*.101*bulk,.657,.063],[.03,.012,.011],16);
      s.oval('accent',[side*.101*bulk,.643,.074],[.003,.003,.002],12);
    }
    s.curve('leather',[[-.09*bulk,.896,.035],[-.049*bulk,.833,.075],[.016,.761,.079],[.09*bulk,.691,.055]],.011,32,8);
    s.box('accent',[-.027,.804,.092],[.022,.024,.006],-.5);s.box('dark',[-.027,.804,.096],[.013,.014,.002],-.5);
  }
  s.rod('skin',[0,.903,-.008],[0,.996,-.008],skeleton?.013:.029,skeleton?.012:.026,24);
  if(!skeleton){
    for(const side of [-1,1]){
      muscle(s,bodyPaint,[side*.12*bulk,.884,-.01],[side*.043,.938,-.009],.028,1.05);
      s.curve('skin',[[side*.036,.941,.009],[side*.023,.965,.019],[side*.02,.984,.017]],.005,18,8);
    }
    // Raised cloth collar / articulated gorget joins the head naturally to the clavicles.
    s.profile(r.armored?'armor':'cloth',[[.909,.077,.049,-.007],[.925,.068,.045,-.007],
      [.944,.045,.037,-.008],[.963,.035,.031,-.008],[.971,.033,.029,-.008]],32);
    if(r.armored){
      s.curve('metal',[[-.045,.945,.004],[-.024,.945,.027],[0,.944,.031],[.024,.945,.027],[.045,.945,.004]],.0025,24,6);
      for(const side of [-1,1])s.oval('accent',[side*.025,.929,.034],[.003,.003,.002],12);
    }else{
      s.curve('leather',[[-.025,.963,.011],[0,.954,.026],[.025,.963,.011]],.002,20,5);
      s.rod('leather',[0,.954,.027],[-.006,.915,.055],.002,.0015,6);
    }
  }
  for(const side of [-1,1]){
    const left=side===-1;
    const shoulder:Point=[side*.159*bulk,.877,-.009],elbow:Point=[side*(left?.187:.201)*bulk,left?.76:.746,left?-.009:.016],
      hand:Point=[side*.22*bulk,left?(r.shield?.701:r.weapon==='bow'?.661:.637):.651,left&&!r.shield&&r.weapon!=='bow'?.07:.102];
    if(skeleton){
      s.rod('skin',shoulder,elbow,.009,.008);for(const offset of [-.005,.005])s.rod('skin',[elbow[0]+offset,elbow[1],elbow[2]],[hand[0]+offset,hand[1],hand[2]],.0047,.0035);
    }else{
      muscle(s,bodyPaint,shoulder,elbow,.035*bulk,1.04);muscle(s,r.armored?'armor':'skin',elbow,hand,.027,1.06);
      if(r.armored){
        for(let lame=0;lame<3;lame+=1){s.add(new SphereGeometry(1,28,16,0,Math.PI*2,0,Math.PI*.64),'armor',[shoulder[0],.89-lame*.019,-.009],[.063-lame*.005,.034,.054-lame*.003]);
          s.curve('metal',[[shoulder[0]-.043,.888-lame*.019,.021],[shoulder[0],.888-lame*.019,.046],[shoulder[0]+.043,.888-lame*.019,.021]],.0022,16,6);}
        s.oval('armor',[elbow[0],elbow[1],elbow[2]+.018],[.032,.028,.023],24);
      }
      s.rod('leather',[hand[0]*.985,hand[1]+.025,hand[2]-.025],[hand[0],hand[1]+.012,hand[2]-.01],.026,.025,20);
    }
    s.oval('skin',hand,[.023,.028,.019],24);
    for(let finger=0;finger<4;finger+=1){const fx=hand[0]+(finger-1.5)*.008;
      s.curve('skin',[[fx,hand[1]-.004,hand[2]+.009],[fx,hand[1]-.022,hand[2]+.016],[fx,hand[1]-.023,hand[2]+.003]],.004,10,6);}
    s.oval('skin',[hand[0]-side*.02,hand[1]+.006,hand[2]+.005],[.009,.017,.009],16);
    if(side===1)sculptWeapon(s,r.weapon,hand);
  }
  if(r.shield)sculptShield(s,-.223*bulk);
  if(r.weapon==='bow')sculptBow(s,-.242*bulk);
  if(r.cape){s.fabric('cloth',.35*bulk,.926,.396,-.067,4);
    for(const side of [-1,1])s.oval('accent',[side*.077,.902,.033],[.01,.01,.007],16);
    s.curve('accent',[[-.075,.9,.039],[0,.875,.069],[.075,.9,.039]],.0024,24,6);}
  if(r.quiver){
    s.rod('leather',[.059,.678,-.095],[.112,.966,-.11],.031,.034,24);
    s.rod('accent',[.105,.929,-.109],[.11,.953,-.11],.036,.036,24);
    for(let arrow=0;arrow<6;arrow+=1){const a=arrow/6*Math.PI*2,x=.111+Math.cos(a)*.021,z=-.111+Math.sin(a)*.021;
      s.rod('leather',[x,.9,z],[x+.015,1.095+(arrow%2)*.02,z-.006],.002,.002,8);
      for(const side of [-1,1])s.oval('bone',[x+.014+side*.003,1.069+(arrow%2)*.02,z-.006],[.002,.024,.006],12);}
  }
  if(r.mane)for(let tuft=0;tuft<42;tuft+=1){const a=tuft/42*Math.PI*2,x=Math.cos(a)*.141*bulk,z=Math.sin(a)*.063;
    s.curve('leather',[[x,.91,z],[x*1.13,.868,z*1.23],[x*1.17,.82,z*1.31]],.0045,12,6);}
  if(r.ragged)for(let fold=-4;fold<=4;fold+=1)s.curve('cloth',[[fold*.023,.624,.069],[fold*.025,.548,.075],[fold*.028,.503+Math.abs(fold)*.008,.081]],.008,20,8);
  if(r.tail){
    s.curve('skin',[[0,.615,-.052],[.044,.472,-.13],[.147,.296,-.224],[.247,.208,-.249]],.025,32,12);
    s.tip('skin',[.223,.223,-.246],[.289,.195,-.237],.016);
    for(let scale=0;scale<11;scale+=1)s.oval('scale',[.029+scale*.02,.5-scale*.026,-.111-scale*.014],[.013,.009,.008],12);
  }
  headSculpt(s,r);
}
