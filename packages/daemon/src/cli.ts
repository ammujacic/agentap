#!/usr/bin/env node

/**
 * Agentap CLI
 */

import { Command } from 'commander';
import chalk from 'chalk';
import qrcode from 'qrcode-terminal';
import { Daemon } from './daemon';
import { loadConfig, setConfigValue, getConfigValue } from './config';

const program = new Command();

// ASCII art banner
const banner = `
  █████╗  ██████╗ ███████╗███╗   ██╗████████╗ █████╗ ██████╗
 ██╔══██╗██╔════╝ ██╔════╝████╗  ██║╚══██╔══╝██╔══██╗██╔══██╗
 ███████║██║  ███╗█████╗  ██╔██╗ ██║   ██║   ███████║██████╔╝
 ██╔══██║██║   ██║██╔══╝  ██║╚██╗██║   ██║   ██╔══██║██╔═══╝
 ██║  ██║╚██████╔╝███████╗██║ ╚████║   ██║   ██║  ██║██║
 ╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚═╝  ╚═══╝   ╚═╝   ╚═╝  ╚═╝╚═╝
`;

program.name('agentap').description('Mobile bridge for your local coding agents').version('0.1.0');

// ============================================================================
// start command
// ============================================================================

program
  .command('start')
  .description('Start the Agentap daemon')
  .option('-p, --port <port>', 'WebSocket server port', '9876')
  .option('--no-tunnel', 'Disable Cloudflare tunnel')
  .action(async (options) => {
    console.log(chalk.magenta(banner));
    console.log(chalk.gray('  Mobile Bridge for your local Coding Agents\n'));

    const daemon = new Daemon({
      port: parseInt(options.port),
      noTunnel: !options.tunnel,
    });

    try {
      const status = await daemon.start();

      console.log(
        chalk.green('✓') + ' WebSocket server running on ' + chalk.cyan(`localhost:${status.port}`)
      );

      if (status.tunnelUrl) {
        console.log(chalk.green('✓') + ' Tunnel connected: ' + chalk.cyan(status.tunnelUrl));
      }

      if (status.detectedAgents.length > 0) {
        console.log(
          chalk.green('✓') + ' Detected agents: ' + chalk.cyan(status.detectedAgents.join(', '))
        );
      } else {
        console.log(chalk.yellow('⚠') + ' No agents detected');
      }

      console.log();

      // If already linked, show connected status
      if (status.linked) {
        console.log(chalk.green('✓') + ' Machine linked: ' + chalk.cyan(status.machineId));
        if (status.tunnelUrl) {
          console.log(chalk.green('✓') + ' Tunnel: ' + chalk.cyan(status.tunnelUrl));
        }
        console.log(chalk.green('✓') + ' Heartbeat active');
        console.log();
      } else {
        // Not linked — show pairing info and poll for link
        try {
          const { code, qrData } = await daemon.createLinkRequest();
          const config = loadConfig();
          const linkUrl = `${config.portal.url}/link?code=${code}`;

          console.log(chalk.bold('📱 Scan to connect your phone:\n'));
          qrcode.generate(qrData, { small: true });
          console.log();
          console.log(chalk.gray(`  Link code: `) + chalk.cyan.bold(code));
          console.log(chalk.gray(`  Or open:   `) + chalk.cyan.underline(linkUrl));
          console.log();
          console.log(chalk.gray('  Waiting for link...'));

          // Poll for link completion in the background
          daemon
            .waitForLink(code)
            .then((result) => {
              console.log();
              console.log(chalk.green('✓') + ' Machine linked successfully!');
              console.log(chalk.gray(`  Machine ID: `) + chalk.cyan(result.machineId));
              if (result.tunnelUrl) {
                console.log(chalk.gray(`  Tunnel:     `) + chalk.cyan(result.tunnelUrl));
              }
              console.log(chalk.green('✓') + ' Heartbeat active');
              console.log();
            })
            .catch((error) => {
              if (error instanceof Error && error.message === 'Link code expired') {
                console.log(
                  chalk.yellow('\n⚠ Link code expired. Run ') +
                    chalk.cyan('agentap link') +
                    chalk.yellow(' to generate a new one.')
                );
              }
            });
        } catch (error) {
          console.log(chalk.yellow('⚠') + ' Could not generate pairing code');
          if (error instanceof Error) console.log(chalk.gray(`  ${error.message}`));
          console.log(chalk.gray(`  Run ${chalk.cyan('agentap link')} to pair manually`));
        }
      }

      console.log(chalk.gray('Press Ctrl+C to stop'));

      // Handle shutdown
      process.on('SIGINT', async () => {
        console.log('\n');
        await daemon.stop();
        process.exit(0);
      });

      process.on('SIGTERM', async () => {
        await daemon.stop();
        process.exit(0);
      });
    } catch (error) {
      console.error(chalk.red('Error starting daemon:'), error);
      process.exit(1);
    }
  });

