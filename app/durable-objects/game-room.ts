import { randomShuffle } from "../domain/game/deck.ts";
import { applyAction, createGame } from "../domain/game/engine.ts";
import { normalizeRules } from "../domain/game/rules.ts";
import { GameRuleError, type GameState } from "../domain/game/types.ts";
import { projectGame } from "../domain/game/view.ts";
import type { WorkerEnv } from "../services/env.server.ts";
import {
  ROOM_PROTOCOL_VERSION,
  type RoomCommand,
  type RoomMetadata,
  type RoomStateResponse,
  type StoredRoomState,
} from "./protocol.ts";
import { ROOM_SCHEMA } from "./schema.ts";
import { findSeatForAuthenticatedReclaim } from "./seat-identity.ts";

type MetadataRow = {
  room_id: string;
  name: string;
  owner_user_id: string | null;
  persistent: number;
  invite_hash: string | null;
  created_at: number;
  version: number;
};
type SeatRow = {
  player_id: string;
  display_name: string;
  reconnect_hash: string;
  user_id: string | null;
  seat_index: number;
  connected: number;
};

type SocketAttachment = {
  playerId: string;
  reconnectHash: string;
  windowStartedAt?: number;
  messageCount?: number;
  unoWindowStartedAt?: number;
  unoMessageCount?: number;
};

const MAX_SOCKET_MESSAGE_BYTES = 16_384;
const RATE_WINDOW_MS = 10_000;
const MAX_MESSAGES_PER_WINDOW = 20;
const UNO_RATE_WINDOW_MS = 1_000;
const MAX_UNO_MESSAGES_PER_WINDOW = 3;
const DEFAULT_TEMPORARY_ROOM_TTL_MS = 60 * 60 * 1000;

