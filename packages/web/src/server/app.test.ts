import { describe, it, expect, beforeEach } from "vitest";
import { createApp, errorResponse } from "./app.js";

// ─── Helpers ─────────────────────────────────────────────────────

function makeApp() {
  // Use a fixed startedAt so uptime is deterministic in tests
  return createApp(Date.now());
}

async function json(response: Response) {
  return response.json() as Promise<unknown>;
}

// ─── errorResponse helper ─────────────────────────────────────────

describe("errorResponse", () => {
  it("returns error object without details when not provided", () => {
    const result = errorResponse("NOT_FOUND", "Item not found");
    expect(result).toEqual({ error: { code: "NOT_FOUND", message: "Item not found" } });
    expect("details" in result.error).toBe(false);
  });

  it("includes details when provided", () => {
    const result = errorResponse("VALIDATION_ERROR", "Bad input", { field: "priority" });
    expect(result.error.details).toEqual({ field: "priority" });
  });
});

// ─── CSRF middleware ──────────────────────────────────────────────

describe("CSRF middleware", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    app = makeApp();
    // Register a test route that proceeds normally when CSRF passes
    app.post("/api/test", (c) => c.json({ data: "ok" }));
    app.put("/api/test", (c) => c.json({ data: "ok" }));
    app.delete("/api/test", (c) => c.json({ data: "ok" }));
    app.get("/api/test", (c) => c.json({ data: "ok" }));
  });

  it("POST without X-Ralph-Request returns 403", async () => {
    const res = await app.request("/api/test", { method: "POST" });
    expect(res.status).toBe(403);
    const body = await json(res);
    expect(body).toMatchObject({
      error: { code: "FORBIDDEN" },
    });
  });

  it("PUT without X-Ralph-Request returns 403", async () => {
    const res = await app.request("/api/test", { method: "PUT" });
    expect(res.status).toBe(403);
    const body = await json(res);
    expect(body).toMatchObject({ error: { code: "FORBIDDEN" } });
  });

  it("DELETE without X-Ralph-Request returns 403", async () => {
    const res = await app.request("/api/test", { method: "DELETE" });
    expect(res.status).toBe(403);
    const body = await json(res);
    expect(body).toMatchObject({ error: { code: "FORBIDDEN" } });
  });

  it("POST with X-Ralph-Request: true proceeds normally", async () => {
    const res = await app.request("/api/test", {
      method: "POST",
      headers: { "X-Ralph-Request": "true" },
    });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body).toEqual({ data: "ok" });
  });

  it("PUT with X-Ralph-Request: true proceeds normally", async () => {
    const res = await app.request("/api/test", {
      method: "PUT",
      headers: { "X-Ralph-Request": "true" },
    });
    expect(res.status).toBe(200);
  });

  it("DELETE with X-Ralph-Request: true proceeds normally", async () => {
    const res = await app.request("/api/test", {
      method: "DELETE",
      headers: { "X-Ralph-Request": "true" },
    });
    expect(res.status).toBe(200);
  });

  it("GET does not require X-Ralph-Request header", async () => {
    const res = await app.request("/api/test", { method: "GET" });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body).toEqual({ data: "ok" });
  });

  it("X-Ralph-Request: false is rejected (must be 'true' string)", async () => {
    const res = await app.request("/api/test", {
      method: "POST",
      headers: { "X-Ralph-Request": "false" },
    });
    expect(res.status).toBe(403);
  });

  it("X-Ralph-Request: 1 is rejected (must be exact string 'true')", async () => {
    const res = await app.request("/api/test", {
      method: "POST",
      headers: { "X-Ralph-Request": "1" },
    });
    expect(res.status).toBe(403);
  });

  it("response has no Access-Control-Allow-Origin header", async () => {
    const res = await app.request("/api/test", { method: "GET" });
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});

// ─── GET /api/health ─────────────────────────────────────────────

describe("GET /api/health", () => {
  it("returns 200 with version and uptime", async () => {
    const app = makeApp();
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);

    const body = (await json(res)) as { data: Record<string, unknown> };
    expect(body).toHaveProperty("data");
    expect(typeof body.data["version"]).toBe("string");
    expect(body.data["version"]).toMatch(/^\d+\.\d+\.\d+/);
    expect(typeof body.data["uptime"]).toBe("number");
    expect(body.data["uptime"]).toBeGreaterThanOrEqual(0);
  });

  it("returns rootDirectory field", async () => {
    const app = makeApp();
    const res = await app.request("/api/health");
    const body = (await json(res)) as { data: Record<string, unknown> };
    expect(typeof body.data["rootDirectory"]).toBe("string");
    expect((body.data["rootDirectory"] as string).length).toBeGreaterThan(0);
  });

  it("returns projectCount as a number", async () => {
    const app = makeApp();
    const res = await app.request("/api/health");
    const body = (await json(res)) as { data: Record<string, unknown> };
    expect(typeof body.data["projectCount"]).toBe("number");
  });

  it("uptime increases over time", async () => {
    // Start with a time 2 seconds in the past
    const twoSecondsAgo = Date.now() - 2000;
    const app = createApp(twoSecondsAgo);
    const res = await app.request("/api/health");
    const body = (await json(res)) as { data: { uptime: number } };
    expect(body.data.uptime).toBeGreaterThanOrEqual(1);
  });

  it("does not require X-Ralph-Request header (GET is read-only)", async () => {
    const app = makeApp();
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
  });
});

// ─── Error handling ───────────────────────────────────────────────

describe("Error handling", () => {
  it("unmatched route returns 404 with standard error format", async () => {
    const app = makeApp();
    const res = await app.request("/api/nonexistent");
    expect(res.status).toBe(404);

    const body = await json(res);
    expect(body).toMatchObject({
      error: {
        code: "NOT_FOUND",
        message: expect.stringContaining("/api/nonexistent"),
      },
    });
  });

  it("404 error includes request method in message", async () => {
    const app = makeApp();
    const res = await app.request("/api/nonexistent", {
      method: "GET",
    });
    const body = (await json(res)) as { error: { message: string } };
    expect(body.error.message).toContain("GET");
  });

  it("global error handler returns 500 with standard format", async () => {
    const app = makeApp();
    // Register a route that throws
    app.get("/api/boom", () => {
      throw new Error("Something exploded");
    });

    const res = await app.request("/api/boom");
    expect(res.status).toBe(500);
    const body = await json(res);
    expect(body).toMatchObject({
      error: {
        code: "INTERNAL_ERROR",
        message: "Something exploded",
      },
    });
  });
});
