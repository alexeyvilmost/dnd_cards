import {Sculpt,type Paint,type Point} from './sculpt';
import type {MiniatureRecipe} from './recipes';

function fur(s:Sculpt,center:Point,radii:Point,count:number,paint:Paint='skin',length=.022){
  // Deterministic golden-angle strands follow the skin surface. No random generation during play.
  for(let strand=0;strand<count;strand+=1){
    const y=1-2*(strand+.5)/count,theta=strand*2.3999632297,radial=Math.sqrt(1-y*y);
    const normal:Point=[Math.cos(theta)*radial,y,Math.sin(theta)*radial];
    const p:Point=[center[0]+normal[0]*radii[0],center[1]+normal[1]*radii[1],center[2]+normal[2]*radii[2]];
    if(p[1]<.15)continue;
    s.curve(paint,[p,[p[0]+normal[0]*.006,p[1]+normal[1]*.008,p[2]-.006],
      [p[0]+normal[0]*.013,p[1]+normal[1]*.009-.01,p[2]-length]],.0032,8,5);
  }
}

export function buildQuadruped(s:Sculpt,r:MiniatureRecipe){
  const rat=r.body==='rat';
  if(rat){
    s.oval('skin',[0,.307,-.061],[.146,.145,.258],32);
    s.oval('fur',[0,.383,-.114],[.13,.078,.214],28);
    s.oval('skin',[0,.319,.168],[.095,.081,.126],32);
    s.oval('skin',[0,.28,.276],[.059,.045,.125],28);
    s.oval('cloth',[0,.279,.388],[.02,.014,.015],24);
    for(const side of [-1,1]){
      s.oval('skin',[side*.085,.402,.133],[.049,.065,.018],28);
      s.oval('cloth',[side*.086,.404,.146],[.036,.05,.007],24);
      s.curve('skin',[[side*.063,.35,.15],[side*.123,.408,.138],[side*.089,.465,.13],[side*.047,.416,.142]],.003,24,6);
      s.oval('dark',[side*.068,.33,.246],[.011,.011,.008],24);
      s.oval('eyes',[side*.073,.334,.251],[.0025,.0025,.002],12);
      for(let whisker=0;whisker<5;whisker+=1){const y=.277+whisker*.006;
        s.curve('bone',[[side*.042,y,.322],[side*.094,y+.001,.339],[side*(.137+whisker*.008),y-.014+whisker*.005,.331-whisker*.005]],.0007,16,4);}
      s.oval('skin',[side*.117,.263,-.181],[.055,.09,.08],24);
      for(const front of [-1,1]){
        const z=front===1?.158:-.173;
        s.curve('skin',[[side*.092,.28,z],[side*.122,.197,z+.003],[side*.144,.13,z+.027]],.016,18,10);
        s.oval('cloth',[side*.145,.117,z+.047],[.025,.011,.038],24);
        for(let toe=0;toe<4;toe+=1)s.curve('cloth',[[side*.144+(toe-1.5)*.009,.12,z+.061],[side*.143+(toe-1.5)*.011,.108,z+.087],[side*.139+(toe-1.5)*.012,.104,z+.091]],.003,10,6);
      }
      s.tip('bone',[side*.011,.248,.326],[side*.011,.223,.343],.006);
    }
    const tail:Point[]=[[0,.272,-.291],[.083,.177,-.357],[.214,.128,-.381],[.304,.12,-.302],[.322,.131,-.22]];
    s.curve('cloth',tail,.013,50,12);
    for(let ring=0;ring<26;ring+=1){const t=ring/25;
      s.oval('leather',[.02+t*.295,.259-.147*Math.sin(t*1.7),-.305-.078*Math.sin(t*3.4)],[.009*(1-t*.5),.002,.01*(1-t*.55)],10);}
    fur(s,[0,.307,-.061],[.147,.146,.259],200,'skin',.023);
    fur(s,[0,.326,.18],[.094,.075,.128],90,'skin',.015);
  }else{
    const bulk=r.bulk;
    s.oval('skin',[0,.449,-.055],[.112*bulk,.152,.261],32);
    s.oval('skin',[0,.503,.136],[.114*bulk,.153,.126],32);
    s.oval('fur',[0,.535,-.104],[.101*bulk,.067,.215],28);
    s.oval('cloth',[0,.389,.123],[.077,.121,.072],24);
    for(const side of [-1,1]){
      // Digitigrade hind legs have hocks, narrow wrists and a forward-set pad.
      s.oval('skin',[side*.096,.394,-.193],[.056,.104,.083],28);
      s.curve('skin',[[side*.091,.395,-.177],[side*.114,.282,-.241],[side*.108,.211,-.165]],.024,24,12);
      s.rod('skin',[side*.108,.216,-.165],[side*.107,.129,-.173],.016,.012,20);
      s.oval('skin',[side*.107,.111,-.14],[.032,.021,.055],28);
      s.oval('skin',[side*.083,.433,.139],[.04,.117,.052],28);
      s.curve('skin',[[side*.079,.443,.143],[side*.095,.276,.122],[side*.101,.138,.155]],.019,28,12);
      s.oval('skin',[side*.102,.109,.184],[.032,.019,.052],28);
      for(const z of [-.105,.213])for(let claw=0;claw<3;claw+=1){
        s.oval('skin',[side*.105+(claw-1)*.015,.11,z-.012],[.012,.014,.021],16);
        s.tip('bone',[side*.105+(claw-1)*.015,.111,z],[side*.105+(claw-1)*.015,.1,z+.014],.004);}
    }
    s.oval('skin',[0,.642,.205],[.084,.093,.119],32);
    s.oval('skin',[0,.605,.31],[.05,.043,.108],32);
    s.oval('cloth',[0,.579,.308],[.042,.019,.088],24);
    s.oval('dark',[0,.613,.408],[.033,.019,.022],28);
    s.curve('dark',[[-.039,.589,.342],[0,.584,.39],[.039,.589,.342]],.0016,20,6);
    for(const side of [-1,1]){
      s.oval('skin',[side*.055,.69,.162],[.034,.071,.033],24);
      s.tip('skin',[side*.056,.725,.164],[side*.068,.793,.128],.021);
      s.tip('cloth',[side*.056,.723,.19],[side*.065,.769,.148],.011);
      s.oval('dark',[side*.057,.655,.279],[.012,.006,.008],24);
      s.oval('eyes',[side*.062,.656,.283],[.004,.0028,.0025],16);
      s.curve('fur',[[side*.044,.668,.28],[side*.06,.674,.268],[side*.073,.666,.25]],.005,16,8);
      s.tip('bone',[side*.032,.589,.321],[side*.031,.564,.332],.005);
      s.curve('skin',[[side*.064,.605,.251],[side*.107,.569,.202],[side*.122,.547,.174]],.006,16,8);
    }
    s.curve('skin',[[0,.452,-.299],[.024,.377,-.382],[.058,.282,-.424],[.094,.211,-.396]],.034,36,12);
    s.tip('fur',[.08,.227,-.408],[.108,.179,-.363],.021);
    fur(s,[0,.477,-.057],[.12*bulk,.131,.26],190,'skin',.036);
    fur(s,[0,.532,.13],[.113*bulk,.153,.12],r.mane?170:90,'fur',r.mane?.057:.032);
    fur(s,[0,.643,.19],[.084,.09,.099],90,'skin',.017);
  }
}

