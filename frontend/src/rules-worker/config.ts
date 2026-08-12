export function resolveRulesWorkerPort(
  environment: Readonly<Record<string, string | undefined>>,
): number {
  return Number.parseInt(environment.RULES_WORKER_PORT ?? environment.PORT ?? '9090', 10);
}
