import { describe, expect, it, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as crypto from "node:crypto";
import { z } from "zod";

import {
  atomicWrite,
  readJsonFile,
  computeHash,
  validatePath,
  fileExists,
  ensureDir,
} from "./fs-utils.js";
import { ErrorCodes } from "./errors.js";

// ─── Helpers ──────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ralph-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function tmpFile(name: string): string {
  return path.join(tmpDir, name);
}

// ─── atomicWrite ──────────────────────────────────────────────────

describe("atomicWrite", () => {
  it("writes content to file", () => {
    const filePath = tmpFile("test.txt");
    const result = atomicWrite(filePath, "hello world");
    expect(result.ok).toBe(true);
    expect(fs.readFileSync(filePath, "utf-8")).toBe("hello world");
  });

  it("overwrites existing file atomically", () => {
    const filePath = tmpFile("test.txt");
    fs.writeFileSync(filePath, "old content");
    const result = atomicWrite(filePath, "new content");
    expect(result.ok).toBe(true);
    expect(fs.readFileSync(filePath, "utf-8")).toBe("new content");
  });

  it("creates .bak backup for backlog.json", () => {
    const filePath = tmpFile("backlog.json");
    fs.writeFileSync(filePath, '{"original": true}');

    const result = atomicWrite(filePath, '{"updated": true}');
    expect(result.ok).toBe(true);

    const bakPath = `${filePath}.bak`;
    expect(fs.existsSync(bakPath)).toBe(true);
    expect(fs.readFileSync(bakPath, "utf-8")).toBe('{"original": true}');
    expect(fs.readFileSync(filePath, "utf-8")).toBe('{"updated": true}');
  });

  it("does not create .bak for non-backlog files", () => {
    const filePath = tmpFile("config.json");
    fs.writeFileSync(filePath, '{"old": true}');

    atomicWrite(filePath, '{"new": true}');
    expect(fs.existsSync(`${filePath}.bak`)).toBe(false);
  });

  it("does not create .bak for new backlog.json (no existing file)", () => {
    const filePath = tmpFile("backlog.json");
    atomicWrite(filePath, '{"items": []}');
    expect(fs.existsSync(`${filePath}.bak`)).toBe(false);
  });

  it("leaves no .tmp file on success", () => {
    const filePath = tmpFile("test.txt");
    atomicWrite(filePath, "content");
    expect(fs.existsSync(`${filePath}.tmp`)).toBe(false);
  });

  it("returns error for invalid directory", () => {
    const filePath = path.join(tmpDir, "nonexistent", "deep", "test.txt");
    const result = atomicWrite(filePath, "content");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(ErrorCodes.FILE_NOT_FOUND);
    }
  });
});

// ─── readJsonFile ─────────────────────────────────────────────────

const TestSchema = z.object({
  name: z.string(),
  value: z.number(),
});

