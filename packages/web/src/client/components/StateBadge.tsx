import { STATE_LABELS, type StateTone } from "@rauf/core/state-labels";
import type { LoopStateEnum } from "@rauf/core";

/** tone → CSS palette (OQ-T1 web table, 02 §5.2). Web-client only — core stays CSS-free. */
const TONE_PALETTE: Record<StateTone, { bg: string; text: string; border: string }> = {
  neutral: {
    bg: "rgba(107, 114, 128, 0.12)",
    text: "#6b7280",
    border: "rgba(107, 114, 128, 0.25)",
  },
  info: { bg: "rgba(37, 99, 235, 0.12)", text: "#2563eb", border: "rgba(37, 99, 235, 0.35)" },
  success: { bg: "rgba(22, 163, 74, 0.12)", text: "#16a34a", border: "rgba(22, 163, 74, 0.35)" },
  warning: { bg: "rgba(202, 138, 4, 0.12)", text: "#ca8a04", border: "rgba(202, 138, 4, 0.35)" },
  danger: { bg: "rgba(220, 38, 38, 0.12)", text: "#dc2626", border: "rgba(220, 38, 38, 0.35)" },
};

export function StateBadge({
  state,
  size = "pill",
}: {
  state: LoopStateEnum;
  size?: "pill" | "block";
}) {
  const { label, tone } = STATE_LABELS[state];
  const palette = TONE_PALETTE[tone];
  const isPill = size === "pill";
  return (
    <span
      className={
        isPill
          ? "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
          : "inline-flex items-center gap-2 rounded-lg border px-4 py-1.5 font-mono text-base font-bold tracking-wide"
      }
      style={{
        backgroundColor: palette.bg,
        color: palette.text,
        ...(isPill ? {} : { borderColor: palette.border }),
      }}
    >
      {state === "RUNNING" && (
        <span
          className={
            isPill
              ? "h-1.5 w-1.5 animate-pulse rounded-full bg-current"
              : "h-2.5 w-2.5 animate-pulse rounded-full bg-current"
          }
          aria-hidden="true"
        />
      )}
      {label}
    </span>
  );
}