export class GameRoom implements DurableObject {
  constructor(
    private readonly state: DurableObjectState,
    private readonly env: WorkerEnv,
  ) {
    void this.env;
    for (const statement of ROOM_SCHEMA.split(";")
      .map((sql) => sql.trim())
      .filter(Boolean)) {
      this.state.storage.sql.exec(statement);
    }
    const seatColumns = this.state.storage.sql
      .exec<{ name: string }>("PRAGMA table_info(seats)")
      .toArray();
    if (!seatColumns.some((column) => column.name === "user_id"))
      this.state.storage.sql.exec("ALTER TABLE seats ADD COLUMN user_id TEXT");
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/socket") {
      return this.openSocket(request);
    }
    if (request.method === "POST" && url.pathname === "/command") {
      return this.state.blockConcurrencyWhile(async () => {
        try {
          const command = await request.json<RoomCommand>();
          const result = await this.execute(command);
          return Response.json(result);
        } catch (error) {
          const status =
            error instanceof RoomError
              ? error.status
              : error instanceof GameRuleError
                ? 409
                : 400;
          const code =
            error instanceof RoomError || error instanceof GameRuleError
              ? error.code
              : "invalid-request";
          return Response.json(
            {
              error:
                error instanceof Error ? error.message : "Room command failed",
              code,
            },
            { status },
          );
        }
      });
    }
    if (request.method === "GET" && url.pathname === "/state") {
      try {
        const playerId = url.searchParams.get("playerId") ?? undefined;
        const reconnectHash =
          url.searchParams.get("reconnectHash") ?? undefined;
        if (playerId)
          this.requireSeat(await this.load(), playerId, reconnectHash);
        return Response.json(this.publicState(await this.load(), playerId));
      } catch (error) {
        return Response.json(
          {
            error: error instanceof Error ? error.message : "Room state failed",
          },
          { status: error instanceof RoomError ? error.status : 400 },
        );
      }
    }
    if (request.method === "DELETE" && url.pathname === "/room") {
      return this.state.blockConcurrencyWhile(async () => {
        const ownerUserId = request.headers.get("X-Wildcard-Owner");
        const metadata = this.metadataRow();
        if (!metadata)
          return Response.json({ error: "Room not found" }, { status: 404 });
        if (!metadata.persistent || metadata.owner_user_id !== ownerUserId)
          return Response.json(
            { error: "Room owner required" },
            { status: 403 },
          );

        for (const socket of this.state.getWebSockets())
          socket.close(4004, "Room deleted by owner");
        await this.state.storage.deleteAll();
        return Response.json({ deleted: true });
      });
    }
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer) {
    try {
      const size =
        typeof message === "string"
          ? new TextEncoder().encode(message).byteLength
          : message.byteLength;
      if (size > MAX_SOCKET_MESSAGE_BYTES)
        throw new RoomError(
          "message-too-large",
          "WebSocket message is too large",
          413,
        );
      if (typeof message !== "string")
        throw new RoomError(
          "invalid-message",
          "WebSocket messages must be JSON text",
          400,
        );

      const now = Date.now();
      const attachment = socket.deserializeAttachment() as SocketAttachment;
      attachment.windowStartedAt ??= now;
      attachment.messageCount ??= 0;
      attachment.unoWindowStartedAt ??= now;
      attachment.unoMessageCount ??= 0;
      if (now - attachment.windowStartedAt >= RATE_WINDOW_MS) {
        attachment.windowStartedAt = now;
        attachment.messageCount = 0;
      }
      attachment.messageCount += 1;
      if (attachment.messageCount > MAX_MESSAGES_PER_WINDOW)
        throw new RoomError("rate-limited", "Too many room actions", 429);

      const incoming = JSON.parse(message) as RoomCommand;
      const isUnoCommand =
        incoming.type === "action" &&
        (incoming.action?.type === "call-uno" ||
          incoming.action?.type === "catch-uno");
      if (isUnoCommand) {
        if (now - attachment.unoWindowStartedAt >= UNO_RATE_WINDOW_MS) {
          attachment.unoWindowStartedAt = now;
          attachment.unoMessageCount = 0;
        }
        attachment.unoMessageCount += 1;
        if (attachment.unoMessageCount > MAX_UNO_MESSAGES_PER_WINDOW) {
          socket.serializeAttachment(attachment);
          throw new RoomError("uno-rate-limited", "Too many UNO attempts", 429);
        }
      }
      socket.serializeAttachment(attachment);
      if (
        incoming.type !== "action" &&
        incoming.type !== "start" &&
        incoming.type !== "lobby" &&
        incoming.type !== "kick" &&
        incoming.type !== "end-game" &&
        incoming.type !== "leave"
      )
        throw new RoomError(
          "invalid-socket-command",
          "Command is not allowed over this socket",
          400,
        );
      const command = {
        ...incoming,
        playerId: attachment.playerId,
        reconnectHash: attachment.reconnectHash,
      } as RoomCommand;
      await this.execute(command);
      await this.broadcastSnapshots();
    } catch (error) {
      socket.send(
        JSON.stringify({
          type: "error",
          code:
            error instanceof RoomError || error instanceof GameRuleError
              ? error.code
              : "invalid-message",
          message:
            error instanceof Error ? error.message : "WebSocket command failed",
        }),
      );
    }
  }

  async webSocketClose(socket: WebSocket) {
    const attachment =
      socket.deserializeAttachment() as SocketAttachment | null;
    const remainingSockets = this.state
      .getWebSockets()
      .filter((candidate) => candidate !== socket);
    if (attachment) {
      const currentSeat = this.state.storage.sql
        .exec<{ reconnect_hash: string }>(
          "SELECT reconnect_hash FROM seats WHERE player_id = ?",
          attachment.playerId,
        )
        .toArray()[0];
      if (currentSeat?.reconnect_hash === attachment.reconnectHash) {
        const stillConnected = remainingSockets.some((candidate) => {
          const candidateAttachment =
            candidate.deserializeAttachment() as SocketAttachment | null;
          return (
            candidateAttachment?.playerId === attachment.playerId &&
            candidateAttachment.reconnectHash === attachment.reconnectHash
          );
        });
        this.state.storage.sql.exec(
          "UPDATE seats SET connected = ? WHERE player_id = ?",
          stillConnected ? 1 : 0,
          attachment.playerId,
        );
      }
    }
    if (remainingSockets.length === 0) {
      const row = this.metadataRow();
      if (row && !row.persistent)
        await this.state.storage.setAlarm(
          Date.now() + this.temporaryRoomTtlMs(),
        );
    } else {
      await this.broadcastSnapshots();
    }
  }

  async webSocketError(socket: WebSocket) {
    await this.webSocketClose(socket);
  }

  async alarm() {
    const row = this.metadataRow();
    if (!row || row.persistent || this.state.getWebSockets().length > 0) return;
    await this.state.storage.deleteAll();
  }

  private async openSocket(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket")
      return Response.json(
        { error: "WebSocket upgrade required" },
        { status: 426 },
      );
    if (request.headers.get("Origin") !== this.env.PASSKEY_ORIGIN)
      return Response.json({ error: "Origin is not allowed" }, { status: 403 });
    const playerId = request.headers.get("X-Wildcard-Player");
    const reconnectHash = request.headers.get("X-Wildcard-Reconnect");
    if (!playerId || !reconnectHash)
      return Response.json(
        { error: "Player credentials are required" },
        { status: 401 },
      );

    const stored = this.load();
    const seat = this.requireSeat(stored, playerId, reconnectHash);
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.serializeAttachment({
      playerId,
      reconnectHash,
      windowStartedAt: Date.now(),
      messageCount: 0,
      unoWindowStartedAt: Date.now(),
      unoMessageCount: 0,
    } satisfies SocketAttachment);
    this.state.acceptWebSocket(server);
    this.state.storage.sql.exec(
      "UPDATE seats SET connected = 1 WHERE player_id = ?",
      playerId,
    );
    seat.connected = true;
    await this.state.storage.deleteAlarm();
    server.send(
      JSON.stringify({
        type: "snapshot",
        state: this.publicState(stored, playerId),
      }),
    );
    await this.broadcastSnapshots(server);
    return new Response(null, {
      status: 101,
      webSocket: client,
      headers: { "Sec-WebSocket-Protocol": "wildcard" },
    });
  }

  private async broadcastSnapshots(except?: WebSocket) {
    const stored = this.load();
    for (const socket of this.state.getWebSockets()) {
      if (socket === except) continue;
      const attachment = socket.deserializeAttachment() as SocketAttachment;
      try {
        socket.send(
          JSON.stringify({
            type: "snapshot",
            state: this.publicState(stored, attachment.playerId),
          }),
        );
      } catch {
        socket.close(1011, "Snapshot delivery failed");
      }
    }
  }

  private async execute(
    command: RoomCommand,
  ): Promise<
    RoomStateResponse | { playerId: string; state: RoomStateResponse }
  > {
    if (command.protocolVersion !== ROOM_PROTOCOL_VERSION)
      throw new RoomError(
        "protocol-mismatch",
        "Unsupported room protocol version",
        400,
      );
    if (command.type === "create") return this.create(command);

    const stored = await this.load();
    if (command.type === "join") return this.join(stored, command);
    const seat = this.requireSeat(
      stored,
      command.playerId,
      command.reconnectHash,
    );

    if (command.type === "reconnect") {
      this.state.storage.sql.exec(
        "UPDATE seats SET connected = 1 WHERE player_id = ?",
        seat.playerId,
      );
      seat.connected = true;
      return this.publicState(stored, seat.playerId);
    }
    if (command.type === "leave") {
      this.state.storage.sql.exec(
        "UPDATE seats SET connected = 0 WHERE player_id = ?",
        seat.playerId,
      );
      seat.connected = false;
      return this.publicState(stored, seat.playerId);
    }
    if (command.type === "start")
      return this.start(stored, seat, command.rules);
    if (command.type === "lobby") return this.returnToLobby(stored, seat);
    if (command.type === "kick")
      return this.kickPlayer(stored, seat, command.targetPlayerId);
    if (command.type === "end-game") return this.endGame(stored, seat);
    if (command.type === "action")
      return this.action(stored, seat, command.action);
    throw new RoomError("invalid-command", "Unknown room command", 400);
  }

  private async create(
    command: Extract<RoomCommand, { type: "create" }>,
  ): Promise<RoomStateResponse> {
    if (this.metadataRow())
      throw new RoomError(
        "already-created",
        "Room is already initialized",
        409,
      );
    const name = validateName(command.name, "Room name");
    const now = Date.now();
    this.state.storage.sql.exec(
      "INSERT INTO room_metadata (singleton, room_id, name, owner_user_id, persistent, invite_hash, created_at, version) VALUES (1, ?, ?, ?, ?, ?, ?, 1)",
      command.roomId,
      name,
      command.ownerUserId ?? null,
      command.persistent ? 1 : 0,
      command.inviteHash ?? null,
      now,
    );
    return this.publicState({
      room: {
        roomId: command.roomId,
        name,
        ownerUserId: command.ownerUserId ?? null,
        persistent: command.persistent,
        protected: Boolean(command.inviteHash),
        createdAt: now,
        version: 1,
      },
      seats: [],
      game: null,
    });
  }

  private join(
    stored: StoredRoomState,
    command: Extract<RoomCommand, { type: "join" }>,
  ): { playerId: string; state: RoomStateResponse } {
    const row = this.metadataRow()!;
    const ownerAuthorized =
      Boolean(command.authenticatedUserId) &&
      command.authenticatedUserId === row.owner_user_id;
    if (
      row.invite_hash &&
      row.invite_hash !== command.inviteHash &&
      !ownerAuthorized
    )
      throw new RoomError(
        "invite-required",
        "The room invite credential is invalid",
        403,
      );
    if (stored.seats.some((seat) => seat.playerId === command.playerId))
      throw new RoomError("player-exists", "Player is already seated", 409);
    const displayName = validateName(command.displayName, "Display name");
    const namedSeat = stored.seats.find(
      (seat) =>
        seat.displayName.toLocaleLowerCase() ===
        displayName.toLocaleLowerCase(),
    );
    const reclaimableSeat = findSeatForAuthenticatedReclaim(
      stored.seats,
      command.authenticatedUserId,
      row.owner_user_id,
      displayName,
    );
    if (reclaimableSeat) {
      this.state.storage.sql.exec(
        "UPDATE seats SET reconnect_hash = ?, user_id = ?, connected = 1, joined_at = ? WHERE player_id = ?",
        command.reconnectHash,
        command.authenticatedUserId ?? null,
        Date.now(),
        reclaimableSeat.playerId,
      );
      reclaimableSeat.reconnectHash = command.reconnectHash;
      reclaimableSeat.userId = command.authenticatedUserId ?? null;
      reclaimableSeat.connected = true;
      for (const socket of this.state.getWebSockets()) {
        const attachment = socket.deserializeAttachment() as
          SocketAttachment | undefined;
        if (attachment?.playerId === reclaimableSeat.playerId)
          socket.close(4001, "Seat resumed from another device");
      }
      this.bumpVersion(stored);
      return {
        playerId: reclaimableSeat.playerId,
        state: this.publicState(stored, reclaimableSeat.playerId),
      };
    }
    if (namedSeat)
      throw new RoomError("name-taken", "Display name is already in use", 409);
    if (stored.game?.phase === "playing")
      throw new RoomError(
        "game-in-progress",
        "The game has already started",
        409,
      );
    if (stored.seats.length >= 8)
      throw new RoomError("room-full", "The room is full", 409);
    const seat = {
      playerId: command.playerId,
      displayName,
      reconnectHash: command.reconnectHash,
      userId: command.authenticatedUserId ?? null,
      seatIndex: stored.seats.length,
      connected: true,
    };
    const now = Date.now();
    this.state.storage.sql.exec(
      "INSERT INTO seats (player_id, display_name, reconnect_hash, user_id, seat_index, connected, joined_at) VALUES (?, ?, ?, ?, ?, 1, ?)",
      seat.playerId,
      seat.displayName,
      seat.reconnectHash,
      seat.userId,
      seat.seatIndex,
      now,
    );
    stored.seats.push(seat);
    this.bumpVersion(stored);
    return {
      playerId: seat.playerId,
      state: this.publicState(stored, seat.playerId),
    };
  }

  private start(
    stored: StoredRoomState,
    seat: StoredRoomState["seats"][number],
    rules: Extract<RoomCommand, { type: "start" }>["rules"],
  ): RoomStateResponse {
    if (seat.seatIndex !== 0)
      throw new RoomError(
        "not-owner",
        "Only the room host can start the game",
        403,
      );
    if (stored.game?.phase === "playing")
      throw new RoomError(
        "game-in-progress",
        "The game is already running",
        409,
      );
    stored.game = createGame({
      players: stored.seats.map(({ playerId, displayName }) => ({
        id: playerId,
        name: displayName,
      })),
      rules,
      shuffle: randomShuffle(secureRandom),
    });
    this.persistGame(stored.game);
    this.bumpVersion(stored);
    return this.publicState(stored, seat.playerId);
  }

  private kickPlayer(
    stored: StoredRoomState,
    seat: StoredRoomState["seats"][number],
    targetPlayerId: string,
  ): RoomStateResponse {
    if (seat.seatIndex !== 0)
      throw new RoomError(
        "not-owner",
        "Only the room host can remove players",
        403,
      );
    if (stored.game)
      throw new RoomError(
        "game-in-progress",
        "Players can only be removed from the lobby",
        409,
      );
    if (targetPlayerId === seat.playerId)
      throw new RoomError(
        "cannot-kick-owner",
        "The room host cannot remove themselves",
        409,
      );
    const target = stored.seats.find(
      (candidate) => candidate.playerId === targetPlayerId,
    );
    if (!target)
      throw new RoomError("player-not-found", "Player is not seated", 404);

    this.state.storage.sql.exec(
      "DELETE FROM seats WHERE player_id = ?",
      targetPlayerId,
    );
    stored.seats = stored.seats.filter(
      (candidate) => candidate.playerId !== targetPlayerId,
    );
    this.state.storage.sql.exec(
      "UPDATE seats SET seat_index = seat_index + 100",
    );
    stored.seats.forEach((candidate, index) => {
      candidate.seatIndex = index;
      this.state.storage.sql.exec(
        "UPDATE seats SET seat_index = ? WHERE player_id = ?",
        index,
        candidate.playerId,
      );
    });
    for (const socket of this.state.getWebSockets()) {
      const attachment = socket.deserializeAttachment() as SocketAttachment;
      if (attachment.playerId === targetPlayerId)
        socket.close(4001, "Removed from the room by the host");
    }
    this.bumpVersion(stored);
    return this.publicState(stored, seat.playerId);
  }

  private endGame(
    stored: StoredRoomState,
    seat: StoredRoomState["seats"][number],
  ): RoomStateResponse {
    if (seat.seatIndex !== 0)
      throw new RoomError(
        "not-owner",
        "Only the room host can end the game",
        403,
      );
    if (!stored.game || stored.game.phase !== "playing")
      throw new RoomError(
        "no-active-game",
        "There is no active game to end",
        409,
      );
    stored.game = null;
    this.state.storage.sql.exec(
      "DELETE FROM game_snapshot WHERE singleton = 1",
    );
    this.bumpVersion(stored);
    return this.publicState(stored, seat.playerId);
  }

  private returnToLobby(
    stored: StoredRoomState,
    seat: StoredRoomState["seats"][number],
  ): RoomStateResponse {
    if (seat.seatIndex !== 0)
      throw new RoomError(
        "not-owner",
        "Only the room host can return to the lobby",
        403,
      );
    if (!stored.game || stored.game.phase !== "finished")
      throw new RoomError(
        "game-not-finished",
        "The game must be finished before returning to the lobby",
        409,
      );
    stored.game = null;
    this.state.storage.sql.exec(
      "DELETE FROM game_snapshot WHERE singleton = 1",
    );
    this.bumpVersion(stored);
    return this.publicState(stored, seat.playerId);
  }

  private action(
    stored: StoredRoomState,
    seat: StoredRoomState["seats"][number],
    action: Extract<RoomCommand, { type: "action" }>["action"],
  ): RoomStateResponse {
    if (!stored.game || stored.game.phase !== "playing")
      throw new RoomError("no-active-game", "There is no active game", 409);
    if (action.playerId !== seat.playerId)
      throw new RoomError(
        "player-mismatch",
        "Action player does not match the authenticated seat",
        403,
      );
    const processed = this.state.storage.sql
      .exec<{ action_id: string }>(
        "SELECT action_id FROM processed_actions WHERE action_id = ?",
        action.actionId,
      )
      .toArray()[0];
    if (processed) return this.publicState(stored, seat.playerId);
    stored.game = applyAction(stored.game, action, {
      shuffle: randomShuffle(secureRandom),
      now: Date.now(),
      generateClaimId: () => crypto.randomUUID(),
    }).state;
    if (stored.game.phase === "finished" && stored.game.winnerId)
      this.recordCompletedMatch(stored, action.actionId, stored.game.winnerId);
    this.persistGame(stored.game);
    this.bumpVersion(stored);
    this.state.storage.sql.exec(
      "INSERT INTO processed_actions (action_id, player_id, room_version, created_at) VALUES (?, ?, ?, ?)",
      action.actionId,
      seat.playerId,
      stored.room.version,
      Date.now(),
    );
    return this.publicState(stored, seat.playerId);
  }

  private load(): StoredRoomState {
    const row = this.metadataRow();
    if (!row)
      throw new RoomError("not-initialized", "Room not initialized", 404);
    const seats = this.state.storage.sql
      .exec<SeatRow>(
        "SELECT player_id, display_name, reconnect_hash, user_id, seat_index, connected FROM seats ORDER BY seat_index",
      )
      .toArray()
      .map((seat) => ({
        playerId: seat.player_id,
        displayName: seat.display_name,
        reconnectHash: seat.reconnect_hash,
        userId: seat.user_id,
        seatIndex: seat.seat_index,
        connected: Boolean(seat.connected),
      }));
    const snapshot = this.state.storage.sql
      .exec<{ state_json: string }>(
        "SELECT state_json FROM game_snapshot WHERE singleton = 1",
      )
      .toArray()[0];
    const game = snapshot
      ? (JSON.parse(snapshot.state_json) as GameState)
      : null;
    if (game) {
      game.rules = normalizeRules(game.rules);
      if (game.drawnCardId === undefined) game.drawnCardId = null;
      if (game.unoClaim === undefined) game.unoClaim = null;
      if (game.actionSequence === undefined) game.actionSequence = 0;
      const unoTarget = game.unoClaim
        ? game.players.find(
            (player) => player.id === game.unoClaim?.targetPlayerId,
          )
        : null;
      if (
        game.phase !== "playing" ||
        (game.unoClaim && (!unoTarget || unoTarget.hand.length !== 1))
      ) {
        game.unoClaim = null;
      }
    }
    return {
      room: mapMetadata(row),
      seats,
      game,
    };
  }

  private temporaryRoomTtlMs() {
    const configured = Number(this.env.TEMPORARY_ROOM_TTL_MS);
    return Number.isFinite(configured) && configured > 0
      ? configured
      : DEFAULT_TEMPORARY_ROOM_TTL_MS;
  }

  private metadataRow() {
    return this.state.storage.sql
      .exec<MetadataRow>(
        "SELECT room_id, name, owner_user_id, persistent, invite_hash, created_at, version FROM room_metadata WHERE singleton = 1",
      )
      .toArray()[0];
  }

  private requireSeat(
    stored: StoredRoomState,
    playerId: string,
    reconnectHash?: string,
  ) {
    const seat = stored.seats.find(
      (candidate) => candidate.playerId === playerId,
    );
    if (!seat || !reconnectHash || seat.reconnectHash !== reconnectHash)
      throw new RoomError(
        "invalid-reconnect",
        "Player reconnect credential is invalid",
        403,
      );
    return seat;
  }

  private recordCompletedMatch(
    stored: StoredRoomState,
    matchId: string,
    winnerId: string,
  ) {
    const now = Date.now();
    this.state.storage.sql.exec(
      "INSERT INTO completed_matches (id, winner_player_id, completed_at) VALUES (?, ?, ?)",
      matchId,
      winnerId,
      now,
    );
    for (const seat of stored.seats) {
      const won = seat.playerId === winnerId;
      this.state.storage.sql.exec(
        `INSERT INTO standings (display_name, games, wins, losses, updated_at)
         VALUES (?, 1, ?, ?, ?)
         ON CONFLICT(display_name) DO UPDATE SET
           games = games + 1,
           wins = wins + excluded.wins,
           losses = losses + excluded.losses,
           updated_at = excluded.updated_at`,
        seat.displayName,
        won ? 1 : 0,
        won ? 0 : 1,
        now,
      );
    }
  }

  private persistGame(game: GameState) {
    this.state.storage.sql.exec(
      "INSERT INTO game_snapshot (singleton, state_json, updated_at) VALUES (1, ?, ?) ON CONFLICT(singleton) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at",
      JSON.stringify(game),
      Date.now(),
    );
  }

  private bumpVersion(stored: StoredRoomState) {
    stored.room.version += 1;
    this.state.storage.sql.exec(
      "UPDATE room_metadata SET version = ? WHERE singleton = 1",
      stored.room.version,
    );
  }

  private publicState(
    stored: StoredRoomState,
    playerId?: string,
  ): RoomStateResponse {
    return {
      protocolVersion: ROOM_PROTOCOL_VERSION,
      room: { ...stored.room },
      seats: stored.seats.map((seat) => ({
        playerId: seat.playerId,
        displayName: seat.displayName,
        seatIndex: seat.seatIndex,
        connected: seat.connected,
      })),
      game: stored.game ? projectGame(stored.game, playerId) : null,
      standings: this.state.storage.sql
        .exec<{
          display_name: string;
          games: number;
          wins: number;
          losses: number;
          updated_at: number;
        }>(
          "SELECT display_name, games, wins, losses, updated_at FROM standings ORDER BY wins DESC, losses ASC, display_name ASC",
        )
        .toArray()
        .map((row) => ({
          displayName: row.display_name,
          games: row.games,
          wins: row.wins,
          losses: row.losses,
          updatedAt: row.updated_at,
        })),
    };
  }
}

function secureRandom() {
  const value = new Uint32Array(1);
  crypto.getRandomValues(value);
  return value[0]! / 0x1_0000_0000;
}

function mapMetadata(row: MetadataRow): RoomMetadata {
  return {
    roomId: row.room_id,
    name: row.name,
    ownerUserId: row.owner_user_id,
    persistent: Boolean(row.persistent),
    protected: Boolean(row.invite_hash),
    createdAt: row.created_at,
    version: row.version,
  };
}

function validateName(value: string, label: string) {
  const normalized = value.trim();
  if (normalized.length < 1 || normalized.length > 32)
    throw new RoomError(
      "invalid-name",
      `${label} must be 1–32 characters`,
      400,
    );
  return normalized;
}

class RoomError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "RoomError";
  }
}
