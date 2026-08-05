import { DEFAULT_GAME_RULES } from "./rules.ts";
import { GAME_PROTOCOL_VERSION, type Card, type GameState } from "./types.ts";

let cardSequence = 0;

export function card(
  color: Card["color"],
  kind: Card["kind"],
  value?: number,
): Card {
  return {
    id: `test-card-${cardSequence++}`,
    color,
    kind,
    ...(value === undefined ? {} : { value }),
  };
}

export function makeTestState(overrides: Partial<GameState> = {}): GameState {
  return {
    protocolVersion: GAME_PROTOCOL_VERSION,
    rules: { ...DEFAULT_GAME_RULES },
    phase: "playing",
    players: [
      {
        id: "p1",
        name: "One",
        hand: [card("red", "number", 7), card("blue", "skip")],
      },
      {
        id: "p2",
        name: "Two",
        hand: [card("green", "number", 3), card("yellow", "reverse")],
      },
      { id: "p3", name: "Three", hand: [card("blue", "number", 9)] },
    ],
    drawPile: Array.from({ length: 20 }, (_, index) =>
      card("green", "number", index % 10),
    ),
    discardPile: [card("red", "number", 5)],
    currentPlayerIndex: 0,
    direction: 1,
    activeColor: "red",
    pendingDraw: null,
    drawnCardId: null,
    lastPlay: null,
    unoClaim: null,
    actionSequence: 0,
    finishOrder: [],
    winnerId: null,
    turnNumber: 1,
    ...overrides,
  };
}
