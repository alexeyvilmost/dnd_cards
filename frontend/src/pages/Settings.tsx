import SettingsPanel from '../components/SettingsPanel';
import { useDiceDialog } from '../contexts/DiceDialogContext';

export default function Settings() {
  const dice = useDiceDialog();
  return <main className="settings-site-page"><h1>Настройки</h1><SettingsPanel onTestDice={() => { void dice.request([{ sides: 20, label: 'Бросок атаки' }, { sides: 8, label: 'Урон' }], 'Пробный бросок'); }} /></main>;
}
