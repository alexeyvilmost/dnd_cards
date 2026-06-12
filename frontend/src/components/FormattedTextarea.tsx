import React, { useRef } from 'react';
import { Bold, Italic, Underline } from 'lucide-react';

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

  const applyFormat = (marker: string) => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selectedText = value.substring(start, end);
    const formattedText = `${marker}${selectedText}${marker}`;
    const nextValue = value.substring(0, start) + formattedText + value.substring(end);

    onChange(nextValue);

    requestAnimationFrame(() => {
      textarea.focus();
      const selectionStart = start + marker.length;
      const selectionEnd = selectionStart + selectedText.length;
      textarea.setSelectionRange(selectionStart, selectionEnd);
    });
  };

  return (
    <div>
      <div className="flex items-center gap-1 mb-2">
        {FORMAT_ACTIONS.map((action) => (
          <button
            key={action.label}
            type="button"
            title={action.label}
            onClick={() => applyFormat(action.marker)}
            className="p-2 rounded border border-gray-300 text-gray-700 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {action.icon}
          </button>
        ))}
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
        Выделите текст и нажмите кнопку форматирования. Поддерживаются **жирный**, *курсив* и __подчёркнутый__.
      </p>

      {error && (
        <p className="mt-1 text-sm text-red-600">{error}</p>
      )}
    </div>
  );
};
