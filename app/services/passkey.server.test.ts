import { describe, expect, it } from "vitest";

import type { WorkerEnv } from "./env.server.ts";
import { registrationOptions } from "./passkey.server.ts";
import { clearSessionCookie, createSession } from "./session.server.ts";

const env = {} as WorkerEnv;

describe("passkey registration", () => {
  it("rejects empty and oversized display names before touching D1", async () => {
    await expect(registrationOptions(env, "   ")).rejects.toThrow("1–32");
    await expect(registrationOptions(env, "x".repeat(33))).rejects.toThrow(
      "1–32",
    );
  });
});

describe("sessions", () => {
  it("requires a strong signing secret", async () => {
    await expect(
      createSession({} as D1Database, "user", "too-short"),
    ).rejects.toThrow("at least 32");
  });

  it("clears the secure HTTP-only cookie", () => {
    expect(clearSessionCookie()).toContain(
      "HttpOnly; Secure; SameSite=Lax; Max-Age=0",
    );
  });
});
