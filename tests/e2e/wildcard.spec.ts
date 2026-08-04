import { expect, test, type APIRequestContext } from "@playwright/test";
import WebSocket from "ws";

type JoinedPlayer = { playerId: string; reconnectToken: string };
type Card = {
  id: string;
  color: "red" | "yellow" | "green" | "blue" | "wild";
  kind: "number" | "skip" | "reverse" | "draw2" | "wild" | "wild4";
  value?: number;
};
type GameState = {
  phase: "playing" | "finished";
  players: Array<{ id: string; cardCount: number; hand?: Card[] }>;
  topDiscard: Card;
  currentPlayerId: string;
  activeColor: "red" | "yellow" | "green" | "blue";
  pendingDraw: { kind: "draw2" | "wild4"; amount: number } | null;
  drawnCardId: string | null;
  playableCardIds: string[];
  unoClaim: {
    id: string;
    targetPlayerId: string;
    catchableAt: number;
  } | null;
  winnerId: string | null;
};

async function createRoom(request: APIRequestContext, name: string) {
  const response = await request.post("/api/rooms", {
    data: { name, persistent: false },
  });
  expect(response.status()).toBe(201);
  const room = (await response.json()) as { roomId: string; inviteUrl: string };
  return {
    ...room,
    inviteCredential: new URL(room.inviteUrl).hash.replace("#invite=", ""),
  };
}

async function join(
  request: APIRequestContext,
  roomId: string,
  displayName: string,
  inviteCredential?: string,
) {
  const response = await request.post(`/api/rooms/${roomId}/join`, {
    data: { displayName, inviteCredential },
  });
  expect(response.status()).toBe(201);
  return (await response.json()) as JoinedPlayer & { state: unknown };
}

function openRoomSocket(roomId: string, player: JoinedPlayer) {
  const encoded = Buffer.from(JSON.stringify(player)).toString("base64url");
  return new Promise<{ socket: WebSocket; snapshot: Record<string, unknown> }>(
    (resolve, reject) => {
      const socket = new WebSocket(
        `ws://localhost:8787/api/rooms/${roomId}/socket`,
        ["wildcard", `credentials.${encoded}`],
        { origin: "http://localhost:8787" },
      );
      socket.once("error", reject);
      socket.once("message", (data) => {
        resolve({
          socket,
          snapshot: JSON.parse(data.toString()) as Record<string, unknown>,
        });
      });
    },
  );
}

function closeSocket(socket: WebSocket) {
  return new Promise<void>((resolve) => {
    socket.once("close", () => resolve());
    socket.close();
  });
}

async function roomState(
  request: APIRequestContext,
  roomId: string,
  player: JoinedPlayer,
) {
  const response = await request.post(`/api/rooms/${roomId}/state`, {
    data: player,
  });
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as {
    game: GameState;
    standings: Array<{
      displayName: string;
      games: number;
      wins: number;
      losses: number;
    }>;
  };
}

async function sendGameAction(
  request: APIRequestContext,
  roomId: string,
  player: JoinedPlayer,
  action: Record<string, unknown>,
) {
  return request.post(`/api/rooms/${roomId}/command`, {
    data: {
      ...player,
      command: {
        protocolVersion: 1,
        type: "action",
        action: {
          protocolVersion: 1,
          actionId: crypto.randomUUID(),
          playerId: player.playerId,
          ...action,
        },
      },
    },
  });
}

function cardGroup(card: Card) {
  return card.kind === "number" ? `number:${card.value}` : card.kind;
}

async function playUntilUnoClaim(
  request: APIRequestContext,
  roomId: string,
  players: JoinedPlayer[],
) {
  for (let turn = 0; turn < 1_000; turn++) {
    const publicState = await roomState(request, roomId, players[0]!);
    if (publicState.game.unoClaim) return publicState.game.unoClaim;
    expect(publicState.game.phase).toBe("playing");
    const player = players.find(
      (candidate) => candidate.playerId === publicState.game.currentPlayerId,
    )!;
    const state = await roomState(request, roomId, player);
    const hand = state.game.players.find(
      (candidate) => candidate.id === player.playerId,
    )!.hand!;
    const playable = hand.find((card) =>
      state.game.playableCardIds.includes(card.id),
    );
    const response = playable
      ? await sendGameAction(request, roomId, player, {
          type: "play",
          cardIds: [playable.id],
          ...(playable.color === "wild" ? { chosenColor: "red" } : {}),
        })
      : state.game.drawnCardId
        ? await sendGameAction(request, roomId, player, { type: "pass" })
        : await sendGameAction(request, roomId, player, { type: "draw" });
    if (!response.ok()) {
      throw new Error(
        `UNO setup action failed (${response.status()}): ${await response.text()}`,
      );
    }
  }
  throw new Error("UNO claim did not open within 1,000 turns");
}

