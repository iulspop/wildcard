import { describe, expect, it } from "vitest";

import {
  bindWorkerEnv,
  getWorkerBindings,
  type WorkerEnv,
} from "./env.server.ts";

describe("worker environment binding", () => {
  it("is scoped to the active request", async () => {
    const request = new Request("https://wildcard.test/");
    const env = {} as WorkerEnv;
    const executionContext = {} as ExecutionContext;

    await bindWorkerEnv(request, env, executionContext, async () => {
      expect(getWorkerBindings(request)).toEqual({ env, executionContext });
    });

    expect(() => getWorkerBindings(request)).toThrow(
      "Worker bindings are unavailable",
    );
  });
});
