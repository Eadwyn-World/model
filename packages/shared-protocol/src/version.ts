/**
 * Tiny semver helpers. The protocol only needs ordering and bumping, so a
 * dependency is not worth it.
 */
export type VersionPart = "major" | "minor" | "patch";

export function parseVersion(version: string): [number, number, number] {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!match) {
    throw new Error(`invalid semantic version: ${version}`);
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  for (let i = 0; i < 3; i += 1) {
    const left = pa[i] ?? 0;
    const right = pb[i] ?? 0;
    if (left < right) return -1;
    if (left > right) return 1;
  }
  return 0;
}

export function bumpVersion(version: string, part: VersionPart): string {
  const [major, minor, patch] = parseVersion(version);
  switch (part) {
    case "major":
      return `${major + 1}.0.0`;
    case "minor":
      return `${major}.${minor + 1}.0`;
    case "patch":
      return `${major}.${minor}.${patch + 1}`;
  }
}
