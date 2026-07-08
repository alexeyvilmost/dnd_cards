import { useState, type ReactNode } from 'react';

type EntitySquareCardProps = {
  name: string;
  imageUrl?: string | null;
  selected?: boolean;
  onClick?: () => void;
  preview?: ReactNode;
  /** Визуально недоступен (напр. неповторяемая черта уже действует). Превью при наведении
   *  сохраняется (парадигма «превью везде, даже при disabled»); клик блокируется. */
  disabled?: boolean;
  disabledReason?: string;
};

const EntitySquareCard = ({ name, imageUrl, selected, onClick, preview, disabled, disabledReason }: EntitySquareCardProps) => {
  const [failed, setFailed] = useState(false);
  const [hover, setHover] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const url = imageUrl?.trim();
  const showImage = url && !failed;
  const longName = name.length > 12;

  const onEnter = (e: React.MouseEvent) => {
    if (preview) {
      setHover(true);
      setPos({ x: e.clientX, y: e.clientY });
    }
  };

  return (
    <>
      <button
        type="button"
        className={`forge-square-card ${selected ? 'selected' : ''}${disabled ? ' disabled' : ''}`}
        style={disabled ? { opacity: 0.4, filter: 'grayscale(1)' } : undefined}
        title={disabled ? disabledReason : undefined}
        onClick={disabled ? undefined : onClick}
        onMouseEnter={onEnter}
        onMouseLeave={() => setHover(false)}
        onMouseMove={(e) => preview && setPos({ x: e.clientX, y: e.clientY })}
      >
        <div className="forge-square-card-media">
          {showImage ? (
            <img src={url} alt={name} onError={() => setFailed(true)} />
          ) : (
            <span className="forge-square-card-placeholder">?</span>
          )}
        </div>
        <span className={`forge-square-card-label${longName ? ' long' : ''}`}>{name}</span>
      </button>
      {hover && preview && (
        <div
          className="forge-entity-preview-pop"
          style={{
            left: Math.min(pos.x + 16, window.innerWidth - 340),
            top: Math.min(Math.max(pos.y - 40, 10), window.innerHeight - 20),
            transform: pos.y > window.innerHeight / 2 ? 'translateY(-100%)' : 'translateY(0)',
          }}
        >
          {preview}
        </div>
      )}
    </>
  );
};

export default EntitySquareCard;
