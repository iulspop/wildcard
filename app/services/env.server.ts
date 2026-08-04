import { createContextKey } from "remix/router";

export interface WorkerEnv {
  ASSETS: Fetcher;
  AUTH_DB: D1Database;
  GAME_ROOMS: DurableObjectNamespace;
  PASSKEY_RP_ID: string;
  PASSKEY_RP_NAME: string;
  PASSKEY_ORIGIN: string;
  SESSION_SECRET: string;
  TEMPORARY_ROOM_TTL_MS?: string;
}

interface WorkerRequestBindings {
  env: WorkerEnv;
  executionContext: ExecutionContext;
}

const requestBindings = new WeakMap<Request, WorkerRequestBindings>();

export const envContext = createContextKey<WorkerEnv>();
export const executionContext = createContextKey<ExecutionContext>();

export async function bindWorkerEnv<T>(
  request: Request,
  env: WorkerEnv,
  ctx: ExecutionContext,
  handler: () => Promise<T>,
): Promise<T> {
  requestBindings.set(request, { env, executionContext: ctx });
  try {
    return await handler();
  } finally {
    requestBindings.delete(request);
  }
}

export function getWorkerBindings(request: Request): WorkerRequestBindings {
  const bindings = requestBindings.get(request);
  if (!bindings)
    throw new Error("Worker bindings are unavailable for this request");
  return bindings;
}
