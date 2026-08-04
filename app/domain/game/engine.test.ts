import { describe, expect, it } from "vitest";

import { createStandardDeck, identityShuffle } from "./deck.ts";
import { applyAction, canPlayCard, createGame } from "./engine.ts";
import { DEFAULT_GAME_RULES } from "./rules.ts";
import { card, makeTestState } from "./test-helpers.ts";
import {
  GAME_PROTOCOL_VERSION,
  GameRuleError,
  type GameAction,
} from "./types.ts";

type ActionInput =
  | { type: "draw" }
  | {
      type: "play";
      cardIds: string[];
      chosenColor?: "red" | "yellow" | "green" | "blue";
    };

const action = (playerId: string, value: ActionInput): GameAction =>
  ({
    protocolVersion: GAME_PROTOCOL_VERSION,
    actionId: crypto.randomUUID(),
    playerId,
    ...value,
  }) as GameAction;

describe("createGame", () => {
  it("deals seven cards and starts on a colored number", () => {
    const state = createGame({
      players: [
        { id: "p1", name: "One" },
        { id: "p2", name: "Two" },
      ],
      deck: createStandardDeck(),
      shuffle: identityShuffle,
    });

    expect(state.players.map((player) => player.hand.length)).toEqual([7, 7]);
    expect(state.discardPile[0]).toMatchObject({ kind: "number" });
    expect(state.discardPile[0]!.color).not.toBe("wild");
    expect(state.drawPile).toHaveLength(93);
  });

  it("accepts 2–8 players and rejects counts outside the configured range", () => {
    for (const count of [2, 4, 8]) {
      const players = Array.from({ length: count }, (_, index) => ({
        id: `p${index}`,
        name: `Player ${index}`,
      }));
      expect(
        createGame({ players, shuffle: identityShuffle }).players,
      ).toHaveLength(count);
    }

    expect(() => createGame({ players: [{ id: "p1", name: "One" }] })).toThrow(
      GameRuleError,
    );
    const nine = Array.from({ length: 9 }, (_, index) => ({
      id: `p${index}`,
      name: "Player",
    }));
    expect(() => createGame({ players: nine })).toThrow(GameRuleError);
  });
});

describe("legal plays", () => {
  it("allows matching color, rank, action, and an anytime +4", () => {
    const state = makeTestState();
    expect(canPlayCard(state, card("red", "number", 1))).toBe(true);
    expect(canPlayCard(state, card("green", "number", 5))).toBe(true);
    expect(canPlayCard(state, card("blue", "skip"))).toBe(false);
    expect(canPlayCard(state, card("wild", "wild4"))).toBe(true);
  });

  it("plays a same-rank group across colors without mutating the input", () => {
    const first = card("red", "number", 7);
    const second = card("blue", "number", 7);
    const state = makeTestState({
      players: [
        {
          id: "p1",
          name: "One",
          hand: [first, second, card("green", "number", 1)],
        },
        { id: "p2", name: "Two", hand: [card("yellow", "number", 2)] },
      ],
    });

    const result = applyAction(
      state,
      action("p1", { type: "play", cardIds: [first.id, second.id] }),
    );
    expect(result.state.players[0]!.hand).toHaveLength(1);
    expect(result.state.activeColor).toBe("blue");
    expect(result.state.currentPlayerIndex).toBe(1);
    expect(state.players[0]!.hand).toHaveLength(3);
  });

  it("requires every grouped card to share the selected rank or action", () => {
    const seven = card("red", "number", 7);
    const eight = card("red", "number", 8);
    const state = makeTestState({
      players: [
        { id: "p1", name: "One", hand: [seven, eight] },
        { id: "p2", name: "Two", hand: [card("blue", "number", 1)] },
      ],
    });

    expect(() =>
      applyAction(
        state,
        action("p1", { type: "play", cardIds: [seven.id, eight.id] }),
      ),
    ).toThrowError(expect.objectContaining({ code: "illegal-play" }));
  });

  it("validates the first card against the discard pile", () => {
    const illegal = card("blue", "number", 2);
    const state = makeTestState({
      players: [
        { id: "p1", name: "One", hand: [illegal] },
        { id: "p2", name: "Two", hand: [card("green", "number", 1)] },
      ],
    });
    expect(() =>
      applyAction(state, action("p1", { type: "play", cardIds: [illegal.id] })),
    ).toThrowError(expect.objectContaining({ code: "illegal-play" }));
  });
});

