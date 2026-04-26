// Stub. Real implementation lands with the archive agent ticket.

export type NotionPageId = string;

export async function appendToDatabase(
  _databaseId: string,
  _properties: Record<string, unknown>,
): Promise<NotionPageId> {
  throw new Error('lib/notion.appendToDatabase: not implemented yet');
}

export async function createPage(
  _parentId: string,
  _title: string,
  _content: string,
): Promise<NotionPageId> {
  throw new Error('lib/notion.createPage: not implemented yet');
}
