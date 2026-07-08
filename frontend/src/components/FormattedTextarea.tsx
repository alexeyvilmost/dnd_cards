import React, { useEffect, useRef, useState } from 'react';
import { Bold, Italic, Underline, Palette, Sparkles, Link as LinkIcon } from 'lucide-react';
import { COLOR_TOKENS, ICON_TOKENS } from '../utils/damageTypes';
import { cardsApi, spellsApi, actionsApi, effectsApi, conceptsApi } from '../api/client';
import type { EntityRefType } from './EntityRefRegistry';

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

// ─── Поиск сущностей для ссылки [[label|type:ref]] ────────────────────────────
type LinkResult = { type: EntityRefType; ref: string; name: string; typeLabel: string };
const TYPE_LABEL: Record<EntityRefType, string> = {
  card: 'Предмет', spell: 'Заклинание', action: 'Действие', effect: 'Эффект', concept: 'Понятие',
};

async function searchLinkTargets(query: string): Promise<LinkResult[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const ql = q.toLowerCase();
  const [cards, spells, actions, effects, concepts] = await Promise.allSettled([
    // fields:'list' — автодополнению нужны только id/name; не тянем detailed_description/mechanics.
    cardsApi.getCards({ search: q, limit: 6, fields: 'list' }),
    spellsApi.getSpells({ search: q, limit: 6, fields: 'list' }),
    actionsApi.getActions({ search: q, limit: 6, fields: 'list' }),
    effectsApi.getEffects({ search: q, limit: 6, fields: 'list' }),
    conceptsApi.getConcepts(),
  ]);
  const out: LinkResult[] = [];
  // Для предметов/заклинаний/действий/эффектов ref = uuid (резолвер грузит по uuid),
  // для понятий ref = slug concept_id (резолвер понимает и slug, и он читаемее).
  if (cards.status === 'fulfilled') out.push(...cards.value.cards.map((c) => ({ type: 'card' as const, ref: c.id, name: c.name, typeLabel: TYPE_LABEL.card })));
  if (spells.status === 'fulfilled') out.push(...spells.value.spells.map((s) => ({ type: 'spell' as const, ref: s.id, name: s.name, typeLabel: TYPE_LABEL.spell })));
  if (actions.status === 'fulfilled') out.push(...actions.value.actions.map((a) => ({ type: 'action' as const, ref: a.id, name: a.name, typeLabel: TYPE_LABEL.action })));
  if (effects.status === 'fulfilled') out.push(...effects.value.effects.map((e) => ({ type: 'effect' as const, ref: e.id, name: e.name, typeLabel: TYPE_LABEL.effect })));
  if (concepts.status === 'fulfilled') {
    for (const c of concepts.value.concepts) {
      if (c.name.toLowerCase().includes(ql)) out.push({ type: 'concept', ref: c.concept_id, name: c.name, typeLabel: TYPE_LABEL.concept });
    }
  }
  return out;
}