async function finishGame(
  request: APIRequestContext,
  roomId: string,
  players: JoinedPlayer[],
) {
  for (let turn = 0; turn < 1_000; turn++) {
    const publicState = await roomState(request, roomId, players[0]!);
    if (publicState.game.phase === "finished") return publicState;
    const player = players.find(
      (candidate) => candidate.playerId === publicState.game.currentPlayerId,
    )!;
    const state = await roomState(request, roomId, player);
    const hand = state.game.players.find(
      (candidate) => candidate.id === player.playerId,
    )!.hand!;
    const first = hand.find((card) =>
      state.game.playableCardIds.includes(card.id),
    );
    const response = first
      ? await sendGameAction(request, roomId, player, {
          type: "play",
          cardIds: state.game.drawnCardId
            ? [first.id]
            : [
                first.id,
                ...hand
                  .filter(
                    (card) =>
                      card.id !== first.id &&
                      cardGroup(card) === cardGroup(first),
                  )
                  .map((card) => card.id),
              ],
          ...(first.color === "wild" ? { chosenColor: "red" } : {}),
        })
      : state.game.drawnCardId
        ? await sendGameAction(request, roomId, player, { type: "pass" })
        : await sendGameAction(request, roomId, player, { type: "draw" });
    if (!response.ok()) {
      throw new Error(
        `Game action failed (${response.status()}): ${await response.text()}`,
      );
    }
  }
  throw new Error("Game did not finish within 1,000 turns");
}

test("home is usable on desktop and mobile", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Play your hand." }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Create private room" }),
  ).toBeVisible();
  await expect(page.locator("#account-trigger")).toHaveText("Sign in");
});

test("passkey users can create and reopen persistent rooms", async ({
  page,
}) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });

  await page.goto("/");
  await page.locator("#account-trigger").click();
  await page
    .getByRole("textbox", { name: /^Display name$/ })
    .fill("Test Player");
  await page.getByRole("button", { name: "Create passkey" }).click();
  await expect(page.locator("#auth-name")).toHaveText("Test Player");
  await expect(page.locator("#status")).toHaveText(
    "Passkey created. You are signed in.",
  );
  await expect(page.locator("#status")).toBeVisible();
  await expect(page.locator("#status")).toBeHidden({ timeout: 5_000 });

  await page.getByLabel("Name your room").fill("Permanent rivals");
  await page.getByLabel("Keep this room and its standings").check();
  await page.getByRole("button", { name: "Create private room" }).click();
  await expect(page).toHaveURL(/\/rooms\/[A-Za-z0-9_-]+#invite=.+$/);
  const roomUrl = new URL(page.url());
  const roomId = roomUrl.pathname.split("/").at(-1)!;
  const inviteCredential = roomUrl.hash.replace("#invite=", "");
  const alice = await join(page.request, roomId, "Alice", inviteCredential);
  const bob = await join(page.request, roomId, "Bob", inviteCredential);
  const start = await page.request.post(`/api/rooms/${roomId}/command`, {
    data: {
      ...alice,
      command: { protocolVersion: 1, type: "start" },
    },
  });
  expect(start.ok()).toBeTruthy();
  const finished = await finishGame(page.request, roomId, [alice, bob]);
  expect(finished.game.winnerId).toBeTruthy();
  expect(finished.game.unoClaim).toBeNull();
  expect(finished.standings).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ games: 1, wins: 1, losses: 0 }),
      expect.objectContaining({ games: 1, wins: 0, losses: 1 }),
    ]),
  );
  const lobby = await page.request.post(`/api/rooms/${roomId}/command`, {
    data: {
      ...alice,
      command: { protocolVersion: 1, type: "lobby" },
    },
  });
  expect(lobby.ok()).toBeTruthy();
  expect((await lobby.json()).game).toBeNull();
  const restart = await page.request.post(`/api/rooms/${roomId}/command`, {
    data: {
      ...alice,
      command: { protocolVersion: 1, type: "start" },
    },
  });
  expect(restart.ok()).toBeTruthy();
  expect((await restart.json()).game.phase).toBe("playing");

  await page.goto("/");
  await expect(page.locator("#owned-rooms")).toContainText("Permanent rivals");
  await page.goto(roomUrl.pathname);
  await expect(page).toHaveURL((url) => url.pathname === roomUrl.pathname);

  await page.goto("/");
  await page.getByText("Test Player", { exact: true }).click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.locator("#account-trigger")).toHaveText("Sign in");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator("#auth-name")).toHaveText("Test Player");
  await expect(page.locator("#owned-rooms")).toContainText("Permanent rivals");
});

