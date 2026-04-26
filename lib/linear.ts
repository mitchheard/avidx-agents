import { LinearClient } from '@linear/sdk';
import { loadEnv } from './env';

const TEAM_KEY = 'AVIDX';
const LINEAR_WORKSPACE = 'avidx';

// Linear priority values: 0=none, 1=urgent, 2=high, 3=medium, 4=low
export const Priority = { URGENT: 1, HIGH: 2, MEDIUM: 3, LOW: 4, NONE: 0 } as const;

export type LinearIssue = {
  id: string;
  identifier: string;
  title: string;
  state: string;
  stateType: string;
  priority: number;
  priorityLabel: string;
  url: string;
  completedAt?: string;
};

export type LinearIssueFilter = {
  stateTypes?: string[];
  priority?: { in?: number[]; lte?: number };
  labelName?: string;
};

let _client: LinearClient | undefined;

function getClient(): LinearClient {
  if (_client) return _client;
  _client = new LinearClient({ apiKey: loadEnv().LINEAR_API_KEY });
  return _client;
}

type RawIssue = Awaited<ReturnType<LinearClient['issues']>>['nodes'][number];

async function toLinearIssue(issue: RawIssue): Promise<LinearIssue> {
  const state = await issue.state;
  return {
    id: issue.id,
    identifier: issue.identifier,
    title: issue.title,
    state: state?.name ?? 'Unknown',
    stateType: state?.type ?? 'unknown',
    priority: issue.priority,
    priorityLabel: issue.priorityLabel,
    url: `https://linear.app/${LINEAR_WORKSPACE}/issue/${issue.identifier}`,
    completedAt: issue.completedAt instanceof Date ? issue.completedAt.toISOString() : undefined,
  };
}

// Returns In Progress issues + High priority Backlog by default.
// Pass filter to override with custom criteria.
export async function getOpenIssues(filter?: LinearIssueFilter): Promise<LinearIssue[]> {
  const issueFilter = filter
    ? {
        team: { key: { eq: TEAM_KEY } },
        ...(filter.stateTypes ? { state: { type: { in: filter.stateTypes } } } : {}),
        ...(filter.priority ? { priority: filter.priority } : {}),
        ...(filter.labelName ? { labels: { name: { eq: filter.labelName } } } : {}),
      }
    : {
        team: { key: { eq: TEAM_KEY } },
        or: [
          { state: { type: { eq: 'started' } } },
          { state: { type: { eq: 'backlog' } }, priority: { in: [1, 2] } },
        ],
      };

  const result = await getClient().issues({ filter: issueFilter, first: 50 });
  return Promise.all(result.nodes.map(toLinearIssue));
}

export async function getInProgress(): Promise<LinearIssue[]> {
  return getOpenIssues({ stateTypes: ['started'] });
}

export async function getRecentlyCompleted(sinceISO: string): Promise<LinearIssue[]> {
  const result = await getClient().issues({
    filter: {
      team: { key: { eq: TEAM_KEY } },
      state: { type: { eq: 'completed' } },
      completedAt: { gte: new Date(sinceISO) },
    },
    first: 50,
  });
  return Promise.all(result.nodes.map(toLinearIssue));
}
