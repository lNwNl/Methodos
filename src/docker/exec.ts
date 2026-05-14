import { docker, getContainerName } from './index';
import { config } from '../config';

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
  const container = docker.getContainer(containerName);

  const exec = await container.exec({
    Cmd: cmd,
    WorkingDir: options.workdir || '/home/kali/workspace',
    AttachStdout: true,
    AttachStderr: true,
  });

  const stream = await exec.start({ Detach: false, Tty: false });

  let stdout = '';
  let stderr = '';

  const timeout = options.timeout || config.actTimeoutMs;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      stream.destroy();
      resolve({ stdout, stderr, exitCode: -1 });
    }, timeout);

    container.modem.demuxStream(stream, {
      write: (chunk: Buffer) => { stdout += chunk.toString(); },
    }, {
      write: (chunk: Buffer) => { stderr += chunk.toString(); },
    });

    stream.on('end', () => {
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: 0 });
    });

    stream.on('error', (err: Error) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

export async function writeFileInContainer(
  projectId: number,
  containerPath: string,
  content: string,
): Promise<void> {
  const safePath = containerPath.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const safeContent = JSON.stringify(content);
  await execInContainer(projectId, [
    'node', '-e',
    `const fs=require("fs"),p=require("path");fs.mkdirSync(p.dirname("${safePath}"),{recursive:true});fs.writeFileSync("${safePath}",${safeContent})`,
  ]);
}

export async function ensureWorkdir(
  projectId: number,
  workdir: string,
): Promise<void> {
  await execInContainer(projectId, ['mkdir', '-p', workdir]);
}
