import { describe, expect, it } from "vitest";

import { createStandardDeck, identityShuffle } from "./deck.ts";
import {
  applyAction,
  canPlayCard,
  createGame,
  randomPlayerShuffle,
} from "./engine.ts";
import { DEFAULT_GAME_RULES } from "./rules.ts";
import { card, makeTestState } from "./test-helpers.ts";
import {
  GAME_PROTOCOL_VERSION,
  GameRuleError,
  type GameAction,
} from "./types.ts";

type ActionInput =
  | { type: "draw" }
  | { type: "pass" }
  | { type: "call-uno"; claimId: string }
  | { type: "catch-uno"; claimId: string }
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

  it("randomizes player order before dealing", () => {
    const players = [
      { id: "p1", name: "One" },
      { id: "p2", name: "Two" },
      { id: "p3", name: "Three" },
      { id: "p4", name: "Four" },
    ];
    const state = createGame({
      players,
      shuffle: identityShuffle,
      playerShuffle: randomPlayerShuffle(() => 0),
    });

    expect(state.players.map((player) => player.id)).toEqual([
      "p2",
      "p3",
      "p4",
      "p1",
    ]);
    expect(players.map((player) => player.id)).toEqual([
      "p1",
      "p2",
      "p3",
      "p4",
    ]);
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
    expect(result.state.lastPlay).toEqual({
      playerId: "p1",
      cards: [first, second],
    });
    expect(state.players[0]!.hand).toHaveLength(3);
    expect(state.lastPlay).toBeNull();
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

describe("rank-all completion", () => {
  it("records finishers in order and automatically places the last active player", () => {
    const firstLastCard = card("red", "number", 7);
    const secondLastCard = card("red", "number", 8);
    const state = makeTestState({
      rules: { ...DEFAULT_GAME_RULES, finishMode: "rank-all" },
      players: [
        { id: "p1", name: "One", hand: [firstLastCard] },
        { id: "p2", name: "Two", hand: [secondLastCard] },
        { id: "p3", name: "Three", hand: [card("green", "number", 3)] },
      ],
    });

    const firstResult = applyAction(
      state,
      action("p1", { type: "play", cardIds: [firstLastCard.id] }),
    );
    expect(firstResult.state).toMatchObject({
      phase: "playing",
      finishOrder: ["p1"],
      winnerId: null,
    });
    expect(
      firstResult.state.players[firstResult.state.currentPlayerIndex]!.id,
    ).toBe("p2");
    expect(firstResult.events).toContainEqual({
      type: "player-finished",
      playerId: "p1",
      placement: 1,
    });

    const finalResult = applyAction(
      firstResult.state,
      action("p2", { type: "play", cardIds: [secondLastCard.id] }),
    );
    expect(finalResult.state).toMatchObject({
      phase: "finished",
      finishOrder: ["p1", "p2", "p3"],
      winnerId: "p1",
    });
    expect(finalResult.events).toContainEqual({
      type: "player-finished",
      playerId: "p3",
      placement: 3,
    });
    expect(finalResult.events).toContainEqual({
      type: "game-won",
      playerId: "p1",
    });
  });

  it("skips finished players without changing their ring positions", () => {
    const playable = card("red", "number", 7);
    const state = makeTestState({
      rules: { ...DEFAULT_GAME_RULES, finishMode: "rank-all" },
      players: [
        { id: "p1", name: "One", hand: [playable, card("green", "number", 1)] },
        { id: "p2", name: "Two", hand: [] },
        { id: "p3", name: "Three", hand: [card("green", "number", 3)] },
        { id: "p4", name: "Four", hand: [card("green", "number", 4)] },
      ],
      finishOrder: ["p2"],
    });

    const clockwise = applyAction(
      state,
      action("p1", { type: "play", cardIds: [playable.id] }),
    ).state;
    expect(clockwise.players[clockwise.currentPlayerIndex]!.id).toBe("p3");

    const reverseState = makeTestState({
      ...state,
      direction: -1,
      players: state.players.map((player) => ({
        ...player,
        hand: player.hand.map((held) => ({ ...held })),
      })),
    });
    const counterclockwise = applyAction(
      reverseState,
      action("p1", { type: "play", cardIds: [playable.id] }),
    ).state;
    expect(
      counterclockwise.players[counterclockwise.currentPlayerIndex]!.id,
    ).toBe("p4");
  });

  it("rejects gameplay actions from finished spectators", () => {
    const state = makeTestState({
      rules: { ...DEFAULT_GAME_RULES, finishMode: "rank-all" },
      currentPlayerIndex: 1,
      finishOrder: ["p1"],
    });

    expect(() =>
      applyAction(state, action("p1", { type: "draw" })),
    ).toThrowError(expect.objectContaining({ code: "invalid-action" }));
  });
});

describe("drawing a playable card", () => {
  it("lets the player lead with the drawn card and stack compatible cards", () => {
    const matching = card("red", "number", 5);
    const remaining = card("green", "number", 8);
    const drawn = card("blue", "number", 5);
    const state = makeTestState({
      players: [
        { id: "p1", name: "One", hand: [matching, remaining] },
        { id: "p2", name: "Two", hand: [card("green", "number", 2)] },
      ],
      drawPile: [drawn],
    });

    const afterDraw = applyAction(state, action("p1", { type: "draw" }), {
      shuffle: identityShuffle,
    }).state;

    expect(afterDraw.currentPlayerIndex).toBe(0);
    expect(afterDraw.drawnCardId).toBe(drawn.id);
    expect(canPlayCard(afterDraw, drawn)).toBe(true);
    expect(canPlayCard(afterDraw, matching)).toBe(false);

    const afterPlay = applyAction(
      afterDraw,
      action("p1", {
        type: "play",
        cardIds: [drawn.id, matching.id],
      }),
    ).state;
    expect(afterPlay.currentPlayerIndex).toBe(1);
    expect(afterPlay.drawnCardId).toBeNull();
    expect(afterPlay.lastPlay?.cards).toEqual([drawn, matching]);
  });

  it("rejects grouped plays that do not start with the drawn card", () => {
    const matching = card("red", "number", 5);
    const drawn = card("blue", "number", 5);
    const afterDraw = applyAction(
      makeTestState({
        players: [
          { id: "p1", name: "One", hand: [matching] },
          { id: "p2", name: "Two", hand: [card("green", "number", 2)] },
        ],
        drawPile: [drawn],
      }),
      action("p1", { type: "draw" }),
      { shuffle: identityShuffle },
    ).state;

    expect(() =>
      applyAction(
        afterDraw,
        action("p1", {
          type: "play",
          cardIds: [matching.id, drawn.id],
        }),
      ),
    ).toThrowError("must start with the card drawn this turn");
  });

  it("lets the player keep a playable drawn card and end their turn", () => {
    const drawn = card("blue", "number", 5);
    const afterDraw = applyAction(
      makeTestState({ drawPile: [drawn] }),
      action("p1", { type: "draw" }),
      { shuffle: identityShuffle },
    ).state;

    const afterPass = applyAction(
      afterDraw,
      action("p1", { type: "pass" }),
    ).state;
    expect(afterPass.currentPlayerIndex).toBe(1);
    expect(afterPass.drawnCardId).toBeNull();
    expect(afterPass.players[0]!.hand).toContainEqual(drawn);
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

describe("UNO claims", () => {
  function openClaim(now = 1_000) {
    const played = card("red", "number", 7);
    const remaining = card("blue", "number", 2);
    const state = makeTestState({
      players: [
        { id: "p1", name: "One", hand: [played, remaining] },
        {
          id: "p2",
          name: "Two",
          hand: [card("yellow", "number", 3), card("green", "number", 4)],
        },
      ],
    });
    const result = applyAction(
      state,
      action("p1", { type: "play", cardIds: [played.id] }),
      { now, generateClaimId: () => "claim-1" },
    );
    return { state: result.state, remaining };
  }

  it("opens a deterministic claim when a play leaves one card", () => {
    const { state } = openClaim();
    expect(state.actionSequence).toBe(1);
    expect(state.unoClaim).toEqual({
      id: "claim-1",
      targetPlayerId: "p1",
      openedAtSequence: 1,
      catchableAt: 1_750,
    });
  });

  it("does not leave a claim when the player wins", () => {
    const last = card("red", "number", 7);
    const state = makeTestState({
      players: [
        { id: "p1", name: "One", hand: [last] },
        { id: "p2", name: "Two", hand: [card("blue", "number", 2)] },
      ],
    });
    const result = applyAction(
      state,
      action("p1", { type: "play", cardIds: [last.id] }),
      { now: 1_000, generateClaimId: () => "unused" },
    );
    expect(result.state.phase).toBe("finished");
    expect(result.state.unoClaim).toBeNull();
  });

  it("allows the target to call during grace and rejects other callers", () => {
    const { state } = openClaim();
    expect(() =>
      applyAction(
        state,
        action("p2", { type: "call-uno", claimId: "claim-1" }),
        { now: 1_100 },
      ),
    ).toThrowError(expect.objectContaining({ code: "uno-not-target" }));
    const called = applyAction(
      state,
      action("p1", { type: "call-uno", claimId: "claim-1" }),
      { now: 1_100 },
    );
    expect(called.state.unoClaim).toBeNull();
    expect(called.events).toContainEqual({
      type: "uno-called",
      playerId: "p1",
      claimId: "claim-1",
    });
  });

  it("rejects early, self, and stale catches without mutating the claim", () => {
    const { state } = openClaim();
    for (const [playerId, claimId, now, code] of [
      ["p2", "claim-1", 1_749, "uno-too-early"],
      ["p1", "claim-1", 1_800, "uno-self-catch"],
      ["p2", "old-claim", 1_800, "uno-stale"],
    ] as const) {
      expect(() =>
        applyAction(state, action(playerId, { type: "catch-uno", claimId }), {
          now,
        }),
      ).toThrowError(expect.objectContaining({ code }));
      expect(state.unoClaim?.id).toBe("claim-1");
      expect(state.players[0]!.hand).toHaveLength(1);
    }
  });

  it("applies exactly four cards after grace without changing the turn", () => {
    const { state } = openClaim();
    const beforeTurn = state.currentPlayerIndex;
    const caught = applyAction(
      state,
      action("p2", { type: "catch-uno", claimId: "claim-1" }),
      { now: 1_750, shuffle: identityShuffle },
    );
    expect(caught.state.players[0]!.hand).toHaveLength(5);
    expect(caught.state.currentPlayerIndex).toBe(beforeTurn);
    expect(caught.state.pendingDraw).toBe(state.pendingDraw);
    expect(caught.state.unoClaim).toBeNull();
  });

  it("expires an unanswered claim on accepted gameplay but not rejected gameplay", () => {
    const { state } = openClaim();
    expect(() =>
      applyAction(state, action("p1", { type: "draw" }), { now: 2_000 }),
    ).toThrowError(expect.objectContaining({ code: "not-your-turn" }));
    expect(state.unoClaim?.id).toBe("claim-1");

    const advanced = applyAction(state, action("p2", { type: "draw" }), {
      now: 2_000,
      shuffle: identityShuffle,
    });
    expect(advanced.state.unoClaim).toBeNull();
    expect(advanced.events).toContainEqual({
      type: "uno-expired",
      playerId: "p1",
      claimId: "claim-1",
    });
  });

  it("opens a claim after a grouped play leaves exactly one card", () => {
    const first = card("red", "number", 7);
    const second = card("blue", "number", 7);
    const remaining = card("green", "number", 1);
    const state = makeTestState({
      players: [
        { id: "p1", name: "One", hand: [first, second, remaining] },
        { id: "p2", name: "Two", hand: [card("yellow", "number", 4)] },
      ],
    });
    const result = applyAction(
      state,
      action("p1", {
        type: "play",
        cardIds: [first.id, second.id],
      }),
      { now: 5_000, generateClaimId: () => "group-claim" },
    );
    expect(result.state.players[0]!.hand).toEqual([remaining]);
    expect(result.state.unoClaim?.id).toBe("group-claim");
  });
});
