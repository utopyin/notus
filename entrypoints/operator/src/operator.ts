import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as AiError from "effect/unstable/ai/AiError";
import * as LanguageModel from "effect/unstable/ai/LanguageModel";
import * as Prompt from "effect/unstable/ai/Prompt";
import * as Response from "effect/unstable/ai/Response";
import { build } from "./prompt";
import * as Tools from "./tools";
import { Briefing, Disposition, type StepResult, type ToolCall } from "./types";

const Parts = Schema.Array(Response.Part(Tools.encoded));

/**
 * One model round for the current turn. Idempotency, leases and persistence belong to the
 * caller; this only turns a briefing plus earlier rounds into replayable response parts.
 */
export const run = Effect.fn("Operator.run")(function* (
  input: Briefing,
  priorParts: ReadonlyArray<Schema.Json>,
) {
  const briefing = yield* Schema.decodeEffect(Briefing)(input).pipe(
    Effect.mapError((error) =>
      AiError.make({
        module: "Operator",
        method: "run",
        reason: new AiError.InvalidUserInputError({ description: error.message }),
      }),
    ),
  );
  let prompt = build(briefing);
  for (const encoded of priorParts) {
    const parts = yield* Schema.decodeUnknownEffect(Parts)(encoded).pipe(
      Effect.mapError((error) =>
        AiError.make({
          module: "Operator",
          method: "run",
          reason: new AiError.InvalidUserInputError({ description: error.message }),
        }),
      ),
    );
    prompt = Prompt.concat(prompt, Prompt.fromResponseParts(parts));
  }
  // Tool calls come back unresolved; the durable owner executes them and appends results.
  const response = yield* LanguageModel.generateText({
    prompt,
    toolkit: Tools.ready,
    disableToolCallResolution: true,
  });
  const invalidOutput = (description: string) =>
    AiError.make({
      module: "Operator",
      method: "run",
      reason: new AiError.InvalidOutputError({ description }),
    });
  const encoded = yield* Schema.encodeEffect(Parts)(response.content).pipe(
    Effect.mapError((error) => invalidOutput(error.message)),
  );
  // Encoded parts may still carry undefined fields; persist exactly what JSON can replay.
  const parts = yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))(encoded).pipe(
    Effect.flatMap(Schema.decodeEffect(Schema.fromJsonString(Schema.Json))),
    Effect.mapError(() => invalidOutput("response parts are not JSON")),
  );
  const calls: Array<ToolCall> = [];
  for (const part of response.content) {
    if (part.type !== "tool-call") continue;
    const params = yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))(
      part.params,
    ).pipe(
      Effect.flatMap(Schema.decodeEffect(Schema.fromJsonString(Schema.Json))),
      Effect.mapError(() => invalidOutput("tool parameters are not JSON")),
    );
    calls.push({ id: part.id, name: part.name, params });
  }
  const result: StepResult = { parts, text: response.text, calls, final: calls.length === 0 };
  return result;
});

/** Encoded tool-result part the next prompt replays as a tool message. */
export const toolResult = (
  call: ToolCall,
  result: Schema.Json,
  isFailure: boolean,
): Schema.Json => ({
  type: "tool-result",
  id: call.id,
  name: call.name,
  result,
  isFailure,
  providerExecuted: false,
});

const backoff = (attempt: number) => Math.min(300_000, 5_000 * 2 ** Math.min(attempt, 6));

/** Retry only what a later attempt can change. Authorization and request faults are terminal. */
export const classify = (error: AiError.AiError, attempt: number, now: number): Disposition => {
  const reason = error.cause;
  const failure = reason._tag;
  switch (reason._tag) {
    case "RateLimitError": {
      const hinted = reason.retryAfter ? Duration.toMillis(reason.retryAfter) : undefined;
      return {
        _tag: "Retry",
        retryAt: now + Math.max(1_000, Math.min(hinted ?? backoff(attempt), 600_000)),
        failure,
      };
    }
    case "NetworkError":
    case "InternalProviderError":
    case "UnknownError":
      return { _tag: "Retry", retryAt: now + backoff(attempt), failure };
    case "AuthenticationError":
      return { _tag: "Failed", failure: `${failure}:${reason.kind}` };
    default:
      return { _tag: "Failed", failure };
  }
};

/** Human-readable reason for the origin conversation when a turn cannot complete. */
export const explain = (failure: string): string => {
  if (failure.startsWith("AuthenticationError"))
    return "the initiator's model connection is missing, revoked, or needs to be linked again";
  if (failure === "step-limit") return "the turn exceeded its step limit";
  if (failure === "RateLimitError" || failure === "QuotaExhaustedError")
    return "the model account is rate limited or out of quota";
  return `the model request failed (${failure})`;
};

export * as Operator from "./operator";