export function buildSpider(s:Sculpt){
  s.oval('fur',[0,.309,-.151],[.179,.146,.234],36);
  s.oval('skin',[0,.289,.123],[.112,.098,.13],32);
  for(let stripe=0;stripe<5;stripe+=1){const z=-.303+stripe*.06;
    s.curve('cloth',[[-.086,.389+Math.sin(stripe)*.012,z],[0,.45-Math.abs(stripe-2)*.01,z-.025],[.086,.389+Math.sin(stripe)*.012,z]],.009,24,8);}
  for(const side of [-1,1])for(let leg=0;leg<4;leg+=1){
    const z=.16-leg*.079;
    const hip:Point=[side*.087,.295,z],knee:Point=[side*(.253+((leg===1||leg===2)?.043:0)),.373,.299-leg*.183];
    const wrist:Point=[side*(.345+((leg===1||leg===2)?.026:0)),.203,.33-leg*.198],foot:Point=[side*(.392+((leg===1||leg===2)?.01:0)),.105,.355-leg*.218];
    s.curve('skin',[hip,[side*.161,.334,z+(leg<2?.04:-.038)],knee],.015,24,12);
    s.oval('fur',knee,[.022,.025,.023],24);
    s.curve('fur',[knee,wrist,foot],.012,28,10);
    s.tip('dark',foot,[foot[0]+side*.013,.091,foot[2]+.008],.006);
    for(let bristle=0;bristle<8;bristle+=1){const t=(bristle+1)/9;
      const p:Point=[hip[0]+(knee[0]-hip[0])*t,hip[1]+(knee[1]-hip[1])*t+.006,hip[2]+(knee[2]-hip[2])*t];
      s.tip('leather',p,[p[0]+side*.009,p[1]+.023,p[2]-.009],.0018);}
  }
  for(const side of [-1,1]){
    for(let eye=0;eye<4;eye+=1){const x=side*(.016+eye*.02),z=.241-eye*.011;
      s.oval('dark',[x,.32+(eye%2)*.015,z],[.007,.007,.006],20);
      s.oval('eyes',[x+.001,.323+(eye%2)*.015,z+.005],[.0019,.0019,.0015],12);}
    s.curve('skin',[[side*.035,.258,.221],[side*.053,.213,.275],[side*.029,.19,.3]],.016,24,12);
    s.tip('dark',[side*.028,.194,.297],[side*.008,.177,.306],.007);
    s.curve('fur',[[side*.076,.259,.204],[side*.11,.231,.259],[side*.119,.2,.289]],.008,22,10);
  }
  fur(s,[0,.31,-.149],[.181,.147,.231],140,'leather',.024);
  fur(s,[0,.29,.12],[.113,.099,.13],80,'leather',.013);
}

