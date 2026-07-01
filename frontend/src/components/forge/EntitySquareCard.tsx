import { useState } from 'react';

type EntitySquareCardProps = {
  name: string;
  imageUrl?: string | null;
  selected?: boolean;
  onClick?: () => void;
};

const EntitySquareCard = ({ name, imageUrl, selected, onClick }: EntitySquareCardProps) => {
  const [failed, setFailed] = useState(false);
  const url = imageUrl?.trim();
  const showImage = url && !failed;

  return (
    <button
      type="button"
      className={`forge-square-card ${selected ? 'selected' : ''}`}
      onClick={onClick}
    >
      <div className="forge-square-card-media">
        {showImage ? (
          <img src={url} alt={name} onError={() => setFailed(true)} />
        ) : (
          <span className="forge-square-card-placeholder">?</span>
        )}
      </div>
      <span className="forge-square-card-label">{name}</span>
    </button>
  );
};

export default EntitySquareCard;
