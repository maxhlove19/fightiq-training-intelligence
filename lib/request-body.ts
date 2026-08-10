// Reading a JSON body without trusting it to be an object.
//
// `await request.json()` throws on malformed bytes, which every route already
// caught — but it returns cleanly for `null`, `7`, `"x"` and `[]`, and the next
// line was always a property read. A body of exactly `null` therefore crashed
// five routes with an empty 500: no message for the athlete, no useful entry in
// the logs, and a status code that says the server is broken when the request
// was.

export type JsonObject = Record<string, unknown>;

/**
 * The request body as an object, or null when it is anything else. Callers
 * answer a null with their own validation error, so the wording stays specific
 * to what that endpoint actually wanted.
 */
export async function readJsonObject(request: Request): Promise<JsonObject | null> {
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as JsonObject;
  } catch { return null; }
}

// Characters no training note ever legitimately contains, and that cause real
// trouble downstream: NUL and the C0/C1 control range corrupt logs and terminal
// output, and the bidirectional overrides let text render in an order that does
// not match the characters stored. Tabs and newlines are kept — people write
// notes in lines.
// eslint-disable-next-line no-control-regex -- matching control characters is the entire point of this expression.
const UNSAFE_TEXT = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;

/** An athlete's own words, with only the characters that were never words removed. */
export function cleanText(value: string): string {
  return value.replace(UNSAFE_TEXT, "");
}
