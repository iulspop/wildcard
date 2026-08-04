import { describe, expect, it } from "vitest";

import { hashSecret } from "./rooms.server.ts";

describe("room credentials", () => {
  it("hashes invite and reconnect credentials without retaining plaintext", async () => {
    const credential = "invite-secret";
    const hash = await hashSecret(credential);

    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[a-f0-9]+$/);
    expect(hash).not.toContain(credential);
    expect(await hashSecret(credential)).toBe(hash);
    expect(await hashSecret(`${credential}-other`)).not.toBe(hash);
  });
});
