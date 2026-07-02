import type { Card } from '../types';

const registry = new Map<string, Card>();

export function registerCard(card: Card): void {
  registry.set(card.id, card);
}

export function getCard(id: string): Card | undefined {
  return registry.get(id);
}

export function getCards(ids: Iterable<string | null | undefined>): Card[] {
  const out: Card[] = [];
  for (const id of ids) {
    if (!id) continue;
    const c = registry.get(id);
    if (c) out.push(c);
  }
  return out;
}

export function clearCardRegistry(): void {
  registry.clear();
}