test("guest players can create, join, and start a protected room privately", async ({
  page,
  request,
}) => {
  const createdResponse = await request.post("/api/rooms", {
    data: { name: "E2E table", protected: true, persistent: false },
  });
  expect(createdResponse.status()).toBe(201);
  const created = (await createdResponse.json()) as {
    roomId: string;
    inviteUrl: string;
  };
  const invite = new URL(created.inviteUrl).hash.slice("#invite=".length);
  expect(invite.length).toBeGreaterThan(20);

  const aliceResponse = await request.post(
    `/api/rooms/${created.roomId}/join`,
    {
      data: { displayName: "Alice", inviteCredential: invite },
    },
  );
  const bobResponse = await request.post(`/api/rooms/${created.roomId}/join`, {
    data: { displayName: "Bob", inviteCredential: invite },
  });
  expect(aliceResponse.status()).toBe(201);
  expect(bobResponse.status()).toBe(201);
  const alice = await aliceResponse.json();
  const bob = await bobResponse.json();

  const startResponse = await request.post(
    `/api/rooms/${created.roomId}/command`,
    {
      data: {
        playerId: alice.playerId,
        reconnectToken: alice.reconnectToken,
        command: { protocolVersion: 1, type: "start" },
      },
    },
  );
  expect(startResponse.ok()).toBeTruthy();

  const aliceStateResponse = await request.post(
    `/api/rooms/${created.roomId}/state`,
    {
      data: { playerId: alice.playerId, reconnectToken: alice.reconnectToken },
    },
  );
  const aliceState = await aliceStateResponse.json();
  expect(
    aliceState.game.players.find(
      (player: { id: string }) => player.id === alice.playerId,
    ).hand,
  ).toHaveLength(7);
  expect(
    aliceState.game.players.find(
      (player: { id: string }) => player.id === bob.playerId,
    ).hand,
  ).toBeUndefined();
  expect(JSON.stringify(aliceState)).not.toContain(bob.reconnectToken);

  await page.addInitScript(
    ({ roomId, credentials }) => {
      localStorage.setItem(`wildcard:${roomId}`, JSON.stringify(credentials));
    },
    { roomId: created.roomId, credentials: alice },
  );
  await page.goto(`/rooms/${created.roomId}`);
  await expect(page.locator("#game")).toBeVisible({ timeout: 10_000 });
  await expect(page.locator("#active-color")).toContainText(
    `Current color: ${aliceState.game.activeColor}`,
  );

  const hand = aliceState.game.players.find(
    (player: { id: string }) => player.id === alice.playerId,
  ).hand as Card[];
  const playableIds = aliceState.game.playableCardIds as string[];
  await expect(page.locator("#hand [data-card]:enabled")).toHaveCount(
    playableIds.length,
  );
  await expect(page.locator("#hand [data-card]:disabled")).toHaveCount(
    hand.length - playableIds.length,
  );

  const firstPlayable = hand.find((card) => playableIds.includes(card.id));
  if (firstPlayable) {
    await page.locator(`[data-card="${firstPlayable.id}"]`).click();
    await expect(page.locator("#hand [data-card]:enabled")).toHaveCount(
      hand.filter((card) => cardGroup(card) === cardGroup(firstPlayable))
        .length,
    );
  } else {
    await expect(page.locator("#draw")).toBeEnabled();
  }
});

test("invalid protected-room credentials are rejected", async ({ request }) => {
  const created = await (
    await request.post("/api/rooms", {
      data: { name: "Locked", protected: true },
    })
  ).json();
  const response = await request.post(`/api/rooms/${created.roomId}/join`, {
    data: { displayName: "Intruder", inviteCredential: "wrong" },
  });
  expect(response.status()).toBe(403);
});

