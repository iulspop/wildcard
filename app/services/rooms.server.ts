import {
  ROOM_PROTOCOL_VERSION,
  type RoomCommand,
} from "../durable-objects/protocol.ts";
import type { WorkerEnv } from "./env.server.ts";
import { getSessionUser } from "./session.server.ts";

const encoder = new TextEncoder();

export async function handleRoomRequest(
  request: Request,
  env: WorkerEnv,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname === "/api/rooms" && request.method === "POST")
    return createRoom(request, env);
  if (url.pathname === "/api/rooms" && request.method === "GET")
    return listOwnedRooms(request, env);

  const match =
    /^\/api\/rooms\/([A-Za-z0-9_-]+)\/(join|command|state|socket)$/.exec(
      url.pathname,
    );
  if (!match) return null;
  const [, roomId, operation] = match;
  if (!roomId || !operation) return null;
  const stub = env.GAME_ROOMS.get(env.GAME_ROOMS.idFromName(roomId));

  if (operation === "join" && request.method === "POST")
    return joinRoom(request, stub);
  if (operation === "command" && request.method === "POST")
    return forwardCommand(request, stub);
  if (operation === "state" && request.method === "POST")
    return roomState(request, stub);
  if (operation === "socket" && request.method === "GET")
    return roomSocket(request, stub, env);
  return Response.json({ error: "Method not allowed" }, { status: 405 });
}

async function listOwnedRooms(request: Request, env: WorkerEnv) {
  const user = await getSessionUser(request, env.AUTH_DB, env.SESSION_SECRET);
  if (!user)
    return Response.json({ error: "Authentication required" }, { status: 401 });
  const result = await env.AUTH_DB.prepare(
    "SELECT room_id, created_at FROM owned_rooms WHERE owner_user_id = ? ORDER BY created_at DESC",
  )
    .bind(user.id)
    .all<{ room_id: string; created_at: number }>();
  const rooms = await Promise.all(
    result.results.map(async (ownedRoom) => {
      const stub = env.GAME_ROOMS.get(
        env.GAME_ROOMS.idFromName(ownedRoom.room_id),
      );
      const response = await stub.fetch("https://room.internal/state");
      if (!response.ok) return null;
      const state = (await response.json()) as {
        room: {
          roomId: string;
          name: string;
          ownerUserId: string | null;
          protected: boolean;
        };
        standings: unknown[];
      };
      if (state.room.ownerUserId !== user.id) return null;
      return {
        roomId: state.room.roomId,
        name: state.room.name,
        protected: state.room.protected,
        createdAt: ownedRoom.created_at,
        standingsCount: state.standings.length,
      };
    }),
  );
  return Response.json({ rooms: rooms.filter((room) => room !== null) });
}

async function createRoom(request: Request, env: WorkerEnv) {
  const input = await readJson<{
    name?: string;
    persistent?: boolean;
  }>(request);
  const user = await getSessionUser(request, env.AUTH_DB, env.SESSION_SECRET);
  if (input.persistent && !user)
    return Response.json(
      { error: "Sign in to create a persistent room" },
      { status: 401 },
    );

  const roomId = randomToken(18);
  const inviteCredential = randomToken(32);
  const command: RoomCommand = {
    protocolVersion: ROOM_PROTOCOL_VERSION,
    type: "create",
    roomId,
    name: input.name ?? "Wildcard room",
    persistent: Boolean(input.persistent),
    ...(user ? { ownerUserId: user.id } : {}),
    inviteHash: await hashSecret(inviteCredential),
  };
  const stub = env.GAME_ROOMS.get(env.GAME_ROOMS.idFromName(roomId));
  if (user && input.persistent) {
    await env.AUTH_DB.prepare(
      "INSERT INTO owned_rooms (room_id, owner_user_id, created_at) VALUES (?, ?, ?)",
    )
      .bind(roomId, user.id, Date.now())
      .run();
  }

  const response = await stub.fetch("https://room.internal/command", {
    method: "POST",
    body: JSON.stringify(command),
  });
  if (!response.ok) {
    if (user && input.persistent)
      await env.AUTH_DB.prepare("DELETE FROM owned_rooms WHERE room_id = ?")
        .bind(roomId)
        .run();
    return response;
  }

  return Response.json(
    {
      roomId,
      inviteUrl: `${new URL(request.url).origin}/rooms/${roomId}#invite=${inviteCredential}`,
    },
    { status: 201 },
  );
}

