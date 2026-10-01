export interface CoinMotion {
  travel:number;
  hop:number;
  tilt:number;
  wobble:number;
  side:number;
}

export interface CoinDeliveryTiming { launch: number; contact: number; duration?: number }

const progressBetween = (time: number, start: number, end: number) => end > start
  ? Math.max(0, Math.min(1, (time - start) / (end - start)))
  : Number(time >= end);

/** Pure visual timing: it never changes positions, health, or combat decisions. */
export function coinMotionAt(animation:{attack:'none'|'melee'|'shot';hit:boolean;hitDelay:number;reach:number;timing?:CoinDeliveryTiming},t:number):CoinMotion {
  let travel=0,hop=0,tilt=0;
  const timing=animation.timing??(animation.attack==='melee'
    ?{launch:.17,contact:.42,duration:.82}:{launch:.16,contact:.29,duration:.55});
  const end=Math.max(timing.contact,timing.duration??timing.contact+.4);
  if(animation.attack==='melee'&&t>=0&&t<end){
    if(t<timing.launch){const phase=progressBetween(t,0,timing.launch);travel=-.09*Math.sin(phase*Math.PI/2);tilt=-.14*phase;}
    else if(t<timing.contact){const phase=progressBetween(t,timing.launch,timing.contact);travel=-.09+(animation.reach+.09)*(1-(1-phase)**2);hop=.11*Math.sin(phase*Math.PI);tilt=-.14+.47*phase;}
    else {const phase=progressBetween(t,timing.contact,end);travel=animation.reach*(1-phase)**2;hop=.05*Math.sin(phase*Math.PI);tilt=.33*(1-phase)**2;}
  } else if(animation.attack==='shot'&&t>=0&&t<end){
    tilt=t<timing.launch?-.16*progressBetween(t,0,timing.launch):t<timing.contact?-.16+.36*progressBetween(t,timing.launch,timing.contact):.2*(1-progressBetween(t,timing.contact,end));
    hop=t<timing.contact?.045*Math.sin(progressBetween(t,0,timing.contact)*Math.PI):0;
  }
  const hitTime=t-animation.hitDelay;
  const shaking=animation.hit&&hitTime>=0&&hitTime<.68;
  const wobble=shaking?Math.sin(hitTime*36)*.23*Math.exp(-hitTime*4):0;
  const side=shaking?Math.sin(hitTime*36)*.065*Math.exp(-hitTime*4):0;
  return {travel,hop,tilt,wobble,side};
}

export function shotPhaseAt(t:number,timing:CoinDeliveryTiming={launch:.12,contact:.54}) {
  const progress=progressBetween(t,timing.launch,timing.contact);
  return {progress,visible:t>=timing.launch&&t<timing.contact,impact:t>=timing.contact&&t<timing.contact+.28,
    impactScale:.45+Math.max(0,t-timing.contact)*2.1,impactOpacity:Math.max(0,.8-(t-timing.contact)*2.8)};
}