test("eight players can join while unauthorized commands are rejected", async ({
  request,
}) => {
  const room = await createRoom(request, "Eight player table");
  const players = await Promise.all(
    Array.from({ length: 8 }, (_, index) =>
      join(request, room.roomId, `Player ${index + 1}`, room.inviteCredential),
    ),
  );
  const ninth = await request.post(`/api/rooms/${room.roomId}/join`, {
    data: {
      displayName: "Player 9",
      inviteCredential: room.inviteCredential,
    },
  });
  expect(ninth.status()).toBe(409);

  const forged = await request.post(`/api/rooms/${room.roomId}/command`, {
    data: {
      playerId: players[0]!.playerId,
      reconnectToken: "forged-token",
      command: { protocolVersion: 1, type: "start" },
    },
  });
  expect(forged.status()).toBe(403);

  const nonHost = await request.post(`/api/rooms/${room.roomId}/command`, {
    data: {
      ...players[1],
      command: { protocolVersion: 1, type: "start" },
    },
  });
  expect(nonHost.status()).toBe(403);

  const start = await request.post(`/api/rooms/${room.roomId}/command`, {
    data: {
      ...players[0],
      command: { protocolVersion: 1, type: "start" },
    },
  });
  expect(start.ok()).toBeTruthy();

  const outOfTurn = await sendGameAction(request, room.roomId, players[1]!, {
    type: "draw",
  });
  expect(outOfTurn.status()).toBe(409);
});

test("UNO claims resist stale catches and apply one race-safe penalty", async ({
  page,
  request,
}) => {
  const room = await createRoom(request, "UNO race table");
  const players = await Promise.all(
    ["Alice", "Bob", "Carol"].map((name) =>
      join(request, room.roomId, name, room.inviteCredential),
    ),
  );
  const start = await request.post(`/api/rooms/${room.roomId}/command`, {
    data: {
      ...players[0],
      command: { protocolVersion: 1, type: "start" },
    },
  });
  expect(start.ok()).toBeTruthy();
  const roomKeeper = await openRoomSocket(room.roomId, players[0]!);

  for (let attempt = 0; attempt < 3; attempt++) {
    const stale = await sendGameAction(request, room.roomId, players[1]!, {
      type: "catch-uno",
      claimId: `stale-${attempt}`,
    });
    expect(stale.status()).toBe(409);
  }

  const claim = await playUntilUnoClaim(request, room.roomId, players);
  const target = players.find(
    (player) => player.playerId === claim.targetPlayerId,
  )!;
  const catchers = players.filter(
    (player) => player.playerId !== claim.targetPlayerId,
  );
  const before = await roomState(request, room.roomId, target);
  expect(
    before.game.players.find((player) => player.id === target.playerId)
      ?.cardCount,
  ).toBe(1);

  const early = await sendGameAction(request, room.roomId, catchers[0]!, {
    type: "catch-uno",
    claimId: claim.id,
  });
  expect(early.status()).toBe(409);
  expect(
    (await roomState(request, room.roomId, target)).game.unoClaim?.id,
  ).toBe(claim.id);

  const reconnected = await openRoomSocket(room.roomId, target);
  expect(
    (
      reconnected.snapshot.state as {
        game: { unoClaim: { id: string } | null };
      }
    ).game.unoClaim?.id,
  ).toBe(claim.id);
  await closeSocket(reconnected.socket);

  await page.addInitScript(
    ({ roomId, credentials }) => {
      localStorage.setItem(`wildcard:${roomId}`, JSON.stringify(credentials));
    },
    { roomId: room.roomId, credentials: target },
  );
  await page.goto(`/rooms/${room.roomId}`);
  await expect(page.locator("#uno-call")).toBeVisible({ timeout: 10_000 });
  await expect(page.locator("#uno-catch")).toBeHidden();

  await new Promise((resolve) =>
    setTimeout(resolve, Math.max(0, claim.catchableAt - Date.now()) + 50),
  );
  const actionIds = catchers.map(() => crypto.randomUUID());
  const catchRequest = (player: JoinedPlayer, actionId: string) =>
    request.post(`/api/rooms/${room.roomId}/command`, {
      data: {
        ...player,
        command: {
          protocolVersion: 1,
          type: "action",
          action: {
            protocolVersion: 1,
            actionId,
            playerId: player.playerId,
            type: "catch-uno",
            claimId: claim.id,
          },
        },
      },
    });
  const results = await Promise.all(
    catchers.map((player, index) => catchRequest(player, actionIds[index]!)),
  );
  expect(results.filter((response) => response.ok())).toHaveLength(1);
  expect(results.filter((response) => response.status() === 409)).toHaveLength(
    1,
  );

  const after = await roomState(request, room.roomId, target);
  expect(after.game.unoClaim).toBeNull();
  expect(
    after.game.players.find((player) => player.id === target.playerId)
      ?.cardCount,
  ).toBe(5);

  const winnerIndex = results.findIndex((response) => response.ok());
  const winner = catchers[winnerIndex]!;
  const duplicate = await catchRequest(winner, actionIds[winnerIndex]!);
  expect(duplicate.ok()).toBeTruthy();
  const afterDuplicate = await roomState(request, room.roomId, target);
  expect(
    afterDuplicate.game.players.find((player) => player.id === target.playerId)
      ?.cardCount,
  ).toBe(5);
  await closeSocket(roomKeeper.socket);
});

