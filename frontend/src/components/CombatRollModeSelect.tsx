import { setSetting, useSiteSettings, type CombatRollMode } from '../settings';
import '../dice/CombatPresentation.css';

export default function CombatRollModeSelect() {
  const settings = useSiteSettings();
  return <label className="combat-roll-mode">
    <span>Показ атак</span>
    <select aria-label="Показ атак" value={settings.combatRollMode}
      onChange={event => setSetting('combatRollMode', event.target.value as CombatRollMode)}>
      <option value="standard">Стандарт</option>
      <option value="fast">Быстрый режим</option>
      <option value="skip">Пропустить окно</option>
    </select>
  </label>;
}
