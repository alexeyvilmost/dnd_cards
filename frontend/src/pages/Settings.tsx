import { Dices, LayoutGrid, List, LayoutTemplate, CreditCard, Eye, Languages } from 'lucide-react';
import {
  setEntityDisplay,
  setSetting,
  useSiteSettings,
  type EntityDisplayKind,
  type EntityDisplayMode,
  type ItemPreviewStyle,
} from '../settings';

const ENTITY_ROWS: Array<{ kind: EntityDisplayKind; label: string; hint: string }> = [
  { kind: 'spells', label: 'Заклинания', hint: 'Лист персонажа и кузница' },
  { kind: 'actions', label: 'Действия', hint: 'Способности-действия персонажа' },
  { kind: 'effects', label: 'Эффекты', hint: 'Пассивные способности персонажа' },
  { kind: 'items', label: 'Предметы', hint: 'Инвентарь на листе и магазин' },
];

const MODE_OPTIONS: Array<{ mode: EntityDisplayMode; label: string; icon: typeof LayoutGrid }> = [
  { mode: 'icon', label: 'Иконки', icon: LayoutGrid },
  { mode: 'row', label: 'Список', icon: List },
];

const ITEM_PREVIEW_OPTIONS: Array<{ mode: ItemPreviewStyle; label: string; icon: typeof LayoutGrid }> = [
  { mode: 'card', label: 'Карточка', icon: CreditCard },
  { mode: 'interface', label: 'Интерфейс', icon: LayoutTemplate },
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

        <label className="flex items-start gap-4 p-5 cursor-pointer">
          <input
            type="checkbox"
            className="mt-1 w-5 h-5 text-indigo-600 rounded"
            checked={settings.playerMode}
            onChange={(e) => setSetting('playerMode', e.target.checked)}
          />
          <span>
            <span className="flex items-center gap-2 font-medium text-gray-900">
              <Eye size={18} className="text-indigo-600" />
              Режим игрока
            </span>
            <span className="block text-sm text-gray-500 mt-1">
              Прячет техническое описание механики (сырые id ресурсов/ячеек, «Стоит…», «Использования…»)
              из превью и листа персонажа. Остаётся человеческое описание, чипы стоимости и боевые
              характеристики (атака, урон, лечение). Выключите, чтобы как мастер видеть всю механику.
            </span>
          </span>
        </label>

        <label className="flex items-start gap-4 p-5 cursor-pointer">
          <input
            type="checkbox"
            className="mt-1 w-5 h-5 text-indigo-600 rounded"
            checked={settings.showOriginalNames}
            onChange={(e) => setSetting('showOriginalNames', e.target.checked)}
          />
          <span>
            <span className="flex items-center gap-2 font-medium text-gray-900">
              <Languages size={18} className="text-indigo-600" />
              Отображать оригинальные названия
            </span>
            <span className="block text-sm text-gray-500 mt-1">
              Под основным названием показывается оригинальное (английское) — в интерфейсных
              отображениях, детальных окнах и превью при наведении. На печатных карточках предметов
              не показывается. У сущностей без заданного оригинала ничего не добавляется.
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
            иконкой и текстом. Настройка действует на лист персонажа, кузницу и магазин.
            В библиотеке — свой переключатель вида (по умолчанию «Список»).
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

        <div className="p-5">
          <div className="flex items-center gap-2 font-medium text-gray-900">
            <LayoutTemplate size={18} className="text-indigo-600" />
            Превью предмета при наведении
          </div>
          <p className="text-sm text-gray-500 mt-1 mb-4">
            Как показывать предмет при наведении (в инвентаре на листе и в библиотеке).
            «Карточка» — обычная карточка предмета. «Интерфейс» — тёмный стат-блок в стиле превью
            заклинания. Не зависит от раскладки «Иконки/Список».
          </p>
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="text-sm font-medium text-gray-900">Вид превью</div>
              <div className="text-xs text-gray-500 truncate">Только для предметов</div>
            </div>
            <div className="flex rounded-lg border border-gray-300 overflow-hidden shrink-0" role="radiogroup" aria-label="Превью предмета">
              {ITEM_PREVIEW_OPTIONS.map(({ mode, label: modeLabel, icon: Icon }) => {
                const active = settings.itemPreview === mode;
                return (
                  <button
                    key={mode}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setSetting('itemPreview', mode)}
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
        </div>
      </div>

      <p className="text-xs text-gray-400 mt-4">
        Настройки сохраняются в этом браузере и действуют на всех страницах сайта.
      </p>
    </div>
  );
};

export default Settings;