test("an ignored UNO claim expires on the next accepted gameplay action", async ({
  request,
}) => {
  const room = await createRoom(request, "Forgotten UNO table");
  const players = await Promise.all(
    ["Alice", "Bob"].map((name) =>
      join(request, room.roomId, name, room.inviteCredential),
    ),
  );
  const keeper = await openRoomSocket(room.roomId, players[0]!);
  const start = await request.post(`/api/rooms/${room.roomId}/command`, {
    data: {
      ...players[0],
      command: { protocolVersion: 1, type: "start" },
    },
  });
  expect(start.ok()).toBeTruthy();
  const claim = await playUntilUnoClaim(request, room.roomId, players);
  const publicState = await roomState(request, room.roomId, players[0]!);
  const current = players.find(
    (player) => player.playerId === publicState.game.currentPlayerId,
  )!;
  const currentState = await roomState(request, room.roomId, current);
  const hand = currentState.game.players.find(
    (player) => player.id === current.playerId,
  )!.hand!;
  const playable = hand.find((card) =>
    currentState.game.playableCardIds.includes(card.id),
  );
  const response = currentState.game.drawnCardId
    ? await sendGameAction(request, room.roomId, current, { type: "pass" })
    : playable
      ? await sendGameAction(request, room.roomId, current, {
          type: "play",
          cardIds: [playable.id],
          ...(playable.color === "wild" ? { chosenColor: "red" } : {}),
        })
      : await sendGameAction(request, room.roomId, current, { type: "draw" });
  expect(response.ok()).toBeTruthy();
  const after = await roomState(request, room.roomId, players[0]!);
  expect(claim.id).toBeTruthy();
  expect(after.game.unoClaim).toBeNull();
  await closeSocket(keeper.socket);
});

test("hibernating sockets reconnect with recipient-safe snapshots", async ({
  request,
}) => {
  const room = await createRoom(request, "Reconnect table");
  const alice = await join(
    request,
    room.roomId,
    "Alice",
    room.inviteCredential,
  );
  const bob = await join(request, room.roomId, "Bob", room.inviteCredential);
  const aliceConnection = await openRoomSocket(room.roomId, alice);
  const bobConnection = await openRoomSocket(room.roomId, bob);

  aliceConnection.socket.send(
    JSON.stringify({ protocolVersion: 1, type: "start" }),
  );
  const started = await new Promise<Record<string, unknown>>((resolve) =>
    aliceConnection.socket.once("message", (data) =>
      resolve(JSON.parse(data.toString()) as Record<string, unknown>),
    ),
  );
  expect(JSON.stringify(started)).not.toContain(bob.reconnectToken);
  const startedState = started.state as {
    game: { players: Array<{ id: string; hand?: unknown[] }> };
  };
  expect(
    startedState.game.players.find((player) => player.id === alice.playerId)
      ?.hand,
  ).toHaveLength(7);
  expect(
    startedState.game.players.find((player) => player.id === bob.playerId)
      ?.hand,
  ).toBeUndefined();

  await closeSocket(aliceConnection.socket);
  const reconnected = await openRoomSocket(room.roomId, alice);
  expect((reconnected.snapshot.state as { game: unknown }).game).toBeTruthy();
  expect(JSON.stringify(reconnected.snapshot)).not.toContain(
    bob.reconnectToken,
  );

  await Promise.all([
    closeSocket(reconnected.socket),
    closeSocket(bobConnection.socket),
  ]);
});

test("temporary rooms expire after their final socket disconnect", async ({
  request,
}) => {
  const room = await createRoom(request, "Expiring table");
  const alice = await join(
    request,
    room.roomId,
    "Alice",
    room.inviteCredential,
  );
  const connection = await openRoomSocket(room.roomId, alice);
  await closeSocket(connection.socket);

  await expect
    .poll(
      async () => {
        const response = await request.post(`/api/rooms/${room.roomId}/state`, {
          data: {},
        });
        return response.status();
      },
      { timeout: 5_000 },
    )
    .not.toBe(200);
});
