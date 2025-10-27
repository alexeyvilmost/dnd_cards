import { useState, useRef, useCallback } from 'react';

interface UseCardTiltProps {
  maxTilt?: number;
  perspective?: number;
  isLarge?: boolean;
}

export const useCardTilt = ({ maxTilt = 10, perspective = 1000, isLarge = false }: UseCardTiltProps = {}) => {
  const [tiltStyle, setTiltStyle] = useState({});
  const cardRef = useRef<HTMLDivElement>(null);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!cardRef.current) return;

    // Фиксированный наклон карточки относительно центра
    // Небольшой наклон для создания 3D эффекта
    const rotateX = -5; // Небольшой наклон по X
    const rotateY = 5;  // Небольшой наклон по Y

    setTiltStyle({
      transform: `perspective(${perspective}px) rotateX(${rotateX}deg) rotateY(${rotateY}deg)${isLarge ? ' scale(1.5)' : ''}`,
    });
  }, [maxTilt, perspective, isLarge]);

  const handleMouseLeave = useCallback(() => {
    setTiltStyle({
      transform: `perspective(1000px) rotateX(0deg) rotateY(0deg)${isLarge ? ' scale(1.5)' : ''}`,
    });
  }, [isLarge]);

  return {
    cardRef,
    tiltStyle,
    handleMouseMove,
    handleMouseLeave,
  };
};
