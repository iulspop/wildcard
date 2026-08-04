import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";

import type { WorkerEnv } from "../services/env.server.ts";
import {
  authenticationOptions,
  registrationOptions,
  verifyAuthentication,
  verifyRegistration,
} from "../services/passkey.server.ts";
import {
  clearSessionCookie,
  createSession,
  deleteSession,
  getSessionUser,
} from "../services/session.server.ts";

const JSON_HEADERS = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};

function json(value: unknown, init: ResponseInit = {}) {
  return Response.json(value, {
    ...init,
    headers: { ...JSON_HEADERS, ...init.headers },
  });
}

async function body<T>(request: Request): Promise<T> {
  const length = Number(request.headers.get("Content-Length") ?? 0);
  if (length > 128_000) throw new Error("Request body is too large");
  return request.json<T>();
}

export async function handleAuthRequest(
  request: Request,
  env: WorkerEnv,
): Promise<Response | null> {
  const { pathname } = new URL(request.url);
  if (!pathname.startsWith("/api/auth/")) return null;

  try {
    if (
      pathname === "/api/auth/register/options" &&
      request.method === "POST"
    ) {
      const input = await body<{ displayName: string }>(request);
      return json(await registrationOptions(env, input.displayName));
    }
    if (pathname === "/api/auth/register/verify" && request.method === "POST") {
      const input = await body<{
        challengeId: string;
        response: RegistrationResponseJSON;
      }>(request);
      const userId = await verifyRegistration(
        env,
        input.challengeId,
        input.response,
      );
      return json(
        { verified: true },
        {
          headers: {
            "Set-Cookie": await createSession(
              env.AUTH_DB,
              userId,
              env.SESSION_SECRET,
            ),
          },
        },
      );
    }
    if (pathname === "/api/auth/login/options" && request.method === "POST") {
      const input = await body<{ userId?: string }>(request);
      return json(await authenticationOptions(env, input.userId));
    }
    if (pathname === "/api/auth/login/verify" && request.method === "POST") {
      const input = await body<{
        challengeId: string;
        response: AuthenticationResponseJSON;
      }>(request);
      const userId = await verifyAuthentication(
        env,
        input.challengeId,
        input.response,
      );
      return json(
        { verified: true },
        {
          headers: {
            "Set-Cookie": await createSession(
              env.AUTH_DB,
              userId,
              env.SESSION_SECRET,
            ),
          },
        },
      );
    }
    if (pathname === "/api/auth/session" && request.method === "GET") {
      return json({
        user: await getSessionUser(request, env.AUTH_DB, env.SESSION_SECRET),
      });
    }
    if (pathname === "/api/auth/logout" && request.method === "POST") {
      await deleteSession(request, env.AUTH_DB);
      return json(
        { signedOut: true },
        { headers: { "Set-Cookie": clearSessionCookie() } },
      );
    }
    return json({ error: "Not found" }, { status: 404 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Authentication request failed";
    return json({ error: message }, { status: 400 });
  }
}
