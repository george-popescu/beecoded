export const ATLAS_NODE_ENGINE_RANGE = '^22.18.0 || >=24.11.0';

const NODE_VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function isAtlasNodeVersionSupported(version) {
  if (typeof version !== 'string') return false;

  const match = NODE_VERSION_PATTERN.exec(version);
  if (!match) return false;

  const major = Number(match[1]);
  const minor = Number(match[2]);

  return (major === 22 && minor >= 18)
    || (major === 24 && minor >= 11)
    || major > 24;
}

export function assertAtlasRuntime(version = process.versions.node) {
  if (!isAtlasNodeVersionSupported(version)) {
    throw new Error(
      `Nectar Atlas requires Node ${ATLAS_NODE_ENGINE_RANGE}; received ${version}`,
    );
  }

  return version;
}
