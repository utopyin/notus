import * as OpenAiClient from "@effect/ai-openai/OpenAiClient";
import * as OpenAiLanguageModel from "@effect/ai-openai/OpenAiLanguageModel";
import * as Layer from "effect/Layer";
import { endpoint } from "./backend";
import type { Provider } from "./types";

export interface Options {
  readonly provider: Provider;
  readonly model: string;
  readonly maxOutputTokens: number;
  readonly reasoningEffort: "minimal" | "low" | "medium" | "high";
}

/**
 * Neutral LanguageModel over the selected backend. The caller supplies the HttpClient,
 * which is where authorization happens; this layer never sees a bearer token.
 * The backend is stateless: nothing is stored server-side and reasoning continuity
 * travels encrypted inside the prompt.
 */
export const languageModel = (options: Options) =>
  OpenAiLanguageModel.layer({
    model: options.model,
    config: {
      store: false,
      include: ["reasoning.encrypted_content"],
      reasoning: { effort: options.reasoningEffort, summary: "auto" },
      max_output_tokens: options.maxOutputTokens,
    },
  }).pipe(Layer.provide(OpenAiClient.layer({ apiUrl: endpoint(options.provider) })));

export * as Model from "./model";
