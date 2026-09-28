export interface CoinMotion {
  travel:number;
  hop:number;
  tilt:number;
  wobble:number;
  side:number;
}

/** Pure visual timing: it never changes positions, health, or combat decisions. */
export function coinMotionAt(animation:{attack:'none'|'melee'|'shot';hit:boolean;hitDelay:number;reach:number},t:number):CoinMotion {
  let travel=0,hop=0,tilt=0;
  if(animation.attack==='melee'&&t>=0&&t<.82){
    if(t<.17){travel=-.09*Math.sin(t/.17*Math.PI/2);tilt=-.14*t/.17;}
    else if(t<.42){const phase=(t-.17)/.25;travel=-.09+(animation.reach+.09)*(1-(1-phase)**2);hop=.11*Math.sin(phase*Math.PI);tilt=-.14+.47*phase;}
    else {const phase=(t-.42)/.4;travel=animation.reach*(1-phase)**2;hop=.05*Math.sin(phase*Math.PI);tilt=.33*(1-phase)**2;}
  } else if(animation.attack==='shot'&&t>=0&&t<.55){
    tilt=t<.16?-.16*t/.16:t<.29?-.16+.36*(t-.16)/.13:.2*(1-(t-.29)/.26);
    hop=t<.29?.045*Math.sin(t/.29*Math.PI):0;
  }
  const hitTime=t-animation.hitDelay;
  const shaking=animation.hit&&hitTime>=0&&hitTime<.68;
  const wobble=shaking?Math.sin(hitTime*36)*.23*Math.exp(-hitTime*4):0;
  const side=shaking?Math.sin(hitTime*36)*.065*Math.exp(-hitTime*4):0;
  return {travel,hop,tilt,wobble,side};
}

export function shotPhaseAt(t:number) {
  const progress=Math.max(0,Math.min(1,(t-.12)/.42));
  return {progress,visible:t>=.12&&progress<1,impact:t>=.54&&t<.82,
    impactScale:.45+(t-.54)*2.1,impactOpacity:Math.max(0,.8-(t-.54)*2.8)};
}
