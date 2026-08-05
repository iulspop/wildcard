/* global document, fetch, btoa, atob, location, localStorage, navigator, FormData, URL, history, WebSocket, setTimeout, clearTimeout, crypto, window */
const $ = (s) => document.querySelector(s);
const api = async (url, options = {}) => {
  const response = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(
      data.error || data.message || `Request failed (${response.status})`,
    );
  return data;
};
const encode = (value) =>
    btoa(String.fromCharCode(...new Uint8Array(value)))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replace(/=+$/, ""),
  decode = (value) =>
    Uint8Array.from(
      atob(
        value
          .replaceAll("-", "+")
          .replaceAll("_", "/")
          .padEnd(Math.ceil(value.length / 4) * 4, "="),
      ),
      (c) => c.charCodeAt(0),
    );
const credentialJSON = (credential) => {
  if (credential.toJSON) return credential.toJSON();
  const response = credential.response.attestationObject
    ? {
        clientDataJSON: encode(credential.response.clientDataJSON),
        attestationObject: encode(credential.response.attestationObject),
        transports: credential.response.getTransports?.() || [],
      }
    : {
        clientDataJSON: encode(credential.response.clientDataJSON),
        authenticatorData: encode(credential.response.authenticatorData),
        signature: encode(credential.response.signature),
        userHandle: credential.response.userHandle
          ? encode(credential.response.userHandle)
          : null,
      };
  return {
    id: credential.id,
    rawId: encode(credential.rawId),
    type: credential.type,
    response,
    clientExtensionResults: credential.getClientExtensionResults(),
    authenticatorAttachment: credential.authenticatorAttachment,
  };
};
let sessionUser = null,
  roomId = location.pathname.match(/^\/rooms\/([^/]+)/)?.[1] || null,
  credentials = roomId
    ? JSON.parse(localStorage.getItem(`wildcard:${roomId}`) || "null")
    : null,
  state = null,
  socket = null,
  selected = new Set(),
  chosenColor = null,
  soundVolume = Math.min(
    1,
    Math.max(0, Number(localStorage.getItem("wildcard:volume") ?? 50) / 100),
  ),
  audioContext = null,
  audioOutput = null,
  previousTurn = null,
  previousWinner = null,
  previousUnoClaimId = null,
  pendingUnoClaimId = null,
  pendingKickPlayerId = null,
  pendingDeleteRoom = null,
  unoTimer = null,
  messageTimer = null;
