import { Component, Suspense, type ReactNode } from 'react';
import DialogShell from './DialogShell';

type Props = { label: string; onCancel: () => void; children: ReactNode };

/** Loading a dialog cannot apply a choice or consume a roll. Cancel stays
 * available while its code loads and after a failed chunk download. */
class DialogLoadBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed ? <DialogShell label={this.props.label} onCancel={this.props.onCancel}>
      <p role="alert">Не удалось открыть окно. Закройте его и обновите страницу, чтобы повторить.</p>
      <button type="button" className="dice-dialog-btn ghost" onClick={this.props.onCancel}>Отмена</button>
    </DialogShell> : this.props.children;
  }
}

export default function DeferredDialog(props: Props) {
  return <DialogLoadBoundary {...props}>
    <Suspense fallback={<DialogShell label={props.label} onCancel={props.onCancel}>
      <p role="status">Открываем окно…</p>
      <button type="button" className="dice-dialog-btn ghost" onClick={props.onCancel}>Отмена</button>
    </DialogShell>}>{props.children}</Suspense>
  </DialogLoadBoundary>;
}
