// ─── Environment for loop child sessions ─────────────────────────────
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
//
// It also owns the one fact about a child session only the runner knows: that
// there is nobody on the other end of it (`INTERACTION_ENV`). Every provider is
// driven with an explicit `nonInteractive` argv, so every loop iteration is a
// non-interactive session by construction — but the agent inside it cannot
// observe that, and measurably guesses "interactive", emits a question nobody
// can answer and burns the iteration. Stating it here is the only place that
// covers every provider: `codex` and `claude` have dedicated adapters rather
// than preset configs, so `providers/presets.ts` would miss both.

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

/**
 * The interaction contract a spawned agent's tooling reads to learn that this
 * session has no reply channel — feature-forge's `doctor` surfaces it as the
 * `interaction-mode` check, whose ladder then takes declared conservative
 * defaults instead of stalling on an unanswerable question.
 *
 * The runner only ever *states* what it knows: it spawns every child with a
 * `nonInteractive` argv, so `non-interactive` is a fact here, not a guess. A
 * caller that somehow spawns an attended child overrides it via `childEnv`.
 *
 * The name deliberately contains no `KEY`/`SECRET`/`TOKEN` substring: agent
 * sandboxes filter environment variables by such name patterns before handing
 * them to a tool call, and a filtered stamp would silently read as unknown.
 */
export const INTERACTION_ENV: Readonly<Record<string, string>> = {
  FORGE_INTERACTION: "non-interactive",
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
 * Precedence (later wins): {@link INTERACTION_ENV} < suppression set (if opted
 * in) < caller `childEnv`. The interaction stamp always applies, so this now
 * always returns an object; children still inherit the parent environment,
 * because `spawnProcessGroup` merges these over `process.env` rather than
 * replacing it.
 */
export function resolveChildEnv(options: ChildEnvOptions): Record<string, string> | undefined {
  const env: Record<string, string> = { ...INTERACTION_ENV };
  if (options.suppressIterationReview) {
    Object.assign(env, REVIEW_HOOK_SUPPRESSION_ENV);
  }
  if (options.childEnv) {
    Object.assign(env, options.childEnv);
  }
  return Object.keys(env).length > 0 ? env : undefined;
}
