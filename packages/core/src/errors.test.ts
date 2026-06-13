import { describe, expect, it } from "vitest";
import { ok, err, ErrorCodes, type Result } from "./errors.js";
import type { RaufError } from "./schemas.js";

describe("ok()", () => {
  it("creates a success result with a value", () => {
    const result = ok(42);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(42);
    }
  });

  it("works with string values", () => {
    const result = ok("hello");
    expect(result).toEqual({ ok: true, value: "hello" });
  });

  it("works with object values", () => {
    const data = { name: "test", count: 5 };
    const result = ok(data);
    expect(result).toEqual({ ok: true, value: data });
  });

  it("works with undefined (void operations)", () => {
    const result = ok(undefined);
    expect(result).toEqual({ ok: true, value: undefined });
  });

  it("works with null values", () => {
    const result = ok(null);
    expect(result).toEqual({ ok: true, value: null });
  });

  it("works with array values", () => {
    const result = ok([1, 2, 3]);
    expect(result).toEqual({ ok: true, value: [1, 2, 3] });
  });
});

describe("err()", () => {
  it("creates a failure result with an error", () => {
    const error: RaufError = {
      code: ErrorCodes.FILE_NOT_FOUND,
      message: "not found",
    };
    const result = err(error);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual(error);
    }
  });

  it("includes optional details", () => {
    const error: RaufError = {
      code: ErrorCodes.VALIDATION_ERROR,
      message: "bad data",
      details: { path: "/tmp/test.json", field: "name" },
    };
    const result = err(error);
    expect(result).toEqual({ ok: false, error });
  });

  it("works without details field", () => {
    const error: RaufError = {
      code: ErrorCodes.INVALID_JSON,
      message: "parse error",
    };
    const result = err(error);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.details).toBeUndefined();
    }
  });
});

describe("Result type narrowing", () => {
  it("narrows correctly in conditional", () => {
    function doWork(succeed: boolean): Result<number> {
      if (succeed) return ok(42);
      return err({ code: ErrorCodes.CONFLICT, message: "conflict" });
    }

    const success = doWork(true);
    if (success.ok) {
      // TypeScript narrows to { ok: true; value: number }
      expect(success.value).toBe(42);
    }

    const failure = doWork(false);
    if (!failure.ok) {
      // TypeScript narrows to { ok: false; error: RaufError }
      expect(failure.error.code).toBe(ErrorCodes.CONFLICT);
    }
  });
});

describe("ErrorCodes", () => {
  it("has all required error codes", () => {
    expect(ErrorCodes.FILE_NOT_FOUND).toBe("FILE_NOT_FOUND");
    expect(ErrorCodes.INVALID_JSON).toBe("INVALID_JSON");
    expect(ErrorCodes.VALIDATION_ERROR).toBe("VALIDATION_ERROR");
    expect(ErrorCodes.PATH_VIOLATION).toBe("PATH_VIOLATION");
    expect(ErrorCodes.ALREADY_INSTALLED).toBe("ALREADY_INSTALLED");
    expect(ErrorCodes.NOT_INSTALLED).toBe("NOT_INSTALLED");
    expect(ErrorCodes.CONFLICT).toBe("CONFLICT");
    expect(ErrorCodes.TRANSITION_INVALID).toBe("TRANSITION_INVALID");
    expect(ErrorCodes.LOCK_CONFLICT).toBe("LOCK_CONFLICT");
    expect(ErrorCodes.IO_ERROR).toBe("IO_ERROR");
  });

  it("is a const object (values match keys)", () => {
    for (const [key, value] of Object.entries(ErrorCodes)) {
      expect(key).toBe(value);
    }
  });

  it("has exactly 10 error codes", () => {
    expect(Object.keys(ErrorCodes)).toHaveLength(10);
  });
});
