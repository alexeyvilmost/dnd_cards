import React from 'react';
import { COLOR_TOKENS, ICON_TOKENS, ICON_TOKEN_MAP, getDamageColor } from './damageTypes';
import HoverCard from '../components/HoverCard';
import EntityRefPreview from '../components/EntityRefPreview';
import type { EntityRefType } from '../components/EntityRefRegistry';
import { useEntityDetail } from '../contexts/entityDetail';

type FormatType = 'bold' | 'italic' | 'underline';

interface FormatDelimiter {
  type: FormatType;
  open: string;
  close: string;
}

interface ParsedTextNode {
  type: 'text';
  content: string;
}

interface ParsedFormatNode {
  type: FormatType;
  children: ParsedNode[];
}

interface ParsedColorNode {
  type: 'color';
  dmg: string; // тип урона (для цвета)
  children: ParsedNode[];
}

interface ParsedIconNode {
  type: 'icon';
  dmg: string; // тип урона (для иконки)
}

interface ParsedLinkNode {
  type: 'link';
  label: string;      // слово-ссылка, остаётся в тексте
  refType: EntityRefType;
  refId: string;      // uuid или slug сущности
}

type ParsedNode = ParsedTextNode | ParsedFormatNode | ParsedColorNode | ParsedIconNode | ParsedLinkNode;

const FORMAT_DELIMITERS: FormatDelimiter[] = [
  { type: 'bold', open: '**', close: '**' },
  { type: 'underline', open: '__', close: '__' },
  { type: 'italic', open: '*', close: '*' },
];

// токены сортируем по длине убыв., чтобы длинные (warlock_spell_slot) матчились раньше
const ICON_TOKEN_NAMES = ICON_TOKENS.map((t) => t.token).sort((a, b) => b.length - a.length);
const COLOR_TOKEN_NAMES = COLOR_TOKENS.map((d) => d.value).sort((a, b) => b.length - a.length);
// :fire: / :action: — вставка иконки урона/лечения/ресурса
const ICON_RE = new RegExp(`:(${ICON_TOKEN_NAMES.join('|')}):`);
// [fire]...[/fire] — окраска фрагмента в цвет типа урона / лечения
const COLOR_OPEN_RE = new RegExp(`\\[(${COLOR_TOKEN_NAMES.join('|')})\\]`);
const colorClose = (dmg: string) => `[/${dmg}]`;
// [[Очарование|concept:saving_throw]] — ссылка на сущность (label | type:id)
const LINK_RE = /\[\[([^\]|]+)\|(card|spell|action|effect|concept):([^\]]+)\]\]/;

const findItalicIndex = (text: string, from: number): number => {
  for (let i = from; i < text.length; i++) {
    if (text[i] !== '*') continue;
    if (text[i + 1] === '*') {
      i += 1;
      continue;
    }
    if (i > 0 && text[i - 1] === '*') continue;
    return i;
  }
  return -1;
};

const findCloseDelimiter = (text: string, delimiter: FormatDelimiter, from: number): number => {
  if (delimiter.type === 'italic') {
    for (let i = from; i < text.length; i++) {
      if (text[i] !== '*') continue;
      if (text[i + 1] === '*') {
        i += 1;
        continue;
      }
      if (i > 0 && text[i - 1] === '*') continue;
      return i;
    }
    return -1;
  }

  return text.indexOf(delimiter.close, from);
};

type Special =
  | { kind: 'format'; index: number; delimiter: FormatDelimiter }
  | { kind: 'color'; index: number; dmg: string; openLen: number }
  | { kind: 'icon'; index: number; dmg: string; tokenLen: number }
  | { kind: 'link'; index: number; label: string; refType: EntityRefType; refId: string; matchLen: number };

// Найти ближайшую «спец-конструкцию» начиная с from
const findEarliestSpecial = (text: string, from: number): Special | null => {
  let earliest: Special | null = null;
  const consider = (cand: Special | null) => {
    if (!cand) return;
    if (!earliest || cand.index < earliest.index) earliest = cand;
  };

  for (const delimiter of FORMAT_DELIMITERS) {
    const index = delimiter.type === 'italic'
      ? findItalicIndex(text, from)
      : text.indexOf(delimiter.open, from);
    if (index !== -1) consider({ kind: 'format', index, delimiter });
  }

  const icon = ICON_RE.exec(text.slice(from));
  if (icon) consider({ kind: 'icon', index: from + icon.index, dmg: icon[1], tokenLen: icon[0].length });

  const color = COLOR_OPEN_RE.exec(text.slice(from));
  if (color) consider({ kind: 'color', index: from + color.index, dmg: color[1], openLen: color[0].length });

  const link = LINK_RE.exec(text.slice(from));
  if (link) consider({ kind: 'link', index: from + link.index, label: link[1], refType: link[2] as EntityRefType, refId: link[3], matchLen: link[0].length });

  return earliest;
};

