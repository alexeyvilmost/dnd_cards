import { Link } from 'react-router-dom';

/** Describe the production boundary: browser preview, server-owned shared state. */
export default function SheetAuthorityNotice() {
  return (
    <aside
      className="sheet-authority-notice"
      aria-label="Режим исполнения правил"
      data-testid="sheet-authority-notice"
    >
      <span>
        <strong>Сервер — источник правил</strong>
        {' · '}
        взаимодействия листов подтверждаются сервером, локальный расчёт — предварительный
      </span>
      <span aria-hidden="true">·</span>
      <Link to="/rules-lab">Изолированная сценарная проверка — Rules Session Lab</Link>
    </aside>
  );
}
