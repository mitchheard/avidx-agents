import { loadEnv } from '../../lib/env';
import { DEFAULT_MODEL } from '../../lib/claude';
import { runAgent, AgentLoopError } from '../../lib/agentLoop';
import { postToChannel } from '../../lib/slack';
import { logger } from '../../lib/logger';
import { calendarTool } from '../../tools/calendar';
import { emailTool } from '../../tools/email';
import { linearTool } from '../../tools/linear';
import { MORNING_BRIEF_AGENTIC_SYSTEM_PROMPT } from './prompts';

const AGENT_NAME = 'morning-brief-agentic';

// Standard API rates for DEFAULT_MODEL (Sonnet 4.6). Update alongside DEFAULT_MODEL
// in lib/claude.ts — verify current numbers at
// https://platform.claude.com/docs/en/about-claude/pricing before trusting stale ones.
const INPUT_USD_PER_MTOK = 3;
const OUTPUT_USD_PER_MTOK = 15;

function estimateCostUSD(inputTokens: number, outputTokens: number): number {
  return (
    (inputTokens / 1_000_000) * INPUT_USD_PER_MTOK +
    (outputTokens / 1_000_000) * OUTPUT_USD_PER_MTOK
  );
}

function buildFooter(turns: number, inputTokens: number, outputTokens: number): string {
  const totalTokens = inputTokens + outputTokens;
  const cost = estimateCostUSD(inputTokens, outputTokens);
  return `---\n🧪 ${turns} turns · ~${totalTokens.toLocaleString('en-US')} tokens · $${cost.toFixed(2)}`;
}

async function main(): Promise<void> {
  loadEnv();

  logger.info(`${AGENT_NAME}: starting agent loop`);

  const result = await runAgent({
    system: MORNING_BRIEF_AGENTIC_SYSTEM_PROMPT,
    goal: "Build today's morning brief.",
    tools: [calendarTool, emailTool, linearTool],
    model: DEFAULT_MODEL,
  });

  logger.info(
    `${AGENT_NAME}: done — ${result.turns} turns, ${result.inputTokens} in / ${result.outputTokens} out tokens`,
  );

  const footer = buildFooter(result.turns, result.inputTokens, result.outputTokens);
  await postToChannel('inbox-agentic', `${result.text}\n\n${footer}`);
  logger.info(`${AGENT_NAME}: posted to #inbox-agentic`);
}

main().catch(async (err: unknown) => {
  if (err instanceof AgentLoopError) {
    logger.warn(
      `${AGENT_NAME}: agent loop failed after ${err.turns} turns (${err.inputTokens} in / ${err.outputTokens} out tokens)`,
    );
  }
  await logger.error(AGENT_NAME, err);
  process.exit(1);
});
