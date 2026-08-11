// The one place FightIQ talks to a model.
//
// Everything that reads an athlete's training back to them goes through here:
// the debrief, Coach, the meal estimate and the strength plan. Keeping it in one
// file means the model, the effort level, the refusal handling and the timeouts
// are decided once rather than drifting apart across four call sites.
//
// The model is Claude Opus 5. That is a deliberate choice rather than a default:
// this app's whole promise is that the thing reading your notes is better than
// you at spotting the pattern, and there is no point charging for a cheap guess.
import Anthropic from "@anthropic-ai/sdk";
import { walkStrings, toHouseStyle } from "./house-style";
import { toAthleteVoice } from "./athlete-voice";

/**
 * Opus 5. Fixed id, no date suffix.
 *
 * Two things about this model shape the code below. Thinking is on by default,
 * so `max_tokens` has to cover the reasoning as well as the answer or the JSON
 * comes back cut in half. And its safety classifiers can decline a request with
 * a normal 200 and `stop_reason: "refusal"`, so the stop reason is read before
 * the content, never after.
 */
export const CLAUDE_MODEL = "claude-opus-5";

/**
 * How hard the model works. `high` is the default and is what the two surfaces
 * an athlete actually reads are set to. The mechanical jobs run at `low`, which
 * on this model is still stronger than the previous generation at its hardest
 * setting, and keeps a photo estimate feeling instant.
 *
 * Never disable thinking to save time. Lowering effort is the cheaper lever and
 * it does not bring the failure modes that a disabled-thinking path does.
 */
export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export type ClaudeText = { type: "text"; text: string };
export type ClaudeImage = { type: "image"; mimeType: string; base64: string };
export type UserPart = ClaudeText | ClaudeImage;

export type JsonCall = {
  apiKey: string;
  /** A stable instruction first, then anything that varies. Only the first is cached. */
  system: string[];
  user: UserPart[];
  /** The exact shape the answer must take. The model is constrained to it, not asked for it. */
  schema: Record<string, unknown>;
  effort: Effort;
  maxTokens: number;
  timeoutMs: number;
  /** A hashed owner id. Never an email, never a raw id. */
  userHash: string;
  /** Injected so the request shape and every failure path can be tested without a network. */
  fetchImpl?: typeof fetch;
};

/**
 * One failure type for every way a model call can go wrong, so each caller can
 * translate it into its own error without repeating the diagnosis.
 */
export class ClaudeError extends Error {
  code: string;
  status: number;
  development: Record<string, unknown>;
  constructor(code: string, status: number, development: Record<string, unknown> = {}) {
    super(code);
    this.code = code;
    this.status = status;
    this.development = development;
  }
}

/** A stable, non-reversible id for abuse reporting. Nothing about the person survives it. */
export async function hashOwner(ownerId: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`fightiq:${ownerId}`));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, 48);
}

/** `data:image/jpeg;base64,AAAA` is how the browser hands us a photo. Claude wants the two halves apart. */
export function imagePart(dataUrl: string, mimeType: string): ClaudeImage | null {
  const comma = dataUrl.indexOf(",");
  const base64 = comma === -1 ? dataUrl : dataUrl.slice(comma + 1);
  const declared = /^data:([^;,]+)/.exec(dataUrl)?.[1] ?? "";
  const type = (declared || mimeType).toLowerCase();
  if (!base64 || !["image/jpeg", "image/png", "image/gif", "image/webp"].includes(type)) return null;
  return { type: "image", mimeType: type, base64 };
}

function client(apiKey: string, timeoutMs: number, fetchImpl?: typeof fetch) {
  return new Anthropic({
    apiKey,
    timeout: timeoutMs,
    // One retry. A model call sits between an athlete and their session, so a
    // retry storm costs more than the failure it is trying to hide.
    maxRetries: 1,
    ...(fetchImpl ? { fetch: fetchImpl } : {}),
  });
}

function systemBlocks(system: string[]): Anthropic.TextBlockParam[] {
  return system.filter((text) => text.trim()).map((text, index) => ({
    type: "text" as const,
    text,
    // The first block is the coaching method and never changes between calls,
    // which is exactly what caching is for. Everything after it varies per note,
    // so caching it would only invalidate the prefix.
    ...(index === 0 ? { cache_control: { type: "ephemeral" as const } } : {}),
  }));
}

