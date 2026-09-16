import { describe, expect, it, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app.js";
import { pool } from "../../src/db/client.js";

/**
 * Phase 0 verification: the full stack (Fastify + tRPC + a live Postgres
 * connection) actually works end-to-end, per
 * docs/implementation-plan.md Phase 0's milestone.
 */
describe("Phase 0 scaffold", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it("responds to /health with a live database connection", async () => {
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
  });

  it("responds to the ping tRPC procedure", async () => {
    const response = await app.inject({ method: "GET", url: "/trpc/ping" });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.result.data.message).toBe("pong");
    expect(typeof body.result.data.serverTime).toBe("string");
  });
});
