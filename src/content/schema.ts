import { z } from 'zod';
import type { ContentPack } from './types';
import { packCapabilityValues } from './types';

const nonEmptyString = z.string().trim().min(1);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/i, 'Expected a SHA-256 value.');
const coordinate = z
  .tuple([z.number().gte(-180).lte(180), z.number().gte(-90).lte(90)])
  .readonly();
export const topologyPointSummarySchema = z
  .object({ id: nonEmptyString, coordinate })
  .strict()
  .readonly();
const localizedName = z
  .object({ zh: nonEmptyString, en: nonEmptyString })
  .strict()
  .readonly();
const capabilities = z.array(z.enum(packCapabilityValues)).readonly();
const metadataValue = z.union([z.string(), z.number(), z.boolean(), z.null()]);

const entityBase = {
  id: nonEmptyString,
  names: localizedName,
  aliases: z.array(nonEmptyString).readonly(),
  parentId: nonEmptyString.optional(),
  capabilities: capabilities.optional(),
};

export const entitySchema = z.discriminatedUnion('kind', [
  z.object({ ...entityBase, kind: z.literal('region'), capitalId: nonEmptyString.optional() }).strict(),
  z.object({ ...entityBase, kind: z.literal('place'), coordinate }).strict(),
]);

const sourceProcessingStep = z
  .object({
    operation: nonEmptyString,
    parameters: z.record(z.string(), metadataValue).readonly(),
  })
  .strict()
  .readonly();

export const contentSourceSchema = z
  .object({
    id: nonEmptyString,
    organization: nonEmptyString,
    url: z.url(),
    retrievedAt: z.string().date(),
    license: nonEmptyString,
    sha256,
    coordinateReferenceSystem: nonEmptyString,
    processing: z.array(sourceProcessingStep).readonly(),
    simplification: z
      .object({ algorithm: nonEmptyString, tolerance: z.number().nonnegative() })
      .strict()
      .readonly()
      .nullable(),
    quantization: z.object({ gridSize: z.number().int().positive() }).strict().readonly().nullable(),
    reviewIdentifier: nonEmptyString.nullable(),
  })
  .strict()
  .readonly();

export const contentPackSchema: z.ZodType<ContentPack> = z
  .object({
    manifest: z
      .object({
        schemaVersion: z.literal(1),
        contentVersion: nonEmptyString,
        packId: nonEmptyString,
        title: localizedName,
        primaryAnswerLanguage: z.enum(['zh', 'en']),
        expectedEntityCounts: z
          .object({ region: z.number().int().nonnegative(), place: z.number().int().nonnegative() })
          .strict()
          .readonly(),
        capabilities,
        defaultViewport: z.object({ center: coordinate, scale: z.number().positive() }).strict().readonly(),
        distributionStatus: z.enum(['development-only', 'reviewed']),
        checksums: z
          .object({ entities: sha256, topology: sha256, sources: sha256 })
          .strict()
          .readonly(),
      })
      .strict()
      .readonly(),
    entities: z.array(entitySchema).readonly(),
    topologyObjectIds: z.array(nonEmptyString).readonly(),
    topologyPoints: z.array(topologyPointSummarySchema).readonly(),
    sources: z.array(contentSourceSchema).readonly(),
  })
  .strict()
  .readonly();
