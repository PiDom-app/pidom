/**
 * The agent, and the one place a model provider is named.
 *
 * Separated from `model/ai.ts` because that file is imported by queries and
 * this one constructs an object that reaches a network. Keeping them apart
 * means a query that only wants `aiOf` does not drag the AI SDK into its
 * dependency graph.
 *
 * **No tools, and that is the security decision rather than a stage of the
 * work.** A passage from a PDF is untrusted input — anybody can write "ignore
 * your instructions" into a document and share it, and this application's whole
 * premise is that readers open documents other people sent them. The system
 * prompt fences the quoted pages and says they are quotation, which is
 * mitigation; the structural answer is that there is nothing for a successful
 * injection to reach. Nothing the model returns picks a page, fetches a URL, or
 * writes a row. The worst a hostile document can do is make one answer wrong,
 * in a sheet that shows which pages it was given.
 *
 * Adding a tool here would change that, and would want its own argument.
 */
import { Agent } from '@convex-dev/agent';
import { convexGateway } from '@convex-dev/ai-sdk-provider';

import { components } from '../_generated/api';
import { AI_DEFAULT_MODEL, AI_INSTRUCTIONS } from './ai';
import { rateLimiter } from './rateLimits';

/**
 * Which service the model is reached through.
 *
 * The Convex AI Gateway, and the reason is one line long: **there is no API key
 * on this deployment for anybody to leak, rotate or forget to rotate.**
 * `getServiceToken` mints a short-lived, deployment-scoped token inside the
 * action, so there is nothing in `npx convex env` and nothing in this
 * repository. `docs/security.md` has a paragraph about the Expo access token
 * that has to be set and cannot be; this is the same class of problem, not
 * solved but avoided.
 *
 * **The seam is `languageModelFor`, and a second provider is one function.**
 * `@openrouter/ai-sdk-provider` implements the same `LanguageModelV2` interface
 * and slots in here — a key set with `npx convex env set OPENROUTER_API_KEY`
 * and read through the typed `env` object, never `EXPO_PUBLIC_*`, never on the
 * handset. Nothing else in the feature changes, because nothing else in the
 * feature names a provider.
 */
export function languageModelFor(model: string) {
  return convexGateway(model);
}

export const agent = new Agent(components.agent, {
  name: 'Pidom',

  /**
   * The default, overridden per question.
   *
   * The constructor requires one, and every call site passes the reader's own
   * choice from `aiSettings.model` — so this is what a generation would use if
   * one ever forgot to, which is the right thing for a default to be rather
   * than the thing the feature actually runs on.
   */
  languageModel: languageModelFor(AI_DEFAULT_MODEL),
  instructions: AI_INSTRUCTIONS,

  /**
   * Nothing. See the note at the top of this file.
   */
  tools: {},

  /**
   * Spends the token budget after the answer rather than estimating it before.
   *
   * `reserve: true` allows a temporary negative balance, which is the whole
   * point: an answer that turned out to cost more than the estimate settles the
   * difference and delays the *next* question, instead of being refused
   * halfway through and leaving the reader with three sentences and an error.
   *
   * Keyed on the profile row's id, the way every other limit in this backend
   * is. `usage.totalTokens` can be absent when a provider does not report it,
   * and an unmetered generation is better than a throw inside a callback that
   * runs after the answer is already saved.
   */
  usageHandler: async (ctx, { userId, usage }) => {
    if (userId === undefined || usage.totalTokens === undefined) {
      return;
    }
    await rateLimiter.limit(ctx, 'aiTokens', {
      key: userId,
      count: usage.totalTokens,
      reserve: true,
    });
  },
});
