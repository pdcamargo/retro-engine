/**
 * The studio's embedded engine version — what built user code resolves against
 * via the host bridge. A project pinned to a different line may compile against a
 * differently-shaped API than the studio actually provides.
 */
export const STUDIO_ENGINE_VERSION = '0.0.0';

// Under 0.x, the minor is the breaking segment (semver), so compare major.minor;
// at >=1.0 the major alone gates compatibility.
const compatKey = (version: string): string => {
  const [major = '', minor = '0'] = version.split('.');
  return major === '0' ? `0.${minor}` : major;
};

/**
 * Whether a project's pinned engine version is incompatible with the studio's.
 * Empty versions (unset) never mismatch. The studio warns rather than refusing —
 * the host bridge will still resolve, it just may not match the project's types.
 */
export const engineVersionMismatch = (projectEngine: string, studioEngine: string): boolean => {
  if (projectEngine.length === 0 || studioEngine.length === 0) return false;
  return compatKey(projectEngine) !== compatKey(studioEngine);
};
