import type { ContentFileName, ContentSource } from '../content/ContentSource';

export type InMemoryPackResources = Readonly<Partial<Record<ContentFileName, unknown>>>;
export type InMemoryContentResources = Readonly<Record<string, InMemoryPackResources>>;

/** A deterministic source for tests and offline development. */
export class InMemoryContentSource implements ContentSource {
  private readonly resources: InMemoryContentResources;

  public constructor(resources: InMemoryContentResources) {
    this.resources = resources;
  }

  public async readPackIds(): Promise<readonly string[]> {
    return Object.keys(this.resources).sort();
  }

  public async readJson(packId: string, fileName: ContentFileName): Promise<unknown> {
    const pack = this.resources[packId];
    if (pack === undefined || !(fileName in pack)) {
      throw new Error(`Content resource not found: ${packId}/${fileName}.`);
    }
    return pack[fileName];
  }
}
