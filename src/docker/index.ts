export const PODMAN = process.env.DOCKER_BIN || 'podman';

export function getContainerName(projectId: number): string {
  return `methodos-${projectId}`;
}
