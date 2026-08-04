import { router } from "./app/router.ts";
import { GameRoom } from "./app/durable-objects/game-room.ts";
import { handleAuthRequest } from "./app/routes/auth.server.ts";
import { bindWorkerEnv, type WorkerEnv } from "./app/services/env.server.ts";
import { handleRoomRequest } from "./app/services/rooms.server.ts";

export { GameRoom };

export default {
  async fetch(
    request: Request,
    env: WorkerEnv,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const authResponse = await handleAuthRequest(request, env);
    if (authResponse) return authResponse;

    const roomResponse = await handleRoomRequest(request, env);
    if (roomResponse) return roomResponse;

    const assetResponse = await env.ASSETS.fetch(request);
    if (assetResponse.status !== 404) return assetResponse;

    return bindWorkerEnv(request, env, ctx, () => router.fetch(request));
  },
} satisfies ExportedHandler<WorkerEnv>;
