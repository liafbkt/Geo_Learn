export const packCapabilityValues = [
  'locate_region',
  'identify_region',
  'associate_capital',
  'locate_place',
  'identify_place',
] as const;

export type PackCapability = (typeof packCapabilityValues)[number];
export type PackCapabilities = readonly PackCapability[];
export type Coordinate = readonly [longitude: number, latitude: number];

export type LocalizedName = Readonly<{
  zh: string;
  en: string;
}>;

export type EntityBase = Readonly<{
  id: string;
  names: LocalizedName;
  aliases: readonly string[];
  parentId?: string | undefined;
  capabilities?: PackCapabilities | undefined;
}>;

export type RegionEntity = EntityBase &
  Readonly<{
    kind: 'region';
    capitalId?: string | undefined;
  }>;

export type PlaceEntity = EntityBase &
  Readonly<{
    kind: 'place';
    coordinate: Coordinate;
  }>;

export type Entity = RegionEntity | PlaceEntity;

export type SourceProcessingStep = Readonly<{
  operation: string;
  parameters: Readonly<Record<string, string | number | boolean | null>>;
}>;

export type SimplificationMetadata = Readonly<{
  algorithm: string;
  tolerance: number;
}>;

export type QuantizationMetadata = Readonly<{
  gridSize: number;
}>;

export type ContentSource = Readonly<{
  id: string;
  organization: string;
  url: string;
  retrievedAt: string;
  license: string;
  sha256: string;
  coordinateReferenceSystem: string;
  processing: readonly SourceProcessingStep[];
  simplification: SimplificationMetadata | null;
  quantization: QuantizationMetadata | null;
  reviewIdentifier: string | null;
}>;

export type ContentPack = Readonly<{
  manifest: Readonly<{
    schemaVersion: 1;
    contentVersion: string;
    packId: string;
    title: LocalizedName;
    primaryAnswerLanguage: 'zh' | 'en';
    expectedEntityCounts: Readonly<{ region: number; place: number }>;
    capabilities: PackCapabilities;
    defaultViewport: Readonly<{ center: Coordinate; scale: number }>;
    distributionStatus: 'development-only' | 'reviewed';
    checksums: Readonly<{ entities: string; topology: string; sources: string }>;
  }>;
  entities: readonly Entity[];
  topologyObjectIds: readonly string[];
  sources: readonly ContentSource[];
}>;

export type PackValidationIssue = Readonly<{
  code:
    | 'schema'
    | 'duplicate_id'
    | 'missing_reference'
    | 'count_mismatch'
    | 'missing_geometry'
    | 'capability_mismatch'
    | 'checksum_mismatch'
    | 'invalid_topology'
    | 'point_outside_region'
    | 'source_metadata'
    | 'coordinate_mismatch';
  path: string;
  message: string;
}>;

export type PackValidationResult =
  | Readonly<{ ok: true; pack: ContentPack }>
  | Readonly<{ ok: false; issues: readonly PackValidationIssue[] }>;
