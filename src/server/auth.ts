import { and, eq, gt } from "drizzle-orm";
import { cookies } from "next/headers";
import { db } from "@/db";
import { authSessions, campaignMembers, campaigns, users } from "@/db/schema";
import {
  generateReclaimCode,
  generateSessionToken,
  hashToken,
  normalizeReclaimCode,
} from "./codes";

/**
 * Identity without accounts.
 *
 * A D&D group should not have to sign up to roll dice. A player types a
 * display name, gets an opaque session token in an httpOnly cookie, and is
 * durably that person on this device. A one-time reclaim code moves them to
 * another device.
 *
 * The cookie holds a random token; only its SHA-256 reaches the database, so a
 * leaked database row cannot be replayed as a session.
 */

export const SESSION_COOKIE = "dnd_session";
const SESSION_DAYS = 90;

export type SessionUser = {
  id: string;
  displayName: string;
};

function expiryDate(): Date {
  return new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
}

async function setSessionCookie(token: string) {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiryDate(),
  });
}

async function issueSession(userId: string): Promise<void> {
  const token = generateSessionToken();
  await db.insert(authSessions).values({
    userId,
    tokenHash: hashToken(token),
    expiresAt: expiryDate(),
  });
  await setSessionCookie(token);
}

/** The signed-in user, or null. Safe to call from any server context. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const rows = await db
    .select({ id: users.id, displayName: users.displayName })
    .from(authSessions)
    .innerJoin(users, eq(users.id, authSessions.userId))
    .where(
      and(
        eq(authSessions.tokenHash, hashToken(token)),
        gt(authSessions.expiresAt, new Date()),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

/** The signed-in user, or a thrown error for route handlers to turn into a 401. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new AuthError("You are not signed in.");
  return user;
}

/**
 * Registers a new player and signs them in. Returns the reclaim code, which is
 * the only time it is ever visible — the database keeps a hash.
 */
export async function createUser(
  displayName: string,
): Promise<{ user: SessionUser; reclaimCode: string }> {
  const name = displayName.trim();
  if (name.length < 1 || name.length > 40) {
    throw new AuthError("Pick a display name between 1 and 40 characters.");
  }

  const reclaimCode = generateReclaimCode();
  const [row] = await db
    .insert(users)
    .values({ displayName: name, reclaimCodeHash: hashToken(reclaimCode) })
    .returning({ id: users.id, displayName: users.displayName });

  await issueSession(row.id);
  return { user: row, reclaimCode };
}

/** Signs in as an existing player on a new device using their reclaim code. */
export async function reclaimUser(code: string): Promise<SessionUser> {
  const hash = hashToken(normalizeReclaimCode(code));
  const rows = await db
    .select({ id: users.id, displayName: users.displayName })
    .from(users)
    .where(eq(users.reclaimCodeHash, hash))
    .limit(1);

  if (rows.length === 0) throw new AuthError("That reclaim code does not match any player.");

  await issueSession(rows[0].id);
  return rows[0];
}

export async function signOut(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    await db.delete(authSessions).where(eq(authSessions.tokenHash, hashToken(token)));
  }
  jar.delete(SESSION_COOKIE);
}

/* ------------------------------------------------------------------ *
 * Campaign membership
 * ------------------------------------------------------------------ */

export type Membership = {
  campaignId: string;
  userId: string;
  role: "player" | "co_dm" | "observer";
};

export async function getMembership(
  campaignId: string,
  userId: string,
): Promise<Membership | null> {
  const rows = await db
    .select()
    .from(campaignMembers)
    .where(
      and(eq(campaignMembers.campaignId, campaignId), eq(campaignMembers.userId, userId)),
    )
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Asserts the caller belongs to this campaign. Every route that touches
 * campaign state goes through here — membership is never inferred from a body
 * parameter the client controls.
 */
export async function requireMembership(campaignId: string): Promise<{
  user: SessionUser;
  membership: Membership;
}> {
  const user = await requireUser();
  const membership = await getMembership(campaignId, user.id);
  if (!membership) throw new AuthError("You are not a member of this campaign.");
  return { user, membership };
}

/** Co-DMs and the campaign's creator may override the engine and the AI. */
export async function requireDmPowers(campaignId: string) {
  const { user, membership } = await requireMembership(campaignId);
  if (membership.role === "co_dm") return { user, membership };

  const rows = await db
    .select({ createdBy: campaigns.createdBy })
    .from(campaigns)
    .where(eq(campaigns.id, campaignId))
    .limit(1);

  if (rows[0]?.createdBy !== user.id) {
    throw new AuthError("Only a co-DM can do that.");
  }
  return { user, membership };
}