export function buildDummy(s:Sculpt){
  s.rod('leather',[0,.102,0],[0,.994,0],.029,.025,24);
  s.rod('leather',[-.254,.771,-.011],[.254,.771,-.011],.019,.019,20);
  s.oval('skin',[0,.72,.003],[.107,.193,.065],32);
  s.oval('skin',[0,.998,-.002],[.061,.077,.055],32);
  for(const side of [-1,1]){
    s.rod('leather',[side*.174,.102,side*.073],[0,.298,0],.018,.015,20);
    s.curve('dark',[[side*.018,.997,.052],[side*.037,1.008,.042]],.0026,12,6);
  }
  for(let grain=0;grain<9;grain+=1){const a=grain/9*Math.PI*2;
    s.curve('dark',[[Math.cos(a)*.029,.123,Math.sin(a)*.029],[Math.cos(a+.1)*.03,.343,Math.sin(a+.1)*.03],[Math.cos(a)*.024,.564,Math.sin(a)*.024]],.0012,24,5);}
  for(const y of [.598,.835])s.torus('leather',[0,y,.002],.08,.004,[Math.PI/2,0,0],Math.PI*2,28);
  for(let seam=0;seam<13;seam+=1)s.rod('leather',[-.019,.581+seam*.024,.057],[.011,.59+seam*.024,.064],.0016,.0016,6);
  s.oval('cloth',[0,.731,.066],[.067,.088,.005],32);
  s.torus('accent',[0,.731,.073],.05,.0025,[0,0,0],Math.PI*2,32);
  s.torus('accent',[0,.731,.074],.027,.002,[0,0,0],Math.PI*2,28);
  s.oval('accent',[0,.731,.076],[.008,.01,.002],20);
  for(let straw=0;straw<55;straw+=1){const a=straw*2.399963,bend=Math.sin(straw*.6)*.012;
    s.curve('accent',[[Math.cos(a)*.082,.86,Math.sin(a)*.039],[Math.cos(a)*.091,.893+bend,Math.sin(a)*.043],[Math.cos(a)*.105,.902+bend,Math.sin(a)*.05]],.0013,10,4);}
}
