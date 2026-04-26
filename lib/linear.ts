// Stub. Real implementation lands with the ops-digest agent ticket.

export type LinearIssue = {
  id: string;
  identifier: string;
  title: string;
  state: string;
  url: string;
};

export async function getOpenIssues(): Promise<LinearIssue[]> {
  return [];
}

export async function getRecentlyShipped(_sinceISO: string): Promise<LinearIssue[]> {
  return [];
}
