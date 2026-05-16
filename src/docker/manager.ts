import { getContainerName } from './index';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';

const home = homedir();
const PODMAN = process.env.DOCKER_BIN || 'podman';

function getOpenCodeBinds(): string[] {
  return [
    `${join(home, '.local/share/opencode')}:/root/.local/share/opencode`,
    `${join(home, '.agents')}:/root/.agents:ro`,
  ];
}

function podman(args: string[], timeout = 30000): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(PODMAN, args, { timeout }, (err, stdout, stderr) => {
      if (err) {
        reject(Object.assign(err, { stdout, stderr }));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

export async function ensureContainer(
  projectId: number,
  imageTag: string,
): Promise<void> {
  const name = getContainerName(projectId);

  try {
    const { stdout } = await podman(['inspect', name, '-f', '{{.State.Running}}']);
    if (stdout.trim() === 'true') return;
    if (stdout.trim() === 'false') {
      await podman(['start', name]);
      return;
    }
  } catch {}

  const bindArgs: string[] = [];
  for (const bind of getOpenCodeBinds()) {
    bindArgs.push('-v', bind);
  }

    await podman([
      'run', '-d', '--name', name,
      '--privileged',
      '--network', 'bridge',
      '--dns', '8.8.8.8',
      '--dns', '1.1.1.1',
      ...bindArgs,
      '-w', '/home/kali/workspace',
      imageTag, 'sleep', 'infinity',
    ], 120000);

  await injectOpencodeConfig(name);
}

async function injectOpencodeConfig(containerName: string): Promise<void> {
  const hostConfigPath = join(home, '.config/opencode/opencode.json');
  if (!existsSync(hostConfigPath)) return;

  const hostConfig = JSON.parse(readFileSync(hostConfigPath, 'utf-8'));
  const merged: any = { mcp: {}, plugin: [] };

  // Copy context7 and exa from host config (includes API keys in headers)
  for (const key of ['context7', 'exa']) {
    if (hostConfig.mcp?.[key]) {
      merged.mcp[key] = hostConfig.mcp[key];
    }
  }

  // Add terminal MCP (no host plugins needed)
  merged.mcp.terminal = { type: 'local', command: ['uvx', 'terminal-mcp'] };

  return new Promise<void>((resolve) => {
    const child = execFile(PODMAN, [
      'exec', '-i', containerName,
      'tee', '/root/.config/opencode/opencode.json',
    ], { timeout: 10000 }, () => resolve());
    child.stdin?.write(JSON.stringify(merged, null, 2));
    child.stdin?.end();
  });
}

export async function stopContainer(projectId: number): Promise<void> {
  const name = getContainerName(projectId);
  await podman(['stop', name]).catch(() => {});
}

export async function containerExists(projectId: number): Promise<boolean> {
  const name = getContainerName(projectId);
  try {
    await podman(['inspect', name]);
    return true;
  } catch {
    return false;
  }
}
