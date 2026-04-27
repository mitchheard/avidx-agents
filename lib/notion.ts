import { Client, isFullBlock } from '@notionhq/client';
import { loadEnv } from './env';

const HUB_PAGE_ID = '33567fabf8ff818787eaeaf6f7476ced';

export type HubContent = {
  currentFocusMarkdown: string;
  referencedPageIds: string[];
};

// Minimal block shape — avoids depending on @notionhq/client internal type paths
// which shift between SDK versions.
type NotionBlock = {
  id: string;
  type: string;
  has_children?: boolean;
  [key: string]: unknown;
};

// Minimal rich text item shape
type RichTextItem = {
  type: string;
  plain_text: string;
  mention?: { type: string; page?: { id: string } };
};

let _client: Client | undefined;

function getNotionClient(): Client {
  if (_client) return _client;
  _client = new Client({ auth: loadEnv().NOTION_TOKEN });
  return _client;
}

async function getAllBlocks(blockId: string): Promise<NotionBlock[]> {
  const blocks: NotionBlock[] = [];
  let cursor: string | undefined;

  do {
    const response = await getNotionClient().blocks.children.list({
      block_id: blockId,
      ...(cursor ? { start_cursor: cursor } : {}),
    });
    for (const block of response.results) {
      if (isFullBlock(block)) blocks.push(block as unknown as NotionBlock);
    }
    cursor = response.has_more && response.next_cursor ? response.next_cursor : undefined;
  } while (cursor);

  return blocks;
}

function isHeading(block: NotionBlock): boolean {
  return block.type === 'heading_1' || block.type === 'heading_2' || block.type === 'heading_3';
}

function extractText(block: NotionBlock): string {
  const data = (block as Record<string, unknown>)[block.type] as
    | { rich_text?: RichTextItem[] }
    | undefined;
  return data?.rich_text?.map((rt) => rt.plain_text).join('') ?? '';
}

// Minimal markdown → Notion block converter. Handles ##/###, - bullets, **bold**, paragraphs.
type NotionRichText = {
  type: 'text';
  text: { content: string };
  annotations?: { bold: true };
};

type NotionBlockRequest = {
  object: 'block';
  type: string;
  [key: string]: unknown;
};

function parseRichText(text: string): NotionRichText[] {
  const parts = text.split(/(\*\*[^*]+\*\*)/);
  return parts.filter(Boolean).map((part): NotionRichText => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return { type: 'text', text: { content: part.slice(2, -2) }, annotations: { bold: true } };
    }
    return { type: 'text', text: { content: part } };
  });
}

function markdownToNotionBlocks(md: string): NotionBlockRequest[] {
  const blocks: NotionBlockRequest[] = [];
  for (const line of md.split('\n')) {
    if (!line.trim()) continue;
    if (line.startsWith('### ')) {
      blocks.push({ object: 'block', type: 'heading_3', heading_3: { rich_text: parseRichText(line.slice(4)) } });
    } else if (line.startsWith('## ')) {
      blocks.push({ object: 'block', type: 'heading_2', heading_2: { rich_text: parseRichText(line.slice(3)) } });
    } else if (line.startsWith('# ')) {
      blocks.push({ object: 'block', type: 'heading_1', heading_1: { rich_text: parseRichText(line.slice(2)) } });
    } else if (/^[-*]\s/.test(line)) {
      blocks.push({ object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: parseRichText(line.slice(2)) } });
    } else {
      blocks.push({ object: 'block', type: 'paragraph', paragraph: { rich_text: parseRichText(line) } });
    }
  }
  return blocks;
}

export async function getAvidXHub(): Promise<HubContent> {
  const blocks = await getAllBlocks(HUB_PAGE_ID);

  const headingIdx = blocks.findIndex(
    (b) => isHeading(b) && extractText(b).toLowerCase().includes('current focus'),
  );

  if (headingIdx === -1) {
    return { currentFocusMarkdown: '', referencedPageIds: [] };
  }

  const contentLines: string[] = [];
  const referencedPageIds: string[] = [];

  for (let i = headingIdx + 1; i < blocks.length; i++) {
    const block = blocks[i];
    if (!block) continue;
    if (isHeading(block)) break;

    const text = extractText(block);
    if (text) contentLines.push(text);

    // Collect Notion page mentions for follow-up fetches
    const data = (block as Record<string, unknown>)[block.type] as
      | { rich_text?: RichTextItem[] }
      | undefined;
    for (const rt of data?.rich_text ?? []) {
      if (rt.type === 'mention' && rt.mention?.type === 'page' && rt.mention.page?.id) {
        referencedPageIds.push(rt.mention.page.id);
      }
    }
  }

  return { currentFocusMarkdown: contentLines.join('\n'), referencedPageIds };
}

