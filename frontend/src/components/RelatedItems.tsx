import { previewAnchor } from '../utils/previewAnchor';
import { useEffect, useState } from 'react';
import type { Card, CardRef } from '../types';
import { getCardsIndex } from '../utils/cardsIndex';
import { containerTotals } from '../utils/containerTotals';
import { useOptionalAuth } from '../contexts/AuthContext';
import { readPersistedAuthToken } from '../api/authSession';
import CardPreview from './CardPreview';

const EMPTY_INDEX = new Map<string, Card>();

function useNeededCardsIndex(needed: boolean): Map<string, Card> {
  const auth = useOptionalAuth();
  const identity = auth ? auth.token : readPersistedAuthToken();
  const [snapshot, setSnapshot] = useState<{ identity: string | null; index: Map<string, Card> } | null>(null);
  useEffect(() => {
    if (!needed) { setSnapshot(null); return; }
    let alive = true;
    // An earlier index is never shown while revalidating a new set of refs.
    setSnapshot(null);
    const requestedIdentity = readPersistedAuthToken();
    void getCardsIndex().then(index => {
      if (alive && requestedIdentity === readPersistedAuthToken() && requestedIdentity === identity) {
        setSnapshot({ identity, index });
      }
    });
    return () => { alive = false; };
  }, [needed, identity]);
  return needed && snapshot?.identity === identity ? snapshot.index : EMPTY_INDEX;
}

/** S6 контейнеры: суммарные вес (фунты) и цена (ЗМ) содержимого контейнера, деривация над card.contents
 *  через общий индекс карт (рекурсия+cycle-guard). null — если карта не контейнер / без содержимого. */
export function useContainerTotals(card: Card | null | undefined): { weight: number; gold: number } | null {
  const hasContents = Array.isArray(card?.contents) && card.contents.length > 0;
  const index = useNeededCardsIndex(hasContents);
  if (!card || !hasContents) return null;
  return containerTotals(card, (id) => index.get(id));
}

/** Резолвит CardRef[] в пары {ref, card} по общему индексу карт (нерезолвленные отбрасываются). */
export function useResolvedRefs(refs: CardRef[]) {
  const hasRefs = refs.length > 0;
  const index = useNeededCardsIndex(hasRefs);
  return refs
    .map((r) => ({ ref: r, card: index.get(r.card_id) }))
    .filter((x): x is { ref: CardRef; card: Card } => !!x.card);
}

// Ряд иконок привязанных предметов (для нижней части карточки предыстории)
export const ItemIconRow: React.FC<{ refs: CardRef[]; size?: number }> = ({ refs, size = 22 }) => {
  const resolved = useResolvedRefs(refs);
  if (resolved.length === 0) return null;
  return (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
      {resolved.map(({ ref, card }) => (
        <div key={ref.card_id} aria-description={card.name} style={{ position: 'relative', flex: '0 0 auto' }}>
          <img
            src={card.image_url || '/default_image.png'}
            alt={card.name}
            style={{ width: size, height: size, objectFit: 'contain' }}
            onError={(e) => ((e.target as HTMLImageElement).src = '/default_image.png')}
          />
          {ref.quantity > 1 && (
            <span style={{
              position: 'absolute', bottom: -3, right: -3, fontSize: 9, lineHeight: '12px',
              minWidth: 12, height: 12, padding: '0 2px', borderRadius: 6,
              background: '#1a1410', color: '#e7cf9a', textAlign: 'center', fontWeight: 700,
            }}>{ref.quantity}</span>
          )}
        </div>
      ))}
    </div>
  );
};

// Список «Связанные карты» с превью предмета при наведении на название
export const RelatedCardsList: React.FC<{ refs: CardRef[]; title?: string }> = ({
  refs,
  title = 'Связанные карты',
}) => {
  const resolved = useResolvedRefs(refs);
  const [hovered, setHovered] = useState<Card | null>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });

  if (resolved.length === 0) return null;

  return (
    <div>
      <h4 className="text-sm font-semibold text-gray-700 mb-2">{title}</h4>
      <ul className="space-y-1">
        {resolved.map(({ ref, card }) => (
          <li key={ref.card_id}>
            <span
              className="text-sm text-blue-700 hover:underline cursor-help"
              onMouseEnter={(e) => { setHovered(card); setPos(previewAnchor(e.currentTarget)); }}
              onMouseLeave={() => setHovered(null)}
            >
              {card.name}{ref.quantity > 1 ? ` ×${ref.quantity}` : ''}
            </span>
          </li>
        ))}
      </ul>

      {hovered && (
        <div
          className="entity-preview-enter"
          style={{
            position: 'fixed',
            left: Math.min(pos.x + 16, window.innerWidth - 220),
            top: Math.min(pos.y + 16, window.innerHeight - 300),
            zIndex: 1000,
            pointerEvents: 'none',
          }}
        >
          <CardPreview card={hovered} disableHover />
        </div>
      )}
    </div>
  );
};
