import type { ToolCategory } from '../events/tool';

const FILE_READ_TOOLS = new Set(['Read', 'Glob', 'Grep']);
const FILE_WRITE_TOOLS = new Set(['Write', 'NotebookEdit']);
const FILE_EDIT_TOOLS = new Set(['Edit']);
const TERMINAL_TOOLS = new Set(['Bash']);
const SEARCH_TOOLS = new Set(['WebSearch']);
const WEB_TOOLS = new Set(['WebFetch']);
const AGENT_TOOLS = new Set(['Task']);

export function categorizeTool(toolName: string): ToolCategory {
  if (FILE_READ_TOOLS.has(toolName)) return 'file_read';
  if (FILE_WRITE_TOOLS.has(toolName)) return 'file_write';
  if (FILE_EDIT_TOOLS.has(toolName)) return 'file_edit';
  if (TERMINAL_TOOLS.has(toolName)) return 'terminal';
  if (SEARCH_TOOLS.has(toolName)) return 'web';
  if (WEB_TOOLS.has(toolName)) return 'web';
  if (AGENT_TOOLS.has(toolName)) return 'agent';

  // Heuristic fallbacks
  if (toolName.toLowerCase().includes('git')) return 'git';
  if (toolName.toLowerCase().includes('mcp')) return 'mcp';
  if (toolName.toLowerCase().includes('search')) return 'search';

  return 'other';
}