export async function updateCurrentFocus(newMarkdown: string): Promise<void> {
  const blocks = await getAllBlocks(HUB_PAGE_ID);

  const headingIdx = blocks.findIndex(
    (b) => isHeading(b) && extractText(b).toLowerCase().includes('current focus'),
  );

  if (headingIdx === -1) {
    throw new Error(
      `"Current Focus" heading not found in Notion hub (${HUB_PAGE_ID}). ` +
        'Check that the heading text exactly contains "Current Focus".',
    );
  }

  const headingBlock = blocks[headingIdx];
  if (!headingBlock) return;

  // Collect content blocks between heading and next heading
  const contentBlocks: NotionBlock[] = [];
  for (let i = headingIdx + 1; i < blocks.length; i++) {
    const block = blocks[i];
    if (!block) continue;
    if (isHeading(block)) break;
    contentBlocks.push(block);
  }

  // Delete existing content (best-effort — ignore individual failures)
  await Promise.all(
    contentBlocks.map((b) =>
      getNotionClient()
        .blocks.delete({ block_id: b.id })
        .catch(() => undefined),
    ),
  );

  const newBlocks = markdownToNotionBlocks(newMarkdown);
  if (newBlocks.length === 0) return;

  try {
    // The `after` param inserts blocks immediately after the heading rather than at page end.
    // Cast as any: `after` is in the Notion REST API spec but may not be typed in all SDK versions.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (getNotionClient().blocks.children.append as (p: any) => Promise<unknown>)({
      block_id: HUB_PAGE_ID,
      children: newBlocks,
      after: headingBlock.id,
    });
  } catch {
    // Fallback: append to end of page. The Current Focus content will appear at the
    // bottom, which is non-ideal but keeps the update from failing entirely.
    // Fix: ensure @notionhq/client version exposes the `after` param.
    await (getNotionClient().blocks.children.append as (p: unknown) => Promise<unknown>)({
      block_id: HUB_PAGE_ID,
      children: newBlocks,
    });
  }
}

export async function getProductPage(pageId: string): Promise<string> {
  const blocks = await getAllBlocks(pageId);
  return blocks.map(extractText).filter(Boolean).join('\n');
}

// ── Agent state (last-run timestamps) ─────────────────────────────────────────
//
// Stored as paragraph blocks in the hub page with the format:
//   [agent-state:{key}] 2026-04-26T12:00:00.000Z
//
// These blocks are appended at the end of the hub page and are invisible in
// normal Notion editing unless you scroll to the bottom.

function agentStatePrefix(agentKey: string): string {
  return `[agent-state:${agentKey}]`;
}

export async function getAgentLastRun(agentKey: string): Promise<string | null> {
  const blocks = await getAllBlocks(HUB_PAGE_ID);
  const prefix = agentStatePrefix(agentKey);
  const block = blocks.find((b) => extractText(b).startsWith(prefix));
  if (!block) return null;
  const iso = extractText(block).slice(prefix.length).trim();
  return iso || null;
}

export async function setAgentLastRun(agentKey: string, iso: string): Promise<void> {
  const blocks = await getAllBlocks(HUB_PAGE_ID);
  const prefix = agentStatePrefix(agentKey);

  // Delete existing state block if present
  const existing = blocks.find((b) => extractText(b).startsWith(prefix));
  if (existing) {
    await getNotionClient()
      .blocks.delete({ block_id: existing.id })
      .catch(() => undefined);
  }

  await (getNotionClient().blocks.children.append as (p: unknown) => Promise<unknown>)({
    block_id: HUB_PAGE_ID,
    children: [
      {
        object: 'block',
        type: 'paragraph',
        paragraph: {
          rich_text: [{ type: 'text', text: { content: `${prefix} ${iso}` } }],
        },
      },
    ],
  });
}
