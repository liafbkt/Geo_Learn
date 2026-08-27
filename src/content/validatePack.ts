import { contentPackSchema } from './schema';
import type {
  ContentPack,
  Entity,
  PackCapability,
  PackValidationIssue,
  PackValidationResult,
} from './types';

function issue(
  code: PackValidationIssue['code'],
  path: string,
  message: string,
): PackValidationIssue {
  return { code, path, message };
}

function supportsCapability(
  entity: Entity,
  capability: PackCapability,
  topologyObjectIds: ReadonlySet<string>,
): boolean {
  if (entity.capabilities !== undefined && !entity.capabilities.includes(capability)) {
    return false;
  }

  switch (capability) {
    case 'locate_region':
      return entity.kind === 'region' && topologyObjectIds.has(entity.id);
    case 'identify_region':
      return entity.kind === 'region';
    case 'associate_capital':
      return entity.kind === 'region' && entity.capitalId !== undefined;
    case 'locate_place':
      return entity.kind === 'place';
    case 'identify_place':
      return entity.kind === 'place';
  }
}

function validateReferences(pack: ContentPack, issues: PackValidationIssue[]): void {
  const entityIds = new Set(pack.entities.map((entity) => entity.id));
  const entitiesById = new Map(pack.entities.map((entity) => [entity.id, entity] as const));

  pack.entities.forEach((entity, index) => {
    if (entity.parentId !== undefined && !entityIds.has(entity.parentId)) {
      issues.push(
        issue('missing_reference', `entities.${index}.parentId`, `Unknown parent entity: ${entity.parentId}.`),
      );
    }

    if (entity.kind === 'region' && entity.capitalId !== undefined) {
      const capital = entitiesById.get(entity.capitalId);
      if (capital === undefined || capital.kind !== 'place') {
        issues.push(
          issue('missing_reference', `entities.${index}.capitalId`, `Unknown place entity: ${entity.capitalId}.`),
        );
      }
    }
  });
}

function validatePackReferences(pack: ContentPack): readonly PackValidationIssue[] {
  const issues: PackValidationIssue[] = [];
  const knownEntityIds = new Set<string>();

  pack.entities.forEach((entity, index) => {
    if (knownEntityIds.has(entity.id)) {
      issues.push(issue('duplicate_id', `entities.${index}.id`, `Duplicate entity ID: ${entity.id}.`));
    }
    knownEntityIds.add(entity.id);
  });

  validateReferences(pack, issues);

  const actualCounts = pack.entities.reduce(
    (counts, entity) => ({ ...counts, [entity.kind]: counts[entity.kind] + 1 }),
    { region: 0, place: 0 },
  );
  (['region', 'place'] as const).forEach((kind) => {
    if (actualCounts[kind] !== pack.manifest.expectedEntityCounts[kind]) {
      issues.push(
        issue(
          'count_mismatch',
          `manifest.expectedEntityCounts.${kind}`,
          `Expected ${pack.manifest.expectedEntityCounts[kind]} ${kind} entities but found ${actualCounts[kind]}.`,
        ),
      );
    }
  });

  const topologyObjectIds = new Set(pack.topologyObjectIds);
  pack.entities.forEach((entity, index) => {
    if (entity.kind === 'region' && !topologyObjectIds.has(entity.id)) {
      issues.push(
        issue('missing_geometry', `entities.${index}.id`, `Missing topology object for region: ${entity.id}.`),
      );
    }
  });

  pack.manifest.capabilities.forEach((capability, index) => {
    if (!pack.entities.some((entity) => supportsCapability(entity, capability, topologyObjectIds))) {
      issues.push(
        issue(
          'capability_mismatch',
          `manifest.capabilities.${index}`,
          `No entity can generate capability: ${capability}.`,
        ),
      );
    }
  });

  return issues;
}

export function validatePack(input: unknown): PackValidationResult {
  const parsed = contentPackSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((validationIssue) =>
        issue('schema', validationIssue.path.join('.') || '$', validationIssue.message),
      ),
    };
  }

  const issues = validatePackReferences(parsed.data);
  return issues.length === 0 ? { ok: true, pack: parsed.data } : { ok: false, issues };
}
