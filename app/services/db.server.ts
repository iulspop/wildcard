export interface UserRecord {
  id: string;
  displayName: string;
  createdAt: number;
}

export interface CredentialRecord {
  credentialId: string;
  userId: string;
  publicKey: Uint8Array;
  counter: number;
  transports: string[];
}

export interface ChallengeRecord {
  id: string;
  kind: "registration" | "authentication";
  challenge: string;
  userId: string | null;
  displayName: string | null;
  expiresAt: number;
}

type UserRow = { id: string; display_name: string; created_at: number };
type CredentialRow = {
  credential_id: string;
  user_id: string;
  public_key: ArrayBuffer;
  counter: number;
  transports: string;
};
type ChallengeRow = {
  id: string;
  kind: ChallengeRecord["kind"];
  challenge: string;
  user_id: string | null;
  display_name: string | null;
  expires_at: number;
};

export async function getUser(db: D1Database, id: string) {
  const row = await db
    .prepare("SELECT id, display_name, created_at FROM users WHERE id = ?")
    .bind(id)
    .first<UserRow>();
  return row
    ? ({
        id: row.id,
        displayName: row.display_name,
        createdAt: row.created_at,
      } satisfies UserRecord)
    : null;
}

export async function getCredentialsForUser(db: D1Database, userId: string) {
  const { results } = await db
    .prepare(
      "SELECT credential_id, user_id, public_key, counter, transports FROM passkey_credentials WHERE user_id = ?",
    )
    .bind(userId)
    .all<CredentialRow>();
  return results.map(mapCredential);
}

export async function getCredential(db: D1Database, credentialId: string) {
  const row = await db
    .prepare(
      "SELECT credential_id, user_id, public_key, counter, transports FROM passkey_credentials WHERE credential_id = ?",
    )
    .bind(credentialId)
    .first<CredentialRow>();
  return row ? mapCredential(row) : null;
}

function mapCredential(row: CredentialRow): CredentialRecord {
  return {
    credentialId: row.credential_id,
    userId: row.user_id,
    publicKey: new Uint8Array(row.public_key),
    counter: row.counter,
    transports: JSON.parse(row.transports) as string[],
  };
}

export async function storeChallenge(
  db: D1Database,
  challenge: ChallengeRecord,
  now: number,
) {
  await db.batch([
    db.prepare("DELETE FROM auth_challenges WHERE expires_at <= ?").bind(now),
    db
      .prepare(
        "INSERT INTO auth_challenges (id, kind, challenge, user_id, display_name, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(
        challenge.id,
        challenge.kind,
        challenge.challenge,
        challenge.userId,
        challenge.displayName,
        challenge.expiresAt,
        now,
      ),
  ]);
}

export async function consumeChallenge(
  db: D1Database,
  id: string,
  kind: ChallengeRecord["kind"],
  now: number,
) {
  const row = await db
    .prepare(
      "DELETE FROM auth_challenges WHERE id = ? AND kind = ? AND expires_at > ? RETURNING id, kind, challenge, user_id, display_name, expires_at",
    )
    .bind(id, kind, now)
    .first<ChallengeRow>();
  return row
    ? ({
        id: row.id,
        kind: row.kind,
        challenge: row.challenge,
        userId: row.user_id,
        displayName: row.display_name,
        expiresAt: row.expires_at,
      } satisfies ChallengeRecord)
    : null;
}

export async function createUserCredential(
  db: D1Database,
  user: UserRecord,
  credential: CredentialRecord,
  now: number,
) {
  await db.batch([
    db
      .prepare(
        "INSERT INTO users (id, display_name, created_at) VALUES (?, ?, ?)",
      )
      .bind(user.id, user.displayName, user.createdAt),
    db
      .prepare(
        "INSERT INTO passkey_credentials (credential_id, user_id, public_key, counter, transports, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .bind(
        credential.credentialId,
        credential.userId,
        credential.publicKey,
        credential.counter,
        JSON.stringify(credential.transports),
        now,
      ),
  ]);
}

export async function updateCredentialCounter(
  db: D1Database,
  credentialId: string,
  counter: number,
  now: number,
) {
  await db
    .prepare(
      "UPDATE passkey_credentials SET counter = ?, last_used_at = ? WHERE credential_id = ?",
    )
    .bind(counter, now, credentialId)
    .run();
}
