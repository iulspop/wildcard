import type { GameAction, GameRules, GameState } from "../domain/game/types.ts";
import type { GameView } from "../domain/game/view.ts";

export const ROOM_PROTOCOL_VERSION = 1 as const;

export interface RoomSeat {
  playerId: string;
  displayName: string;
  seatIndex: number;
  connected: boolean;
}

export interface RoomMetadata {
  roomId: string;
  name: string;
  ownerUserId: string | null;
  persistent: boolean;
  protected: boolean;
  createdAt: number;
  version: number;
}

interface BaseCommand {
  protocolVersion: typeof ROOM_PROTOCOL_VERSION;
}

export type RoomCommand =
  | (BaseCommand & {
      type: "create";
      roomId: string;
      name: string;
      ownerUserId?: string;
      inviteHash?: string;
      persistent: boolean;
    })
  | (BaseCommand & {
      type: "join";
      playerId: string;
      displayName: string;
      reconnectHash: string;
      inviteHash?: string;
      authenticatedUserId?: string;
    })
  | (BaseCommand & {
      type: "reconnect";
      playerId: string;
      reconnectHash: string;
    })
  | (BaseCommand & { type: "leave"; playerId: string; reconnectHash: string })
  | (BaseCommand & {
      type: "start";
      playerId: string;
      reconnectHash: string;
      rules?: GameRules;
    })
  | (BaseCommand & {
      type: "lobby";
      playerId: string;
      reconnectHash: string;
    })
  | (BaseCommand & {
      type: "kick";
      playerId: string;
      reconnectHash: string;
      targetPlayerId: string;
    })
  | (BaseCommand & {
      type: "end-game";
      playerId: string;
      reconnectHash: string;
    })
  | (BaseCommand & {
      type: "action";
      playerId: string;
      reconnectHash: string;
      action: GameAction;
    });

export interface RoomStanding {
  displayName: string;
  games: number;
  wins: number;
  losses: number;
  updatedAt: number;
}

export interface RoomStateResponse {
  protocolVersion: typeof ROOM_PROTOCOL_VERSION;
  room: RoomMetadata;
  seats: RoomSeat[];
  game: GameView | null;
  standings: RoomStanding[];
}

export interface StoredRoomState {
  room: RoomMetadata;
  seats: Array<RoomSeat & { reconnectHash: string; userId: string | null }>;
  game: GameState | null;
}
