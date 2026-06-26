import React from 'react';
import { DAMAGE_TYPES, getDamageColor, getDamageIconPath, getDamageLabel } from './damageTypes';

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

type ParsedNode = ParsedTextNode | ParsedFormatNode | ParsedColorNode | ParsedIconNode;

const FORMAT_DELIMITERS: FormatDelimiter[] = [
  { type: 'bold', open: '**', close: '**' },
  { type: 'underline', open: '__', close: '__' },
  { type: 'italic', open: '*', close: '*' },
];

const DAMAGE_VALUES = DAMAGE_TYPES.map((d) => d.value);
// :fire:  — вставка иконки урона
const ICON_RE = new RegExp(`:(${DAMAGE_VALUES.join('|')}):`);
// [fire]...[/fire] — окраска фрагмента в цвет типа урона
const COLOR_OPEN_RE = new RegExp(`\\[(${DAMAGE_VALUES.join('|')})\\]`);
const colorClose = (dmg: string) => `[/${dmg}]`;

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
  | { kind: 'icon'; index: number; dmg: string; tokenLen: number };

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
  useInlineStyles: boolean
): React.ReactNode[] => {
  return nodes.map((node, index) => {
    const key = `${keyPrefix}-${index}`;

    if (node.type === 'text') {
      return <React.Fragment key={key}>{node.content}</React.Fragment>;
    }

    if (node.type === 'icon') {
      return (
        <img
          key={key}
          src={getDamageIconPath(node.dmg)}
          alt={getDamageLabel(node.dmg)}
          title={getDamageLabel(node.dmg)}
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
          {renderParsedNodes(node.children, key, useInlineStyles)}
        </span>
      );
    }

    const styleProps = useInlineStyles
      ? { style: getFormatInlineStyle(node.type) }
      : { className: getFormatClassName(node.type) };

    return (
      <span key={key} {...styleProps}>
        {renderParsedNodes(node.children, key, useInlineStyles)}
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
}

export const FormattedText: React.FC<FormattedTextProps> = ({
  text,
  className = '',
  style,
  useInlineStyles = false,
  emptyText = 'Нет описания',
}) => {
  if (!text || text.trim() === '') {
    return <>{emptyText}</>;
  }

  const nodes = parseFormattedText(text);

  return (
    <span className={className} style={style}>
      {renderParsedNodes(nodes, 'formatted', useInlineStyles)}
    </span>
  );
};
