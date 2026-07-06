import type Anthropic from '@anthropic-ai/sdk';
import { getClaude, DEFAULT_MODEL, DEFAULT_MAX_TOKENS } from './claude';
import { logger } from './logger';
import type { Tool } from '../tools/types';

const MAX_TURNS = 8;

export type AgentResult = {
  text: string;
  turns: number;
  inputTokens: number;
  outputTokens: number;
};

export class AgentLoopError extends Error {
  turns: number;
  inputTokens: number;
  outputTokens: number;

  constructor(
    message: string,
    usage: { turns: number; inputTokens: number; outputTokens: number },
    cause?: unknown,
  ) {
    super(message, cause ? { cause } : undefined);
    this.name = 'AgentLoopError';
    this.turns = usage.turns;
    this.inputTokens = usage.inputTokens;
    this.outputTokens = usage.outputTokens;
  }
}

function isToolUseBlock(block: Anthropic.ContentBlock): block is Anthropic.ToolUseBlock {
  return block.type === 'tool_use';
}

function isTextBlock(block: Anthropic.ContentBlock): block is Anthropic.TextBlock {
  return block.type === 'text';
}

// Reusable Claude tool-use loop. Runs turns until the model stops requesting
// tools (or MAX_TURNS is hit), executing every tool it asks for in parallel
// each turn. Per-turn tool calls are logged — that trace is the point of
// this spike, not just the final output.
export async function runAgent(opts: {
  system: string;
  goal: string;
  tools: Tool[];
  model?: string;
}): Promise<AgentResult> {
  const { system, goal, tools, model } = opts;
  const client = getClaude();
  const toolDefs = tools.map((t) => t.def);
  const toolByName = new Map(tools.map((t) => [t.def.name, t]));

  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: goal }];

  let inputTokens = 0;
  let outputTokens = 0;
  let turn = 0;

  while (turn < MAX_TURNS) {
    turn += 1;

    let response: Anthropic.Message;
    try {
      response = await client.messages.create({
        model: model ?? DEFAULT_MODEL,
        max_tokens: DEFAULT_MAX_TOKENS,
        system,
        messages,
        tools: toolDefs,
      });
    } catch (err) {
      throw new AgentLoopError(
        `agentLoop: turn ${turn} API call failed`,
        { turns: turn, inputTokens, outputTokens },
        err,
      );
    }

    inputTokens += response.usage.input_tokens;
    outputTokens += response.usage.output_tokens;

    if (response.stop_reason !== 'tool_use') {
      const text = response.content.filter(isTextBlock).map((b) => b.text).join('\n');
      return { text, turns: turn, inputTokens, outputTokens };
    }

    const toolUseBlocks = response.content.filter(isToolUseBlock);
    logger.info(
      `[agentLoop] turn ${turn}:`,
      toolUseBlocks.map((b) => `${b.name}(${JSON.stringify(b.input)})`).join(', '),
    );

    const toolResults: Anthropic.ToolResultBlockParam[] = await Promise.all(
      toolUseBlocks.map(async (block): Promise<Anthropic.ToolResultBlockParam> => {
        const tool = toolByName.get(block.name);
        try {
          if (!tool) throw new Error(`Unknown tool: ${block.name}`);
          const content = await tool.run(block.input);
          return { type: 'tool_result', tool_use_id: block.id, content };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return {
            type: 'tool_result',
            tool_use_id: block.id,
            content: `Error: ${message}`,
            is_error: true,
          };
        }
      }),
    );

    messages.push({ role: 'assistant', content: response.content });
    messages.push({ role: 'user', content: toolResults });
  }

  throw new AgentLoopError(`agentLoop: exceeded MAX_TURNS (${MAX_TURNS})`, {
    turns: turn,
    inputTokens,
    outputTokens,
  });
}
