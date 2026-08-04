/* global document, fetch, btoa, atob, location, localStorage, navigator, FormData, URL, URLSearchParams, sessionStorage, history, WebSocket, setTimeout, clearTimeout, crypto, window */
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
  soundEnabled = localStorage.getItem("wildcard:sound") !== "off",
  audioContext = null,
  previousTurn = null,
  previousWinner = null,
  messageTimer = null,
  roomInviteCredential = roomId ? inviteFromHash() : undefined;
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
            `<li><a href="/rooms/${encodeURIComponent(room.roomId)}"><strong>${escapeHTML(room.name)}</strong><span>${room.protected ? "Protected" : "Open"} · ${room.standingsCount} ranked players</span></a></li>`,
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
function inviteFromHash() {
  return (
    new URLSearchParams(location.hash.slice(1)).get("invite") ||
    sessionStorage.getItem(`invite:${roomId}`) ||
    undefined
  );
}
async function joinRoom(event) {
  event.preventDefault();
  const inviteCredential = inviteFromHash();
  if (inviteCredential) {
    roomInviteCredential = inviteCredential;
    sessionStorage.setItem(`invite:${roomId}`, inviteCredential);
  }
  const data = await api(`/api/rooms/${roomId}/join`, {
    method: "POST",
    body: JSON.stringify({
      displayName: new FormData(event.currentTarget).get("displayName"),
      inviteCredential,
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
  socket.onclose = () => {
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
  const inviteUrl = new URL(location.pathname, location.origin);
  if (roomInviteCredential)
    inviteUrl.hash = `invite=${encodeURIComponent(roomInviteCredential)}`;
  $("#invite-url").value = inviteUrl.href;
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
  $("#seats").innerHTML = state.seats
    .map(
      (s) =>
        `<li class="seat"><span><span class="dot ${s.connected ? "online" : ""}"></span>${escapeHTML(s.displayName)}</span><span>${s.playerId === credentials?.playerId ? "You" : `Seat ${s.seatIndex + 1}`}</span></li>`,
    )
    .join("");
  $("#start").disabled = state.seats.length < 2 || !!state.game;
  $("#lobby").classList.toggle("hidden", !!state.game);
  $("#game").classList.toggle("hidden", !state.game);
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
      ? "Your turn"
      : `${current?.name}'s turn`;
  $("#direction").textContent =
    game.direction === 1 ? "Clockwise ↻" : "Counter-clockwise ↺";
  $("#pending").textContent = game.pendingDraw
    ? `Stack ${game.pendingDraw.kind === "draw2" ? "+2" : "+4"} · ${game.pendingDraw.amount} cards pending`
    : "";
  const activeColor = $("#active-color");
  activeColor.className = `active-color ${game.activeColor}`;
  activeColor.innerHTML = `<span class="active-color-swatch" aria-hidden="true"></span>Current color: ${escapeHTML(game.activeColor)}`;
  $("#opponents").innerHTML = game.players
    .filter((p) => p.id !== credentials.playerId)
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
  $("#discard").className = `card ${game.topDiscard.color}`;
  $("#discard").innerHTML =
    `<span class="card-corner top">${cardLabel(game.topDiscard)}</span><span class="card-face">${cardLabel(game.topDiscard)}</span><span class="card-corner bottom">${cardLabel(game.topDiscard)}</span>`;
  $("#draw-count").textContent = `${game.drawPileCount} cards`;
  $("#hand-count").textContent = `${me?.cardCount || 0} cards`;
  const hand = me?.hand || [],
    isMyTurn = game.currentPlayerId === credentials.playerId,
    playableCardIds = new Set(game.playableCardIds || []),
    cardsById = new Map(hand.map((card) => [card.id, card]));
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
  $("#play").disabled =
    !selected.size ||
    game.currentPlayerId !== credentials.playerId ||
    (hasSelectedWild && !chosenColor);
  $("#draw").disabled = game.currentPlayerId !== credentials.playerId;
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
function unlockAudio() {
  if (!window.AudioContext) return null;
  audioContext ||= new window.AudioContext();
  if (audioContext.state === "suspended") audioContext.resume();
  return audioContext;
}
function playSound(type) {
  if (!soundEnabled) return;
  const context = unlockAudio();
  if (!context) return;
  const sounds = {
    start: [392, 0.08, 0],
    play: [660, 0.09, 0],
    draw: [220, 0.12, 0],
    turn: [520, 0.12, 0],
    lose: [196, 0.24, -70],
  };
  const [frequency, duration, slide] = sounds[type] || [784, 0.12, 90];
  const notes = type === "win" ? [523, 659, 784] : [frequency];
  notes.forEach((note, index) => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const startAt = context.currentTime + index * 0.1;
    oscillator.type = type === "draw" ? "triangle" : "sine";
    oscillator.frequency.setValueAtTime(note, startAt);
    if (slide)
      oscillator.frequency.linearRampToValueAtTime(
        note + slide,
        startAt + duration,
      );
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(0.08, startAt + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(startAt);
    oscillator.stop(startAt + duration);
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
bind("#play", "click", play);
bind("#draw", "click", draw);
function updateSoundButton() {
  $("#mute").textContent = soundEnabled ? "Sound on" : "Sound off";
  $("#mute").setAttribute("aria-pressed", String(soundEnabled));
}
updateSoundButton();
document.addEventListener("pointerdown", unlockAudio, { once: true });
bind("#mute", "click", () => {
  soundEnabled = !soundEnabled;
  localStorage.setItem("wildcard:sound", soundEnabled ? "on" : "off");
  updateSoundButton();
  if (soundEnabled) playSound("turn");
});
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
