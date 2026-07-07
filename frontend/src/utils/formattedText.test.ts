import { describe, expect, it } from 'vitest';
import { parseFormattedText, stripFormattingMarkers } from './formattedText';

type AnyNode = { type: string; [k: string]: unknown };

describe('formattedText: ссылки [[label|type:id]]', () => {
  it('парсит ссылку в узел link (label/refType/refId), текст вокруг сохранён', () => {
    const nodes = parseFormattedText('До боя [[Очарование|concept:charmed]] важно') as unknown as AnyNode[];
    const link = nodes.find((n) => n.type === 'link') as unknown as AnyNode;
    expect(link).toBeTruthy();
    expect(link.label).toBe('Очарование');
    expect(link.refType).toBe('concept');
    expect(link.refId).toBe('charmed');
    expect(nodes[0]).toEqual({ type: 'text', content: 'До боя ' });
  });

  it('ссылка внутри **жирного** парсится (earliest-wins порядок)', () => {
    const nodes = parseFormattedText('**[[Меч|card:abc-123]]**') as unknown as AnyNode[];
    expect(nodes[0].type).toBe('bold');
    const inner = (nodes[0].children as unknown as AnyNode[]).find((n) => n.type === 'link') as unknown as AnyNode;
    expect(inner.refType).toBe('card');
    expect(inner.refId).toBe('abc-123');
  });

  it('неизвестный тип ссылки остаётся простым текстом', () => {
    const nodes = parseFormattedText('[[X|badtype:id]]') as unknown as AnyNode[];
    expect(nodes.every((n) => n.type === 'text')).toBe(true);
  });

  it('поддерживает uuid и slug в id', () => {
    const uuid = parseFormattedText('[[A|spell:1a2b-3c4d]]')[0] as unknown as AnyNode;
    expect(uuid.refId).toBe('1a2b-3c4d');
    const slug = parseFormattedText('[[B|concept:saving_throw]]')[0] as unknown as AnyNode;
    expect(slug.refId).toBe('saving_throw');
  });

  it('stripFormattingMarkers возвращает подпись ссылки', () => {
    expect(stripFormattingMarkers('см. [[Спасбросок|concept:saving_throw]] тут')).toBe('см. Спасбросок тут');
  });

  it('ссылка рядом с цветным токеном — обе конструкции парсятся', () => {
    const nodes = parseFormattedText('[fire]огонь[/fire] и [[Щит|spell:s1]]') as unknown as AnyNode[];
    expect(nodes.some((n) => n.type === 'color')).toBe(true);
    expect(nodes.some((n) => n.type === 'link')).toBe(true);
  });

  it('все пять типов сущностей распознаются', () => {
    for (const t of ['card', 'spell', 'action', 'effect', 'concept']) {
      const node = parseFormattedText(`[[X|${t}:id1]]`)[0] as unknown as AnyNode;
      expect(node.type).toBe('link');
      expect(node.refType).toBe(t);
    }
  });
});