function userContent(parts: UserPart[]): Anthropic.ContentBlockParam[] {
  return parts.map((part) => part.type === "text"
    ? { type: "text" as const, text: part.text }
    : { type: "image" as const, source: { type: "base64" as const, media_type: part.mimeType as "image/jpeg", data: part.base64 } });
}

function readText(message: { content: Array<{ type: string }> }) {
  return message.content
    .filter((block): block is { type: "text"; text: string } => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();
}

/**
 * Ask Claude for one JSON object and return it parsed.
 *
 * The shape is enforced by the API rather than requested in prose, so a model
 * that decides to write a paragraph instead cannot reach the caller. Everything
 * that can still go wrong arrives as a ClaudeError with a code the caller can
 * turn into something an athlete can act on.
 */
export async function requestJson(call: JsonCall): Promise<unknown> {
  const anthropic = client(call.apiKey, call.timeoutMs, call.fetchImpl);
  const system = systemBlocks(call.system);
  const request = {
    model: CLAUDE_MODEL,
    max_tokens: call.maxTokens,
    // An empty array is not the same as no system prompt, and the API rejects it.
    ...(system.length ? { system } : {}),
    messages: [{ role: "user" as const, content: userContent(call.user) }],
    output_config: { effort: call.effort, format: { type: "json_schema" as const, schema: call.schema } },
    metadata: { user_id: call.userHash },
  };

  let message: Anthropic.Beta.BetaMessage | Anthropic.Message;
  try {
    // Opus 5's classifiers occasionally decline something benign. Rather than
    // handing that refusal to an athlete who wrote a note about getting hurt,
    // the API re-runs it on Anthropic's recommended substitute inside the same
    // call, chosen by why it was declined.
    message = await anthropic.beta.messages.create({
      ...request,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
  } catch (error) {
    // An account without the fallback beta must not lose the whole feature over
    // an optional safety net. This is the only case where we quietly try again.
    if (error instanceof Anthropic.BadRequestError && /fallback|beta/i.test(error.message)) {
      message = await anthropic.messages.create(request).catch(rethrow);
    } else {
      return rethrow(error);
    }
  }

  // Read this before the content. On a refusal there is nothing in content to read.
  if (message.stop_reason === "refusal") {
    throw new ClaudeError("AI_REFUSED", 502, { category: message.stop_details?.category ?? "unknown" });
  }
  if (message.stop_reason === "max_tokens") {
    throw new ClaudeError("AI_TRUNCATED", 502, { maxTokens: call.maxTokens });
  }
  const text = readText(message);
  if (!text) throw new ClaudeError("AI_EMPTY", 502, { stopReason: message.stop_reason ?? "none" });
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ClaudeError("AI_UNPARSEABLE", 502, { length: text.length });
  }
  // Every readable string the product will ever show comes back through here, so
  // both rules are applied once, to all of it, rather than at each of the four
  // call sites where somebody would eventually forget.
  //
  // The voice pass is here as well as at display time on purpose. Stored model
  // text is fed back to the model as its own context on the next call, so a
  // debrief saved as "Athlete reported the technique worked" was quietly teaching
  // the next answer to talk about the athlete instead of to them. Fixing it only
  // on the way to the screen would have left that loop running.
  return walkStrings(parsed, (text) => toAthleteVoice(toHouseStyle(text)));
}

function rethrow(error: unknown): never {
  if (error instanceof ClaudeError) throw error;
  if (error instanceof Anthropic.APIConnectionTimeoutError) {
    throw new ClaudeError("AI_TIMEOUT", 504, { cause: "The model did not answer in time." });
  }
  if (error instanceof Anthropic.APIConnectionError) {
    throw new ClaudeError("AI_NETWORK_ERROR", 503, { cause: error.message.slice(0, 300) });
  }
  if (error instanceof Anthropic.AuthenticationError) {
    throw new ClaudeError("AI_UPSTREAM_ERROR", 503, { upstreamStatus: error.status ?? 401, providerMessage: "The ANTHROPIC_API_KEY was rejected." });
  }
  if (error instanceof Anthropic.APIError) {
    const status = error.status ?? 503;
    throw new ClaudeError("AI_UPSTREAM_ERROR", status === 429 ? 429 : 503, {
      upstreamStatus: status,
      providerMessage: error.message.slice(0, 400),
      ...(error.requestID ? { requestId: error.requestID } : {}),
    });
  }
  throw new ClaudeError("AI_NETWORK_ERROR", 503, { cause: error instanceof Error ? error.message.slice(0, 300) : "Unknown failure" });
}
