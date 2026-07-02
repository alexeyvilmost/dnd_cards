import { useEffect, useState } from 'react';
import './RollFlash.css';

interface RollFlashProps {
  value: number;
  sides?: number;
  /** Ключ меняется при новом броске — перезапуск анимации. */
  flashKey: string | number;
}

/** Краткая анимация выпавшего значения кости. */
export default function RollFlash({ value, sides = 20, flashKey }: RollFlashProps) {
  const [rolling, setRolling] = useState(true);
  const [display, setDisplay] = useState(value);

  useEffect(() => {
    setRolling(true);
    let frame = 0;
    const ticks = 12;
    const id = window.setInterval(() => {
      frame += 1;
      if (frame < ticks) {
        setDisplay(Math.floor(Math.random() * sides) + 1);
      } else {
        setDisplay(value);
        setRolling(false);
        window.clearInterval(id);
      }
    }, 45);
    return () => window.clearInterval(id);
  }, [flashKey, value, sides]);

  return (
    <span className={`roll-flash ${rolling ? 'roll-flash--rolling' : ''}`} aria-label={`к${sides}: ${display}`}>
      {display}
    </span>
  );
}