// ============================================================================
// link command
// ============================================================================

program
  .command('link')
  .description('Generate a link code to connect this machine to your account')
  .option('--text', 'Show link code as text only (no QR)')
  .action(async (options) => {
    const daemon = new Daemon();

    // Check if already linked
    if (daemon.isLinked()) {
      console.log(chalk.green('✓') + ' This machine is already linked');
      console.log(chalk.gray(`  Machine ID: `) + chalk.cyan(daemon.getMachineId()));
      console.log(
        chalk.gray(`\nTo unlink, run: `) + chalk.cyan('agentap config set machine.id ""')
      );
      return;
    }

    console.log('Generating link code...\n');

    try {
      await daemon.start();
      const { code, qrData } = await daemon.createLinkRequest();

      const config = loadConfig();
      const linkUrl = `${config.portal.url}/link?code=${code}`;

      if (options.text) {
        console.log(chalk.bold('Link code: ') + chalk.cyan.bold(code));
        console.log(chalk.gray('\nEnter this code in the Agentap mobile app'));
        console.log(chalk.gray('Or open:   ') + chalk.cyan.underline(linkUrl));
      } else {
        console.log(chalk.bold('📱 Scan with Agentap mobile app:\n'));
        qrcode.generate(qrData, { small: true });
        console.log();
        console.log(chalk.gray(`Link code: `) + chalk.cyan.bold(code));
        console.log(chalk.gray(`Or open:   `) + chalk.cyan.underline(linkUrl));
      }

      console.log(chalk.gray('\nWaiting for link... (expires in 10 minutes)'));

      // Poll for link completion
      const result = await daemon.waitForLink(code);

      console.log();
      console.log(chalk.green('✓') + ' Machine linked successfully!');
      console.log(chalk.gray(`  Machine ID: `) + chalk.cyan(result.machineId));
      if (result.tunnelUrl) {
        console.log(chalk.gray(`  Tunnel:     `) + chalk.cyan(result.tunnelUrl));
      }
      console.log(chalk.gray('\nCredentials saved to ~/.agentap/config.toml'));
      console.log(chalk.gray('Run ') + chalk.cyan('agentap start') + chalk.gray(' to begin'));

      await daemon.stop();
      process.exit(0);
    } catch (error) {
      if (error instanceof Error && error.message === 'Link code expired') {
        console.log(
          chalk.yellow('\n⚠ Link code expired. Run ') +
            chalk.cyan('agentap link') +
            chalk.yellow(' to try again.')
        );
      } else {
        console.error(chalk.red('Error:'), error);
      }
      await daemon.stop();
      process.exit(1);
    }
  });

// ============================================================================
// status command
// ============================================================================

program
  .command('status')
  .description('Show daemon status')
  .action(async () => {
    const config = loadConfig();

    if (config.machine.id) {
      console.log(chalk.green('✓') + ' Machine is linked');
      console.log(chalk.gray(`  Machine ID: `) + chalk.cyan(config.machine.id));
      if (config.machine.tunnelUrl) {
        console.log(chalk.gray(`  Tunnel URL: `) + chalk.cyan(config.machine.tunnelUrl));
      }
    } else {
      console.log(chalk.yellow('⚠') + ' Machine is not linked');
      console.log(chalk.gray(`  Run ${chalk.cyan('agentap link')} to connect to your account`));
    }
  });

// ============================================================================
// config commands
// ============================================================================

const configCmd = program.command('config').description('Manage configuration');

configCmd
  .command('list')
  .description('List all configuration values')
  .action(() => {
    const config = loadConfig();
    console.log(chalk.bold('Current configuration:\n'));
    console.log(JSON.stringify(config, null, 2));
  });