describe("readJsonFile", () => {
  it("reads and validates a valid JSON file", () => {
    const filePath = tmpFile("valid.json");
    fs.writeFileSync(filePath, JSON.stringify({ name: "test", value: 42 }));

    const result = readJsonFile(filePath, TestSchema);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ name: "test", value: 42 });
    }
  });

  it("returns FILE_NOT_FOUND for missing file", () => {
    const result = readJsonFile(tmpFile("missing.json"), TestSchema);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(ErrorCodes.FILE_NOT_FOUND);
    }
  });

  it("returns INVALID_JSON for malformed JSON", () => {
    const filePath = tmpFile("bad.json");
    fs.writeFileSync(filePath, "{ not valid json }}}");

    const result = readJsonFile(filePath, TestSchema);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(ErrorCodes.INVALID_JSON);
    }
  });

  it("returns VALIDATION_ERROR for schema mismatch", () => {
    const filePath = tmpFile("wrong-shape.json");
    fs.writeFileSync(filePath, JSON.stringify({ name: 123, value: "not a number" }));

    const result = readJsonFile(filePath, TestSchema);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
      expect(result.error.details).toBeDefined();
      expect(result.error.details!.issues).toBeDefined();
    }
  });

  it("includes validation issue details", () => {
    const filePath = tmpFile("partial.json");
    fs.writeFileSync(filePath, JSON.stringify({ name: "test" }));

    const result = readJsonFile(filePath, TestSchema);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const issues = result.error.details!.issues as Array<{
        path: string;
        message: string;
      }>;
      expect(issues.some((i) => i.path === "value")).toBe(true);
    }
  });

  it("handles empty file as INVALID_JSON", () => {
    const filePath = tmpFile("empty.json");
    fs.writeFileSync(filePath, "");

    const result = readJsonFile(filePath, TestSchema);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(ErrorCodes.INVALID_JSON);
    }
  });

  it("reads nested JSON structures", () => {
    const NestedSchema = z.object({
      items: z.array(z.object({ id: z.string() })),
    });
    const filePath = tmpFile("nested.json");
    fs.writeFileSync(filePath, JSON.stringify({ items: [{ id: "001" }, { id: "002" }] }));

    const result = readJsonFile(filePath, NestedSchema);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.items).toHaveLength(2);
    }
  });
});

// ─── computeHash ──────────────────────────────────────────────────

