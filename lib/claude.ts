import Anthropic from '@anthropic-ai/sdk';
import { loadEnv } from './env';

// Default model for all agents. Bump centrally when upgrading.
export const DEFAULT_MODEL = 'claude-sonnet-4-6';
export const DEFAULT_MAX_TOKENS = 4096;

let client: Anthropic | undefined;

export function getClaude(): Anthropic {
  if (client) return client;
  const env = loadEnv();
  // SDK has built-in exponential backoff for 429/5xx/529 — don't double-wrap.
  client = new Anthropic({ apiKey: env.AGENTS_ANTHROPIC_API_KEY, maxRetries: 3 });
  return client;
}

export type ClaudeMessage = Anthropic.MessageParam;

export async function callClaude(
  messages: ClaudeMessage[],
  opts: { model?: string; maxTokens?: number; system?: string } = {},
): Promise<string> {
  const response = await getClaude().messages.create({
    model: opts.model ?? DEFAULT_MODEL,
    max_tokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
    ...(opts.system ? { system: opts.system } : {}),
    messages,
  });
  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('Claude response contained no text block');
  }
  return textBlock.text;
}
