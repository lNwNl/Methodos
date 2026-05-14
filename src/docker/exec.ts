import { getContainerName } from './index';
import { config } from '../config';
import { execFile } from 'node:child_process';

const PODMAN = process.env.DOCKER_BIN || 'podman';

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export async function execInContainer(
  projectId: number,
  cmd: string[],
  options: {
    workdir?: string;
    timeout?: number;
  } = {},
): Promise<ExecResult> {
  const containerName = getContainerName(projectId);
  const args = ['exec'];
  if (options.workdir) {
    args.push('-w', options.workdir);
  }
  args.push(containerName, ...cmd);

  const timeout = options.timeout || config.actTimeoutMs;

  return new Promise((resolve) => {
    const child = execFile(PODMAN, args, {
      timeout,
      maxBuffer: 10 * 1024 * 1024,
    }, (err, stdout, stderr) => {
      if (err && (err as any).killed) {
        resolve({ stdout, stderr, exitCode: -1 });
        return;
      }
      resolve({
        stdout: stdout || '',
        stderr: stderr || '',
        exitCode: err ? (err as any).code || 1 : 0,
      });
    });
  });
}

export async function writeFileInContainer(
  projectId: number,
  containerPath: string,
  content: string,
): Promise<void> {
  const dirPath = containerPath.substring(0, containerPath.lastIndexOf('/'));
  if (dirPath) {
    await ensureWorkdir(projectId, dirPath);
  }

  // Use podman exec with stdin to write file content
  const containerName = getContainerName(projectId);
  return new Promise<void>((resolve) => {
    const child = execFile(PODMAN, ['exec', '-i', containerName, 'tee', containerPath], {
      timeout: 10000,
    }, () => resolve());
    child.stdin?.write(content);
    child.stdin?.end();
  });
}

export async function ensureWorkdir(
  projectId: number,
  workdir: string,
): Promise<void> {
  const containerName = getContainerName(projectId);
  return new Promise<void>((resolve) => {
    execFile(PODMAN, ['exec', containerName, 'mkdir', '-p', workdir], {
      timeout: 5000,
    }, () => resolve());
  });
}
