// ─── Result Type ──────────────────────────────────────────────────
//
// Core error-handling pattern for @rauf/core.
// All public functions return Result<T, E> instead of throwing.
// RaufError shape is defined by the Zod schema in schemas.ts.

import type { RaufError } from "./schemas.js";

export type Result<T, E = RaufError> = { ok: true; value: T } | { ok: false; error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E = RaufError>(error: E): Result<never, E> {
  return { ok: false, error };
}

// ─── Error Codes ──────────────────────────────────────────────────

export const ErrorCodes = {
  FILE_NOT_FOUND: "FILE_NOT_FOUND",
  INVALID_JSON: "INVALID_JSON",
  VALIDATION_ERROR: "VALIDATION_ERROR",
  PATH_VIOLATION: "PATH_VIOLATION",
  ALREADY_INSTALLED: "ALREADY_INSTALLED",
  NOT_INSTALLED: "NOT_INSTALLED",
  CONFLICT: "CONFLICT",
  TRANSITION_INVALID: "TRANSITION_INVALID",
  LOCK_CONFLICT: "LOCK_CONFLICT",
  IO_ERROR: "IO_ERROR",
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];
