import { expect, it } from "vitest";

import { card, makeTestState } from "./test-helpers.ts";
import { projectGame } from "./view.ts";

it("only exposes the viewing player's hand", () => {
  const state = makeTestState();
  const view = projectGame(state, "p1");

  expect(view.players[0]!.hand).toEqual(state.players[0]!.hand);
  expect(view.players[1]!.hand).toBeUndefined();
  expect(view.players[1]!.cardCount).toBe(state.players[1]!.hand.length);
  expect(view.playableCardIds).toEqual([state.players[0]!.hand[0]!.id]);
  expect(projectGame(state, "p2").playableCardIds).toEqual([]);
  expect(JSON.stringify(view)).not.toContain(
    `"id":"${state.players[1]!.hand[0]!.id}"`,
  );
});

it("projects opponents in left-to-right upcoming turn order", () => {
  const state = makeTestState({
    players: [
      { id: "p1", name: "One", hand: [card("red", "number", 1)] },
      { id: "p2", name: "Two", hand: [card("red", "number", 2)] },
      { id: "p3", name: "Three", hand: [card("red", "number", 3)] },
      { id: "p4", name: "Four", hand: [card("red", "number", 4)] },
    ],
    currentPlayerIndex: 1,
    direction: 1,
  });

  expect(projectGame(state, "p1").upcomingPlayerIds).toEqual([
    "p2",
    "p3",
    "p4",
  ]);
  state.direction = -1;
  expect(projectGame(state, "p1").upcomingPlayerIds).toEqual([
    "p2",
    "p4",
    "p3",
  ]);
});

it("projects the public cards from the most recent play", () => {
  const state = makeTestState();
  const playedCards = state.players[0]!.hand.slice(0, 2);
  state.lastPlay = { playerId: "p1", cards: playedCards };

  for (const viewer of ["p1", "p2"]) {
    expect(projectGame(state, viewer).lastPlay).toEqual({
      playerId: "p1",
      cards: playedCards,
    });
  }
});

it("projects only public UNO claim metadata to every player", () => {
  const state = makeTestState({
    unoClaim: {
      id: "claim-public",
      targetPlayerId: "p1",
      openedAtSequence: 8,
      catchableAt: 12_345,
    },
  });

  for (const viewer of ["p1", "p2"]) {
    const serialized = JSON.stringify(projectGame(state, viewer));
    expect(projectGame(state, viewer).unoClaim).toEqual({
      id: "claim-public",
      targetPlayerId: "p1",
      catchableAt: 12_345,
    });
    expect(serialized).not.toContain("openedAtSequence");
    if (viewer === "p2") {
      expect(serialized).not.toContain(
        `"id":"${state.players[0]!.hand[0]!.id}"`,
      );
    }
  }
});
