import { createStandardDeck, randomShuffle } from "./deck.ts";
import { DEFAULT_GAME_RULES, validateRules } from "./rules.ts";
import {
  GAME_PROTOCOL_VERSION,
  GameRuleError,
  type Card,
  type CardColor,
  type GameAction,
  type GameEvent,
  type GameRules,
  type GameState,
  type PlayerSeed,
  type Shuffle,
  type TransitionResult,
} from "./types.ts";

export interface CreateGameOptions {
  players: PlayerSeed[];
  rules?: GameRules;
  deck?: Card[];
  shuffle?: Shuffle;
}

export interface ApplyActionOptions {
  shuffle?: Shuffle;
}

export function createGame({
  players,
  rules = DEFAULT_GAME_RULES,
  deck = createStandardDeck(),
  shuffle = randomShuffle(),
}: CreateGameOptions): GameState {
  validateRules(rules);
  validatePlayers(players, rules);
  validateDeck(deck, players.length * rules.initialHandSize + 1);

  const drawPile = shuffle(deck.map((card) => ({ ...card })));
  const gamePlayers = players.map((player) => ({
    ...player,
    hand: [] as Card[],
  }));

  for (let round = 0; round < rules.initialHandSize; round++) {
    for (const player of gamePlayers) player.hand.push(drawRequired(drawPile));
  }

  const initialDiscardIndex = findInitialDiscardIndex(drawPile);
  const [initialDiscard] = drawPile.splice(initialDiscardIndex, 1);
  if (!initialDiscard || initialDiscard.color === "wild") {
    throw new GameRuleError(
      "invalid-state",
      "A colored initial discard is required",
    );
  }

  return {
    protocolVersion: GAME_PROTOCOL_VERSION,
    rules: { ...rules },
    phase: "playing",
    players: gamePlayers,
    drawPile,
    discardPile: [initialDiscard],
    currentPlayerIndex: 0,
    direction: 1,
    activeColor: initialDiscard.color,
    pendingDraw: null,
    winnerId: null,
    turnNumber: 1,
  };
}

export function applyAction(
  state: GameState,
  action: GameAction,
  { shuffle = randomShuffle() }: ApplyActionOptions = {},
): TransitionResult {
  validateStateAndAction(state, action);
  const next = cloneState(state);
  const player = next.players[next.currentPlayerIndex]!;

  if (action.type === "draw") return applyDraw(next, player.id, shuffle);
  if (action.type === "play") return applyPlay(next, action, player.id);
  throw new GameRuleError("invalid-action", "Unknown game action");
}

export function canPlayCard(state: GameState, card: Card): boolean {
  if (state.pendingDraw) {
    return (
      state.rules.drawStacking === "same-type" &&
      card.kind === state.pendingDraw.kind
    );
  }

  if (card.color === "wild") {
    if (card.kind !== "wild4" || state.rules.wild4Anytime) return true;
    const player = state.players[state.currentPlayerIndex]!;
    return !player.hand.some((held) => held.color === state.activeColor);
  }

  const top = state.discardPile.at(-1);
  if (!top) return false;
  return card.color === state.activeColor || groupKey(card) === groupKey(top);
}

function applyPlay(
  state: GameState,
  action: Extract<GameAction, { type: "play" }>,
  playerId: string,
): TransitionResult {
  if (!Array.isArray(action.cardIds) || action.cardIds.length === 0) {
    throw new GameRuleError(
      "invalid-action",
      "At least one card must be played",
    );
  }
  if (!state.rules.groupPlay && action.cardIds.length > 1) {
    throw new GameRuleError("illegal-play", "Grouped plays are disabled");
  }
  if (new Set(action.cardIds).size !== action.cardIds.length) {
    throw new GameRuleError(
      "invalid-action",
      "A card cannot be played more than once",
    );
  }

  const player = state.players[state.currentPlayerIndex]!;
  const cards = action.cardIds.map((cardId) => {
    const card = player.hand.find((candidate) => candidate.id === cardId);
    if (!card)
      throw new GameRuleError(
        "card-not-in-hand",
        "Card is not in the player's hand",
      );
    return card;
  });

  const expectedGroup = groupKey(cards[0]!);
  if (cards.some((card) => groupKey(card) !== expectedGroup)) {
    throw new GameRuleError(
      "illegal-play",
      "Grouped cards must share the same rank or action",
    );
  }
  if (!canPlayCard(state, cards[0]!)) {
    throw new GameRuleError(
      "illegal-play",
      "The first card is not legal on the discard pile",
    );
  }

  const finalCard = cards.at(-1)!;
  if (finalCard.color === "wild" && !isCardColor(action.chosenColor)) {
    throw new GameRuleError(
      "color-required",
      "A color is required after a wild card",
    );
  }
  if (finalCard.color !== "wild" && action.chosenColor !== undefined) {
    throw new GameRuleError(
      "color-not-allowed",
      "A color may only be chosen for a wild card",
    );
  }

  const playedIds = new Set(action.cardIds);
  player.hand = player.hand.filter((card) => !playedIds.has(card.id));

  let skippedPlayers = 0;
  for (const card of cards) {
    state.discardPile.push(card);
    if (card.color !== "wild") state.activeColor = card.color;
    if (card.kind === "skip") skippedPlayers += 1;
    if (card.kind === "reverse")
      state.direction = state.direction === 1 ? -1 : 1;
    if (card.kind === "draw2" || card.kind === "wild4") {
      const amount = card.kind === "draw2" ? 2 : 4;
      state.pendingDraw = {
        kind: card.kind,
        amount: (state.pendingDraw?.amount ?? 0) + amount,
      };
    }
  }
  if (finalCard.color === "wild") state.activeColor = action.chosenColor!;

  const events: GameEvent[] = [
    { type: "cards-played", playerId, cardIds: [...action.cardIds] },
  ];

  if (player.hand.length === 0) {
    state.phase = "finished";
    state.winnerId = playerId;
    events.push({ type: "game-won", playerId });
    return { state, events };
  }

  finishTurn(state, 1 + skippedPlayers, events);
  return { state, events };
}

