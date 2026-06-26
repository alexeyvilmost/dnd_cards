import React, { useRef, useState } from 'react';
import { Bold, Italic, Underline, Palette, Sparkles } from 'lucide-react';
import { DAMAGE_TYPES, getDamageIconPath } from '../utils/damageTypes';

interface FormattedTextareaProps {
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  rows?: number;
  placeholder?: string;
  error?: string;
  required?: boolean;
}

type FormatAction = {
  label: string;
  marker: string;
  icon: React.ReactNode;
};

const FORMAT_ACTIONS: FormatAction[] = [
  { label: 'Жирный', marker: '**', icon: <Bold size={16} /> },
  { label: 'Курсив', marker: '*', icon: <Italic size={16} /> },
  { label: 'Подчёркнутый', marker: '__', icon: <Underline size={16} /> },
];

export const FormattedTextarea: React.FC<FormattedTextareaProps> = ({
  value,
  onChange,
  onBlur,
  rows = 4,
  placeholder,
  error,
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [menu, setMenu] = useState<null | 'color' | 'icon'>(null);

  // Обернуть выделение парой маркеров (open/close могут отличаться)
  const wrap = (open: string, close: string) => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = value.substring(start, end);
    const next = value.substring(0, start) + open + selected + close + value.substring(end);
    onChange(next);
    requestAnimationFrame(() => {
      textarea.focus();
      const s = start + open.length;
      textarea.setSelectionRange(s, s + selected.length);
    });
  };

  // Вставить токен в позицию курсора
  const insert = (token: string) => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const next = value.substring(0, start) + token + value.substring(end);
    onChange(next);
    requestAnimationFrame(() => {
      textarea.focus();
      const pos = start + token.length;
      textarea.setSelectionRange(pos, pos);
    });
  };

  const btnCls =
    'p-2 rounded border border-gray-300 text-gray-700 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500';

  return (
    <div>
      <div className="flex items-center gap-1 mb-2 relative flex-wrap">
        {FORMAT_ACTIONS.map((action) => (
          <button
            key={action.label}
            type="button"
            title={action.label}
            onClick={() => wrap(action.marker, action.marker)}
            className={btnCls}
          >
            {action.icon}
          </button>
        ))}

        {/* Цвет фрагмента по типу урона */}
        <div className="relative">
          <button
            type="button"
            title="Окрасить выделенный текст в цвет типа урона"
            onClick={() => setMenu(menu === 'color' ? null : 'color')}
            className={btnCls}
          >
            <Palette size={16} />
          </button>
          {menu === 'color' && (
            <div className="absolute z-20 mt-1 left-0 bg-white border border-gray-200 rounded-lg shadow-lg p-2 grid grid-cols-2 gap-1 w-56">
              {DAMAGE_TYPES.map((d) => (
                <button
                  key={d.value}
                  type="button"
                  onClick={() => { wrap(`[${d.value}]`, `[/${d.value}]`); setMenu(null); }}
                  className="flex items-center gap-2 px-2 py-1 rounded hover:bg-gray-100 text-sm"
                >
                  <span className="inline-block w-3 h-3 rounded-full" style={{ backgroundColor: d.color }} />
                  {d.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Вставка иконки урона */}
        <div className="relative">
          <button
            type="button"
            title="Вставить иконку типа урона"
            onClick={() => setMenu(menu === 'icon' ? null : 'icon')}
            className={btnCls}
          >
            <Sparkles size={16} />
          </button>
          {menu === 'icon' && (
            <div className="absolute z-20 mt-1 left-0 bg-white border border-gray-200 rounded-lg shadow-lg p-2 grid grid-cols-2 gap-1 w-56">
              {DAMAGE_TYPES.map((d) => (
                <button
                  key={d.value}
                  type="button"
                  onClick={() => { insert(`:${d.value}:`); setMenu(null); }}
                  className="flex items-center gap-2 px-2 py-1 rounded hover:bg-gray-100 text-sm"
                >
                  <img src={getDamageIconPath(d.value)} alt="" className="w-4 h-4 object-contain" />
                  {d.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <textarea
        ref={textareaRef}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
        rows={rows}
        placeholder={placeholder}
        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
      />

      <p className="text-xs text-gray-500 mt-1">
        **жирный**, *курсив*, __подчёркнутый__. Цвет: выделите текст и выберите тип урона. Иконка: <code>:fire:</code>.
      </p>

      {error && (
        <p className="mt-1 text-sm text-red-600">{error}</p>
      )}
    </div>
  );
};
