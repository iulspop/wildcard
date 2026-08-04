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
          <div className="user">
            <span id="auth-name">Guest</span>
            <button id="logout" className="secondary hidden" type="button">
              Sign out
            </button>
          </div>
        </header>
        <div
          id="status"
          className="status hidden"
          role="status"
          aria-live="polite"
        />
        <section id="home" className="hero">
          <div>
            <p className="brand">REAL-TIME CARD ROOMS</p>
            <h1>Play your hand.</h1>
            <p>
              Create a room, invite up to seven friends, and settle the score.
              No account required.
            </p>
          </div>
          <div className="grid">
            <form id="create-form" className="panel stack">
              <h2>Create a room</h2>
              <label>
                Room name
                <input name="name" maxLength={60} value="Friday night" />
              </label>
              <label className="row">
                <input
                  name="protected"
                  type="checkbox"
                  style={{ width: "auto" }}
                />{" "}
                Protect invite
              </label>
              <label id="persistent-wrap" className="row hidden">
                <input
                  name="persistent"
                  type="checkbox"
                  style={{ width: "auto" }}
                />{" "}
                Keep room and standings
              </label>
              <button type="submit">Create room</button>
            </form>
            <section className="panel stack" aria-labelledby="passkey-title">
              <h2 id="passkey-title">Your passkey</h2>
              <p>
                Optional. Sign in to own persistent rooms and keep all-time
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
              <div id="owned-rooms" className="hidden stack">
                <h3>Your persistent rooms</h3>
                <ul id="owned-room-list" className="owned-room-list" />
              </div>
            </section>
          </div>
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
                <h2>Invite friends</h2>
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
                  <div className="turn-meta">
                    <span id="direction" />
                    <span id="pending" />
                    <span id="active-color" className="active-color" />
                  </div>
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
                  <div className="pile-wrap">
                    <span className="pile-label">Discard</span>
                    <div
                      id="discard"
                      className="card wild"
                      aria-label="Top discard"
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
                  <button
                    id="mute"
                    className="icon-button"
                    type="button"
                    aria-pressed="true"
                  >
                    Sound on
                  </button>
                </div>
                <div id="hand" className="hand" aria-label="Your hand" />
                <button id="play" className="play-button" type="button">
                  Play selected cards
                </button>
              </div>
            </section>
          </div>
        </section>
      </main>
    </Document>
  );
}
