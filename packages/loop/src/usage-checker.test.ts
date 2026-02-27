import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { checkUsageLimit, interruptibleSleep } from "./usage-checker.js";

// ─── checkUsageLimit ────────────────────────────────────────────

describe("checkUsageLimit", () => {
  const originalFetch = globalThis.fetch;
  const originalWarn = console.warn;

  beforeEach(() => {
    console.warn = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    console.warn = originalWarn;
  });

  it("sends correct request with Authorization and anthropic-beta headers", async () => {
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;

    globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      capturedUrl = String(url);
      capturedInit = init;
      return new Response(
        JSON.stringify({
          five_hour: { utilization: 50, resets_at: "2026-02-28T00:00:00Z" },
          seven_day: { utilization: 30, resets_at: "2026-03-05T00:00:00Z" },
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    await checkUsageLimit("test-token-123");

    expect(capturedUrl).toBe("https://api.anthropic.com/api/oauth/usage");
    expect(capturedInit?.method).toBe("GET");
    expect((capturedInit?.headers as Record<string, string>)["Authorization"]).toBe(
      "Bearer test-token-123",
    );
    expect((capturedInit?.headers as Record<string, string>)["anthropic-beta"]).toBe(
      "oauth-2025-04-20",
    );
  });

  it("uses a 10-second timeout via AbortSignal", async () => {
    let capturedSignal: AbortSignal | undefined;

    globalThis.fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      capturedSignal = init?.signal as AbortSignal | undefined;
      return new Response(
        JSON.stringify({
          five_hour: { utilization: 50, resets_at: "2026-02-28T00:00:00Z" },
          seven_day: { utilization: 30, resets_at: "2026-03-05T00:00:00Z" },
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    await checkUsageLimit("token");

    expect(capturedSignal).toBeDefined();
    // AbortSignal.timeout returns a signal — we verify it exists
    expect(capturedSignal!.aborted).toBe(false);
  });

  it("returns { limited: false } when no limits detected", async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          five_hour: { utilization: 50, resets_at: "2026-02-28T00:00:00Z" },
          seven_day: { utilization: 30, resets_at: "2026-03-05T00:00:00Z" },
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    const result = await checkUsageLimit("token");
    expect(result).toEqual({ limited: false });
  });

  it("detects 5-hour limit when five_hour.utilization >= 100", async () => {
    const resetsAt = "2026-02-27T20:00:00Z";
    globalThis.fetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          five_hour: { utilization: 100, resets_at: resetsAt },
          seven_day: { utilization: 50, resets_at: "2026-03-05T00:00:00Z" },
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    const result = await checkUsageLimit("token");
    expect(result.limited).toBe(true);
    expect(result.limitType).toBe("5h");
    expect(result.utilization).toBe(100);
    expect(result.resetsAt).toBe(resetsAt);
    expect(result.retryAfter).toBeTypeOf("number");
  });

  it("detects 5-hour limit when utilization exceeds 100", async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          five_hour: { utilization: 150, resets_at: "2026-02-27T20:00:00Z" },
          seven_day: { utilization: 50, resets_at: "2026-03-05T00:00:00Z" },
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    const result = await checkUsageLimit("token");
    expect(result.limited).toBe(true);
    expect(result.limitType).toBe("5h");
    expect(result.utilization).toBe(150);
  });

  it("detects 7-day limit when seven_day.utilization >= 100", async () => {
    const resetsAt = "2026-03-05T00:00:00Z";
    globalThis.fetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          five_hour: { utilization: 50, resets_at: "2026-02-28T00:00:00Z" },
          seven_day: { utilization: 100, resets_at: resetsAt },
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    const result = await checkUsageLimit("token");
    expect(result.limited).toBe(true);
    expect(result.limitType).toBe("7d");
    expect(result.utilization).toBe(100);
    expect(result.resetsAt).toBe(resetsAt);
    expect(result.retryAfter).toBeTypeOf("number");
  });

  it("prioritizes 7-day limit over 5-hour when both are hit", async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          five_hour: { utilization: 100, resets_at: "2026-02-27T20:00:00Z" },
          seven_day: { utilization: 100, resets_at: "2026-03-05T00:00:00Z" },
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    const result = await checkUsageLimit("token");
    expect(result.limited).toBe(true);
    expect(result.limitType).toBe("7d");
  });

  it("computes retryAfter as seconds until reset time", async () => {
    const futureTime = new Date(Date.now() + 3600 * 1000).toISOString(); // 1 hour from now
    globalThis.fetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          five_hour: { utilization: 100, resets_at: futureTime },
          seven_day: { utilization: 50, resets_at: "2026-03-05T00:00:00Z" },
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    const result = await checkUsageLimit("token");
    expect(result.retryAfter).toBeGreaterThan(3500);
    expect(result.retryAfter).toBeLessThanOrEqual(3600);
  });

  it("retryAfter is 0 when reset time is in the past", async () => {
    const pastTime = new Date(Date.now() - 60_000).toISOString();
    globalThis.fetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          five_hour: { utilization: 100, resets_at: pastTime },
          seven_day: { utilization: 50, resets_at: "2026-03-05T00:00:00Z" },
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    const result = await checkUsageLimit("token");
    expect(result.retryAfter).toBe(0);
  });

  it("returns { limited: false } on network error", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("Network error: ECONNREFUSED");
    }) as typeof fetch;

    const result = await checkUsageLimit("token");
    expect(result).toEqual({ limited: false });
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("Usage API check failed"));
  });

  it("returns { limited: false } on HTTP error status", async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response("Unauthorized", { status: 401, statusText: "Unauthorized" });
    }) as typeof fetch;

    const result = await checkUsageLimit("token");
    expect(result).toEqual({ limited: false });
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("401"));
  });

  it("returns { limited: false } on 500 server error", async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response("Internal Server Error", {
        status: 500,
        statusText: "Internal Server Error",
      });
    }) as typeof fetch;

    const result = await checkUsageLimit("token");
    expect(result).toEqual({ limited: false });
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("500"));
  });

  it("returns { limited: false } on malformed JSON response", async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response("not json", { status: 200 });
    }) as typeof fetch;

    const result = await checkUsageLimit("token");
    expect(result).toEqual({ limited: false });
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("Usage API check failed"));
  });

  it("returns { limited: false } when utilization is exactly 99", async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          five_hour: { utilization: 99, resets_at: "2026-02-28T00:00:00Z" },
          seven_day: { utilization: 99, resets_at: "2026-03-05T00:00:00Z" },
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    const result = await checkUsageLimit("token");
    expect(result).toEqual({ limited: false });
  });
});