describe("computeHash", () => {
  it("returns SHA-256 hex digest", () => {
    const filePath = tmpFile("hash-test.txt");
    const content = "hello world";
    fs.writeFileSync(filePath, content);

    const expected = crypto.createHash("sha256").update(Buffer.from(content)).digest("hex");

    const result = computeHash(filePath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(expected);
      expect(result.value).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  it("produces consistent hashes for same content", () => {
    const file1 = tmpFile("hash1.txt");
    const file2 = tmpFile("hash2.txt");
    fs.writeFileSync(file1, "identical content");
    fs.writeFileSync(file2, "identical content");

    const r1 = computeHash(file1);
    const r2 = computeHash(file2);
    expect(r1.ok && r2.ok).toBe(true);
    if (r1.ok && r2.ok) {
      expect(r1.value).toBe(r2.value);
    }
  });

  it("produces different hashes for different content", () => {
    const file1 = tmpFile("diff1.txt");
    const file2 = tmpFile("diff2.txt");
    fs.writeFileSync(file1, "content A");
    fs.writeFileSync(file2, "content B");

    const r1 = computeHash(file1);
    const r2 = computeHash(file2);
    expect(r1.ok && r2.ok).toBe(true);
    if (r1.ok && r2.ok) {
      expect(r1.value).not.toBe(r2.value);
    }
  });

  it("returns error for missing file", () => {
    const result = computeHash(tmpFile("nonexistent.txt"));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(ErrorCodes.FILE_NOT_FOUND);
    }
  });

  it("handles binary content", () => {
    const filePath = tmpFile("binary.bin");
    const buf = Buffer.from([0x00, 0xff, 0x42, 0x13]);
    fs.writeFileSync(filePath, buf);

    const result = computeHash(filePath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  it("handles empty file", () => {
    const filePath = tmpFile("empty.txt");
    fs.writeFileSync(filePath, "");

    const result = computeHash(filePath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // SHA-256 of empty string is well-known
      expect(result.value).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    }
  });
});

// ─── validatePath ─────────────────────────────────────────────────

describe("validatePath", () => {
  it("accepts a path within an allowed root", () => {
    const result = validatePath(path.join(tmpDir, "project", "file.txt"), [tmpDir]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(path.resolve(tmpDir, "project", "file.txt"));
    }
  });

  it("accepts the root directory itself", () => {
    const result = validatePath(tmpDir, [tmpDir]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(path.resolve(tmpDir));
    }
  });

  it("rejects path outside allowed roots", () => {
    const result = validatePath("/etc/passwd", [tmpDir]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(ErrorCodes.PATH_VIOLATION);
    }
  });

  it("rejects .. traversal escaping root", () => {
    const result = validatePath(path.join(tmpDir, "subdir", "..", "..", "escape"), [tmpDir]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(ErrorCodes.PATH_VIOLATION);
    }
  });

  it("accepts .. traversal staying within root", () => {
    const result = validatePath(path.join(tmpDir, "a", "..", "b", "file.txt"), [tmpDir]);
    expect(result.ok).toBe(true);
  });

  it("accepts path in any of multiple allowed roots", () => {
    const root1 = path.join(tmpDir, "root1");
    const root2 = path.join(tmpDir, "root2");
    fs.mkdirSync(root1);
    fs.mkdirSync(root2);

    const result = validatePath(path.join(root2, "file.txt"), [root1, root2]);
    expect(result.ok).toBe(true);
  });

  it("rejects path not in any allowed root", () => {
    const root1 = path.join(tmpDir, "root1");
    const root2 = path.join(tmpDir, "root2");
    fs.mkdirSync(root1);
    fs.mkdirSync(root2);

    const result = validatePath(path.join(tmpDir, "root3", "file.txt"), [root1, root2]);
    expect(result.ok).toBe(false);
  });

  it("handles root that is a prefix of another path (not a directory boundary)", () => {
    // /tmp/foo should NOT match /tmp/foobar/file.txt
    const root = path.join(tmpDir, "foo");
    const target = path.join(tmpDir, "foobar", "file.txt");
    fs.mkdirSync(root);
    fs.mkdirSync(path.join(tmpDir, "foobar"));

    const result = validatePath(target, [root]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(ErrorCodes.PATH_VIOLATION);
    }
  });

  it("includes useful details in error", () => {
    const result = validatePath("/outside/path", [tmpDir]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.details).toBeDefined();
      expect(result.error.details!.resolved).toBe(path.resolve("/outside/path"));
      expect(result.error.details!.allowedRoots).toBeInstanceOf(Array);
    }
  });
});

// ─── fileExists ───────────────────────────────────────────────────

describe("fileExists", () => {
  it("returns true for existing file", () => {
    const filePath = tmpFile("exists.txt");
    fs.writeFileSync(filePath, "content");
    expect(fileExists(filePath)).toBe(true);
  });

  it("returns false for non-existing file", () => {
    expect(fileExists(tmpFile("nope.txt"))).toBe(false);
  });

  it("returns true for existing directory", () => {
    expect(fileExists(tmpDir)).toBe(true);
  });

  it("returns false for removed file", () => {
    const filePath = tmpFile("removed.txt");
    fs.writeFileSync(filePath, "temp");
    fs.unlinkSync(filePath);
    expect(fileExists(filePath)).toBe(false);
  });
});

// ─── ensureDir ────────────────────────────────────────────────────

describe("ensureDir", () => {
  it("creates a single directory", () => {
    const dirPath = path.join(tmpDir, "newdir");
    const result = ensureDir(dirPath);
    expect(result.ok).toBe(true);
    expect(fs.existsSync(dirPath)).toBe(true);
    expect(fs.statSync(dirPath).isDirectory()).toBe(true);
  });

  it("creates nested directories recursively", () => {
    const dirPath = path.join(tmpDir, "a", "b", "c");
    const result = ensureDir(dirPath);
    expect(result.ok).toBe(true);
    expect(fs.existsSync(dirPath)).toBe(true);
  });

  it("succeeds if directory already exists (idempotent)", () => {
    const dirPath = path.join(tmpDir, "existing");
    fs.mkdirSync(dirPath);

    const result = ensureDir(dirPath);
    expect(result.ok).toBe(true);
    expect(fs.existsSync(dirPath)).toBe(true);
  });

  it("succeeds if deeply nested directory already exists", () => {
    const dirPath = path.join(tmpDir, "x", "y", "z");
    fs.mkdirSync(dirPath, { recursive: true });

    const result = ensureDir(dirPath);
    expect(result.ok).toBe(true);
  });
});
