import { Dices, LayoutGrid, List } from 'lucide-react';
import {
  setEntityDisplay,
  setSetting,
  useSiteSettings,
  type EntityDisplayKind,
  type EntityDisplayMode,
} from '../settings';

const ENTITY_ROWS: Array<{ kind: EntityDisplayKind; label: string; hint: string }> = [
  { kind: 'spells', label: 'Заклинания', hint: 'Лист персонажа, кузница, библиотека' },
  { kind: 'actions', label: 'Действия', hint: 'Способности-действия персонажа и библиотека' },
  { kind: 'effects', label: 'Эффекты', hint: 'Пассивные способности персонажа и библиотека' },
  { kind: 'items', label: 'Предметы', hint: 'Инвентарь на листе, библиотека, магазин' },
];

const MODE_OPTIONS: Array<{ mode: EntityDisplayMode; label: string; icon: typeof LayoutGrid }> = [
  { mode: 'icon', label: 'Иконки', icon: LayoutGrid },
  { mode: 'row', label: 'Список', icon: List },
];

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

        <div className="p-5">
          <div className="flex items-center gap-2 font-medium text-gray-900">
            <LayoutGrid size={18} className="text-indigo-600" />
            Отображение сущностей
          </div>
          <p className="text-sm text-gray-500 mt-1 mb-4">
            «Иконки» — квадратные плитки с карточкой при наведении. «Список» — строки с маленькой
            иконкой и текстом. Настройка действует на лист персонажа, кузницу, библиотеку и магазин.
          </p>
          <div className="space-y-3">
            {ENTITY_ROWS.map(({ kind, label, hint }) => (
              <div key={kind} className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-gray-900">{label}</div>
                  <div className="text-xs text-gray-500 truncate">{hint}</div>
                </div>
                <div className="flex rounded-lg border border-gray-300 overflow-hidden shrink-0" role="radiogroup" aria-label={label}>
                  {MODE_OPTIONS.map(({ mode, label: modeLabel, icon: Icon }) => {
                    const active = settings.entityDisplay[kind] === mode;
                    return (
                      <button
                        key={mode}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        onClick={() => setEntityDisplay(kind, mode)}
                        className={`flex items-center gap-1.5 px-3 py-1.5 text-sm transition-colors ${
                          active
                            ? 'bg-indigo-600 text-white'
                            : 'bg-white text-gray-600 hover:bg-gray-50'
                        }`}
                      >
                        <Icon size={14} />
                        {modeLabel}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <p className="text-xs text-gray-400 mt-4">
        Настройки сохраняются в этом браузере и действуют на всех страницах сайта.
      </p>
    </div>
  );
};

export default Settings;