configCmd
  .command('get <key>')
  .description('Get a configuration value')
  .action((key) => {
    const value = getConfigValue(key);
    if (value === undefined) {
      console.log(chalk.red(`Key not found: ${key}`));
      process.exit(1);
    }
    console.log(value);
  });

configCmd
  .command('set <key> <value>')
  .description('Set a configuration value')
  .action((key, value) => {
    let parsed: unknown = value;
    try {
      parsed = JSON.parse(value);
    } catch {
      if (value === 'true') parsed = true;
      else if (value === 'false') parsed = false;
      else if (!isNaN(Number(value))) parsed = Number(value);
    }

    if (value === '' || value === 'null') parsed = null;

    setConfigValue(key, parsed);
    console.log(chalk.green('✓') + ` Set ${key} = ${JSON.stringify(parsed)}`);
  });

// ============================================================================
// agents command
// ============================================================================

program
  .command('agents')
  .description('List detected agents')
  .action(async () => {
    console.log(chalk.bold('Checking for installed agents...\n'));

    const config = loadConfig();
    const { discoverAndLoadAdapters } = await import('./adapter-loader');
    const loaded = await discoverAndLoadAdapters(config);

    if (loaded.length === 0) {
      console.log(chalk.gray('  No adapters found.'));
      console.log(
        chalk.gray('  Install an adapter package (e.g., @agentap-dev/adapter-claude-code)')
      );
      console.log();
      return;
    }

    for (const { adapter, meta } of loaded) {
      const caps = adapter.getCapabilities();
      const installed = await adapter.isInstalled();
      const version = await adapter.getVersion();

      const displayName = caps.agent.displayName || caps.agent.name;
      const status = installed ? chalk.green('✓ Installed') : chalk.yellow('○ Loaded');

      console.log(
        `  ${displayName.padEnd(15)} ${status}${version ? chalk.gray(` (${version})`) : ''}`
      );
      console.log(chalk.gray(`    Package: ${meta.packageName} [${meta.source}]`));
    }

    console.log();
  });

// ============================================================================
// hooks commands
// ============================================================================

const hooksCmd = program.command('hooks').description('Manage Claude Code approval hooks');

hooksCmd
  .command('install')
  .description('Install Agentap approval hooks into Claude Code')
  .action(async () => {
    const { existsSync, mkdirSync, cpSync, chmodSync, readFileSync, writeFileSync } =
      await import('fs');
    const { join, dirname } = await import('path');
    const { fileURLToPath } = await import('url');
    const { homedir } = await import('os');

    const __cli_dirname = dirname(fileURLToPath(import.meta.url));
    const hookScriptDir = join(homedir(), '.agentap', 'hooks');
    const hookScriptDest = join(hookScriptDir, 'pre-tool-use.sh');
    const hookScriptSrc = join(
      __cli_dirname,
      '..',
      '..',
      'adapter-claude-code',
      'plugin',
      'scripts',
      'pre-tool-use.sh'
    );

    console.log('Installing Agentap hooks for Claude Code...\n');

    // 1. Copy hook script
    try {
      mkdirSync(hookScriptDir, { recursive: true });
      cpSync(hookScriptSrc, hookScriptDest);
      chmodSync(hookScriptDest, 0o755);
      console.log(chalk.green('  Hook script installed to ') + chalk.cyan(hookScriptDest));
    } catch (error) {
      console.error(chalk.red('  Failed to copy hook script:'), error);
      process.exit(1);
    }

    // 2. Register in ~/.claude/settings.json
    const claudeDir = join(homedir(), '.claude');
    const settingsPath = join(claudeDir, 'settings.json');

    try {
      let settings: Record<string, unknown> = {};
      if (existsSync(settingsPath)) {
        settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
      } else {
        mkdirSync(claudeDir, { recursive: true });
      }

      const hooks = (settings.hooks ?? {}) as Record<string, unknown[]>;
      const preToolUse = (hooks.PreToolUse ?? []) as Array<{
        hooks?: Array<{ command?: string }>;
      }>;

      const alreadyInstalled = preToolUse.some((entry) =>
        entry.hooks?.some((h) => h.command === hookScriptDest)
      );

      if (alreadyInstalled) {
        console.log(chalk.green('  Hooks already registered in ') + chalk.cyan(settingsPath));
      } else {
        preToolUse.push({
          matcher: 'Bash|Write|Edit|NotebookEdit',
          hooks: [{ type: 'command', command: hookScriptDest, timeout: 300 }],
        } as unknown as { hooks?: Array<{ command?: string }> });

        hooks.PreToolUse = preToolUse;
        settings.hooks = hooks;
        writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
        console.log(chalk.green('  Hooks registered in ') + chalk.cyan(settingsPath));
      }
    } catch (error) {
      console.error(chalk.red('  Failed to update Claude settings:'), error);
      process.exit(1);
    }

    console.log();
    console.log(
      chalk.green('Done!') +
        ' Approval requests will be routed to Agentap when the daemon is running.'
    );
    console.log(
      chalk.gray('  When the daemon is stopped, Claude falls back to normal terminal prompts.')
    );
    console.log();
  });

