const USAGE_API_URL = "https://api.anthropic.com/api/oauth/usage";
const TIMEOUT_MS = 10_000;
const SLEEP_CHECK_INTERVAL_MS = 30_000;
const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

/** API response structure from the Anthropic OAuth usage endpoint */
interface UsageApiResponse {
  five_hour: { utilization: number; resets_at: string };
  seven_day: { utilization: number; resets_at: string };
}

/** Result of checking usage limits */
export interface UsageLimitResult {
  limited: boolean;
  limitType?: "5h" | "7d";
  utilization?: number;
  retryAfter?: number;
  resetsAt?: string;
}

/**
 * Checks Claude API usage limits via the Anthropic OAuth API.
 *
 * Queries GET https://api.anthropic.com/api/oauth/usage with the given
 * bearer token. Returns { limited: false } when no limits are hit.
 * Returns structured limit info when 5-hour or 7-day utilization >= 100.
 *
 * On any error (network, auth, parse), assumes not limited and logs a warning.
 */
export async function checkUsageLimit(token: string): Promise<UsageLimitResult> {
  try {
    const response = await fetch(USAGE_API_URL, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "anthropic-beta": "oauth-2025-04-20",
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!response.ok) {
      console.warn(`[rauf] Usage API returned ${response.status}: ${response.statusText}`);
      return { limited: false };
    }

    const data = (await response.json()) as UsageApiResponse;

    // Check 7-day weekly limit first (longer recovery)
    if (data.seven_day && data.seven_day.utilization >= 100) {
      const resetsAt = data.seven_day.resets_at;
      return {
        limited: true,
        limitType: "7d",
        utilization: data.seven_day.utilization,
        retryAfter: computeRetryAfter(resetsAt),
        resetsAt,
      };
    }

    // Check 5-hour limit
    if (data.five_hour && data.five_hour.utilization >= 100) {
      const resetsAt = data.five_hour.resets_at;
      return {
        limited: true,
        limitType: "5h",
        utilization: data.five_hour.utilization,
        retryAfter: computeRetryAfter(resetsAt),
        resetsAt,
      };
    }

    return { limited: false };
  } catch (e) {
    console.warn(`[rauf] Usage API check failed: ${e instanceof Error ? e.message : String(e)}`);
    return { limited: false };
  }
}

/** Computes seconds until the given ISO timestamp, minimum 0 */
function computeRetryAfter(resetsAt: string): number {
  const resetTime = new Date(resetsAt).getTime();
  const now = Date.now();
  return Math.max(0, Math.ceil((resetTime - now) / 1000));
}

/**
 * A sleep that can be cancelled via AbortController signal.
 *
 * Checks the abort signal every ~30 seconds rather than just at start.
 * If onHeartbeat callback is provided, calls it every ~5 minutes during
 * sleep (used by the runner to update state.json updatedAt to prevent
 * staleness detection).
 *
 * Resolves after durationMs milliseconds, or resolves early when the
 * abort signal fires.
 */
export function interruptibleSleep(
  durationMs: number,
  signal: AbortSignal,
  onHeartbeat?: () => void,
): Promise<void> {
  return new Promise<void>((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }

    const startTime = Date.now();
    const timers: {
      check?: ReturnType<typeof setInterval>;
      heartbeat?: ReturnType<typeof setInterval>;
      main?: ReturnType<typeof setTimeout>;
    } = {};

    function cleanup() {
      if (timers.check !== undefined) clearInterval(timers.check);
      if (timers.heartbeat !== undefined) clearInterval(timers.heartbeat);
      if (timers.main !== undefined) clearTimeout(timers.main);
      signal.removeEventListener("abort", onAbort);
    }

    function onAbort() {
      cleanup();
      resolve();
    }

    signal.addEventListener("abort", onAbort);

    // Main timeout for the full duration
    timers.main = setTimeout(() => {
      cleanup();
      resolve();
    }, durationMs);

    // Check abort signal every ~30 seconds
    timers.check = setInterval(() => {
      if (signal.aborted) {
        cleanup();
        resolve();
        return;
      }
      // Also check if we've exceeded duration (defensive)
      if (Date.now() - startTime >= durationMs) {
        cleanup();
        resolve();
      }
    }, SLEEP_CHECK_INTERVAL_MS);

    // Call heartbeat every ~5 minutes if provided
    if (onHeartbeat) {
      timers.heartbeat = setInterval(() => {
        if (!signal.aborted) {
          onHeartbeat();
        }
      }, HEARTBEAT_INTERVAL_MS);
    }
  });
}