export const parseFormattedText = (text: string): ParsedNode[] => {
  const nodes: ParsedNode[] = [];
  let position = 0;

  while (position < text.length) {
    const match = findEarliestSpecial(text, position);

    if (!match) {
      nodes.push({ type: 'text', content: text.slice(position) });
      break;
    }

    if (match.index > position) {
      nodes.push({ type: 'text', content: text.slice(position, match.index) });
    }

    if (match.kind === 'icon') {
      nodes.push({ type: 'icon', dmg: match.dmg });
      position = match.index + match.tokenLen;
      continue;
    }

    if (match.kind === 'link') {
      nodes.push({ type: 'link', label: match.label, refType: match.refType, refId: match.refId });
      position = match.index + match.matchLen;
      continue;
    }

    if (match.kind === 'color') {
      const contentStart = match.index + match.openLen;
      const close = colorClose(match.dmg);
      const closeIndex = text.indexOf(close, contentStart);
      if (closeIndex === -1) {
        nodes.push({ type: 'text', content: text.slice(match.index) });
        break;
      }
      nodes.push({
        type: 'color',
        dmg: match.dmg,
        children: parseFormattedText(text.slice(contentStart, closeIndex)),
      });
      position = closeIndex + close.length;
      continue;
    }

    // format
    const { delimiter } = match;
    const contentStart = match.index + delimiter.open.length;
    const closeIndex = findCloseDelimiter(text, delimiter, contentStart);

    if (closeIndex === -1) {
      nodes.push({ type: 'text', content: text.slice(match.index) });
      break;
    }

    nodes.push({
      type: delimiter.type,
      children: parseFormattedText(text.slice(contentStart, closeIndex)),
    });
    position = closeIndex + delimiter.close.length;
  }

  return nodes;
};

const extractPlainText = (nodes: ParsedNode[]): string => {
  return nodes
    .map((node) => {
      if (node.type === 'text') return node.content;
      if (node.type === 'icon') return '';
      if (node.type === 'link') return node.label;
      return extractPlainText(node.children);
    })
    .join('');
};

export const stripFormattingMarkers = (text: string): string => {
  return extractPlainText(parseFormattedText(text));
};

const getFormatClassName = (type: FormatType): string => {
  switch (type) {
    case 'bold':
      return 'font-bold';
    case 'italic':
      return 'italic';
    case 'underline':
      return 'underline';
  }
};

const getFormatInlineStyle = (type: FormatType): React.CSSProperties => {
  switch (type) {
    case 'bold':
      return { fontWeight: 'bold' };
    case 'italic':
      return { fontStyle: 'italic' };
    case 'underline':
      return { textDecoration: 'underline' };
  }
};

const renderParsedNodes = (
  nodes: ParsedNode[],
  keyPrefix: string,
  useInlineStyles: boolean,
  onOpenRef?: (type: EntityRefType, id: string) => void,
  disableHoverPreviews = false,
): React.ReactNode[] => {
  return nodes.map((node, index) => {
    const key = `${keyPrefix}-${index}`;

    if (node.type === 'text') {
      return <React.Fragment key={key}>{node.content}</React.Fragment>;
    }

    if (node.type === 'link') {
      return (
        <HoverCard
          key={key}
          className="ft-link"
          content={<EntityRefPreview type={node.refType} id={node.refId} />}
          onClick={onOpenRef ? () => onOpenRef(node.refType, node.refId) : undefined}
          disabled={disableHoverPreviews}
        >
          {node.label}
        </HoverCard>
      );
    }

    if (node.type === 'icon') {
      const info = ICON_TOKEN_MAP[node.dmg];
      return (
        <img
          key={key}
          src={info?.path ?? ''}
          alt={info?.label ?? node.dmg}
          title={info?.label ?? node.dmg}
          style={{
            display: 'inline-block',
            height: '1em',
            width: '1em',
            verticalAlign: '-0.15em',
            objectFit: 'contain',
            margin: '0 0.05em',
          }}
        />
      );
    }

    if (node.type === 'color') {
      return (
        <span key={key} style={{ color: getDamageColor(node.dmg) }}>
          {renderParsedNodes(node.children, key, useInlineStyles, onOpenRef, disableHoverPreviews)}
        </span>
      );
    }

    const styleProps = useInlineStyles
      ? { style: getFormatInlineStyle(node.type) }
      : { className: getFormatClassName(node.type) };

    return (
      <span key={key} {...styleProps}>
        {renderParsedNodes(node.children, key, useInlineStyles, onOpenRef, disableHoverPreviews)}
      </span>
    );
  });
};

interface FormattedTextProps {
  text: string;
  className?: string;
  style?: React.CSSProperties;
  useInlineStyles?: boolean;
  emptyText?: string;
  /** Клик по ссылке [[label|type:id]] — открыть детальное окно сущности. */
  onOpenRef?: (type: EntityRefType, id: string) => void;
}

export const FormattedText: React.FC<FormattedTextProps> = ({
  text,
  className = '',
  style,
  useInlineStyles = false,
  emptyText = 'Нет описания',
  onOpenRef,
}) => {
  // По умолчанию клик по ссылке открывает деталь через глобальный хост (если он смонтирован).
  const { openEntity, disableHoverPreviews = false } = useEntityDetail();
  const effectiveOpenRef = onOpenRef ?? openEntity;

  if (!text || text.trim() === '') {
    return <>{emptyText}</>;
  }

  const nodes = parseFormattedText(text);

  return (
    <span className={className} style={style}>
      {renderParsedNodes(nodes, 'formatted', useInlineStyles, effectiveOpenRef, disableHoverPreviews)}
    </span>
  );
};
