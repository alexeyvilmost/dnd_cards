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

    const card = cardRef.current;
    const rect = card.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    
    const mouseX = e.clientX - centerX;
    const mouseY = e.clientY - centerY;
    
    const rotateX = (mouseY / (rect.height / 2)) * -maxTilt;
    const rotateY = (mouseX / (rect.width / 2)) * maxTilt;

    setTiltStyle({
      transform: `perspective(${perspective}px) rotateX(${rotateX}deg) rotateY(${rotateY}deg)${isLarge ? ' scale(1.5)' : ''}`,
    });
  }, [maxTilt, perspective]);

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
