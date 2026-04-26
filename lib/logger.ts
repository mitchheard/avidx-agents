import { postToChannel } from './slack';

const SECRET_PATTERN = /([A-Z0-9_]*(?:KEY|TOKEN|WEBHOOK|PASSWORD)[A-Z0-9_]*)\s*[=:]\s*\S+/gi;
const STACK_TRUNCATE = 2000;

function redact(s: string): string {
  return s.replace(SECRET_PATTERN, '$1=[REDACTED]');
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…[truncated]` : s;
}

export const logger = {
  info(...args: unknown[]): void {
    console.log('[info]', ...args);
  },
  warn(...args: unknown[]): void {
    console.warn('[warn]', ...args);
  },
  async error(agentName: string, err: unknown): Promise<void> {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error && err.stack ? err.stack : '';
    console.error(`[error] ${agentName}:`, message);
    if (stack) console.error(stack);

    const safeMessage = redact(message);
    const safeStack = redact(truncate(stack, STACK_TRUNCATE));
    const text = [
      `:rotating_light: *${agentName}* failed at ${new Date().toISOString()}`,
      '```',
      safeMessage,
      safeStack ? `\n${safeStack}` : '',
      '```',
    ].join('\n');

    try {
      await postToChannel('errors', text);
    } catch (postErr) {
      console.error('[error] failed to post to #agent-errors:', postErr);
    }
  },
};
