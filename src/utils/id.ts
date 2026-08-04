import { randomUUID } from "node:crypto";

/** Generates a unique request/event ID. Falls back gracefully if crypto is unavailable. */
export function generateId(prefix = "evt"): string {
  try {
    return `${prefix}_${randomUUID()}`;
  } catch {
    const random = Math.random().toString(36).slice(2);
    return `${prefix}_${Date.now().toString(36)}${random}`;
  }
}
