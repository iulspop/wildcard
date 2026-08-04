import { describe, expect, it } from "vitest";

import type { StoredRoomState } from "./protocol.ts";
import { findSeatForAuthenticatedReclaim } from "./seat-identity.ts";

const seats: StoredRoomState["seats"] = [
  {
    playerId: "player-1",
    displayName: "Iuliu",
    reconnectHash: "old-hash",
    userId: "user-1",
    seatIndex: 0,
    connected: true,
  },
  {
    playerId: "player-2",
    displayName: "Guest",
    reconnectHash: "guest-hash",
    userId: null,
    seatIndex: 1,
    connected: false,
  },
];

describe("authenticated seat reclaim", () => {
  it("finds the same account seat even when it is still connected", () => {
    expect(
      findSeatForAuthenticatedReclaim(seats, "user-1", "user-1", "Iuliu"),
    ).toMatchObject({ playerId: "player-1", userId: "user-1" });
  });

  it("does not allow another account to claim a reserved display name", () => {
    expect(
      findSeatForAuthenticatedReclaim(seats, "user-2", "user-1", "Iuliu"),
    ).toBeUndefined();
  });

  it("lets the authenticated room owner adopt a legacy unlinked seat", () => {
    const legacySeats = seats.map((seat) => ({ ...seat, userId: null }));

    expect(
      findSeatForAuthenticatedReclaim(legacySeats, "user-1", "user-1", "Guest"),
    ).toMatchObject({ playerId: "player-2", userId: null });
  });
});