describe("actions and turn order", () => {
  it("skips one player per grouped skip card", () => {
    const skips = [card("red", "skip"), card("blue", "skip")];
    const state = makeTestState({
      players: [
        { id: "p1", name: "One", hand: [...skips, card("green", "number", 1)] },
        { id: "p2", name: "Two", hand: [card("green", "number", 2)] },
        { id: "p3", name: "Three", hand: [card("green", "number", 3)] },
        { id: "p4", name: "Four", hand: [card("green", "number", 4)] },
      ],
      discardPile: [card("red", "number", 5)],
    });

    const result = applyAction(
      state,
      action("p1", { type: "play", cardIds: skips.map(({ id }) => id) }),
    );
    expect(result.state.players[result.state.currentPlayerIndex]!.id).toBe(
      "p4",
    );
  });

  it("resolves grouped reverses in order", () => {
    const reverses = [card("red", "reverse"), card("yellow", "reverse")];
    const state = makeTestState({
      players: [
        {
          id: "p1",
          name: "One",
          hand: [...reverses, card("green", "number", 1)],
        },
        { id: "p2", name: "Two", hand: [card("green", "number", 2)] },
        { id: "p3", name: "Three", hand: [card("green", "number", 3)] },
      ],
    });

    const result = applyAction(
      state,
      action("p1", { type: "play", cardIds: reverses.map(({ id }) => id) }),
    );
    expect(result.state.direction).toBe(1);
    expect(result.state.currentPlayerIndex).toBe(1);
  });

  it("requires a color for a final wild card", () => {
    const wild = card("wild", "wild");
    const state = makeTestState({
      players: [
        { id: "p1", name: "One", hand: [wild, card("red", "number", 1)] },
        { id: "p2", name: "Two", hand: [card("green", "number", 2)] },
      ],
    });

    expect(() =>
      applyAction(state, action("p1", { type: "play", cardIds: [wild.id] })),
    ).toThrowError(expect.objectContaining({ code: "color-required" }));
    const result = applyAction(
      state,
      action("p1", { type: "play", cardIds: [wild.id], chosenColor: "green" }),
    );
    expect(result.state.activeColor).toBe("green");
  });

  it("finishes when a player empties their hand", () => {
    const last = card("red", "number", 7);
    const state = makeTestState({
      players: [
        { id: "p1", name: "One", hand: [last] },
        { id: "p2", name: "Two", hand: [card("green", "number", 2)] },
      ],
    });
    const result = applyAction(
      state,
      action("p1", { type: "play", cardIds: [last.id] }),
    );
    expect(result.state).toMatchObject({ phase: "finished", winnerId: "p1" });
    expect(result.events).toContainEqual({ type: "game-won", playerId: "p1" });
  });
});

describe("draw stacking", () => {
  it("accumulates grouped draw cards and only permits the same type to pass the penalty", () => {
    const drawTwos = [card("red", "draw2"), card("blue", "draw2")];
    const p2DrawTwo = card("green", "draw2");
    let state = makeTestState({
      players: [
        {
          id: "p1",
          name: "One",
          hand: [...drawTwos, card("green", "number", 1)],
        },
        { id: "p2", name: "Two", hand: [p2DrawTwo, card("wild", "wild4")] },
        { id: "p3", name: "Three", hand: [card("green", "number", 3)] },
      ],
    });

    state = applyAction(
      state,
      action("p1", { type: "play", cardIds: drawTwos.map(({ id }) => id) }),
    ).state;
    expect(state.pendingDraw).toEqual({ kind: "draw2", amount: 4 });
    expect(canPlayCard(state, state.players[1]!.hand[1]!)).toBe(false);

    state = applyAction(
      state,
      action("p2", { type: "play", cardIds: [p2DrawTwo.id] }),
    ).state;
    expect(state.pendingDraw).toEqual({ kind: "draw2", amount: 6 });

    const before = state.players[2]!.hand.length;
    const result = applyAction(state, action("p3", { type: "draw" }), {
      shuffle: identityShuffle,
    });
    expect(result.state.players[2]!.hand).toHaveLength(before + 6);
    expect(result.state.pendingDraw).toBeNull();
    expect(result.state.currentPlayerIndex).toBe(0);
  });

  it("recycles all but the top discard when drawing", () => {
    const state = makeTestState({
      drawPile: [],
      discardPile: [
        card("blue", "number", 1),
        card("yellow", "number", 2),
        card("red", "number", 5),
      ],
    });
    const result = applyAction(state, action("p1", { type: "draw" }), {
      shuffle: identityShuffle,
    });
    expect(result.state.discardPile).toHaveLength(1);
    expect(result.state.discardPile[0]).toEqual(state.discardPile.at(-1));
    expect(result.state.drawPile).toHaveLength(1);
  });
});

describe("invalid actions", () => {
  it("rejects out-of-turn, duplicate-card, and malformed actions", () => {
    const state = makeTestState();
    expect(() =>
      applyAction(state, action("p2", { type: "draw" })),
    ).toThrowError(expect.objectContaining({ code: "not-your-turn" }));
    const held = state.players[0]!.hand[0]!;
    expect(() =>
      applyAction(
        state,
        action("p1", { type: "play", cardIds: [held.id, held.id] }),
      ),
    ).toThrowError(expect.objectContaining({ code: "invalid-action" }));
    expect(() =>
      applyAction(state, { ...action("p1", { type: "draw" }), actionId: "" }),
    ).toThrowError(expect.objectContaining({ code: "invalid-action" }));
  });

  it("honors configurable group-play and draw-ending rules", () => {
    const first = card("red", "number", 7);
    const second = card("blue", "number", 7);
    const state = makeTestState({
      rules: { ...DEFAULT_GAME_RULES, groupPlay: false, drawEndsTurn: false },
      players: [
        { id: "p1", name: "One", hand: [first, second] },
        { id: "p2", name: "Two", hand: [card("green", "number", 2)] },
      ],
    });
    expect(() =>
      applyAction(
        state,
        action("p1", { type: "play", cardIds: [first.id, second.id] }),
      ),
    ).toThrowError(expect.objectContaining({ code: "illegal-play" }));
    expect(
      applyAction(state, action("p1", { type: "draw" })).state
        .currentPlayerIndex,
    ).toBe(0);
  });
});
