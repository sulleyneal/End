import { ZodError } from "zod";
import { AuthError } from "./auth";
import { CampaignError } from "./campaigns";
import { BuildError } from "@/rules/build";

/**
 * One place that turns a thrown error into a status code, so every route
 * reports failures the same way and no handler leaks an internal message to a
 * player.
 */

export class RuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuleError";
  }
}

export class NotFoundError extends Error {
  constructor(message = "Not found.") {
    super(message);
    this.name = "NotFoundError";
  }
}

export function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

export function toResponse(error: unknown): Response {
  if (error instanceof AuthError) return jsonError(error.message, 401);
  if (error instanceof NotFoundError) return jsonError(error.message, 404);
  if (error instanceof CampaignError || error instanceof BuildError || error instanceof RuleError) {
    return jsonError(error.message, 400);
  }
  if (error instanceof ZodError) {
    const first = error.issues[0];
    const path = first?.path.join(".");
    return jsonError(
      path ? `${path}: ${first.message}` : (first?.message ?? "Invalid request."),
      400,
    );
  }

  // Anything unrecognised is a bug: log it in full, tell the player nothing.
  console.error("Unhandled route error:", error);
  return jsonError("Something went wrong on the server.", 500);
}

/** Wraps a route handler so thrown errors become well-formed responses. */
export function route<A extends unknown[]>(
  handler: (...args: A) => Promise<Response>,
): (...args: A) => Promise<Response> {
  return async (...args: A) => {
    try {
      return await handler(...args);
    } catch (error) {
      return toResponse(error);
    }
  };
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new RuleError("Request body must be JSON.");
  }
}
