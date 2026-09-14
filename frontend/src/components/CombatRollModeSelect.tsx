import { setSetting, useSiteSettings, type CombatRollMode } from '../settings';
import '../dice/CombatPresentation.css';

export default function CombatRollModeSelect() {
  const settings = useSiteSettings();
  return <div className="combat-roll-preferences">{([
    ['combatRollMode', 'Свои действия и союзники'],
    ['enemyCombatRollMode', 'Действия противников'],
  ] as const).map(([key, label]) => <label className="combat-roll-mode" key={key}>
    <span>{label}</span>
    <select aria-label={label} value={settings[key]}
      onChange={event => setSetting(key, event.target.value as CombatRollMode)}>
      <option value="standard">Стандарт</option>
      <option value="fast">Быстрый режим</option>
      <option value="skip">Пропустить окно</option>
    </select>
  </label>)}</div>;
}
