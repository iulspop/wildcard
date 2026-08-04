import type { Card, CardColor, Shuffle } from "./types.ts";

export const CARD_COLORS: readonly CardColor[] = [
  "red",
  "yellow",
  "green",
  "blue",
];

export function createStandardDeck(): Card[] {
  const cards: Card[] = [];
  let sequence = 0;
  const add = (card: Omit<Card, "id">) =>
    cards.push({ id: `card-${sequence++}`, ...card });

  for (const color of CARD_COLORS) {
    add({ color, kind: "number", value: 0 });
    for (let copy = 0; copy < 2; copy++) {
      for (let value = 1; value <= 9; value++)
        add({ color, kind: "number", value });
      add({ color, kind: "skip" });
      add({ color, kind: "reverse" });
      add({ color, kind: "draw2" });
    }
  }

  for (let copy = 0; copy < 4; copy++) {
    add({ color: "wild", kind: "wild" });
    add({ color: "wild", kind: "wild4" });
  }

  return cards;
}

export const identityShuffle: Shuffle = (cards) => [...cards];

export function randomShuffle(random: () => number = Math.random): Shuffle {
  return (cards) => {
    const shuffled = [...cards];
    for (let index = shuffled.length - 1; index > 0; index--) {
      const target = Math.floor(random() * (index + 1));
      [shuffled[index], shuffled[target]] = [
        shuffled[target]!,
        shuffled[index]!,
      ];
    }
    return shuffled;
  };
}