async function joinRoom(request: Request, stub: DurableObjectStub) {
  const input = await readJson<{
    displayName?: string;
    inviteCredential?: string;
  }>(request);
  const playerId = crypto.randomUUID();
  const reconnectToken = randomToken(32);
  const command: RoomCommand = {
    protocolVersion: ROOM_PROTOCOL_VERSION,
    type: "join",
    playerId,
    displayName: input.displayName ?? "",
    reconnectHash: await hashSecret(reconnectToken),
    ...(input.inviteCredential
      ? { inviteHash: await hashSecret(input.inviteCredential) }
      : {}),
  };
  const response = await stub.fetch("https://room.internal/command", {
    method: "POST",
    body: JSON.stringify(command),
  });
  if (!response.ok) return response;
  return Response.json(
    { playerId, reconnectToken, state: await response.json() },
    { status: 201 },
  );
}

async function forwardCommand(request: Request, stub: DurableObjectStub) {
  const input = await readJson<{
    playerId?: string;
    reconnectToken?: string;
    command?: RoomCommand;
  }>(request);
  if (!input.playerId || !input.reconnectToken || !input.command)
    return Response.json(
      { error: "Player credentials and command are required" },
      { status: 400 },
    );
  const command = {
    ...input.command,
    playerId: input.playerId,
    reconnectHash: await hashSecret(input.reconnectToken),
    protocolVersion: ROOM_PROTOCOL_VERSION,
  } as RoomCommand;
  return stub.fetch("https://room.internal/command", {
    method: "POST",
    body: JSON.stringify(command),
  });
}

async function roomState(request: Request, stub: DurableObjectStub) {
  const input = await readJson<{ playerId?: string; reconnectToken?: string }>(
    request,
  );
  const internal = new URL("https://room.internal/state");
  if (input.playerId && input.reconnectToken) {
    internal.searchParams.set("playerId", input.playerId);
    internal.searchParams.set(
      "reconnectHash",
      await hashSecret(input.reconnectToken),
    );
  }
  return stub.fetch(internal);
}

async function roomSocket(
  request: Request,
  stub: DurableObjectStub,
  env: WorkerEnv,
) {
  if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket")
    return Response.json(
      { error: "WebSocket upgrade required" },
      { status: 426 },
    );
  if (request.headers.get("Origin") !== env.PASSKEY_ORIGIN)
    return Response.json({ error: "Origin is not allowed" }, { status: 403 });
  const protocols =
    request.headers
      .get("Sec-WebSocket-Protocol")
      ?.split(",")
      .map((value) => value.trim()) ?? [];
  const encoded = protocols
    .find((value) => value.startsWith("credentials."))
    ?.slice("credentials.".length);
  if (!protocols.includes("wildcard") || !encoded)
    return Response.json(
      { error: "WebSocket credentials are required" },
      { status: 401 },
    );
  let credentials: { playerId?: string; reconnectToken?: string };
  try {
    credentials = JSON.parse(decodeBase64Url(encoded)) as typeof credentials;
  } catch {
    return Response.json(
      { error: "WebSocket credentials are invalid" },
      { status: 401 },
    );
  }
  if (!credentials.playerId || !credentials.reconnectToken)
    return Response.json(
      { error: "WebSocket credentials are invalid" },
      { status: 401 },
    );
  const headers = new Headers(request.headers);
  headers.set("X-Wildcard-Player", credentials.playerId);
  headers.set(
    "X-Wildcard-Reconnect",
    await hashSecret(credentials.reconnectToken),
  );
  headers.set("Sec-WebSocket-Protocol", "wildcard");
  return stub.fetch("https://room.internal/socket", { headers });
}

async function readJson<T>(request: Request): Promise<T> {
  if (Number(request.headers.get("Content-Length") ?? 0) > 16_384)
    throw new Error("Request body is too large");
  return request.json<T>();
}

export async function hashSecret(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function randomToken(bytes: number) {
  const data = crypto.getRandomValues(new Uint8Array(bytes));
  let binary = "";
  for (const byte of data) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function decodeBase64Url(value: string) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  return atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
}