function message(text, error = false, persistent = false) {
  const el = $("#status");
  clearTimeout(messageTimer);
  el.textContent = text || "";
  el.className = `status${error ? " error" : ""}${text ? " visible" : " hidden"}`;
  if (text && !persistent) {
    messageTimer = setTimeout(() => {
      el.classList.remove("visible");
      el.classList.add("hidden");
    }, 3200);
  }
}
async function loadSession() {
  const data = await api("/api/auth/session");
  sessionUser = data.user;
  $("#auth-name").textContent = sessionUser ? sessionUser.displayName : "Guest";
  $("#auth-name").classList.toggle("hidden", !sessionUser);
  $("#account-trigger").textContent = sessionUser
    ? sessionUser.displayName
    : "Sign in";
  $("#auth-controls").classList.toggle("hidden", Boolean(sessionUser));
  $("#logout").classList.toggle("hidden", !sessionUser);
  $("#persistent-wrap").classList.toggle("hidden", !sessionUser);
  const joinName = $("#join-form input[name='displayName']");
  if (roomId && sessionUser && joinName && !joinName.value)
    joinName.value = sessionUser.displayName;
  await loadOwnedRooms();
}
async function loadOwnedRooms() {
  const panel = $("#owned-rooms"),
    list = $("#owned-room-list");
  panel.classList.toggle("hidden", !sessionUser);
  if (!sessionUser) {
    list.innerHTML = "";
    return;
  }
  const data = await api("/api/rooms");
  list.innerHTML = data.rooms.length
    ? data.rooms
        .map(
          (room) =>
            `<li><a href="/rooms/${encodeURIComponent(room.roomId)}"><strong>${escapeHTML(room.name)}</strong><span>${room.standingsCount} ranked players</span></a><button class="owned-room-delete" type="button" data-room-id="${room.roomId}" data-room-name="${escapeHTML(room.name)}" aria-label="Delete ${escapeHTML(room.name)}">Delete</button></li>`,
        )
        .join("")
    : '<li class="empty">No persistent rooms yet.</li>';
}
function createOptions(json) {
  return {
    ...json,
    challenge: decode(json.challenge),
    user: { ...json.user, id: decode(json.user.id) },
    excludeCredentials: (json.excludeCredentials || []).map((c) => ({
      ...c,
      id: decode(c.id),
    })),
  };
}
function getOptions(json) {
  return {
    ...json,
    challenge: decode(json.challenge),
    allowCredentials: (json.allowCredentials || []).map((c) => ({
      ...c,
      id: decode(c.id),
    })),
  };
}
async function register() {
  const displayName = $("#auth-display-name").value.trim();
  if (!displayName) throw new Error("Enter a display name first");
  const options = await api("/api/auth/register/options", {
    method: "POST",
    body: JSON.stringify({ displayName }),
  });
  const response = await navigator.credentials.create({
    publicKey: createOptions(options.options),
  });
  await api("/api/auth/register/verify", {
    method: "POST",
    body: JSON.stringify({
      challengeId: options.challengeId,
      response: credentialJSON(response),
    }),
  });
  await loadSession();
  message("Passkey created. You are signed in.");
}
async function login() {
  const options = await api("/api/auth/login/options", {
    method: "POST",
    body: "{}",
  });
  const response = await navigator.credentials.get({
    publicKey: getOptions(options.options),
  });
  await api("/api/auth/login/verify", {
    method: "POST",
    body: JSON.stringify({
      challengeId: options.challengeId,
      response: credentialJSON(response),
    }),
  });
  await loadSession();
  message("Signed in with your passkey.");
}
async function createRoom(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget),
    data = await api("/api/rooms", {
      method: "POST",
      body: JSON.stringify({
        name: form.get("name"),
        persistent: form.get("persistent") === "on",
      }),
    });
  location.href = data.inviteUrl;
}
async function joinRoom(event) {
  event.preventDefault();
  const data = await api(`/api/rooms/${roomId}/join`, {
    method: "POST",
    body: JSON.stringify({
      displayName: new FormData(event.currentTarget).get("displayName"),
    }),
  });
  credentials = {
    playerId: data.playerId,
    reconnectToken: data.reconnectToken,
  };
  localStorage.setItem(`wildcard:${roomId}`, JSON.stringify(credentials));
  history.replaceState(null, "", location.pathname);
  applyState(data.state);
  connect();
}
function connect() {
  if (!credentials || socket?.readyState === WebSocket.OPEN) return;
  const protocol = location.protocol === "https:" ? "wss" : "ws",
    encoded = btoa(JSON.stringify(credentials))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replace(/=+$/g, "");
  socket = new WebSocket(
    `${protocol}://${location.host}/api/rooms/${roomId}/socket`,
    ["wildcard", `credentials.${encoded}`],
  );
  $("#connection").textContent = "Connecting…";
  socket.onopen = () => {
    $("#connection").textContent = "Connected";
  };
  socket.onclose = (event) => {
    if (event.code === 4001) {
      const displayName = state?.seats.find(
        (seat) => seat.playerId === credentials?.playerId,
      )?.displayName;
      localStorage.removeItem(`wildcard:${roomId}`);
      credentials = null;
      state = null;
      socket = null;
      $("#room-panel").classList.add("hidden");
      $("#join-panel").classList.remove("hidden");
      if (displayName)
        $("#join-form input[name='displayName']").value = displayName;
      message("The room host removed you. You may join again.", true, true);
      return;
    }
    $("#connection").textContent = "Reconnecting…";
    setTimeout(connect, 1500);
  };
  socket.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.type === "snapshot") applyState(data.state);
    else if (data.type === "error") message(data.message || data.error, true);
  };
}
function applyState(next) {
  state = next;
  $("#join-panel").classList.add("hidden");
  $("#room-panel").classList.remove("hidden");
  $("#room-name").textContent = state.room.name;
  $("#invite-url").value = new URL(location.pathname, location.origin).href;
  render();
}
function cardLabel(card) {
  return card.kind === "number"
    ? String(card.value)
    : { draw2: "+2", wild4: "+4", reverse: "↺", skip: "⊘", wild: "WILD" }[
        card.kind
      ] || card.kind;
}
function cardGroup(card) {
  return card.kind === "number" ? `number:${card.value}` : card.kind;
}
function render() {
  if (!state) return;
  const mySeat = state.seats.find(
      (seat) => seat.playerId === credentials?.playerId,
    ),
    isHost = mySeat?.seatIndex === 0;
  $("#seats").innerHTML = state.seats
    .map(
      (seat) =>
        `<li class="seat"><span><span class="dot ${seat.connected ? "online" : ""}"></span>${escapeHTML(seat.displayName)}</span><span class="seat-actions">${seat.playerId === credentials?.playerId ? "You" : `Seat ${seat.seatIndex + 1}${isHost && !state.game ? ` <button class="kick-button" type="button" data-player-id="${escapeHTML(seat.playerId)}" data-player-name="${escapeHTML(seat.displayName)}" aria-label="Remove ${escapeHTML(seat.displayName)} from room">Remove</button>` : ""}`}</span></li>`,
    )
    .join("");
  $("#start").disabled = !isHost || state.seats.length < 2 || !!state.game;
  $("#end-game").classList.toggle(
    "hidden",
    !isHost || state.game?.phase !== "playing",
  );
  $("#lobby").classList.toggle("hidden", !!state.game);
  $("#game").classList.toggle("hidden", !state.game);
  if (!state.game) {
    selected.clear();
    chosenColor = null;
    previousTurn = null;
    previousWinner = null;
  }
  const standings = state.standings || [];
  $("#standings-panel").classList.toggle("hidden", !standings.length);
  $("#standings").innerHTML = standings
    .map(
      (standing) =>
        `<tr><td>${escapeHTML(standing.displayName)}</td><td>${standing.wins}</td><td>${standing.losses}</td><td>${standing.games}</td><td>${standing.losses ? (standing.wins / standing.losses).toFixed(2) : standing.wins ? "Undefeated" : "—"}</td></tr>`,
    )
    .join("");
  if (state.game) renderGame(state.game);
}
function renderUno(game) {
  const claim = game.unoClaim,
    container = $("#uno-actions"),
    callButton = $("#uno-call"),
    catchButton = $("#uno-catch");
  clearTimeout(unoTimer);
  if (!claim) {
    container.classList.add("hidden");
    callButton.classList.add("hidden");
    catchButton.classList.add("hidden");
    previousUnoClaimId = null;
    pendingUnoClaimId = null;
    return;
  }

  const target = game.players.find(
      (player) => player.id === claim.targetPlayerId,
    ),
    isTarget = claim.targetPlayerId === credentials.playerId,
    catchable = Date.now() >= claim.catchableAt;
  if (previousUnoClaimId !== claim.id) {
    previousUnoClaimId = claim.id;
    pendingUnoClaimId = null;
    message(
      isTarget
        ? "You have one card — call UNO!"
        : `${target?.name || "A player"} has one card.`,
    );
  }
  container.classList.remove("hidden");
  $("#uno-status").textContent = isTarget
    ? "You have one card. Declare UNO before you are caught."
    : catchable
      ? `${target?.name || "This player"} can be caught now.`
      : `${target?.name || "This player"} has a moment to call UNO.`;
  callButton.classList.toggle("hidden", !isTarget);
  catchButton.classList.toggle("hidden", isTarget);
  callButton.disabled = pendingUnoClaimId === claim.id;
  catchButton.disabled = !catchable || pendingUnoClaimId === claim.id;
  if (!isTarget && !catchable) {
    unoTimer = setTimeout(
      () => state?.game && renderUno(state.game),
      Math.max(0, claim.catchableAt - Date.now()) + 10,
    );
  }
}