hooksCmd
  .command('uninstall')
  .description('Remove Agentap hooks from Claude Code')
  .action(async () => {
    const { existsSync, rmSync, readFileSync, writeFileSync } = await import('fs');
    const { join } = await import('path');
    const { homedir } = await import('os');

    const hookScriptDest = join(homedir(), '.agentap', 'hooks', 'pre-tool-use.sh');
    const settingsPath = join(homedir(), '.claude', 'settings.json');

    // 1. Remove hook entry from settings.json
    if (existsSync(settingsPath)) {
      try {
        const settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
        const hooks = settings.hooks as Record<string, unknown[]> | undefined;
        if (hooks?.PreToolUse) {
          const preToolUse = hooks.PreToolUse as Array<{
            hooks?: Array<{ command?: string }>;
          }>;
          hooks.PreToolUse = preToolUse.filter(
            (entry) => !entry.hooks?.some((h) => h.command === hookScriptDest)
          );
          if (hooks.PreToolUse.length === 0) delete hooks.PreToolUse;
          if (Object.keys(hooks).length === 0) delete settings.hooks;
          writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
          console.log(chalk.green('  Removed hooks from ') + chalk.cyan(settingsPath));
        }
      } catch (error) {
        console.error(chalk.red('  Failed to update Claude settings:'), error);
      }
    }

    // 2. Remove hook script
    if (existsSync(hookScriptDest)) {
      rmSync(hookScriptDest);
      console.log(chalk.green('  Removed hook script from ') + chalk.cyan(hookScriptDest));
    }

    console.log();
  });

hooksCmd
  .command('status')
  .description('Check if Agentap hooks are installed')
  .action(async () => {
    const { existsSync, readFileSync } = await import('fs');
    const { join } = await import('path');
    const { homedir } = await import('os');

    const hookScriptDest = join(homedir(), '.agentap', 'hooks', 'pre-tool-use.sh');
    const settingsPath = join(homedir(), '.claude', 'settings.json');

    const scriptExists = existsSync(hookScriptDest);
    let settingsRegistered = false;

    if (existsSync(settingsPath)) {
      try {
        const settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
        const preToolUse = settings.hooks?.PreToolUse as
          | Array<{
              hooks?: Array<{ command?: string }>;
            }>
          | undefined;
        settingsRegistered =
          preToolUse?.some((entry) => entry.hooks?.some((h) => h.command === hookScriptDest)) ??
          false;
      } catch {
        /* ignore parse errors */
      }
    }

    if (scriptExists && settingsRegistered) {
      console.log(chalk.green('  Agentap hooks are installed and registered.'));
      console.log(chalk.gray('  Script: ') + chalk.cyan(hookScriptDest));
      console.log(chalk.gray('  Config: ') + chalk.cyan(settingsPath));
    } else if (scriptExists) {
      console.log(chalk.yellow('  Hook script exists but is not registered in Claude settings.'));
      console.log(
        chalk.gray('  Run ') + chalk.cyan('agentap hooks install') + chalk.gray(' to fix.')
      );
    } else {
      console.log(chalk.yellow('  Agentap hooks are not installed.'));
      console.log(
        chalk.gray('  Run ') + chalk.cyan('agentap hooks install') + chalk.gray(' to install.')
      );
    }

    console.log();
  });

// ============================================================================
// version command
// ============================================================================

program
  .command('version')
  .description('Show version information')
  .action(() => {
    console.log('agentap version 0.1.0');
  });

// Parse arguments
program.parse();
