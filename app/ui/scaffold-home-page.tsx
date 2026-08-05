import { css } from "remix/ui";

import { Document } from "./document.tsx";

export function HomePage() {
  return () => (
    <Document title="Wildcard — Play your hand">
      <main className="shell" mix={css({ minHeight: "100vh" })}>
        <header className="topbar">
          <a className="brand" href="/">
            WILDCARD
          </a>
          <div className="topbar-actions">
            <button id="end-game" className="topbar-stop hidden" type="button">
              Stop game
            </button>
            <details id="volume-menu" className="volume-menu">
              <summary aria-label="Adjust sound volume" title="Sound volume">
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  width="20"
                  height="20"
                >
                  <path d="M4 9v6h4l5 4V5L8 9H4Zm12.5 3a4.5 4.5 0 0 0-2.25-3.9v7.8A4.5 4.5 0 0 0 16.5 12Zm-2.25-8.72v2.06a7.5 7.5 0 0 1 0 13.32v2.06a9.5 9.5 0 0 0 0-17.44Z" />
                </svg>
              </summary>
              <label className="volume-popover" htmlFor="volume">
                <output id="volume-value" htmlFor="volume">
                  50%
                </output>
                <input
                  id="volume"
                  type="range"
                  min="0"
                  max="100"
                  step="5"
                  defaultValue="50"
                  aria-label="Sound volume"
                />
              </label>
            </details>
            <details id="account-menu" className="account-menu">
              <summary id="account-trigger">Sign in</summary>
              <section
                className="account-popover stack"
                aria-labelledby="account-title"
              >
                <div className="account-heading">
                  <div>
                    <span className="eyebrow">Account</span>
                    <h2 id="account-title">Play across visits</h2>
                  </div>
                  <span id="auth-name" className="hidden">
                    Guest
                  </span>
                </div>
                <div id="auth-controls" className="stack">
                  <p>
                    Optional. Use a passkey to keep rooms and all-time
                    standings.
                  </p>
                  <label>
                    Display name
                    <input
                      id="auth-display-name"
                      maxLength={40}
                      autoComplete="nickname"
                    />
                  </label>
                  <div className="row">
                    <button id="register" type="button">
                      Create passkey
                    </button>
                    <button id="login" className="secondary" type="button">
                      Sign in
                    </button>
                  </div>
                </div>
                <button id="logout" className="secondary hidden" type="button">
                  Sign out
                </button>
                <div id="owned-rooms" className="hidden stack">
                  <h3>Your rooms</h3>
                  <ul id="owned-room-list" className="owned-room-list" />
                </div>
              </section>
            </details>
          </div>
        </header>
        <div
          id="status"
          className="status hidden"
          role="status"
          aria-live="polite"
        />
        <section id="home" className="hero">
          <div className="hero-copy">
            <p className="brand">REAL-TIME CARD ROOMS</p>
            <h1>Play your hand.</h1>
            <p>
              Start a private table, share one link, and play with up to seven
              friends. No account required.
            </p>
          </div>
          <form id="create-form" className="create-card stack">
            <label>
              Name your room
              <input name="name" maxLength={60} value="Friday night" />
            </label>
            <label id="persistent-wrap" className="row hidden">
              <input
                name="persistent"
                type="checkbox"
                style={{ width: "auto" }}
              />{" "}
              Keep this room and its standings
            </label>
            <button type="submit">Create private room</button>
            <small>
              Its secret invite is included automatically in the link.
            </small>
          </form>
        </section>
        <section id="room-page" className="hidden stack">
          <div id="join-panel" className="panel stack">
            <p className="brand">ROOM INVITE</p>
            <h1>Join the table</h1>
            <form id="join-form" className="stack">
              <label>
                Your display name
                <input
                  name="displayName"
                  required
                  minLength={1}
                  maxLength={40}
                  autoComplete="nickname"
                />
              </label>
              <button type="submit">Take a seat</button>
            </form>
          </div>
          <div id="room-panel" className="hidden stack">
            <div className="room-head">
              <div>
                <p className="brand">ROOM</p>
                <h1 id="room-name">Wildcard room</h1>
              </div>
              <span id="connection" className="status">
                Offline
              </span>
            </div>
            <section id="lobby" className="grid">
              <div className="panel">
                <h2>Players</h2>
                <ul id="seats" className="seat-list" />
              </div>
              <div className="panel stack">
                <h2>Room setup</h2>
                <label htmlFor="finish-mode">Match finish</label>
                <select id="finish-mode">
                  <option value="first-out">First player out</option>
                  <option value="rank-all">Rank every player</option>
                </select>
                <p id="finish-mode-description" className="setting-description">
                  The match ends as soon as one player empties their hand.
                </p>
                <small id="finish-mode-access" />
                <label>
                  Invite URL
                  <input id="invite-url" readOnly />
                </label>
                <button id="copy" className="secondary" type="button">
                  Copy invite
                </button>
                <button id="start" type="button">
                  Start game
                </button>
                <p>At least 2 players are required.</p>
              </div>
            </section>
            <section id="standings-panel" className="panel hidden">
              <h2>All-time standings</h2>
              <table className="standings">
                <thead>
                  <tr>
                    <th>Player</th>
                    <th>W</th>
                    <th>L</th>
                    <th>Games</th>
                    <th>W/L</th>
                    <th>Best</th>
                    <th>Avg.</th>
                  </tr>
                </thead>
                <tbody id="standings" />
              </table>
            </section>
            <section
              id="game"
              className="game-table hidden"
              aria-label="Game table"
            >
              <div className="table-surface">
                <div id="opponents" className="opponents" />
                <div className="turn-hud" aria-live="polite">
                  <div id="turn" className="turn turn-primary" />
                  <div
                    id="finish-progress"
                    className="finish-progress hidden"
                  />
                  <div className="turn-meta">
                    <span id="direction" />
                    <span id="pending" />
                    <span id="active-color" className="active-color" />
                  </div>
                </div>
                <div
                  id="uno-actions"
                  className="uno-actions hidden"
                  aria-live="polite"
                >
                  <span id="uno-status" />
                  <button
                    id="uno-call"
                    className="uno-button hidden"
                    type="button"
                  >
                    UNO!
                  </button>
                  <button
                    id="uno-catch"
                    className="uno-button catch hidden"
                    type="button"
                  >
                    Catch UNO
                  </button>
                </div>
                <div className="piles" aria-label="Draw and discard piles">
                  <div className="pile-wrap">
                    <span className="pile-label">Draw pile</span>
                    <button
                      id="draw"
                      className="card back"
                      type="button"
                      aria-label="Draw cards"
                    >
                      <span className="card-back-mark">W</span>
                    </button>
                    <small id="draw-count" className="pile-count" />
                  </div>
                  <div className="pile-wrap discard-wrap">
                    <span className="pile-label">Discard</span>
                    <div id="discard-stack" className="discard-stack">
                      <div
                        id="discard"
                        className="card wild"
                        aria-label="Top discard"
                      />
                    </div>
                    <small
                      id="group-play-indicator"
                      className="group-play-indicator hidden"
                      aria-live="polite"
                    />
                  </div>
                </div>
                <div
                  id="colors"
                  className="colors hidden"
                  aria-label="Choose a color"
                >
                  <span id="color-choice-label">Choose a color</span>
                  {["red", "yellow", "green", "blue"].map((color) => (
                    <button
                      key={color}
                      type="button"
                      className={`color-button ${color}`}
                      data-color={color}
                      aria-label={`Choose ${color}`}
                      aria-pressed="false"
                    />
                  ))}
                </div>
              </div>
              <div className="player-tray">
                <div className="hand-heading">
                  <div>
                    <span className="eyebrow">Your hand</span>
                    <strong id="hand-count" />
                  </div>
                </div>
                <div
                  id="local-placement"
                  className="local-placement hidden"
                  aria-live="polite"
                />
                <div id="hand" className="hand" aria-label="Your hand" />
                <button id="play" className="play-button" type="button">
                  Play selected cards
                </button>
                <button
                  id="keep-drawn"
                  className="secondary hidden"
                  type="button"
                >
                  Keep drawn card
                </button>
                <div
                  id="post-game-actions"
                  className="post-game-actions hidden"
                >
                  <button id="restart" type="button">
                    Play again
                  </button>
                  <button id="return-lobby" className="secondary" type="button">
                    Return to lobby
                  </button>
                </div>
              </div>
            </section>
          </div>
        </section>
        <dialog id="end-game-dialog" className="confirm-dialog">
          <div className="confirm-dialog-icon" aria-hidden="true">
            !
          </div>
          <div>
            <span className="eyebrow">Stop current game</span>
            <h2>Return everyone to the lobby?</h2>
            <p>
              This game will end immediately and no result will be recorded.
              Players and room standings will remain.
            </p>
          </div>
          <div className="confirm-dialog-actions">
            <button id="cancel-end-game" className="secondary" type="button">
              Keep playing
            </button>
            <button id="confirm-end-game" className="danger" type="button">
              Stop game
            </button>
          </div>
        </dialog>
        <dialog id="kick-player-dialog" className="confirm-dialog">
          <div className="confirm-dialog-icon" aria-hidden="true">
            !
          </div>
          <div>
            <span className="eyebrow">Remove player</span>
            <h2>
              Remove <span id="kick-player-name">this player</span>?
            </h2>
            <p>
              They will leave the room, but may rejoin later with the same
              display name.
            </p>
          </div>
          <div className="confirm-dialog-actions">
            <button id="cancel-kick-player" className="secondary" type="button">
              Keep player
            </button>
            <button id="confirm-kick-player" className="danger" type="button">
              Remove player
            </button>
          </div>
        </dialog>
        <dialog id="delete-room-dialog" className="confirm-dialog">
          <div className="confirm-dialog-icon" aria-hidden="true">
            !
          </div>
          <div>
            <span className="eyebrow">Delete persistent room</span>
            <h2>
              Delete <span id="delete-room-name">this room</span>?
            </h2>
            <p>
              The room, its player seats, game state, and all-time standings
              will be permanently deleted. This cannot be undone.
            </p>
          </div>
          <div className="confirm-dialog-actions">
            <button id="cancel-delete-room" className="secondary" type="button">
              Keep room
            </button>
            <button id="confirm-delete-room" className="danger" type="button">
              Delete room
            </button>
          </div>
        </dialog>
      </main>
    </Document>
  );
}
