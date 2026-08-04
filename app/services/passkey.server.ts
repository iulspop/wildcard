import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";

import {
  consumeChallenge,
  createUserCredential,
  getCredential,
  getCredentialsForUser,
  storeChallenge,
  updateCredentialCounter,
} from "./db.server.ts";
import type { WorkerEnv } from "./env.server.ts";

const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const encoder = new TextEncoder();

export async function registrationOptions(
  env: WorkerEnv,
  displayName: string,
  now = Date.now(),
) {
  const normalizedName = displayName.trim();
  if (normalizedName.length < 1 || normalizedName.length > 32)
    throw new Error("Display name must be 1–32 characters");
  const userId = crypto.randomUUID();
  const options = await generateRegistrationOptions({
    rpName: env.PASSKEY_RP_NAME,
    rpID: env.PASSKEY_RP_ID,
    userName: normalizedName,
    userDisplayName: normalizedName,
    userID: encoder.encode(userId),
    attestationType: "none",
    authenticatorSelection: {
      residentKey: "required",
      userVerification: "required",
    },
  });
  const challengeId = crypto.randomUUID();
  await storeChallenge(
    env.AUTH_DB,
    {
      id: challengeId,
      kind: "registration",
      challenge: options.challenge,
      userId,
      displayName: normalizedName,
      expiresAt: now + CHALLENGE_TTL_MS,
    },
    now,
  );
  return { challengeId, options };
}

export async function verifyRegistration(
  env: WorkerEnv,
  challengeId: string,
  response: RegistrationResponseJSON,
  now = Date.now(),
) {
  const challenge = await consumeChallenge(
    env.AUTH_DB,
    challengeId,
    "registration",
    now,
  );
  if (!challenge?.userId || !challenge.displayName)
    throw new Error("Registration challenge is invalid or expired");
  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge: challenge.challenge,
    expectedOrigin: env.PASSKEY_ORIGIN,
    expectedRPID: env.PASSKEY_RP_ID,
    requireUserVerification: true,
  });
  if (!verification.verified)
    throw new Error("Passkey registration could not be verified");
  const credential = verification.registrationInfo.credential;
  await createUserCredential(
    env.AUTH_DB,
    {
      id: challenge.userId,
      displayName: challenge.displayName,
      createdAt: now,
    },
    {
      credentialId: credential.id,
      userId: challenge.userId,
      publicKey: credential.publicKey,
      counter: credential.counter,
      transports: credential.transports ?? response.response.transports ?? [],
    },
    now,
  );
  return challenge.userId;
}

export async function authenticationOptions(
  env: WorkerEnv,
  userId?: string,
  now = Date.now(),
) {
  const credentials = userId
    ? await getCredentialsForUser(env.AUTH_DB, userId)
    : [];
  const options = await generateAuthenticationOptions({
    rpID: env.PASSKEY_RP_ID,
    userVerification: "required",
    allowCredentials: credentials.map((credential) => ({
      id: credential.credentialId,
      transports: credential.transports as AuthenticatorTransportFuture[],
    })),
  });
  const challengeId = crypto.randomUUID();
  await storeChallenge(
    env.AUTH_DB,
    {
      id: challengeId,
      kind: "authentication",
      challenge: options.challenge,
      userId: userId ?? null,
      displayName: null,
      expiresAt: now + CHALLENGE_TTL_MS,
    },
    now,
  );
  return { challengeId, options };
}

export async function verifyAuthentication(
  env: WorkerEnv,
  challengeId: string,
  response: AuthenticationResponseJSON,
  now = Date.now(),
) {
  const challenge = await consumeChallenge(
    env.AUTH_DB,
    challengeId,
    "authentication",
    now,
  );
  if (!challenge)
    throw new Error("Authentication challenge is invalid or expired");
  const credential = await getCredential(env.AUTH_DB, response.id);
  if (
    !credential ||
    (challenge.userId && credential.userId !== challenge.userId)
  )
    throw new Error("Passkey is not recognized");
  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge: challenge.challenge,
    expectedOrigin: env.PASSKEY_ORIGIN,
    expectedRPID: env.PASSKEY_RP_ID,
    credential: {
      id: credential.credentialId,
      publicKey: new Uint8Array(credential.publicKey),
      counter: credential.counter,
      transports: credential.transports as AuthenticatorTransportFuture[],
    },
    requireUserVerification: true,
  });
  if (!verification.verified)
    throw new Error("Passkey authentication could not be verified");
  await updateCredentialCounter(
    env.AUTH_DB,
    credential.credentialId,
    verification.authenticationInfo.newCounter,
    now,
  );
  return credential.userId;
}
