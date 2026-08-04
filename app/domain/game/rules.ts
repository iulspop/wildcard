import type { GameRules } from "./types.ts";

export const DEFAULT_GAME_RULES: GameRules = Object.freeze({
  version: 1,
  minPlayers: 2,
  maxPlayers: 8,
  initialHandSize: 7,
  groupPlay: true,
  wild4Anytime: true,
  drawStacking: "same-type",
  drawEndsTurn: true,
  unoEnabled: true,
  unoCatchPenalty: 4,
  unoGraceMs: 750,
});

export function normalizeRules(rules: GameRules): GameRules {
  return {
    ...DEFAULT_GAME_RULES,
    ...rules,
  };
}

export function validateRules(rules: GameRules): void {
  if (rules.version !== 1) throw new Error("Unsupported game rules version");
  if (!Number.isInteger(rules.minPlayers) || rules.minPlayers < 2) {
    throw new Error("minPlayers must be at least 2");
  }
  if (
    !Number.isInteger(rules.maxPlayers) ||
    rules.maxPlayers < rules.minPlayers
  ) {
    throw new Error("maxPlayers must be greater than or equal to minPlayers");
  }
  if (!Number.isInteger(rules.initialHandSize) || rules.initialHandSize < 1) {
    throw new Error("initialHandSize must be positive");
  }
  if (!Number.isInteger(rules.unoCatchPenalty) || rules.unoCatchPenalty < 1) {
    throw new Error("unoCatchPenalty must be positive");
  }
  if (!Number.isInteger(rules.unoGraceMs) || rules.unoGraceMs < 0) {
    throw new Error("unoGraceMs cannot be negative");
  }
}
