import { useState, useRef, useCallback, type CSSProperties } from 'react';

interface UseCardTiltProps {
  maxTilt?: number;
  perspective?: number;
  liftPx?: number;
  hoverScale?: number;
  enabled?: boolean;
}

export const useCardTilt = ({
  maxTilt = 14,
  perspective = 1200,
  liftPx = 28,
  hoverScale = 1.03,
  enabled = true,
}: UseCardTiltProps = {}) => {
  const [tiltStyle, setTiltStyle] = useState<CSSProperties>({
    transformStyle: 'preserve-3d',
  });
  const [isHovered, setIsHovered] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!enabled || !cardRef.current) return;

      const rect = cardRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const centerX = rect.width / 2;
      const centerY = rect.height / 2;

      const rotateX = ((y - centerY) / centerY) * -maxTilt;
      const rotateY = ((x - centerX) / centerX) * maxTilt;

      setTiltStyle({
        transformStyle: 'preserve-3d',
        transform: `perspective(${perspective}px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateZ(${liftPx}px) scale(${hoverScale})`,
        transition: 'transform 0.08s ease-out',
      });
    },
    [enabled, maxTilt, perspective, liftPx, hoverScale]
  );

  const handleMouseEnter = useCallback(() => {
    if (enabled) setIsHovered(true);
  }, [enabled]);

  const handleMouseLeave = useCallback(() => {
    setIsHovered(false);
    setTiltStyle({
      transformStyle: 'preserve-3d',
      transform: `perspective(${perspective}px) rotateX(0deg) rotateY(0deg) translateZ(0px) scale(1)`,
      transition: 'transform 0.45s ease-out',
    });
  }, [perspective]);

  return {
    cardRef,
    tiltStyle,
    isHovered,
    handleMouseMove,
    handleMouseEnter,
    handleMouseLeave,
  };
};
