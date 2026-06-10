// ─── Review-hook suppression for loop child sessions ─────────────────
//
// When a commit/Stop-triggered review hook (e.g. a globally-installed
// security-review plugin) is present, it fires inside EVERY loop child agent
// session. For human-in-the-loop autonomous dev that is the wrong altitude —
// the child agent rubber-stamps findings. The adopted model is "review at the
// gate": run the loop quiet, then review the cumulative `main..HEAD` diff once,
// surfaced to the human.
//
// This module provides the generic mechanism to run child sessions quiet. It is
// NOT hardcoded to any one plugin: `REVIEW_HOOK_SUPPRESSION_ENV` is a small set
// of opt-out env vars that known review hooks honor, and `resolveChildEnv`
// merges arbitrary caller-supplied overrides on top so any hook with an env
// opt-out can be suppressed without code changes.

/**
 * Environment variables propagated to loop child sessions when iteration-level
 * review is suppressed (`suppressIterationReview`). Each entry is an opt-out a
 * known review/security hook honors. Add more here as hooks expose env opt-outs
 * — the mechanism stays generic.
 */
export const REVIEW_HOOK_SUPPRESSION_ENV: Readonly<Record<string, string>> = {
  // security-guidance plugin: disables its PostToolUse(git commit/push) + Stop
  // diff review inside the child session.
  ENABLE_CODE_SECURITY_REVIEW: "0",
};

/** Inputs that influence the child session environment. */
export interface ChildEnvOptions {
  /** When true, merge {@link REVIEW_HOOK_SUPPRESSION_ENV} into the child env. */
  suppressIterationReview?: boolean;
  /** Generic env overrides; take precedence over the suppression set. */
  childEnv?: Record<string, string>;
}

/**
 * Compute the effective environment-variable overrides for loop child sessions.
 *
 * Precedence (later wins): suppression set (if opted in) < caller `childEnv`.
 * Returns `undefined` when no overrides apply, so the default behavior — child
 * inherits the parent environment unchanged — is preserved.
 */
export function resolveChildEnv(options: ChildEnvOptions): Record<string, string> | undefined {
  const env: Record<string, string> = {};
  if (options.suppressIterationReview) {
    Object.assign(env, REVIEW_HOOK_SUPPRESSION_ENV);
  }
  if (options.childEnv) {
    Object.assign(env, options.childEnv);
  }
  return Object.keys(env).length > 0 ? env : undefined;
}
