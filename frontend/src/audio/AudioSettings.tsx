import {setSetting,useSiteSettings} from '../settings';
import {soundPlayer} from './player';
import {AUDIO_AVAILABLE} from './availability';
export default function AudioSettings(){
 const settings=useSiteSettings();
 if(!AUDIO_AVAILABLE)return <p role="status">Звук временно отключён на время доработки. Ваши настройки громкости сохранены.</p>;
 return <div className="audio-settings">
  <label className="settings-panel-check"><input type="checkbox" checked={settings.audioEnabled} onChange={e=>setSetting('audioEnabled',e.target.checked)}/><span>Включить звук<small>Музыка и эффекты запускаются после первого нажатия. В скрытой вкладке звук приостанавливается.</small></span></label>
  {([['audioMaster','Общая громкость'],['audioMusic','Фоновая музыка'],['audioEffects','Эффекты и кубики'],['audioUI','Нажатия интерфейса']] as const).map(([key,label])=><label className="audio-volume" key={key}><span>{label} <output>{Math.round(settings[key]*100)}%</output></span><input type="range" min="0" max="100" value={Math.round(settings[key]*100)} disabled={!settings.audioEnabled} onChange={e=>setSetting(key,Number(e.target.value)/100)}/></label>)}
  <button type="button" disabled={!settings.audioEnabled} onClick={()=>{soundPlayer.unlock();soundPlayer.play('dice.roll');}}>Проверить звук кубиков</button>
  <p>Звуки действий и заклинаний настраиваются администратором в подробном превью при выключенном режиме игрока. Музыка и эффекты не влияют на результаты бросков.</p>
 </div>;
}
