import { useState } from 'react';

type ForgeEntityIconProps = {
  imageUrl?: string | null;
  alt: string;
  size?: number;
  className?: string;
  /** Заполнить контейнер целиком (квадрат плитки) вместо фиксированного size. */
  fill?: boolean;
};

const ForgeEntityIcon = ({ imageUrl, alt, size = 22, className = '', fill = false }: ForgeEntityIconProps) => {
  const [failed, setFailed] = useState(false);
  const url = imageUrl?.trim();
  const cls = (base: string) => `${base}${fill ? ' forge-entity-icon--fill' : ''}${className ? ` ${className}` : ''}`;

  if (!url || failed) {
    return (
      <span
        className={cls('forge-entity-icon forge-entity-icon--placeholder')}
        style={fill ? { fontSize: size * 0.65 } : { width: size, height: size, fontSize: size * 0.65 }}
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
      className={cls('forge-entity-icon')}
      style={fill ? undefined : { width: size, height: size }}
      onError={() => setFailed(true)}
    />
  );
};

export default ForgeEntityIcon;
