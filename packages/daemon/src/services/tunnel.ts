/**
 * Cloudflare Tunnel manager
 *
 * Supports two modes:
 * 1. Named tunnels (production) — uses a tunnel token from the API
 * 2. Anonymous quick tunnels (local dev) — uses trycloudflare.com
 */

import { spawn, execSync, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { randomBytes } from 'crypto';
import { createWriteStream, chmodSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir, platform, arch } from 'os';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';

export interface TunnelOptions {
  localPort: number;
}

export class TunnelManager extends EventEmitter {
  private process: ChildProcess | null = null;
  private tunnelUrl: string | null = null;
  private tunnelId: string | null = null;
  private options: TunnelOptions;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private namedTunnel = false;
  private starting = false;

  constructor(options: TunnelOptions) {
    super();
    this.options = options;
  }

  private generateTunnelId(): string {
    return randomBytes(4).toString('hex');
  }

  /**
   * Check if cloudflared is installed
   */
  async isCloudflaredInstalled(): Promise<boolean> {
    return new Promise((resolve) => {
      const proc = spawn('cloudflared', ['--version']);

      proc.on('close', (code) => {
        resolve(code === 0);
      });

      proc.on('error', () => {
        resolve(false);
      });
    });
  }

  /**
   * Install cloudflared automatically
   */
  async installCloudflared(): Promise<void> {
    const os = platform();
    const cpuArch = arch();

    console.log('Installing cloudflared...');

    if (os === 'darwin') {
      // macOS — try brew first, fall back to direct download
      try {
        execSync('which brew', { stdio: 'ignore' });
        console.log('Installing via Homebrew...');
        execSync('brew install cloudflared', { stdio: 'inherit' });
        return;
      } catch {
        // No brew, fall back to direct download
      }
    }

    // Direct download for Linux / macOS without brew
    const binaryName = this.getCloudflaredBinaryName(os, cpuArch);
    if (!binaryName) {
      throw new Error(
        `Unsupported platform: ${os}/${cpuArch}. Please install cloudflared manually from https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/`
      );
    }

    const url = `https://github.com/cloudflare/cloudflared/releases/latest/download/${binaryName}`;
    const installDir = join(homedir(), '.agentap', 'bin');
    const installPath = join(installDir, 'cloudflared');

    if (!existsSync(installDir)) {
      mkdirSync(installDir, { recursive: true });
    }

    console.log(`Downloading cloudflared from ${url}...`);

    const response = await fetch(url);
    if (!response.ok || !response.body) {
      throw new Error(`Failed to download cloudflared: ${response.statusText}`);
    }

    const fileStream = createWriteStream(installPath);
    await pipeline(
      Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]),
      fileStream
    );

    chmodSync(installPath, 0o755);

    // Add to PATH for this process
    process.env.PATH = `${installDir}:${process.env.PATH}`;

    console.log(`cloudflared installed to ${installPath}`);
  }

  private getCloudflaredBinaryName(os: string, cpuArch: string): string | null {
    if (os === 'darwin') {
      return cpuArch === 'arm64' ? 'cloudflared-darwin-arm64.tgz' : 'cloudflared-darwin-amd64.tgz';
    }
    if (os === 'linux') {
      if (cpuArch === 'x64' || cpuArch === 'amd64') return 'cloudflared-linux-amd64';
      if (cpuArch === 'arm64' || cpuArch === 'aarch64') return 'cloudflared-linux-arm64';
      if (cpuArch === 'arm') return 'cloudflared-linux-arm';
    }
    return null;
  }

  /**
   * Ensure cloudflared is installed, auto-installing if needed
   */
  private async ensureCloudflared(): Promise<void> {
    if (await this.isCloudflaredInstalled()) return;

    console.log('cloudflared not found. Attempting auto-install...');
    await this.installCloudflared();

    if (!(await this.isCloudflaredInstalled())) {
      throw new Error(
        'cloudflared installation failed. Please install manually from https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/'
      );
    }
  }

  /**
   * Start an anonymous quick tunnel (local dev)
   */
  async start(): Promise<{ tunnelUrl: string; tunnelId: string }> {
    if (this.starting) return new Promise(() => {}); // Another start is in progress
    if (this.process) {
      throw new Error('Tunnel already running');
    }

    this.starting = true;
    await this.ensureCloudflared();

    this.tunnelId = this.generateTunnelId();
    this.namedTunnel = false;

    return new Promise((resolve, reject) => {
      this.process = spawn('cloudflared', [
        'tunnel',
        '--url',
        `http://localhost:${this.options.localPort}`,
        '--no-autoupdate',
      ]);

      let output = '';

      this.process.stdout?.on('data', (data) => {
        output += data.toString();
        this.parseQuickTunnelOutput(output, resolve);
      });

      this.process.stderr?.on('data', (data) => {
        output += data.toString();
        this.parseQuickTunnelOutput(output, resolve);
      });

      this.process.on('close', (code) => {
        if (this.process) {
          this.process.removeAllListeners();
          this.process.stdout?.removeAllListeners();
          this.process.stderr?.removeAllListeners();
        }
        this.process = null;
        this.tunnelUrl = null;
        this.starting = false;

        if (code !== 0 && this.reconnectAttempts < this.maxReconnectAttempts) {
          this.reconnectAttempts++;
          console.log(`Tunnel disconnected, reconnecting (attempt ${this.reconnectAttempts})...`);
          setTimeout(() => this.start().catch(console.error), 2000);
        } else {
          this.emit('disconnected');
        }
      });

      this.process.on('error', (error) => {
        this.starting = false;
        this.emit('error', error);
        reject(error);
      });

      setTimeout(() => {
        if (!this.tunnelUrl) {
          this.starting = false;
          if (this.process) {
            this.process.removeAllListeners();
            this.process.stdout?.removeAllListeners();
            this.process.stderr?.removeAllListeners();
            this.process.kill('SIGTERM');
            this.process = null;
          }
          reject(new Error('Tunnel startup timeout'));
        }
      }, 30000);
    });
  }

  /**
   * Start a named tunnel using a tunnel token (production)
   */
  async startWithToken(token: string): Promise<void> {
    if (this.starting) return; // Another start is in progress
    if (this.process) {
      throw new Error('Tunnel already running');
    }

    this.starting = true;
    await this.ensureCloudflared();

    this.namedTunnel = true;

    return new Promise((resolve, reject) => {
      this.process = spawn('cloudflared', ['tunnel', '--no-autoupdate', 'run', '--token', token]);

      let output = '';
      let resolved = false;

      const handleOutput = (data: Buffer) => {
        output += data.toString();

        // Named tunnels log "Registered tunnel connection" when connected
        if (!resolved && output.includes('Registered tunnel connection')) {
          resolved = true;
          this.starting = false;
          this.reconnectAttempts = 0;
          // For named tunnels, the URL is known ahead of time (from API)
          // so we don't need to parse it from output
          this.tunnelUrl = 'named-tunnel'; // Sentinel — actual URL is in config
          this.emit('connected', 'named-tunnel', 'named');
          resolve();
        }
      };

      this.process.stdout?.on('data', handleOutput);
      this.process.stderr?.on('data', handleOutput);

      this.process.on('close', (code) => {
        if (this.process) {
          this.process.removeAllListeners();
          this.process.stdout?.removeAllListeners();
          this.process.stderr?.removeAllListeners();
        }
        this.process = null;
        this.tunnelUrl = null;
        this.starting = false;

        if (code !== 0 && this.reconnectAttempts < this.maxReconnectAttempts) {
          this.reconnectAttempts++;
          console.log(
            `Named tunnel disconnected, reconnecting (attempt ${this.reconnectAttempts})...`
          );
          setTimeout(() => this.startWithToken(token).catch(console.error), 2000);
        } else {
          this.emit('disconnected');
        }
      });

      this.process.on('error', (error) => {
        this.starting = false;
        this.emit('error', error);
        reject(error);
      });

      setTimeout(() => {
        if (!resolved) {
          this.starting = false;
          if (this.process) {
            this.process.removeAllListeners();
            this.process.stdout?.removeAllListeners();
            this.process.stderr?.removeAllListeners();
            this.process.kill('SIGTERM');
            this.process = null;
          }
          reject(new Error('Named tunnel startup timeout'));
        }
      }, 30000);
    });
  }

  private parseQuickTunnelOutput(
    output: string,
    resolve: (value: { tunnelUrl: string; tunnelId: string }) => void
  ): void {
    const urlMatch = output.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);

    if (urlMatch && !this.tunnelUrl) {
      this.tunnelUrl = urlMatch[0];
      this.starting = false;
      this.reconnectAttempts = 0;

      this.emit('connected', this.tunnelUrl, this.tunnelId!);
      resolve({ tunnelUrl: this.tunnelUrl, tunnelId: this.tunnelId! });
    }
  }

  /**
   * Stop the tunnel
   */
  stop(): void {
    if (this.process) {
      this.process.kill('SIGTERM');
      this.process = null;
    }
    this.tunnelUrl = null;
  }

  getTunnelUrl(): string | null {
    return this.tunnelUrl;
  }

  getTunnelId(): string | null {
    return this.tunnelId;
  }

  isRunning(): boolean {
    return this.process !== null;
  }

  isNamedTunnel(): boolean {
    return this.namedTunnel;
  }
}
