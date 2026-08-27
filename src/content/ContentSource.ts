export const contentFileNames = [
  'manifest.json',
  'entities.json',
  'sources.json',
  'map.topojson',
] as const;

export type ContentFileName = (typeof contentFileNames)[number];

export interface ContentSource {
  readPackIds(): Promise<readonly string[]>;
  readJson(packId: string, fileName: ContentFileName): Promise<unknown>;
}
