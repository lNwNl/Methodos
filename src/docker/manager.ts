import { getContainerName } from './index';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';

const home = homedir();
const PODMAN = process.env.DOCKER_BIN || 'podman';

function getOpenCodeBinds(): string[] {
  return [
    `${join(home, '.config/opencode')}:/root/.config/opencode:ro`,
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
    ...bindArgs,
    '-w', '/home/kali/workspace',
    imageTag, 'sleep', 'infinity',
  ], 120000);
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
