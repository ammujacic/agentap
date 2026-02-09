import type { RiskLevel } from '../events/tool';

const DANGEROUS_COMMANDS = ['rm', 'sudo', 'chmod', 'chown', 'kill', 'mkfs', 'dd'];
const INSTALL_COMMANDS = ['npm', 'pip', 'brew', 'apt', 'yarn', 'pnpm', 'cargo'];

export function assessRisk(toolName: string, input: unknown): RiskLevel {
  if (toolName === 'Bash') {
    const cmd = String((input as Record<string, unknown>)?.command || '');

    if (DANGEROUS_COMMANDS.some((c) => cmd.includes(c))) return 'high';
    if (INSTALL_COMMANDS.some((c) => cmd.includes(c))) return 'medium';
  }

  if (toolName === 'Write' || toolName === 'Edit') return 'medium';

  return 'low';
}
