import Docker from 'dockerode';

const socketPath = process.env.DOCKER_SOCKET || '/run/user/1000/podman/podman.sock';

export const docker = new Docker({ socketPath });

export function getContainerName(projectId: number): string {
  return `methodos-${projectId}`;
}
