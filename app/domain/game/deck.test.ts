import { describe, expect, it } from "vitest";

import { createStandardDeck, randomShuffle } from "./deck.ts";

it("creates a 108-card Wildcard deck with unique IDs", () => {
  const deck = createStandardDeck();
  expect(deck).toHaveLength(108);
  expect(new Set(deck.map((card) => card.id))).toHaveLength(108);
  expect(deck.filter((card) => card.kind === "wild")).toHaveLength(4);
  expect(deck.filter((card) => card.kind === "wild4")).toHaveLength(4);
  expect(deck.filter((card) => card.kind === "draw2")).toHaveLength(8);
});

describe("randomShuffle", () => {
  it("does not mutate its input", () => {
    const deck = createStandardDeck();
    const original = [...deck];
    const shuffled = randomShuffle(() => 0.5)(deck);
    expect(deck).toEqual(original);
    expect(shuffled).not.toBe(deck);
    expect(shuffled).toHaveLength(deck.length);
  });
});
