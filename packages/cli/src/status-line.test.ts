import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { StatusLine, formatElapsed } from "./status-line.js";

// ─── Helpers ────────────────────────────────────────────────────────

/** Capture process.stdout.write calls */
function captureWrites() {
  const writes: string[] = [];
  const orig = process.stdout.write;
  process.stdout.write = ((chunk: string) => {
    writes.push(chunk);
    return true;
  }) as typeof process.stdout.write;
  return {
    writes,
    restore: () => {
      process.stdout.write = orig;
    },
  };
}

// ─── formatElapsed ──────────────────────────────────────────────────

describe("formatElapsed", () => {
  it("formats seconds", () => {
    expect(formatElapsed(0)).toBe("0s");
    expect(formatElapsed(5000)).toBe("5s");
    expect(formatElapsed(59000)).toBe("59s");
  });

  it("formats minutes and seconds", () => {
    expect(formatElapsed(60000)).toBe("1m 0s");
    expect(formatElapsed(263000)).toBe("4m 23s");
    expect(formatElapsed(3599000)).toBe("59m 59s");
  });

  it("formats hours, minutes, and seconds", () => {
    expect(formatElapsed(3600000)).toBe("1h 0m 0s");
    expect(formatElapsed(7384000)).toBe("2h 3m 4s");
  });

  it("clamps negative values to 0s", () => {
    expect(formatElapsed(-1000)).toBe("0s");
  });
});

// ─── StatusLine ─────────────────────────────────────────────────────

describe("StatusLine", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("is a no-op when non-TTY", () => {
    const cap = captureWrites();
    const sl = new StatusLine({ isTTY: false, quiet: false, json: false, noColor: false });
    sl.start("test");
    vi.advanceTimersByTime(200);
    sl.stop();
    cap.restore();
    expect(cap.writes).toEqual([]);
  });

  it("is a no-op when quiet", () => {
    const cap = captureWrites();
    const sl = new StatusLine({ isTTY: true, quiet: true, json: false, noColor: false });
    sl.start("test");
    vi.advanceTimersByTime(200);
    sl.stop();
    cap.restore();
    expect(cap.writes).toEqual([]);
  });

  it("is a no-op when json", () => {
    const cap = captureWrites();
    const sl = new StatusLine({ isTTY: true, quiet: false, json: true, noColor: false });
    sl.start("test");
    vi.advanceTimersByTime(200);
    sl.stop();
    cap.restore();
    expect(cap.writes).toEqual([]);
  });

  it("renders braille spinner frames when color enabled", () => {
    const cap = captureWrites();
    const sl = new StatusLine({ isTTY: true, quiet: false, json: false, noColor: false });
    sl.start("Working");
    // Initial render is frame 0 (⠋)
    expect(cap.writes[0]).toContain("⠋");
    expect(cap.writes[0]).toContain("Working");

    // Advance one interval → frame 1 (⠙)
    vi.advanceTimersByTime(80);
    const lastWrite = cap.writes[cap.writes.length - 1]!;
    expect(lastWrite).toContain("⠙");

    sl.stop();
    cap.restore();
  });

  it("renders ASCII spinner frames when noColor", () => {
    const cap = captureWrites();
    const sl = new StatusLine({ isTTY: true, quiet: false, json: false, noColor: true });
    sl.start("Working");
    expect(cap.writes[0]).toContain("|");

    vi.advanceTimersByTime(80);
    const lastWrite = cap.writes[cap.writes.length - 1]!;
    expect(lastWrite).toContain("/");

    sl.stop();
    cap.restore();
  });

  it("shows elapsed timer", () => {
    const cap = captureWrites();
    const sl = new StatusLine({ isTTY: true, quiet: false, json: false, noColor: true });
    sl.start("Working");
    // At start, timer is ~0s
    expect(cap.writes[0]).toContain("[0s]");

    // Advance 5+ seconds (extra tick to ensure timer renders after 5s mark)
    vi.advanceTimersByTime(5080);
    const lastWrite = cap.writes[cap.writes.length - 1]!;
    expect(lastWrite).toContain("[5s]");

    sl.stop();
    cap.restore();
  });

  it("shows countdown timer", () => {
    const cap = captureWrites();
    const sl = new StatusLine({ isTTY: true, quiet: false, json: false, noColor: true });
    const now = Date.now();
    sl.startCountdown("Waiting", new Date(now + 60000));
    // Should show ~1m 0s initially
    expect(cap.writes[0]).toContain("[1m 0s]");

    // Advance 30 seconds
    vi.advanceTimersByTime(30000);
    const lastWrite = cap.writes[cap.writes.length - 1]!;
    expect(lastWrite).toContain("[30s]");

    sl.stop();
    cap.restore();
  });

  it("pause hides and resume shows", () => {
    const cap = captureWrites();
    const sl = new StatusLine({ isTTY: true, quiet: false, json: false, noColor: true });
    sl.start("Working");
    cap.writes.length = 0;

    sl.pause();
    // Pause should clear the line
    expect(cap.writes[cap.writes.length - 1]).toBe("\r\x1b[K");

    // While paused, ticks should not render
    const countBefore = cap.writes.length;
    vi.advanceTimersByTime(160);
    expect(cap.writes.length).toBe(countBefore);

    // Resume — next tick should render
    sl.resume();
    vi.advanceTimersByTime(80);
    const lastWrite = cap.writes[cap.writes.length - 1]!;
    expect(lastWrite).toContain("Working");

    sl.stop();
    cap.restore();
  });

  it("stop clears the line", () => {
    const cap = captureWrites();
    const sl = new StatusLine({ isTTY: true, quiet: false, json: false, noColor: true });
    sl.start("Working");
    cap.writes.length = 0;
    sl.stop();
    expect(cap.writes[cap.writes.length - 1]).toBe("\r\x1b[K");
    expect(sl.active).toBe(false);
    cap.restore();
  });

  it("active reflects timer state", () => {
    const sl = new StatusLine({ isTTY: true, quiet: false, json: false, noColor: true });
    const cap = captureWrites();
    expect(sl.active).toBe(false);
    sl.start("Working");
    expect(sl.active).toBe(true);
    sl.stop();
    expect(sl.active).toBe(false);
    cap.restore();
  });

  it("update changes message without restarting timer", () => {
    const cap = captureWrites();
    const sl = new StatusLine({ isTTY: true, quiet: false, json: false, noColor: true });
    sl.start("First");
    vi.advanceTimersByTime(2000);
    sl.update("Second");
    vi.advanceTimersByTime(80);
    const lastWrite = cap.writes[cap.writes.length - 1]!;
    expect(lastWrite).toContain("Second");
    // Timer should still reflect elapsed from start (~2s)
    expect(lastWrite).toContain("[2s]");
    sl.stop();
    cap.restore();
  });
});
