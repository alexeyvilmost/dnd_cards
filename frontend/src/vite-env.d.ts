/// <reference types="vite/client" />

import '@vitest/runner';

declare module '@vitest/runner' {
  interface TaskMeta {
    semanticProtocol?: string;
    scenarioId?: string;
    basicPrimitive?: 'attack' | 'resource_spend' | 'saving_throw' | 'ability_check';
    evidenceKind?: string;
  }
}
