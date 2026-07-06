import { IncomingWebhook, type IncomingWebhookSendArguments } from '@slack/webhook';
import { loadEnv } from './env';

export type Channel = 'digest' | 'alerts' | 'errors' | 'mail-zero' | 'inbox' | 'inbox-agentic';

function webhookFor(channel: Channel): string {
  const env = loadEnv();
  switch (channel) {
    case 'digest':
      return env.SLACK_WEBHOOK_DIGEST;
    case 'alerts':
      return env.SLACK_WEBHOOK_ALERTS;
    case 'errors':
      return env.SLACK_WEBHOOK_ERRORS;
    case 'mail-zero':
      return env.SLACK_WEBHOOK_MAIL_ZERO;
    case 'inbox':
      return env.SLACK_WEBHOOK_INBOX;
    case 'inbox-agentic':
      return env.SLACK_WEBHOOK_INBOX_AGENTIC;
  }
}

export async function postToChannel(
  channel: Channel,
  text: string,
  blocks?: IncomingWebhookSendArguments['blocks'],
): Promise<void> {
  const webhook = new IncomingWebhook(webhookFor(channel));
  await webhook.send({ text, ...(blocks ? { blocks } : {}) });
}

export async function postMessage(
  webhookUrl: string,
  payload: IncomingWebhookSendArguments,
): Promise<void> {
  const webhook = new IncomingWebhook(webhookUrl);
  await webhook.send(payload);
}
