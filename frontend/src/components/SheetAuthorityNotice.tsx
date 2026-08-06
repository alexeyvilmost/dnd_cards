import { Link } from 'react-router-dom';

/**
 * The production sheet executes rules in the browser and persists the resulting
 * projection. Keep that semantic-authority boundary visible until the same
 * pinned rules artifact is executed and validated by a shared command worker.
 */
export default function SheetAuthorityNotice() {
  return (
    <aside
      className="sheet-authority-notice"
      aria-label="Режим исполнения правил"
      data-testid="sheet-authority-notice"
    >
      <span><strong>Локальный движок правил</strong> · результат сохраняется в листе или бою</span>
      <span aria-hidden="true">·</span>
      <Link to="/rules-lab">Изолированная сценарная проверка — Rules Session Lab</Link>
    </aside>
  );
}
