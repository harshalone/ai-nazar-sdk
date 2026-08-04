import type { RedactFn } from "../types.js";

const REDACTED = "[REDACTED]";

// Best-effort patterns for common secrets/PII. Not exhaustive by design —
// this is a safety net, not a substitute for `capturePrompts: false` or a
// custom `redact` function tailored to the developer's data.
const PATTERNS: Array<{ name: string; regex: RegExp }> = [
  { name: "email", regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g },
  { name: "openai_key", regex: /sk-[A-Za-z0-9]{16,}/g },
  { name: "nazar_key", regex: /nz_(live|test)_[A-Za-z0-9]{8,}/g },
  { name: "bearer_token", regex: /Bearer\s+[A-Za-z0-9._-]{10,}/gi },
  {
    name: "credit_card",
    regex: /\b(?:\d[ -]*?){13,16}\b/g,
  },
  {
    name: "ssn",
    regex: /\b\d{3}-\d{2}-\d{4}\b/g,
  },
  {
    name: "phone",
    regex: /\+?\d{1,3}[-.\s]?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}\b/g,
  },
];

const SENSITIVE_KEY_NAMES = new Set([
  "password",
  "apikey",
  "api_key",
  "secret",
  "token",
  "authorization",
  "ssn",
  "creditcard",
  "credit_card",
]);

function redactString(value: string): string {
  let result = value;
  for (const { regex } of PATTERNS) {
    result = result.replace(regex, REDACTED);
  }
  return result;
}

/**
 * Recursively walks a value (string, object, array) and redacts anything
 * that looks like a secret or common PII. Applied when
 * `redactSensitiveData: true` (the default) to any captured prompt,
 * response, or metadata content.
 */
export function redactValue(value: unknown, depth = 0): unknown {
  if (depth > 20) return REDACTED; // guard against pathological/cyclic input

  if (typeof value === "string") {
    return redactString(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, depth + 1));
  }

  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      if (SENSITIVE_KEY_NAMES.has(key.toLowerCase())) {
        out[key] = REDACTED;
      } else {
        out[key] = redactValue(val, depth + 1);
      }
    }
    return out;
  }

  return value;
}

/**
 * Applies built-in redaction (if enabled) followed by a custom redact
 * function (if provided). Errors thrown by a custom `redact` function are
 * caught and logged rather than propagated — a broken redaction function
 * must never crash the host application or leak the un-redacted payload.
 */
export function applyRedaction(
  value: unknown,
  options: {
    redactSensitiveData: boolean;
    redact?: RedactFn;
    log: (...a: unknown[]) => void;
  },
): unknown {
  let result = value;

  if (options.redactSensitiveData) {
    result = redactValue(result);
  }

  if (options.redact) {
    try {
      result = options.redact(result);
    } catch (err) {
      options.log("custom redact() function threw; dropping field", err);
      return REDACTED;
    }
  }

  return result;
}
