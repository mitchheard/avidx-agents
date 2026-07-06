import { getOpenIssues } from '../lib/linear';
import type { Tool } from './types';

const MAX_ISSUES = 20;

export const linearTool: Tool = {
  def: {
    name: 'get_linear_issues',
    description:
      "Get Mitch's currently open Linear issues for the AvidX team: everything In Progress, " +
      'plus high/urgent-priority items still in Backlog. Use this to reference what he is ' +
      'actively working on or should prioritize next — NOT for historical or completed work. ' +
      'Call it once per brief; there are no parameters to vary.',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
  async run(): Promise<string> {
    const issues = await getOpenIssues();
    if (issues.length === 0) return '(no open issues)';

    const shown = issues.slice(0, MAX_ISSUES);
    const lines = shown.map(
      (i) => `- ${i.identifier} [${i.state}, ${i.priorityLabel}]: ${i.title} — ${i.url}`,
    );
    if (issues.length > MAX_ISSUES) {
      lines.push(`… and ${issues.length - MAX_ISSUES} more issues (truncated)`);
    }
    return lines.join('\n');
  },
};
