import { canPlayCard } from "./engine.ts";
import type {
  Card,
  CardColor,
  DrawKind,
  GamePhase,
  GameState,
} from "./types.ts";

export interface PlayerView {
  id: string;
  name: string;
  cardCount: number;
  hand?: Card[];
}

export interface GameView {
  protocolVersion: 1;
  phase: GamePhase;
  players: PlayerView[];
  topDiscard: Card;
  drawPileCount: number;
  currentPlayerId: string;
  direction: 1 | -1;
  activeColor: CardColor;
  pendingDraw: { kind: DrawKind; amount: number } | null;
  drawnCardId: string | null;
  unoClaim: {
    id: string;
    targetPlayerId: string;
    catchableAt: number;
  } | null;
  playableCardIds: string[];
  winnerId: string | null;
  turnNumber: number;
}

export function projectGame(state: GameState, viewerId?: string): GameView {
  const topDiscard = state.discardPile.at(-1);
  if (!topDiscard) throw new Error("Game state has no discard card");

  return {
    protocolVersion: state.protocolVersion,
    phase: state.phase,
    players: state.players.map((player) => ({
      id: player.id,
      name: player.name,
      cardCount: player.hand.length,
      ...(player.id === viewerId
        ? { hand: player.hand.map((card) => ({ ...card })) }
        : {}),
    })),
    topDiscard: { ...topDiscard },
    drawPileCount: state.drawPile.length,
    currentPlayerId: state.players[state.currentPlayerIndex]!.id,
    direction: state.direction,
    activeColor: state.activeColor,
    pendingDraw: state.pendingDraw ? { ...state.pendingDraw } : null,
    drawnCardId: state.drawnCardId,
    unoClaim: state.unoClaim
      ? {
          id: state.unoClaim.id,
          targetPlayerId: state.unoClaim.targetPlayerId,
          catchableAt: state.unoClaim.catchableAt,
        }
      : null,
    playableCardIds:
      viewerId === state.players[state.currentPlayerIndex]!.id
        ? state.players[state.currentPlayerIndex]!.hand.filter((card) =>
            canPlayCard(state, card),
          ).map((card) => card.id)
        : [],
    winnerId: state.winnerId,
    turnNumber: state.turnNumber,
  };
}
