export const GAME_PROTOCOL_VERSION = 1 as const;

export type CardColor = "red" | "yellow" | "green" | "blue";
export type WildColor = CardColor | "wild";
export type DrawKind = "draw2" | "wild4";
export type ActionKind = "skip" | "reverse" | DrawKind | "wild";
export type CardKind = "number" | ActionKind;

export interface Card {
  id: string;
  color: WildColor;
  kind: CardKind;
  value?: number;
}

export interface GameRules {
  version: 1;
  minPlayers: number;
  maxPlayers: number;
  initialHandSize: number;
  groupPlay: boolean;
  wild4Anytime: boolean;
  drawStacking: "same-type" | "none";
  drawEndsTurn: boolean;
}

export interface PlayerSeed {
  id: string;
  name: string;
}

export interface GamePlayer extends PlayerSeed {
  hand: Card[];
}

export interface PendingDraw {
  kind: DrawKind;
  amount: number;
}

export type GamePhase = "playing" | "finished";

export interface GameState {
  protocolVersion: typeof GAME_PROTOCOL_VERSION;
  rules: GameRules;
  phase: GamePhase;
  players: GamePlayer[];
  drawPile: Card[];
  discardPile: Card[];
  currentPlayerIndex: number;
  direction: 1 | -1;
  activeColor: CardColor;
  pendingDraw: PendingDraw | null;
  winnerId: string | null;
  turnNumber: number;
}

interface BaseAction {
  protocolVersion: typeof GAME_PROTOCOL_VERSION;
  actionId: string;
  playerId: string;
}

export interface PlayCardsAction extends BaseAction {
  type: "play";
  cardIds: string[];
  chosenColor?: CardColor;
}

export interface DrawCardsAction extends BaseAction {
  type: "draw";
}

export type GameAction = PlayCardsAction | DrawCardsAction;

export type GameEvent =
  | { type: "cards-played"; playerId: string; cardIds: string[] }
  | { type: "cards-drawn"; playerId: string; count: number; penalty: boolean }
  | { type: "turn-changed"; playerId: string; turnNumber: number }
  | { type: "game-won"; playerId: string };

export interface TransitionResult {
  state: GameState;
  events: GameEvent[];
}

export type Shuffle = (cards: readonly Card[]) => Card[];

export class GameRuleError extends Error {
  constructor(
    readonly code:
      | "invalid-state"
      | "invalid-action"
      | "not-your-turn"
      | "card-not-in-hand"
      | "illegal-play"
      | "color-required"
      | "color-not-allowed"
      | "empty-draw-pile",
    message: string,
  ) {
    super(message);
    this.name = "GameRuleError";
  }
}