export const FormattedTextarea: React.FC<FormattedTextareaProps> = ({
  value,
  onChange,
  onBlur,
  rows = 4,
  placeholder,
  error,
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const caretRef = useRef<{ start: number; end: number } | null>(null); // последняя каретка (меню крадёт фокус)
  const [menu, setMenu] = useState<null | 'color' | 'icon' | 'link'>(null);
  const [linkQuery, setLinkQuery] = useState('');
  const [linkResults, setLinkResults] = useState<LinkResult[]>([]);
  const [linkLoading, setLinkLoading] = useState(false);

  // Дебаунс-поиск сущностей для ссылки.
  useEffect(() => {
    if (menu !== 'link') return;
    if (linkQuery.trim().length < 2) { setLinkResults([]); return; }
    setLinkLoading(true);
    const t = setTimeout(() => {
      searchLinkTargets(linkQuery).then((r) => setLinkResults(r)).catch(() => setLinkResults([])).finally(() => setLinkLoading(false));
    }, 250);
    return () => clearTimeout(t);
  }, [linkQuery, menu]);

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

  // Вставить ссылку: выделенный текст становится подписью, иначе — имя сущности.
  const insertLink = (name: string, type: EntityRefType, ref: string) => {
    const textarea = textareaRef.current;
    // Меню (autoFocus input) увело фокус — берём последнюю каретку, иначе конец текста.
    const caret = caretRef.current ?? { start: value.length, end: value.length };
    const start = caret.start;
    const end = caret.end;
    const label = value.substring(start, end) || name;
    const token = `[[${label}|${type}:${ref}]]`;
    const next = value.substring(0, start) + token + value.substring(end);
    onChange(next);
    requestAnimationFrame(() => {
      textarea?.focus();
      const pos = start + token.length;
      textarea?.setSelectionRange(pos, pos);
    });
  };

  // Открыть меню ссылки. Если есть выделение — подставляем его в строку поиска
  // (и оно же станет подписью ссылки через caretRef, insertLink).
  const openLinkMenu = () => {
    const textarea = textareaRef.current;
    let caret = caretRef.current;
    if (textarea && textarea.selectionStart !== textarea.selectionEnd) {
      caret = { start: textarea.selectionStart, end: textarea.selectionEnd };
      caretRef.current = caret; // держим поиск и подпись согласованными
    }
    const selectedText = caret ? value.substring(caret.start, caret.end).trim() : '';
    setLinkResults([]);
    setLinkQuery(selectedText);
    setMenu('link');
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
              {COLOR_TOKENS.map((d) => (
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
            <div className="absolute z-20 mt-1 left-0 bg-white border border-gray-200 rounded-lg shadow-lg p-2 w-64 max-h-80 overflow-y-auto">
              {(['damage', 'heal', 'resource'] as const).map((grp) => {
                const items = ICON_TOKENS.filter((t) => t.group === grp);
                if (!items.length) return null;
                const title = grp === 'damage' ? 'Урон' : grp === 'heal' ? 'Лечение' : 'Ресурсы';
                return (
                  <div key={grp} className="mb-1">
                    <div className="text-[11px] uppercase tracking-wide text-gray-400 px-2 py-1">{title}</div>
                    <div className="grid grid-cols-2 gap-1">
                      {items.map((t) => (
                        <button
                          key={t.token}
                          type="button"
                          onClick={() => { insert(`:${t.token}:`); setMenu(null); }}
                          className="flex items-center gap-2 px-2 py-1 rounded hover:bg-gray-100 text-sm"
                        >
                          <img src={t.path} alt="" className="w-4 h-4 object-contain" />
                          {t.label}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Ссылка на сущность */}
        <div className="relative">
          <button
            type="button"
            title="Вставить ссылку на сущность (предмет/заклинание/действие/эффект/понятие)"
            onClick={() => { if (menu === 'link') setMenu(null); else openLinkMenu(); }}
            className={btnCls}
          >
            <LinkIcon size={16} />
          </button>
          {menu === 'link' && (
            <div className="absolute z-20 mt-1 left-0 bg-white border border-gray-200 rounded-lg shadow-lg p-2 w-72 max-h-96 overflow-y-auto">
              <input
                autoFocus
                value={linkQuery}
                onChange={(e) => setLinkQuery(e.target.value)}
                onFocus={(e) => e.currentTarget.select()}
                placeholder="Поиск: предмет, заклинание, понятие…"
                className="w-full px-2 py-1.5 border border-gray-300 rounded mb-2 text-sm"
              />
              {linkLoading && <div className="text-xs text-gray-400 px-2 py-1">Поиск…</div>}
              {!linkLoading && linkQuery.trim().length >= 2 && linkResults.length === 0 && (
                <div className="text-xs text-gray-400 px-2 py-1">Ничего не найдено</div>
              )}
              {linkResults.map((r) => (
                <button
                  key={`${r.type}:${r.ref}`}
                  type="button"
                  onClick={() => { insertLink(r.name, r.type, r.ref); setMenu(null); }}
                  className="w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded hover:bg-gray-100 text-sm text-left"
                >
                  <span className="truncate text-gray-900">{r.name}</span>
                  <span className="text-[10px] uppercase tracking-wide text-gray-400 flex-shrink-0">{r.typeLabel}</span>
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
        onSelect={(e) => { caretRef.current = { start: e.currentTarget.selectionStart, end: e.currentTarget.selectionEnd }; }}
        onBlur={onBlur}
        rows={rows}
        placeholder={placeholder}
        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
      />

      <p className="text-xs text-gray-500 mt-1">
        **жирный**, *курсив*, __подчёркнутый__. Цвет: выделите текст и выберите тип урона.
        Иконка: <code>:fire:</code>. Ссылка: кнопка «звено» → поиск сущности (или вручную <code>[[Спасбросок|concept:saving_throw]]</code>).
      </p>

      {error && (
        <p className="mt-1 text-sm text-red-600">{error}</p>
      )}
    </div>
  );
};
