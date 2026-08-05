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
  placement: number | null;
  hand?: Card[];
}

export interface GameView {
  protocolVersion: 1;
  phase: GamePhase;
  finishMode: "first-out" | "rank-all";
  finishOrder: string[];
  players: PlayerView[];
  topDiscard: Card;
  drawPileCount: number;
  currentPlayerId: string;
  seatedOpponentIds: string[];
  direction: 1 | -1;
  activeColor: CardColor;
  pendingDraw: { kind: DrawKind; amount: number } | null;
  drawnCardId: string | null;
  lastPlay: { playerId: string; cards: Card[] } | null;
  unoClaim: {
    id: string;
    targetPlayerId: string;
    catchableAt: number;
  } | null;
  playableCardIds: string[];
  winnerId: string | null;
  turnNumber: number;
}

function placementFor(state: GameState, playerId: string): number | null {
  const index = state.finishOrder.indexOf(playerId);
  return index === -1 ? null : index + 1;
}

export function projectGame(state: GameState, viewerId?: string): GameView {
  const topDiscard = state.discardPile.at(-1);
  if (!topDiscard) throw new Error("Game state has no discard card");
  const viewerIndex = state.players.findIndex(
    (player) => player.id === viewerId,
  );
  const seatedOpponentIds =
    viewerIndex === -1
      ? state.players.map((player) => player.id)
      : Array.from(
          { length: state.players.length - 1 },
          (_, offset) =>
            state.players[(viewerIndex + offset + 1) % state.players.length]!
              .id,
        );

  return {
    protocolVersion: state.protocolVersion,
    phase: state.phase,
    finishMode: state.rules.finishMode,
    finishOrder: [...state.finishOrder],
    players: state.players.map((player) => ({
      id: player.id,
      name: player.name,
      cardCount: player.hand.length,
      placement: placementFor(state, player.id),
      ...(player.id === viewerId
        ? { hand: player.hand.map((card) => ({ ...card })) }
        : {}),
    })),
    topDiscard: { ...topDiscard },
    drawPileCount: state.drawPile.length,
    currentPlayerId: state.players[state.currentPlayerIndex]!.id,
    seatedOpponentIds,
    direction: state.direction,
    activeColor: state.activeColor,
    pendingDraw: state.pendingDraw ? { ...state.pendingDraw } : null,
    drawnCardId: state.drawnCardId,
    lastPlay: state.lastPlay
      ? {
          playerId: state.lastPlay.playerId,
          cards: state.lastPlay.cards.map((card) => ({ ...card })),
        }
      : null,
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
