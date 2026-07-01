import { useState } from 'react';

type ForgeEntityIconProps = {
  imageUrl?: string | null;
  alt: string;
  size?: number;
};

const ForgeEntityIcon = ({ imageUrl, alt, size = 22 }: ForgeEntityIconProps) => {
  const [failed, setFailed] = useState(false);
  const url = imageUrl?.trim();

  if (!url || failed) {
    return (
      <span
        className="forge-entity-icon forge-entity-icon--placeholder"
        style={{ width: size, height: size, fontSize: size * 0.65 }}
        aria-hidden
      >
        ?
      </span>
    );
  }

  return (
    <img
      src={url}
      alt={alt}
      className="forge-entity-icon"
      style={{ width: size, height: size }}
      onError={() => setFailed(true)}
    />
  );
};

export default ForgeEntityIcon;
