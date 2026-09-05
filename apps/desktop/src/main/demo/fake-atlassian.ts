/**
 * The fake Jira + Confluence (docs/demo-mode.md DM-8): a `FetchLike` that
 * answers the REST endpoints the Atlassian connector uses from an in-memory
 * store seeded by a fixture. STUB: the signature below is the contract; the
 * body is being built.
 */
import type { FetchLike } from '@qale/connectors';

export interface FakeAtlassianOptions {
  /** The generated fixture (`demo/atlassian-fixture.json`), anchored dates. */
  fixturePath: string;
  /** Where mutations persist between launches (`<userData>/demo/atlassian.json`). */
  statePath: string;
  /** Days to slide fixture date tokens by at load (today − anchor). */
  dateOffsetDays: number;
  /** The site the mirrors name, e.g. `https://tavla.atlassian.net`. */
  siteUrl: string;
}

/** A scripted change the presenter can trigger (e.g. "WO-231 goes Done"). */
export interface DemoStep {
  id: string;
  label: string;
  applied: boolean;
}

export interface FakeAtlassian {
  fetchImpl: FetchLike;
  /** Back to the fixture, mutations and steps forgotten. */
  reset(): void;
  steps(): DemoStep[];
  /** Apply one scripted step. False if unknown or already applied. */
  applyStep(id: string): boolean;
}

export function createFakeAtlassian(_opts: FakeAtlassianOptions): FakeAtlassian {
  throw new Error('fake atlassian not built yet');
}
