import { expect, it } from "vitest";

import { projectGame } from "./view.ts";
import { makeTestState } from "./test-helpers.ts";

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
