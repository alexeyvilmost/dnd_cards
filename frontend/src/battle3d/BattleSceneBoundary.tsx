import {Component, type ErrorInfo, type ReactNode} from 'react';

/** Graphics cannot prevent the player from using the existing battle. */
export default class BattleSceneBoundary extends Component<{
  children: ReactNode;
  onUnavailable: (reason: string) => void;
}, {failed: boolean}> {
  state = {failed: false};
  static getDerivedStateFromError() { return {failed: true}; }
  componentDidCatch(_error: Error, _info: ErrorInfo) {
    this.props.onUnavailable('Не удалось открыть 3D-поле.');
  }
  render() { return this.state.failed ? null : this.props.children; }
}
