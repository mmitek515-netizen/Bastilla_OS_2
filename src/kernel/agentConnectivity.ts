export function getAgentConnectivity(
  runtimeStatus: unknown,
  probeFailed = false,
) {
  const runtime = probeFailed
    ? 'unknown'
    : runtimeStatus === 'online'
      ? 'available'
      : runtimeStatus === 'offline' || runtimeStatus === 'no-models'
        ? runtimeStatus
        : 'unknown';

  return {
    sourceApi: 'not_connected' as const,
    runtime,
  };
}