// ─── interruptibleSleep ─────────────────────────────────────────

describe("interruptibleSleep", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves after specified duration", async () => {
    const ac = new AbortController();
    let resolved = false;

    const promise = interruptibleSleep(100, ac.signal).then(() => {
      resolved = true;
    });

    expect(resolved).toBe(false);
    await vi.advanceTimersByTimeAsync(99);
    expect(resolved).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(resolved).toBe(true);

    await promise;
  });

  it("resolves immediately when signal is already aborted", async () => {
    const ac = new AbortController();
    ac.abort();

    let resolved = false;
    const promise = interruptibleSleep(60_000, ac.signal).then(() => {
      resolved = true;
    });

    // Should resolve synchronously (in the microtask queue)
    await promise;
    expect(resolved).toBe(true);
  });

  it("resolves early when abort signal fires mid-sleep", async () => {
    const ac = new AbortController();
    let resolved = false;

    const promise = interruptibleSleep(60_000, ac.signal).then(() => {
      resolved = true;
    });

    expect(resolved).toBe(false);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(resolved).toBe(false);

    ac.abort();
    // Need to yield for the abort event listener to fire
    await vi.advanceTimersByTimeAsync(0);

    expect(resolved).toBe(true);
    await promise;
  });

  it("checks abort signal every ~30 seconds", async () => {
    const ac = new AbortController();
    let resolved = false;

    const promise = interruptibleSleep(120_000, ac.signal).then(() => {
      resolved = true;
    });

    // Advance 29 seconds — still sleeping
    await vi.advanceTimersByTimeAsync(29_000);
    expect(resolved).toBe(false);

    // Advance to 30 seconds — check interval fires, not aborted so continues
    await vi.advanceTimersByTimeAsync(1_000);
    expect(resolved).toBe(false);

    // Advance to 60 seconds — another check
    await vi.advanceTimersByTimeAsync(30_000);
    expect(resolved).toBe(false);

    // Full duration
    await vi.advanceTimersByTimeAsync(60_000);
    expect(resolved).toBe(true);

    await promise;
  });

  it("calls onHeartbeat every ~5 minutes", async () => {
    const ac = new AbortController();
    const heartbeat = vi.fn();

    const promise = interruptibleSleep(20 * 60 * 1000, ac.signal, heartbeat);

    // No heartbeat yet
    expect(heartbeat).not.toHaveBeenCalled();

    // Advance 5 minutes — first heartbeat
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(heartbeat).toHaveBeenCalledTimes(1);

    // Advance 5 more minutes — second heartbeat
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(heartbeat).toHaveBeenCalledTimes(2);

    // Advance 5 more minutes — third heartbeat
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(heartbeat).toHaveBeenCalledTimes(3);

    // Advance remaining 5 minutes — sleep completes (main timeout fires,
    // cleanup runs, so no 4th heartbeat even though intervals align)
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(heartbeat).toHaveBeenCalledTimes(3);

    await promise;
  });

  it("does not call onHeartbeat when not provided", async () => {
    const ac = new AbortController();

    const promise = interruptibleSleep(100, ac.signal);
    await vi.advanceTimersByTimeAsync(100);
    await promise;
    // Just verify no errors — no heartbeat to check
  });

  it("stops heartbeat callbacks after abort", async () => {
    const ac = new AbortController();
    const heartbeat = vi.fn();

    const promise = interruptibleSleep(30 * 60 * 1000, ac.signal, heartbeat);

    // Advance 5 minutes — first heartbeat
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(heartbeat).toHaveBeenCalledTimes(1);

    // Abort
    ac.abort();
    await vi.advanceTimersByTimeAsync(0);

    // Advance 10 more minutes — no more heartbeats
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(heartbeat).toHaveBeenCalledTimes(1);

    await promise;
  });

  it("cleans up all timers after completion", async () => {
    const ac = new AbortController();

    const promise = interruptibleSleep(100, ac.signal);
    await vi.advanceTimersByTimeAsync(100);
    await promise;

    // After completion, advancing time should not cause issues
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cleans up all timers after abort", async () => {
    const ac = new AbortController();
    const heartbeat = vi.fn();

    const promise = interruptibleSleep(60_000, ac.signal, heartbeat);
    ac.abort();
    await vi.advanceTimersByTimeAsync(0);
    await promise;

    expect(vi.getTimerCount()).toBe(0);
  });

  it("handles zero-duration sleep", async () => {
    const ac = new AbortController();
    let resolved = false;

    const promise = interruptibleSleep(0, ac.signal).then(() => {
      resolved = true;
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(resolved).toBe(true);
    await promise;
  });
});
