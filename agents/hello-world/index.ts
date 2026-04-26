import { loadEnv } from '../../lib/env';
import { callClaude } from '../../lib/claude';
import { postToChannel } from '../../lib/slack';
import { logger } from '../../lib/logger';

const AGENT_NAME = 'hello-world';

async function main(): Promise<void> {
  loadEnv();

  const today = new Date().toISOString().slice(0, 10);
  const greeting = await callClaude(
    [
      {
        role: 'user',
        content: `Write a single-sentence greeting for Mitch confirming the avidx-agents infra is working. Today is ${today}. Keep it under 25 words.`,
      },
    ],
    { maxTokens: 200 },
  );

  await postToChannel('digest', greeting);
  logger.info(`${AGENT_NAME}: posted greeting to #digest`);
}

main().catch(async (err: unknown) => {
  await logger.error(AGENT_NAME, err);
  process.exit(1);
});
