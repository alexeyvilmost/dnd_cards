import type { RulesWorkerExecuteRequest, RulesWorkerExecuteResponse } from '../../src/rules-worker/execute';

export function executeRulesWorkerRequest(
  request: RulesWorkerExecuteRequest,
): Promise<RulesWorkerExecuteResponse>;
