// ─── Status Line ────────────────────────────────────────────────
//
// Animated spinner + elapsed/countdown timer for long-running phases.
// Renders on the bottom terminal line via \r + clear-to-EOL.
// All methods are no-ops when non-TTY, quiet, or JSON mode.

export interface StatusLineOptions {
  isTTY: boolean;
  quiet: boolean;
  json: boolean;
  noColor: boolean;
}

const BRAILLE_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const ASCII_FRAMES = ["|", "/", "-", "\\"];

const INTERVAL_MS = 80;

/** Format a duration in milliseconds to a human-readable string */
export function formatElapsed(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  if (totalSec < 60) return `${totalSec}s`;
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  return `${m}m ${s}s`;
}

export class StatusLine {
  private enabled: boolean;
  private frames: readonly string[];
  private frameIndex = 0;
  private message = "";
  private detail: string | null = null;
  private startedAt = 0;
  private countdownUntil: number | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private paused = false;

  constructor(options: StatusLineOptions) {
    this.enabled = options.isTTY && !options.quiet && !options.json;
    this.frames = options.noColor ? ASCII_FRAMES : BRAILLE_FRAMES;
  }

  /** Start spinner + elapsed timer. */
  start(message: string): void {
    if (!this.enabled) return;
    this.stop();
    this.message = message;
    this.startedAt = Date.now();
    this.countdownUntil = null;
    this.frameIndex = 0;
    this.paused = false;
    this.beginInterval();
  }

  /** Start spinner + countdown timer to a target time. */
  startCountdown(message: string, until: Date): void {
    if (!this.enabled) return;
    this.stop();
    this.message = message;
    this.startedAt = Date.now();
    this.countdownUntil = until.getTime();
    this.frameIndex = 0;
    this.paused = false;
    this.beginInterval();
  }

  /** Update message text without restarting timer. */
  update(message: string): void {
    if (!this.enabled || !this.timer) return;
    this.message = message;
  }

  /** Set or clear the detail line below the spinner. */
  setDetail(detail: string | null): void {
    if (!this.enabled || !this.timer) return;
    this.detail = detail;
  }

  /** Stop animation, clear the line. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      this.clearLines();
    }
    this.detail = null;
    this.paused = false;
  }

  /** Temporarily hide the status line (call before normal output). */
  pause(): void {
    if (!this.enabled || !this.timer) return;
    this.paused = true;
    this.clearLines();
  }

  /** Restore the status line after a pause. */
  resume(): void {
    if (!this.enabled || !this.timer) return;
    this.paused = false;
  }

  get active(): boolean {
    return this.timer !== null;
  }

  private beginInterval(): void {
    this.render();
    this.timer = setInterval(() => {
      this.frameIndex = (this.frameIndex + 1) % this.frames.length;
      if (!this.paused) this.render();
    }, INTERVAL_MS);
  }

  private render(): void {
    const spinner = this.frames[this.frameIndex]!;
    const timerText = this.computeTimer();
    const line = `${spinner} ${this.message}  [${timerText}]`;
    if (this.detail) {
      // Write main line + detail line, then move cursor back up
      process.stdout.write(`\r\x1b[K${line}\n\r\x1b[K  ${this.detail}\x1b[1A`);
    } else {
      process.stdout.write(`\r\x1b[K${line}`);
    }
  }

  private computeTimer(): string {
    if (this.countdownUntil !== null) {
      const remaining = this.countdownUntil - Date.now();
      return formatElapsed(Math.max(0, remaining));
    }
    return formatElapsed(Date.now() - this.startedAt);
  }

  /** Clear main line and detail line (if present) */
  private clearLines(): void {
    if (this.detail !== null) {
      // Clear current line, move down, clear detail line, move back up
      process.stdout.write("\r\x1b[K\n\r\x1b[K\x1b[1A");
    } else {
      process.stdout.write("\r\x1b[K");
    }
  }
}
