# Wildcard Vision

Wildcard is a mobile-first web platform for fast, social, Uno-style card games. It should feel effortless to start a room, invite friends, and play from any device—while providing a flexible foundation for new game styles, house rules, and variations over time.

## Initial Game

The first game supports 2–8 players and a deliberately chaotic ruleset:

- Wild Draw Four (`+4`) can be played at any time.
- Matching cards may be played together in one turn, even across colors—for example `2, 2, 2`.
- Draw cards can be stacked, including `+2` on `+2` and `+4` on `+4`.
- The game engine must model rules as configuration rather than hard-coded assumptions, so future modes can change deck composition, valid moves, stacking, scoring, and win conditions.

## Rooms and Identity

- Anyone can create a room and receive a unique invite URL.
- Unauthenticated rooms have no owner and are deleted when the session ends.
- Authentication uses passkeys only—no passwords or social login.
- Rooms created by authenticated players are owned, persistent, and retain their history.
- Rooms may be open or protected; invite links can optionally include the room credential for frictionless entry.
- Players can join without an account, choose a display name, and play immediately.
- Persistent rooms keep an all-time leaderboard with wins, losses, games played, and win/loss ratio for every player name.

## Experience

Wildcard is designed mobile-first and scales cleanly to desktop. The table must remain understandable with any supported player count, especially eight players on a small screen, using adaptive layouts rather than fixed seat positions.

Play should feel lively and tactile, with responsive card movement, clear turn and stack feedback, sound, and optional richer effects. Canvas, WebGL, or similar rendering may be used where it improves the experience, but accessibility, performance, and reliable gameplay come first.

## Platform

Wildcard runs on the web, is built with Remix 3, and deploys to Cloudflare. The architecture should separate the real-time multiplayer engine, configurable game rules, room persistence, identity, and presentation so the product can grow without rebuilding its foundations.

## Product Principles

1. **Join quickly:** opening an invite and entering a name should be enough to play.
2. **Mobile first:** every game state must remain clear and usable on a phone.
3. **Rules are extensible:** new modes and house rules should be additions, not rewrites.
4. **Persistent rooms build history:** authenticated owners can create lasting spaces for ongoing rivalries.
5. **Delight supports clarity:** animation and sound should make actions easier to understand, never harder.
6. **The server is authoritative:** move validation, stacking, turns, and scores must remain fair and consistent.

## MVP Success

A player can create and share a temporary room without authentication, or authenticate with a passkey to create a persistent room. Up to eight named players can complete a reliable match using the initial stacking rules, and persistent-room players can return later to see lifetime standings.