function applyDraw(
  state: GameState,
  playerId: string,
  shuffle: Shuffle,
): TransitionResult {
  const player = state.players[state.currentPlayerIndex]!;
  const penalty = state.pendingDraw !== null;
  const count = state.pendingDraw?.amount ?? 1;

  for (let index = 0; index < count; index++) {
    replenishDrawPile(state, shuffle);
    player.hand.push(drawRequired(state.drawPile));
  }

  state.pendingDraw = null;
  const events: GameEvent[] = [
    { type: "cards-drawn", playerId, count, penalty },
  ];
  if (penalty || state.rules.drawEndsTurn) finishTurn(state, 1, events);
  return { state, events };
}

function finishTurn(
  state: GameState,
  steps: number,
  events: GameEvent[],
): void {
  state.currentPlayerIndex = advanceIndex(
    state.currentPlayerIndex,
    state.direction,
    steps,
    state.players.length,
  );
  state.turnNumber += 1;
  events.push({
    type: "turn-changed",
    playerId: state.players[state.currentPlayerIndex]!.id,
    turnNumber: state.turnNumber,
  });
}

function replenishDrawPile(state: GameState, shuffle: Shuffle): void {
  if (state.drawPile.length > 0) return;
  if (state.discardPile.length <= 1) {
    throw new GameRuleError("empty-draw-pile", "No cards remain to draw");
  }

  const top = state.discardPile.pop()!;
  state.drawPile = shuffle(state.discardPile.map((card) => ({ ...card })));
  state.discardPile = [top];
}

function validateStateAndAction(state: GameState, action: GameAction): void {
  if (
    state.protocolVersion !== GAME_PROTOCOL_VERSION ||
    state.phase !== "playing"
  ) {
    throw new GameRuleError(
      "invalid-state",
      "The game is not accepting actions",
    );
  }
  if (!action || action.protocolVersion !== GAME_PROTOCOL_VERSION) {
    throw new GameRuleError(
      "invalid-action",
      "Unsupported action protocol version",
    );
  }
  if (typeof action.actionId !== "string" || action.actionId.length === 0) {
    throw new GameRuleError("invalid-action", "Action ID is required");
  }
  const currentPlayer = state.players[state.currentPlayerIndex];
  if (!currentPlayer || action.playerId !== currentPlayer.id) {
    throw new GameRuleError("not-your-turn", "It is not this player's turn");
  }
  if (action.type !== "draw" && action.type !== "play") {
    throw new GameRuleError("invalid-action", "Unknown game action");
  }
}

function validatePlayers(players: PlayerSeed[], rules: GameRules): void {
  if (players.length < rules.minPlayers || players.length > rules.maxPlayers) {
    throw new GameRuleError(
      "invalid-state",
      `A game requires ${rules.minPlayers}–${rules.maxPlayers} players`,
    );
  }
  if (new Set(players.map((player) => player.id)).size !== players.length) {
    throw new GameRuleError("invalid-state", "Player IDs must be unique");
  }
  if (players.some((player) => !player.id || !player.name.trim())) {
    throw new GameRuleError(
      "invalid-state",
      "Players require an ID and display name",
    );
  }
}

function validateDeck(deck: Card[], minimumCards: number): void {
  if (deck.length < minimumCards) {
    throw new GameRuleError(
      "invalid-state",
      "The deck does not contain enough cards",
    );
  }
  if (new Set(deck.map((card) => card.id)).size !== deck.length) {
    throw new GameRuleError("invalid-state", "Card IDs must be unique");
  }
}

function findInitialDiscardIndex(drawPile: Card[]): number {
  for (let index = drawPile.length - 1; index >= 0; index--) {
    const card = drawPile[index]!;
    if (card.color !== "wild" && card.kind === "number") return index;
  }
  throw new GameRuleError(
    "invalid-state",
    "The deck needs a colored number card",
  );
}

function drawRequired(cards: Card[]): Card {
  const card = cards.pop();
  if (!card)
    throw new GameRuleError("empty-draw-pile", "No cards remain to draw");
  return card;
}

function groupKey(card: Card): string {
  return card.kind === "number" ? `number:${card.value}` : card.kind;
}

function isCardColor(value: unknown): value is CardColor {
  return (
    value === "red" ||
    value === "yellow" ||
    value === "green" ||
    value === "blue"
  );
}

function advanceIndex(
  current: number,
  direction: 1 | -1,
  steps: number,
  count: number,
): number {
  return (((current + direction * steps) % count) + count) % count;
}

function cloneState(state: GameState): GameState {
  return {
    ...state,
    rules: { ...state.rules },
    players: state.players.map((player) => ({
      ...player,
      hand: player.hand.map((card) => ({ ...card })),
    })),
    drawPile: state.drawPile.map((card) => ({ ...card })),
    discardPile: state.discardPile.map((card) => ({ ...card })),
    pendingDraw: state.pendingDraw ? { ...state.pendingDraw } : null,
  };
}
