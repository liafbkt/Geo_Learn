import type { ContentPack, Coordinate, Entity, PlaceEntity, RegionEntity } from '../content/types';
import type { MasteryStage, Skill } from './types';
import type { AnswerSpec } from './normalizeAnswer';

type ChoiceFields = Readonly<{
  presentation: 'choice';
  entityId: string;
  candidateEntityIds: readonly [string, string, string, string];
}>;

type TextFields = Readonly<{
  presentation: 'text';
  entityId: string;
  answer: AnswerSpec;
}>;

export type Question =
  | Readonly<{ kind: 'locate_region'; presentation: 'map'; entityId: string }>
  | Readonly<{ kind: 'identify_region' } & (ChoiceFields | TextFields)>
  | Readonly<
      { kind: 'associate_capital'; capitalId: string } & (ChoiceFields | TextFields)
    >
  | Readonly<{
      kind: 'locate_place';
      presentation: 'map';
      entityId: string;
      coordinate: Coordinate;
    }>
  | Readonly<{ kind: 'identify_place' } & (ChoiceFields | TextFields)>;

export type GenerateQuestionInput = Readonly<{
  pack: ContentPack;
  entityId: string;
  skill: Skill;
  stage: MasteryStage;
  candidateOrder?: readonly string[];
}>;

function supportsSkill(entity: Entity, skill: Skill): boolean {
  return entity.capabilities === undefined || entity.capabilities.includes(skill);
}

function requireEntity(pack: ContentPack, entityId: string): Entity {
  const entity = pack.entities.find((candidate) => candidate.id === entityId);
  if (entity === undefined) {
    throw new Error(`Unknown entity: ${entityId}`);
  }
  return entity;
}

function requireRegion(entity: Entity): RegionEntity {
  if (entity.kind !== 'region') {
    throw new Error(`Skill requires a region entity: ${entity.id}`);
  }
  return entity;
}

function requirePlace(entity: Entity): PlaceEntity {
  if (entity.kind !== 'place') {
    throw new Error(`Skill requires a place entity: ${entity.id}`);
  }
  return entity;
}

function requireRegionGeometry(pack: ContentPack, entityId: string): void {
  if (!pack.topologyObjectIds.includes(entityId)) {
    throw new Error(`Region ${entityId} is missing required geometry`);
  }
}

function answerSpec(entity: Entity): AnswerSpec {
  return {
    acceptedDisplayValues: [entity.names.zh, entity.names.en, ...entity.aliases],
  };
}

function fourChoices(
  candidateOrder: readonly string[] | undefined,
  correctEntityId: string,
  isValid: (entityId: string) => boolean,
): readonly [string, string, string, string] {
  if (candidateOrder === undefined || !candidateOrder.includes(correctEntityId)) {
    throw new Error('Candidate ordering must include the correct answer');
  }

  const orderedUnique = [...new Set(candidateOrder)].filter(isValid);
  const distractors = orderedUnique.filter((entityId) => entityId !== correctEntityId).slice(0, 3);
  if (distractors.length !== 3 || !isValid(correctEntityId)) {
    throw new Error('Question generation requires four valid choices');
  }

  const selected = new Set([correctEntityId, ...distractors]);
  const choices = orderedUnique.filter((entityId) => selected.has(entityId));
  const [first, second, third, fourth, extra] = choices;
  if (
    first === undefined ||
    second === undefined ||
    third === undefined ||
    fourth === undefined ||
    extra !== undefined
  ) {
    throw new Error('Question generation requires four valid choices');
  }
  return [first, second, third, fourth];
}

function isChoiceStage(stage: MasteryStage): boolean {
  return stage === 'new' || stage === 'learning';
}

export function generateQuestion(input: GenerateQuestionInput): Question {
  const { pack, entityId, skill, stage, candidateOrder } = input;
  if (!pack.manifest.capabilities.includes(skill)) {
    throw new Error(`Pack does not declare capability: ${skill}`);
  }

  const entity = requireEntity(pack, entityId);
  if (!supportsSkill(entity, skill)) {
    throw new Error(`Entity ${entityId} does not declare capability: ${skill}`);
  }

  switch (skill) {
    case 'locate_region': {
      requireRegion(entity);
      requireRegionGeometry(pack, entityId);
      return { kind: 'locate_region', presentation: 'map', entityId };
    }
    case 'identify_region': {
      requireRegion(entity);
      requireRegionGeometry(pack, entityId);
      if (!isChoiceStage(stage)) {
        return {
          kind: 'identify_region',
          presentation: 'text',
          entityId,
          answer: answerSpec(entity),
        };
      }
      return {
        kind: 'identify_region',
        presentation: 'choice',
        entityId,
        candidateEntityIds: fourChoices(candidateOrder, entityId, (candidateId) => {
          const candidate = pack.entities.find((item) => item.id === candidateId);
          return (
            candidate?.kind === 'region' &&
            supportsSkill(candidate, skill) &&
            pack.topologyObjectIds.includes(candidateId)
          );
        }),
      };
    }
    case 'associate_capital': {
      const region = requireRegion(entity);
      if (region.capitalId === undefined) {
        throw new Error(`Region ${entityId} is missing a capital relationship`);
      }
      const capital = pack.entities.find((candidate) => candidate.id === region.capitalId);
      if (capital?.kind !== 'place') {
        throw new Error(`Region ${entityId} has an invalid capital relationship`);
      }
      if (!isChoiceStage(stage)) {
        return {
          kind: 'associate_capital',
          presentation: 'text',
          entityId,
          capitalId: capital.id,
          answer: answerSpec(capital),
        };
      }
      const capitalIds = new Set(
        pack.entities.flatMap((candidate) =>
          candidate.kind === 'region' &&
          supportsSkill(candidate, skill) &&
          candidate.capitalId !== undefined &&
          pack.entities.some(
            (possibleCapital) =>
              possibleCapital.id === candidate.capitalId && possibleCapital.kind === 'place',
          )
            ? [candidate.capitalId]
            : [],
        ),
      );
      return {
        kind: 'associate_capital',
        presentation: 'choice',
        entityId,
        capitalId: capital.id,
        candidateEntityIds: fourChoices(candidateOrder, capital.id, (candidateId) =>
          capitalIds.has(candidateId),
        ),
      };
    }
    case 'locate_place': {
      const place = requirePlace(entity);
      return {
        kind: 'locate_place',
        presentation: 'map',
        entityId,
        coordinate: place.coordinate,
      };
    }
    case 'identify_place': {
      requirePlace(entity);
      if (!isChoiceStage(stage)) {
        return {
          kind: 'identify_place',
          presentation: 'text',
          entityId,
          answer: answerSpec(entity),
        };
      }
      return {
        kind: 'identify_place',
        presentation: 'choice',
        entityId,
        candidateEntityIds: fourChoices(candidateOrder, entityId, (candidateId) => {
          const candidate = pack.entities.find((item) => item.id === candidateId);
          return (
            candidate?.kind === 'place' &&
            supportsSkill(candidate, skill)
          );
        }),
      };
    }
  }
}
