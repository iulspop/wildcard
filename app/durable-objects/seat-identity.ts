import type { StoredRoomState } from "./protocol.ts";

export function findSeatForAuthenticatedReclaim(
  seats: StoredRoomState["seats"],
  authenticatedUserId: string | undefined,
  ownerUserId: string | null,
  requestedDisplayName: string,
) {
  if (!authenticatedUserId) return undefined;
  return (
    seats.find((seat) => seat.userId === authenticatedUserId) ??
    (authenticatedUserId === ownerUserId
      ? seats.find(
          (seat) =>
            seat.displayName.toLocaleLowerCase() ===
            requestedDisplayName.toLocaleLowerCase(),
        )
      : undefined)
  );
}
