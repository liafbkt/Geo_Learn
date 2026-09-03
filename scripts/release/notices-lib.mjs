const compareAscii = (left, right) => left < right ? -1 : left > right ? 1 : 0;

export function parseNoticesArgs(rawArgs) {
  const args = rawArgs[0] === '--' ? rawArgs.slice(1) : rawArgs;
  if (args.some((arg) => arg !== '--check') || args.length > 1) throw new Error('Notices generation accepts only an optional --check argument.');
  return { check: args.includes('--check') };
}

function requiredText(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Missing dependency ${label}.`);
  return value.trim();
}

function markdown(value) {
  return value.replaceAll('|', '\\|').replaceAll('\r', ' ').replaceAll('\n', ' ');
}

function nodeDependencies(pnpmLicenses) {
  if (!pnpmLicenses || typeof pnpmLicenses !== 'object' || Array.isArray(pnpmLicenses)) {
    throw new Error('Invalid pnpm license metadata.');
  }
  const packages = new Map();
  for (const [groupLicense, entries] of Object.entries(pnpmLicenses)) {
    requiredText(groupLicense, 'license expression');
    if (!Array.isArray(entries)) throw new Error('Invalid pnpm license metadata.');
    for (const entry of entries) {
      const name = requiredText(entry?.name, 'name');
      const license = requiredText(entry?.license, 'license expression');
      if (!Array.isArray(entry.versions) || entry.versions.length === 0) throw new Error('Missing dependency version.');
      for (const rawVersion of entry.versions) {
        const version = requiredText(rawVersion, 'version');
        const key = `${name}\0${version}`;
        const existing = packages.get(key);
        if (existing && existing.license !== license) throw new Error(`Conflicting license expressions for ${name}@${version}.`);
        packages.set(key, { name, version, license });
      }
    }
  }
  return [...packages.values()].sort((left, right) => compareAscii(`${left.name}@${left.version}`, `${right.name}@${right.version}`));
}

function rustDependencies(metadata) {
  if (!metadata || !Array.isArray(metadata.packages) || typeof metadata.resolve?.root !== 'string') {
    throw new Error('Invalid Cargo metadata.');
  }
  const root = metadata.packages.find((pkg) => pkg?.id === metadata.resolve.root);
  if (!root || !Array.isArray(root.dependencies)) throw new Error('Invalid Cargo root package metadata.');
  const packages = new Map();
  for (const entry of metadata.packages.filter((pkg) => pkg?.id !== metadata.resolve.root)) {
    const name = requiredText(entry?.name, 'name');
    const version = requiredText(entry?.version, 'version');
    const license = requiredText(entry?.license, 'license expression');
    const key = `${name}\0${version}`;
    const existing = packages.get(key);
    if (existing && existing.license !== license) throw new Error(`Conflicting license expressions for ${name}@${version}.`);
    packages.set(key, { name, version, license });
  }
  const values = [...packages.values()].sort((left, right) => compareAscii(`${left.name}@${left.version}`, `${right.name}@${right.version}`));
  const available = new Set(values.map((entry) => entry.name));
  const missing = root.dependencies
    .filter((dependency) => dependency?.kind == null)
    .map((dependency) => requiredText(dependency.name, 'name'))
    .filter((name) => !available.has(name));
  if (missing.length) throw new Error(`Missing direct Rust production dependencies: ${missing.sort(compareAscii).join(', ')}.`);
  return values;
}

function table(packages) {
  return ['| Package | Version | License |', '| --- | --- | --- |', ...packages.map((entry) =>
    `| ${markdown(entry.name)} | ${markdown(entry.version)} | ${markdown(entry.license)} |`)].join('\n');
}

export function generateNotices(pnpmLicenses, cargoMetadata, directNodeDependencies) {
  const node = nodeDependencies(pnpmLicenses);
  const direct = Array.isArray(directNodeDependencies) ? directNodeDependencies.map((name) => requiredText(name, 'name')) : [];
  const nodeNames = new Set(node.map((entry) => entry.name));
  const missingNode = direct.filter((name) => !nodeNames.has(name)).sort(compareAscii);
  if (missingNode.length) throw new Error(`Missing direct Node production dependencies: ${missingNode.join(', ')}.`);
  const rust = rustDependencies(cargoMetadata);
  const output = `# Third-Party Notices

This file is generated from the locked production dependency metadata. Package license expressions are reproduced as reported by their manifests.

## Node production dependencies

${table(node)}

## Rust dependencies

${table(rust)}

## Bundled SQLite

The application enables rusqlite's bundled feature, which compiles SQLite into the Windows application. SQLite is dedicated to the public domain; see https://www.sqlite.org/copyright.html.

## Original audio

The crisp, soft, and minimal feedback tone packs were generated specifically for Spatial Memory Coach. Copyright (c) 2026 Spatial Memory Coach contributors; licensed with this application under the MIT License. No third-party game or application audio was sampled or copied. The complete MIT notice is retained in each pack's LICENSE.md.

## Content packs

- cn-provincial-divisions: upstream vector dedicated to the public domain by its author; geoBoundaries derivative licensed CC BY 4.0 with attribution required. The pack remains development-only and has no named-human or statutory public-release approval.
- cn-shanghai-districts: OpenStreetMap-derived database licensed ODbL 1.0; geoBoundaries attribution under CC BY 4.0 is retained. The pack remains development-only and has no named-human or statutory public-release approval.
- us-states: U.S. Census cartographic boundaries allow use with acknowledgement and retain their small-scale display limitation; the federal government capital/name sources are public domain in the United States. The pack remains development-only.

Detailed organizations, URLs, retrieval dates, hashes, processing steps, and use terms remain bundled in each pack's sources.json. This personal-use notice does not convert unresolved map review or statutory questions into an approval.
`;
  if (/C:\\Users\\|\/Users\/|\/home\//i.test(output)) throw new Error('Generated notices contain a personal path.');
  return output;
}
