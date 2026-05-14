import { docker, getContainerName } from './index';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Container } from 'dockerode';

const home = homedir();

function getOpenCodeBinds(): string[] {
  return [
    `${join(home, '.config/opencode')}:/root/.config/opencode:ro`,
    `${join(home, '.local/share/opencode')}:/root/.local/share/opencode`,
    `${join(home, '.agents')}:/root/.agents:ro`,
  ];
}

export async function ensureContainer(
  projectId: number,
  imageTag: string,
): Promise<Container> {
  const name = getContainerName(projectId);

  try {
    const container = docker.getContainer(name);
    const info = await container.inspect();
    if (!info.State.Running) {
      await container.start();
    }
    return container;
  } catch (err: any) {
    if (err.statusCode === 404) {
      const container = await docker.createContainer({
        name,
        Image: imageTag,
        Tty: true,
        AttachStdin: false,
        AttachStdout: false,
        AttachStderr: false,
        WorkingDir: '/home/kali/workspace',
        HostConfig: {
          AutoRemove: false,
          Binds: getOpenCodeBinds(),
        },
      });
      await container.start();
      return container;
    }
    throw err;
  }
}

export async function stopContainer(projectId: number): Promise<void> {
  const name = getContainerName(projectId);
  try {
    const container = docker.getContainer(name);
    await container.stop().catch(() => {});
  } catch (err: any) {
    if (err.statusCode !== 404) throw err;
  }
}

export async function containerExists(projectId: number): Promise<boolean> {
  const name = getContainerName(projectId);
  try {
    await docker.getContainer(name).inspect();
    return true;
  } catch (err: any) {
    if (err.statusCode === 404) return false;
    throw err;
  }
}
