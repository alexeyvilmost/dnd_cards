import type { ValueBreakdown } from '../mvp/contracts';
import '../contexts/DiceDialog.css';

// Виды перемещения PHB 2024: ходьба, полёт, плавание, лазание, копание.
const MODE_LABEL: Record<string, string> = {
  walk: 'Ходьба', fly: 'Полёт', swim: 'Плавание', climb: 'Лазание', burrow: 'Копание',
};
const MODE_ICON: Record<string, string> = {
  walk: '🚶', fly: '🕊️', swim: '🏊', climb: '🧗', burrow: '⛏️',
};
const rowStyle: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' };
const valStyle: React.CSSProperties = { color: '#d8b978', fontWeight: 700 };

/**
 * Информативный диалог всех скоростей перемещения персонажа (по клику на «Скорость»).
 * Ходьба — с разбивкой (база + прибавки); особые режимы (полёт/плавание/лазание/копание) —
 * из ruleState.speeds. Пока чисто информативно; в будущем — интеграция с боевым перемещением.
 */
export default function SheetSpeedDialog({
  speed, speedBreakdown, speeds, onClose,
}: {
  speed: number;
  speedBreakdown?: ValueBreakdown | null;
  speeds: Record<string, number>;
  onClose: () => void;
}) {
  const special = Object.entries(speeds).filter(([, v]) => v > 0);
  return (
    <div className="dice-dialog-backdrop" onClick={onClose}>
      <div className="dice-dialog-wrap" onClick={(e) => e.stopPropagation()}>
        <div className="dice-dialog" role="dialog" aria-label="Скорости перемещения">
          <div className="dice-dialog-title">Скорости перемещения</div>
          <div className="dice-dialog-summary">Все виды перемещения персонажа.</div>
          <div className="dice-dialog-list">
            <div style={rowStyle}>
              <span>{MODE_ICON.walk} Ходьба</span>
              <strong style={valStyle}>{speed} фт</strong>
            </div>
            {speedBreakdown && speedBreakdown.parts.length > 0 && (
              <ul style={{ margin: '0 0 4px 22px', padding: 0, listStyle: 'none', fontSize: 12, color: '#a99f8b' }}>
                {speedBreakdown.parts.map((p, i) => (
                  <li key={`${p.source}-${i}`} style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>{p.source}</span>
                    <span>{p.value >= 0 ? '+' : ''}{p.value} фт</span>
                  </li>
                ))}
              </ul>
            )}
            {special.map(([mode, v]) => (
              <div key={mode} style={rowStyle}>
                <span>{MODE_ICON[mode] ?? '•'} {MODE_LABEL[mode] ?? mode}</span>
                <strong style={valStyle}>{v} фт</strong>
              </div>
            ))}
          </div>
          {special.length === 0 && (
            <p className="dice-dialog-note">Особых скоростей (полёт / плавание / лазание / копание) нет.</p>
          )}
          <p className="dice-dialog-note">
            Без соответствующей скорости лазание и плавание расходуют вдвое больше перемещения.
            Пока информативно — в бою будет учитываться при движении.
          </p>
          <div className="dice-dialog-actions">
            <button type="button" className="dice-dialog-btn primary" onClick={onClose}>Закрыть</button>
          </div>
        </div>
      </div>
    </div>
  );
}
