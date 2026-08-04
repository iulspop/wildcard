import { getUser, type UserRecord } from "./db.server.ts";

const COOKIE_NAME = "wildcard_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

async function sign(value: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return toBase64Url(
    new Uint8Array(
      await crypto.subtle.sign("HMAC", key, encoder.encode(value)),
    ),
  );
}

export async function createSession(
  db: D1Database,
  userId: string,
  secret: string,
  now = Date.now(),
) {
  if (secret.length < 32)
    throw new Error("SESSION_SECRET must be at least 32 characters");
  const id = crypto.randomUUID();
  const expiresAt = now + SESSION_TTL_MS;
  await db
    .prepare(
      "INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
    )
    .bind(id, userId, expiresAt, now)
    .run();
  const value = `${id}.${await sign(id, secret)}`;
  return `${COOKIE_NAME}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`;
}

export function clearSessionCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

function readCookie(request: Request) {
  const cookie = request.headers.get("Cookie") ?? "";
  return (
    cookie
      .split(/;\s*/)
      .find((part) => part.startsWith(`${COOKIE_NAME}=`))
      ?.slice(COOKIE_NAME.length + 1) ?? null
  );
}

export async function getSessionUser(
  request: Request,
  db: D1Database,
  secret: string,
  now = Date.now(),
): Promise<UserRecord | null> {
  const value = readCookie(request);
  if (!value) return null;
  const separator = value.lastIndexOf(".");
  if (separator < 1) return null;
  const id = value.slice(0, separator);
  if ((await sign(id, secret)) !== value.slice(separator + 1)) return null;
  const session = await db
    .prepare("SELECT user_id FROM sessions WHERE id = ? AND expires_at > ?")
    .bind(id, now)
    .first<{ user_id: string }>();
  return session ? getUser(db, session.user_id) : null;
}

export async function deleteSession(request: Request, db: D1Database) {
  const value = readCookie(request);
  const id = value?.slice(0, value.lastIndexOf("."));
  if (id) await db.prepare("DELETE FROM sessions WHERE id = ?").bind(id).run();
}