function opponentsInUpcomingTurnOrder(game) {
  const playersById = new Map(
    game.players.map((player) => [player.id, player]),
  );
  return (game.upcomingPlayerIds || [])
    .map((playerId) => playersById.get(playerId))
    .filter(Boolean);
}

function renderGame(game) {
  const me = game.players.find((p) => p.id === credentials.playerId),
    current = game.players.find((p) => p.id === game.currentPlayerId),
    winner = game.players.find((p) => p.id === game.winnerId);
  if (
    previousTurn &&
    previousTurn !== game.currentPlayerId &&
    game.currentPlayerId === credentials.playerId
  )
    playSound("turn");
  if (!previousWinner && game.winnerId)
    playSound(game.winnerId === credentials.playerId ? "win" : "lose");
  previousTurn = game.currentPlayerId;
  previousWinner = game.winnerId;
  $("#turn").textContent = winner
    ? `${winner.name} wins!`
    : current?.id === credentials.playerId
      ? "YOUR TURN — PLAY NOW"
      : `${current?.name}'s turn`;
  $("#direction").textContent =
    game.direction === 1 ? "Clockwise ↻" : "Counter-clockwise ↺";
  $("#pending").textContent = game.pendingDraw
    ? `Stack ${game.pendingDraw.kind === "draw2" ? "+2" : "+4"} · ${game.pendingDraw.amount} cards pending`
    : "";
  const activeColor = $("#active-color");
  activeColor.className = `active-color ${game.activeColor}`;
  activeColor.innerHTML = `<span class="active-color-swatch" aria-hidden="true"></span>Current color: ${escapeHTML(game.activeColor)}`;
  renderUno(game);
  $("#opponents").innerHTML = opponentsInUpcomingTurnOrder(game)
    .map((p) => {
      const visibleCardCount = Math.min(p.cardCount, 10);
      const cardBacks = Array.from({ length: visibleCardCount }, (_, index) => {
        const offset = (index - (visibleCardCount - 1) / 2) * 7;
        const rotation = (index - (visibleCardCount - 1) / 2) * 2;
        return `<span class="mini-card" style="--card-offset:${offset}px;--card-rotation:${rotation}deg" aria-hidden="true"><span>W</span></span>`;
      }).join("");
      return `<div class="opponent ${p.id === game.currentPlayerId ? "active" : ""}">
        <div class="opponent-cards">${cardBacks}</div>
        <div class="opponent-info">
          <strong>${escapeHTML(p.name)}</strong>
          <span>${p.cardCount} ${p.cardCount === 1 ? "card" : "cards"}</span>
        </div>
        ${p.id === game.currentPlayerId ? '<span class="playing-badge">Playing</span>' : ""}
      </div>`;
    })
    .join("");
  const lastPlay = game.lastPlay,
    groupedCards = lastPlay?.cards?.length > 1 ? lastPlay.cards : null,
    displayedCards = groupedCards?.slice(-4) || [game.topDiscard],
    lastPlayer = groupedCards
      ? game.players.find((player) => player.id === lastPlay.playerId)
      : null;
  const discardStack = $("#discard-stack");
  discardStack.classList.toggle("grouped", Boolean(groupedCards));
  if (groupedCards) discardStack.dataset.cardCount = groupedCards.length;
  else delete discardStack.dataset.cardCount;
  discardStack.innerHTML = displayedCards
    .map((card, index) => {
      const isTopCard = index === displayedCards.length - 1,
        rotation = (index - (displayedCards.length - 1) / 2) * 3;
      return `<div ${isTopCard ? 'id="discard"' : ""} class="card discard-card ${card.color}" style="--discard-index:${index};--discard-rotation:${rotation}deg" aria-label="${isTopCard ? "Top discard: " : "Played card: "}${escapeHTML(card.color)} ${escapeHTML(cardLabel(card))}"><span class="card-corner top">${cardLabel(card)}</span><span class="card-face">${cardLabel(card)}</span><span class="card-corner bottom">${cardLabel(card)}</span></div>`;
    })
    .join("");
  const groupIndicator = $("#group-play-indicator");
  groupIndicator.classList.toggle("hidden", !groupedCards);
  groupIndicator.textContent = groupedCards
    ? `${lastPlayer?.name || "A player"} · ${groupedCards.length}-card play`
    : "";
  $("#draw-count").textContent = `${game.drawPileCount} cards`;
  $("#hand-count").textContent = `${me?.cardCount || 0} cards`;
  const hand = me?.hand || [],
    isMyTurn = game.currentPlayerId === credentials.playerId,
    playableCardIds = new Set(game.playableCardIds || []),
    cardsById = new Map(hand.map((card) => [card.id, card]));
  $("#game").classList.toggle("my-turn", isMyTurn);
  for (const cardId of selected) {
    if (!cardsById.has(cardId)) selected.delete(cardId);
  }
  if (!isMyTurn) selected.clear();
  let firstSelected = cardsById.get(selected.values().next().value);
  if (firstSelected && !playableCardIds.has(firstSelected.id)) {
    selected.clear();
    firstSelected = null;
  }
  const selectedGroup = firstSelected ? cardGroup(firstSelected) : null;
  $("#hand").innerHTML = hand
    .map((c, index) => {
      const enabled =
        isMyTurn &&
        (selected.has(c.id) ||
          (selectedGroup
            ? cardGroup(c) === selectedGroup
            : playableCardIds.has(c.id)));
      return `<button class="card ${c.color} ${selected.has(c.id) ? "selected" : ""}" style="--hand-index:${index}" data-card="${c.id}" aria-label="${c.color} ${cardLabel(c)}${enabled ? "" : ", cannot be played"}" aria-pressed="${selected.has(c.id)}" ${enabled ? "" : "disabled"}><span class="card-corner top">${cardLabel(c)}</span><span class="card-face">${cardLabel(c)}</span><span class="card-corner bottom">${cardLabel(c)}</span></button>`;
    })
    .join("");
  document.querySelectorAll("[data-card]").forEach(
    (el) =>
      (el.onclick = () => {
        if (selected.has(el.dataset.card)) selected.delete(el.dataset.card);
        else selected.add(el.dataset.card);
        renderGame(game);
      }),
  );
  const hasSelectedWild = [...(me?.hand || [])].some(
    (c) => selected.has(c.id) && c.color === "wild",
  );
  if (!hasSelectedWild) chosenColor = null;
  $("#colors").classList.toggle("hidden", !hasSelectedWild);
  $("#color-choice-label").textContent = chosenColor
    ? `Selected: ${chosenColor}`
    : "Choose a color";
  document.querySelectorAll("[data-color]").forEach((button) => {
    const isSelected = button.dataset.color === chosenColor;
    button.classList.toggle("selected", isSelected);
    button.setAttribute("aria-pressed", String(isSelected));
  });
  const gameFinished = game.phase === "finished";
  const isHost = state.seats[0]?.playerId === credentials.playerId;
  const decidingDraw = isMyTurn && game.drawnCardId !== null;
  $("#play").classList.toggle("hidden", gameFinished);
  $("#keep-drawn").classList.toggle("hidden", gameFinished || !decidingDraw);
  $("#play").disabled =
    !selected.size ||
    game.currentPlayerId !== credentials.playerId ||
    (hasSelectedWild && !chosenColor);
  $("#draw").disabled =
    gameFinished ||
    game.currentPlayerId !== credentials.playerId ||
    decidingDraw;
  $("#post-game-actions").classList.toggle("hidden", !gameFinished || !isHost);
}
function send(type, payload = {}) {
  if (socket?.readyState !== WebSocket.OPEN) throw new Error("Not connected");
  socket.send(JSON.stringify({ protocolVersion: 1, type, ...payload }));
}
async function start() {
  unlockAudio();
  send("start");
  playSound("start");
}
async function returnToLobby() {
  send("lobby");
}
function kickPlayer(playerId) {
  send("kick", { targetPlayerId: playerId });
}
function showKickPlayerDialog(playerId, playerName) {
  pendingKickPlayerId = playerId;
  $("#kick-player-name").textContent = playerName;
  $("#kick-player-dialog").showModal();
}
function cancelKickPlayer() {
  pendingKickPlayerId = null;
  $("#kick-player-dialog").close();
}
function confirmKickPlayer() {
  const playerId = pendingKickPlayerId;
  cancelKickPlayer();
  if (playerId) kickPlayer(playerId);
}
function showDeleteRoomDialog(roomIdToDelete, roomName) {
  pendingDeleteRoom = { roomId: roomIdToDelete, name: roomName };
  $("#delete-room-name").textContent = roomName;
  $("#delete-room-dialog").showModal();
}
function cancelDeleteRoom() {
  pendingDeleteRoom = null;
  $("#delete-room-dialog").close();
}
async function confirmDeleteRoom() {
  const room = pendingDeleteRoom;
  cancelDeleteRoom();
  if (!room) return;
  await api(`/api/rooms/${encodeURIComponent(room.roomId)}`, {
    method: "DELETE",
  });
  localStorage.removeItem(`wildcard:${room.roomId}`);
  message(`${room.name} deleted.`);
  if (roomId === room.roomId) {
    location.href = "/";
    return;
  }
  await loadOwnedRooms();
}
function endGame() {
  $("#end-game-dialog").showModal();
}
function cancelEndGame() {
  $("#end-game-dialog").close();
}
function confirmEndGame() {
  $("#end-game-dialog").close();
  send("end-game");
}
async function play() {
  unlockAudio();
  send("action", {
    action: {
      protocolVersion: 1,
      actionId: crypto.randomUUID(),
      playerId: credentials.playerId,
      type: "play",
      cardIds: [...selected],
      ...(chosenColor ? { chosenColor } : {}),
    },
  });
  selected.clear();
  chosenColor = null;
  playSound("play");
}
async function draw() {
  unlockAudio();
  send("action", {
    action: {
      protocolVersion: 1,
      actionId: crypto.randomUUID(),
      playerId: credentials.playerId,
      type: "draw",
    },
  });
  playSound("draw");
}
async function keepDrawnCard() {
  send("action", {
    action: {
      protocolVersion: 1,
      actionId: crypto.randomUUID(),
      playerId: credentials.playerId,
      type: "pass",
    },
  });
}
function sendUno(type) {
  const claimId = state?.game?.unoClaim?.id;
  if (!claimId || pendingUnoClaimId === claimId) return;
  pendingUnoClaimId = claimId;
  renderUno(state.game);
  send("action", {
    action: {
      protocolVersion: 1,
      actionId: crypto.randomUUID(),
      playerId: credentials.playerId,
      type,
      claimId,
    },
  });
}
function unlockAudio() {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return null;
  audioContext ||= new AudioContext();
  if (!audioOutput) {
    audioOutput = audioContext.createDynamicsCompressor();
    audioOutput.threshold.value = -12;
    audioOutput.knee.value = 18;
    audioOutput.ratio.value = 6;
    audioOutput.attack.value = 0.003;
    audioOutput.release.value = 0.18;
    audioOutput.connect(audioContext.destination);

    const silentGain = audioContext.createGain();
    const silentSource = audioContext.createBufferSource();
    silentGain.gain.value = 0;
    silentSource.buffer = audioContext.createBuffer(1, 1, 22050);
    silentSource.connect(silentGain).connect(audioOutput);
    silentSource.start();
  }
  if (audioContext.state !== "running")
    audioContext.resume().catch(() => undefined);
  return audioContext;
}
async function playSound(type) {
  if (soundVolume <= 0) return;
  const context = unlockAudio();
  if (!context) return;
  if (context.state !== "running") {
    await context.resume().catch(() => undefined);
    if (context.state !== "running") return;
  }
  const sounds = {
    start: [
      [523, 0, 0.18, 0.65, "sine"],
      [659, 0.08, 0.2, 0.72, "sine"],
      [784, 0.16, 0.28, 0.8, "triangle"],
    ],
    play: [
      [659, 0, 0.09, 0.55, "triangle"],
      [988, 0.055, 0.14, 0.7, "sine"],
    ],
    draw: [
      [294, 0, 0.18, 0.5, "triangle", -55],
      [220, 0.07, 0.2, 0.42, "sine", -35],
    ],
    turn: [
      [784, 0, 0.16, 0.72, "sine"],
      [1047, 0.09, 0.22, 0.9, "triangle"],
      [1319, 0.19, 0.28, 0.8, "sine"],
    ],
    win: [
      [523, 0, 0.22, 0.65, "sine"],
      [659, 0.1, 0.24, 0.72, "triangle"],
      [784, 0.2, 0.26, 0.8, "sine"],
      [1047, 0.3, 0.42, 0.95, "triangle"],
    ],
    lose: [
      [392, 0, 0.24, 0.55, "sine"],
      [311, 0.12, 0.28, 0.5, "triangle"],
      [262, 0.25, 0.36, 0.45, "sine"],
    ],
  };
  const notes = sounds[type] || [[880, 0, 0.16, 0.65, "sine"]];
  notes.forEach(([frequency, delay, duration, level, wave, slide = 0]) => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const startAt = context.currentTime + delay;
    oscillator.type = wave;
    oscillator.frequency.setValueAtTime(frequency, startAt);
    if (slide)
      oscillator.frequency.exponentialRampToValueAtTime(
        frequency + slide,
        startAt + duration,
      );
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(
      Math.max(
        0.0001,
        soundVolume * 2.8 * level * (1 + Math.max(0, soundVolume - 0.5) * 2),
      ),
      startAt + 0.018,
    );
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
    oscillator.connect(gain).connect(audioOutput);
    oscillator.start(startAt);
    oscillator.stop(startAt + duration + 0.02);
  });
}
function escapeHTML(value) {
  const el = document.createElement("span");
  el.textContent = value;
  return el.innerHTML;
}
function bind(id, event, fn) {
  const el = $(id);
  if (el)
    el.addEventListener(event, (e) =>
      Promise.resolve(fn(e)).catch((error) => message(error.message, true)),
    );
}
bind("#create-form", "submit", createRoom);
bind("#join-form", "submit", joinRoom);
bind("#register", "click", register);
bind("#login", "click", login);
bind("#logout", "click", async () => {
  await api("/api/auth/logout", { method: "POST", body: "{}" });
  await loadSession();
  message("Signed out.");
});
bind("#start", "click", start);
bind("#restart", "click", start);
bind("#return-lobby", "click", returnToLobby);
bind("#end-game", "click", endGame);
bind("#cancel-end-game", "click", cancelEndGame);
bind("#confirm-end-game", "click", confirmEndGame);
bind("#end-game-dialog", "click", (event) => {
  if (event.target === event.currentTarget) cancelEndGame();
});
bind("#cancel-kick-player", "click", cancelKickPlayer);
bind("#confirm-kick-player", "click", confirmKickPlayer);
bind("#kick-player-dialog", "click", (event) => {
  if (event.target === event.currentTarget) cancelKickPlayer();
});
bind("#cancel-delete-room", "click", cancelDeleteRoom);
bind("#confirm-delete-room", "click", confirmDeleteRoom);
bind("#delete-room-dialog", "click", (event) => {
  if (event.target === event.currentTarget) cancelDeleteRoom();
});
bind("#delete-room-dialog", "cancel", cancelDeleteRoom);
bind("#owned-room-list", "click", (event) => {
  const button = event.target.closest(".owned-room-delete");
  if (button)
    showDeleteRoomDialog(button.dataset.roomId, button.dataset.roomName);
});
bind("#seats", "click", (event) => {
  const button = event.target.closest(".kick-button");
  if (button)
    showKickPlayerDialog(button.dataset.playerId, button.dataset.playerName);
});
bind("#play", "click", play);
bind("#draw", "click", draw);
bind("#keep-drawn", "click", keepDrawnCard);
bind("#uno-call", "click", () => sendUno("call-uno"));
bind("#uno-catch", "click", () => sendUno("catch-uno"));
function updateVolumeControl() {
  const percentage = Math.round(soundVolume * 100);
  $("#volume").value = String(percentage);
  $("#volume-value").textContent = percentage ? `${percentage}%` : "Muted";
}
updateVolumeControl();
const activateAudio = () => unlockAudio();
document.addEventListener("touchstart", activateAudio, {
  passive: true,
  once: true,
});
document.addEventListener("pointerdown", activateAudio, { once: true });
document.addEventListener("click", activateAudio, { once: true });
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") unlockAudio();
});
window.addEventListener("pageshow", activateAudio);
bind("#volume", "input", (event) => {
  soundVolume = Number(event.currentTarget.value) / 100;
  localStorage.setItem("wildcard:volume", String(event.currentTarget.value));
  updateVolumeControl();
});
bind("#volume", "change", () => playSound("turn"));
bind("#copy", "click", async () => {
  await navigator.clipboard.writeText($("#invite-url").value);
  message("Invite link copied.");
});
document.querySelectorAll("[data-color]").forEach(
  (el) =>
    (el.onclick = () => {
      chosenColor = el.dataset.color;
      if (state?.game) renderGame(state.game);
    }),
);
loadSession().catch((e) => message(e.message, true));
if (roomId) {
  $("#home").classList.add("hidden");
  $("#room-page").classList.remove("hidden");
  if (credentials) {
    api(`/api/rooms/${roomId}/state`, {
      method: "POST",
      body: JSON.stringify(credentials),
    })
      .then(applyState)
      .then(connect)
      .catch(() => {
        localStorage.removeItem(`wildcard:${roomId}`);
        credentials = null;
      });
  }
}
