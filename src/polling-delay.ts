const MAX_RETRY_DELAY_SECONDS = 3_600;
const MAX_BACKOFF_EXPONENT = 7;

export function nextPollDelaySeconds(
  pollIntervalSeconds: number,
  consecutiveFailures: number,
): number {
  if (consecutiveFailures <= 0) return pollIntervalSeconds;

  const multiplier = 2 ** Math.min(consecutiveFailures, MAX_BACKOFF_EXPONENT);
  const maxDelaySeconds = Math.max(
    pollIntervalSeconds,
    MAX_RETRY_DELAY_SECONDS,
  );
  return Math.min(
    pollIntervalSeconds * multiplier,
    maxDelaySeconds,
  );
}
