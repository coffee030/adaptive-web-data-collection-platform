import { getProfile, type Profile } from '../profiles/api';
import { getSource, type Source } from '../sources/api';
import type { CollectionJob } from './api';

export const shortId = (id: string) => id.slice(0, 8);

export async function loadJobContext(jobs: readonly CollectionJob[], signal: AbortSignal) {
  const metadataSignal = AbortSignal.any([signal, AbortSignal.timeout(4_000)]);
  const sources = new Map<string, Source>();
  const profiles = new Map<string, Profile>();
  const sourceIds = new Set(jobs.map(job => job.source_id));
  const pinned = new Map(jobs.map(job => [job.profile_version_id, job.source_id]));
  const reads = [
    ...Array.from(sourceIds, id => async () => sources.set(id, await getSource(id, metadataSignal))),
    ...Array.from(pinned, ([id, source]) => async () => profiles.set(id, await getProfile(source, id, metadataSignal))),
  ];
  for (let index = 0; index < reads.length && !metadataSignal.aborted; index += 4) {
    await Promise.allSettled(reads.slice(index, index + 4).map(read => read()));
  }
  signal.throwIfAborted();
  return { sources, profiles };
}
