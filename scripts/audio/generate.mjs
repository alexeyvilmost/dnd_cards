// Original, reproducible synthesized recordings. No samples or external music.
// Produces PCM WAV assets; never uses game RNG.
import {mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const dir='outputs/audio-260';await mkdir(dir,{recursive:true});
const sr=22050,TAU=Math.PI*2;
let seed=260;const noise=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2147483648-1;};
const catalog=[];
const make=(key,name,channel,duration,render,gain=1)=>{
 const samples=new Float32Array(Math.ceil(duration*sr));
 const tone=(at,len,freq,amp=.2,kind='sine')=>{for(let i=0;i<len*sr&&i+Math.floor(at*sr)<samples.length;i++){
  const t=i/sr,p=t/len,phase=TAU*freq*t;
  const wave=kind==='bell'?Math.sin(phase)+.25*Math.sin(phase*2.76)+.12*Math.sin(phase*4.13):Math.sin(phase)+.15*Math.sin(phase*2);
  const env=Math.min(1,t/.012)*Math.exp(-p*(kind==='pad'?1.2:5))*Math.min(1,(len-t)/.03);
  samples[Math.floor(at*sr)+i]+=wave*env*amp;
 }};
 const rush=(at,len,amp=.3,bright=.3)=>{let smooth=0;for(let i=0;i<len*sr&&i+Math.floor(at*sr)<samples.length;i++){
  smooth+=bright*(noise()-smooth);const p=i/(len*sr);samples[Math.floor(at*sr)+i]+=smooth*amp*Math.sin(Math.PI*p)**.65;
 }};
 render(tone,rush,samples);
 let peak=0;for(const v of samples)peak=Math.max(peak,Math.abs(v));
 const scale=peak>.78?.78/peak:1,buf=Buffer.alloc(44+samples.length*2);
 buf.write('RIFF');buf.writeUInt32LE(buf.length-8,4);buf.write('WAVEfmt ',8);buf.writeUInt32LE(16,16);buf.writeUInt16LE(1,20);buf.writeUInt16LE(1,22);buf.writeUInt32LE(sr,24);buf.writeUInt32LE(sr*2,28);buf.writeUInt16LE(2,32);buf.writeUInt16LE(16,34);buf.write('data',36);buf.writeUInt32LE(samples.length*2,40);
 for(let i=0;i<samples.length;i++){const edge=Math.min(1,i/(sr*.008),(samples.length-1-i)/(sr*.03));buf.writeInt16LE(Math.round(samples[i]*scale*edge*32767),44+i*2);}
 const hash=createHash('sha256').update(buf).digest('hex').slice(0,16),file=`${key}-${hash}.wav`;
 catalog.push({key,name,channel,gain,loop:channel==='music',file,duration,license:'Original synthesized audio, project-owned; no third-party recordings.'});
 return writeFile(`${dir}/${file}`,buf);
};
const jobs=[];
for(const [key,name] of [['camp','У костра'],['combat','Сражение'],['shop','Лавка путника']])jobs.push(make(`music.${key}`,name,'music',48,(tone,rush)=>{
 const roots=[146.832,130.813,174.614,110];const scale=[1,1.2,1.5,1.8,2,1.5,1.2,1.125];
 for(let bar=0;bar<8;bar++){
  const root=roots[bar%4],at=bar*6;
  [1,1.5,2.4].forEach((ratio,j)=>tone(at,6,root*ratio/2,.075-j*.012,'pad'));
  for(let n=0;n<8;n++)tone(at+n*.75,1.8,root*scale[(n+bar)%8],key==='shop'?.11:.055,'bell');
  if(key==='combat')for(let n=0;n<8;n++){tone(at+n*.75,.3,55,n%4===0?.22:.09);rush(at+n*.75,.06,.18,.12);}
 }
},.55));
jobs.push(make('ui.click','Кнопка','ui',.09,(t,r)=>{t(0,.075,700,.10);r(0,.045,.13,.8)},.45));
jobs.push(make('dice.roll','Кости на столе','effects',1.45,(t,r)=>{for(let n=0;n<14;n++){const at=n*.08+n*n*.0018;r(at,.033,.65,.7);t(at,.06,260+n*27,.09);}},.7));
for(const [key,name,notes] of [
 ['combat.start','Начало боя',[146.83,220,293.66]],['combat.victory','Победа',[261.63,329.63,392,523.25]],
 ['combat.defeat','Поражение',[220,207.65,164.81,110]],['critical.success','Натуральная 20',[392,523.25,659.25]],['critical.failure','Натуральная 1',[220,164.81,110]],
 ['rest.short','Короткий отдых',[293.66,349.23,440]],['rest.long','Долгий отдых',[196,293.66,392,587.33]],
 ['healing','Исцеление',[523.25,659.25,783.99]],['shop.buy','Покупка',[1108.73,1396.91,1661.22]],['shop.open','Дверной колокольчик',[1174.66,1567.98]],
 ['shop.refresh','Новые товары',[392,493.88,587.33]],['shop.pin','Резерв',[880,1174.66]],['item.transfer','Перекладывание вещей',[240,320]],['level.up','Новый уровень',[293.66,369.99,440,587.33]],
])jobs.push(make(key,name,'effects',2.2,(t,r)=>{notes.forEach((f,i)=>t(i*.16,1.5,f,.18,'bell'));if(key.startsWith('combat'))r(0,.4,.2,.12);},.75));
for(const [kind,name] of [['slashing','Рубящий'],['piercing','Колющий'],['bludgeoning','Дробящий'],['ranged','Стрела'],['magic','Магия']])for(const miss of [false,true])jobs.push(make(`attack.${kind}.${miss?'miss':'hit'}`,`${name}: ${miss?'промах':'попадание'}`,'effects',.85,(t,r)=>{
 r(0,.24,kind==='ranged'?.6:.4,kind==='bludgeoning'?.07:.65);
 if(kind==='magic'){[440,660,880].forEach((f,i)=>t(i*.04,.5,f,.12,'bell'));r(.18,.5,.3,.4);}
 if(!miss){r(.25,.12,.7,kind==='piercing'?.8:.2);t(.25,.3,kind==='bludgeoning'?65:kind==='slashing'?175:290,.3);}
 else t(.24,.25,kind==='magic'?220:110,.055);
},.8));
jobs.push(make('breath.fire','Пламенное дыхание','effects',2.1,(t,r)=>{r(0,1.7,1,.075);r(.15,1.6,.45,.7);t(.12,1.3,48,.2);},.8));
jobs.push(make('terrain.web','Липкая паутина','effects',.7,(t,r)=>{[140,185,260].forEach((f,i)=>t(i*.09,.35,f,.16));r(.04,.5,.45,.045);},.65));
jobs.push(make('terrain.mud','Шаг в грязь','effects',.65,(t,r)=>{r(0,.35,.7,.06);r(.25,.2,.4,.3);t(.04,.24,65,.2);},.75));
jobs.push(make('terrain.water','Всплеск воды','effects',.65,(t,r)=>{r(0,.5,.5,.2);[660,880,440].forEach((f,i)=>t(i*.11,.13,f,.07));},.65));
jobs.push(make('terrain.fire','Ожог','effects',.6,(t,r)=>{r(0,.5,.7,.35);t(0,.24,80,.15);},.7));
await Promise.all(jobs);await writeFile(`${dir}/manifest.json`,JSON.stringify(catalog,null,2));
console.log(`Generated ${catalog.length} original WAV assets in ${dir}`);
