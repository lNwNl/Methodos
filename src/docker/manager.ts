import { docker, getContainerName } from './index';
import type { Container } from 'dockerode';

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
