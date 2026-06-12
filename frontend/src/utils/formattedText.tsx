import React from 'react';

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

type ParsedNode = ParsedTextNode | ParsedFormatNode;

const FORMAT_DELIMITERS: FormatDelimiter[] = [
  { type: 'bold', open: '**', close: '**' },
  { type: 'underline', open: '__', close: '__' },
  { type: 'italic', open: '*', close: '*' },
];

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

const findEarliestDelimiter = (text: string, from: number): { index: number; delimiter: FormatDelimiter } | null => {
  let earliest: { index: number; delimiter: FormatDelimiter } | null = null;

  for (const delimiter of FORMAT_DELIMITERS) {
    const index = delimiter.type === 'italic'
      ? findItalicIndex(text, from)
      : text.indexOf(delimiter.open, from);

    if (index === -1) continue;
    if (!earliest || index < earliest.index) {
      earliest = { index, delimiter };
    }
  }

  return earliest;
};

export const parseFormattedText = (text: string): ParsedNode[] => {
  const nodes: ParsedNode[] = [];
  let position = 0;

  while (position < text.length) {
    const match = findEarliestDelimiter(text, position);

    if (!match) {
      nodes.push({ type: 'text', content: text.slice(position) });
      break;
    }

    if (match.index > position) {
      nodes.push({ type: 'text', content: text.slice(position, match.index) });
    }

    const contentStart = match.index + match.delimiter.open.length;
    const closeIndex = findCloseDelimiter(text, match.delimiter, contentStart);

    if (closeIndex === -1) {
      nodes.push({ type: 'text', content: text.slice(match.index) });
      break;
    }

    const innerText = text.slice(contentStart, closeIndex);
    nodes.push({
      type: match.delimiter.type,
      children: parseFormattedText(innerText),
    });

    position = closeIndex + match.delimiter.close.length;
  }

  return nodes;
};

const extractPlainText = (nodes: ParsedNode[]): string => {
  return nodes
    .map((node) => {
      if (node.type === 'text') {
        return node.content;
      }
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
