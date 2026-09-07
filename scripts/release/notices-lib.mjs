import { createHash } from 'node:crypto';

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

function normalizeLicenseText(value) {
  return value.replaceAll('\r\n', '\n').replaceAll('\t', '    ')
    .split('\n').map((line) => line.trimEnd()).join('\n').trimEnd();
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

export function rustDependencyPackages(metadata) {
  if (!metadata || !Array.isArray(metadata.packages) || typeof metadata.resolve?.root !== 'string' || !Array.isArray(metadata.resolve.nodes)) {
    throw new Error('Invalid Cargo metadata.');
  }
  const packagesById = new Map(metadata.packages.map((pkg) => [pkg?.id, pkg]));
  const nodesById = new Map(metadata.resolve.nodes.map((node) => [node?.id, node]));
  if (!packagesById.has(metadata.resolve.root) || !nodesById.has(metadata.resolve.root)) throw new Error('Invalid Cargo root package metadata.');
  const reachable = new Set();
  const queue = [metadata.resolve.root];
  while (queue.length) {
    const node = nodesById.get(queue.shift());
    if (!node || !Array.isArray(node.deps)) throw new Error('Invalid Cargo dependency graph.');
    for (const dependency of node.deps) {
      if (!Array.isArray(dependency?.dep_kinds) || !dependency.dep_kinds.some((kind) => kind?.kind == null || kind?.kind === 'build')) continue;
      if (!packagesById.has(dependency.pkg) || !nodesById.has(dependency.pkg)) throw new Error('Invalid Cargo dependency graph.');
      if (!reachable.has(dependency.pkg)) {
        reachable.add(dependency.pkg);
        queue.push(dependency.pkg);
      }
    }
  }
  return [...reachable].map((id) => packagesById.get(id));
}

function rustDependencies(metadata) {
  const packages = new Map();
  for (const entry of rustDependencyPackages(metadata)) {
    const name = requiredText(entry?.name, 'name');
    const version = requiredText(entry?.version, 'version');
    const license = requiredText(entry?.license, 'license expression');
    const key = `${name}\0${version}`;
    const existing = packages.get(key);
    if (existing && existing.license !== license) throw new Error(`Conflicting license expressions for ${name}@${version}.`);
    packages.set(key, { name, version, license });
  }
  return [...packages.values()].sort((left, right) => compareAscii(`${left.name}@${left.version}`, `${right.name}@${right.version}`));
}

function table(packages) {
  return ['| Package | Version | License |', '| --- | --- | --- |', ...packages.map((entry) =>
    `| ${markdown(entry.name)} | ${markdown(entry.version)} | ${markdown(entry.license)} |`)].join('\n');
}

function licenseAppendix(documents) {
  if (!Array.isArray(documents) || documents.length === 0) throw new Error('Missing dependency license text.');
  return documents.map((document, index) => {
    if (!Array.isArray(document?.packages) || !document.packages.length || !Array.isArray(document.filenames) || !document.filenames.length) {
      throw new Error('Invalid dependency license document metadata.');
    }
    const text = normalizeLicenseText(requiredText(document.text, 'license text'));
    const digest = createHash('sha256').update(text).digest('hex');
    const indented = text.split('\n').map((line) => line ? `    ${line}` : '').join('\n');
    const packages = [...new Set(document.packages.map((value) => requiredText(value, 'license package')))].sort(compareAscii);
    const filenames = [...new Set(document.filenames.map((value) => requiredText(value, 'license filename')))].sort(compareAscii);
    return `### Document ${index + 1} — SHA-256 ${digest}\n\nApplies to: ${packages.map((value) => `\`${value}\``).join(', ')}\n\nSource filenames: ${filenames.map((value) => `\`${value}\``).join(', ')}\n\n${indented}`;
  }).join('\n\n');
}

export function generateNotices(pnpmLicenses, cargoMetadata, directNodeDependencies, licenseDocuments) {
  const node = nodeDependencies(pnpmLicenses);
  const direct = Array.isArray(directNodeDependencies) ? directNodeDependencies.map((name) => requiredText(name, 'name')) : [];
  const nodeNames = new Set(node.map((entry) => entry.name));
  const missingNode = direct.filter((name) => !nodeNames.has(name)).sort(compareAscii);
  if (missingNode.length) throw new Error(`Missing direct Node production dependencies: ${missingNode.join(', ')}.`);
  const rust = rustDependencies(cargoMetadata);
  const output = `# Third-Party Notices

This file is generated from the locked Node production and Windows Rust production/build dependency metadata. Package license expressions are reproduced as reported by their manifests.

## Node production dependencies

${table(node)}

## Rust dependencies

${table(rust)}

This table is the locked Windows production and build dependency graph; development-only packages are excluded.

## Dependency license and notice texts

The following package-supplied license and NOTICE texts are bundled with line endings, trailing whitespace, and tabs normalized, deduplicated by content, and mapped to the packages that supplied them.

${licenseAppendix(licenseDocuments)}

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
