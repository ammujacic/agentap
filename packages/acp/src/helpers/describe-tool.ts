export function describeToolCall(toolName: string, input: unknown): string {
  const i = input as Record<string, unknown>;

  switch (toolName) {
    case 'Bash':
      return `Run: ${String(i.command).slice(0, 100)}`;
    case 'Read':
      return `Read: ${i.file_path}`;
    case 'Write':
      return `Write: ${i.file_path}`;
    case 'Edit':
      return `Edit: ${i.file_path}`;
    case 'Glob':
      return `Search: ${i.pattern}`;
    case 'Grep':
      return `Grep: ${i.pattern}`;
    case 'Task':
      return `Task: ${String(i.description).slice(0, 50)}`;
    case 'WebSearch':
      return `Search: ${i.query}`;
    case 'WebFetch':
      return `Fetch: ${i.url}`;
    default:
      return `${toolName}`;
  }
}
