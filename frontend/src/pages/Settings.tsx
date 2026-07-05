import { Dices } from 'lucide-react';
import { setSetting, useSiteSettings } from '../settings';

/** Общие настройки сайта (хранятся локально в браузере). */
const Settings = () => {
  const settings = useSiteSettings();

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Настройки</h1>

      <div className="bg-white rounded-lg shadow divide-y divide-gray-100">
        <label className="flex items-start gap-4 p-5 cursor-pointer">
          <input
            type="checkbox"
            className="mt-1 w-5 h-5 text-indigo-600 rounded"
            checked={settings.diceDialog}
            onChange={(e) => setSetting('diceDialog', e.target.checked)}
          />
          <span>
            <span className="flex items-center gap-2 font-medium text-gray-900">
              <Dices size={18} className="text-indigo-600" />
              Диалог бросков кубов
            </span>
            <span className="block text-sm text-gray-500 mt-1">
              Перед действием, требующим броска, показывать окно: система подскажет, сколько и каких
              кубов бросить, и позволит либо бросить автоматически, либо ввести значения ваших
              физических кубов. Результат в любом случае попадает в журнал.
            </span>
          </span>
        </label>
      </div>

      <p className="text-xs text-gray-400 mt-4">
        Настройки сохраняются в этом браузере и действуют на всех страницах сайта.
      </p>
    </div>
  );
};

export default Settings;
