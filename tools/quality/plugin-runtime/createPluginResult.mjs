export function createPluginResult(id, findings, startedAt = Date.now(), extra = {}) {
  return {
    id,
    status: findings.some((finding) => finding.severity === 'error') ? 'failed' : 'passed',
    durationMs: Date.now() - startedAt,
    findings,
    ...extra
  };
}
