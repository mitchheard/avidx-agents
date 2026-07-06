import type Anthropic from '@anthropic-ai/sdk';

export type Tool = {
  def: Anthropic.Tool;
  run: (input: unknown) => Promise<string>;
};
