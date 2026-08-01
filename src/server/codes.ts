import { randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { createHash } from "node:crypto";

/**
 * Human-typed codes and the tokens behind them.
 *
 * Join codes and reclaim codes are read aloud across a table, so they avoid
 * the character pairs people mishear or mistype.
 */

/**
 * Excludes both halves of every look-alike pair — I/L/1, O/0, S/5, Z/2, U/V.
 * Because no ambiguous character can appear in a code, reading one back only
 * needs case-folding: there is nothing left to guess between.
 */
const ALPHABET = "ACDEFGHJKMNPQRTWXY3467";

export function generateJoinCode(length = 6): string {
  let code = "";
  for (let i = 0; i < length; i++) code += ALPHABET[randomInt(0, ALPHABET.length)];
  return code;
}

/** Normalizes what a player typed: trims, upper-cases, drops spaces and dashes. */
export function normalizeJoinCode(input: string): string {
  return input.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function isPlausibleJoinCode(code: string): boolean {
  return code.length === 6 && [...code].every((c) => ALPHABET.includes(c));
}

const WORDS_A = [
  "amber", "brisk", "clever", "dusky", "eager", "fabled", "gilded", "hollow",
  "iron", "jolly", "keen", "lucky", "murky", "noble", "olden", "proud",
  "quiet", "rapid", "silver", "tidal", "umber", "vivid", "wary", "young",
];

const WORDS_B = [
  "anvil", "badger", "candle", "dagger", "ember", "falcon", "grotto", "harbor",
  "ingot", "jackal", "kettle", "lantern", "marsh", "nettle", "otter", "pillar",
  "quarry", "raven", "sigil", "thicket", "urchin", "vault", "warden", "yarrow",
];

/**
 * A personal reclaim code, e.g. `silver-raven-4127`. Shown once, stored only as
 * a hash. It lets a player pick their character back up on another device
 * without an account.
 */
export function generateReclaimCode(): string {
  const a = WORDS_A[randomInt(0, WORDS_A.length)];
  const b = WORDS_B[randomInt(0, WORDS_B.length)];
  return `${a}-${b}-${randomInt(1000, 10000)}`;
}

export function normalizeReclaimCode(input: string): string {
  return input.trim().toLowerCase().replace(/\s+/g, "-");
}

/** An opaque session token. Only its hash reaches the database. */
export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Constant-time comparison for anything secret. */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
