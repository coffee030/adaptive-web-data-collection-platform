import { apiGet, ApiError } from '../../lib/api';
import type { RequestIntent } from '../../lib/requestIntent';
import { bindingsPath, categoriesPath, listPage, topicsPath, type Binding, type Category, type Topic } from './api';

export const maxBindings = 4;
const bindingPageSize = 24;

export interface TopicContext {
  category: Category;
  topic: Topic;
}

export interface CollectionSelection {
  category: string;
  topic: string;
  keyword: string;
  sources: Binding[];
}

export interface CollectionInput {
  topic_id: string;
  keyword: string;
  binding_ids: string[];
}

interface CollectionDraft {
  category?: Category;
  keyword: string;
  selected: Binding[];
  selectionTopic?: string;
  bindingPages: number;
  reviewed?: string;
  returnFocus?: string;
  pending?: { intent: RequestIntent<CollectionInput>; selection: CollectionSelection };
  submitted?: string;
}

const recentDrafts = new Map<string, CollectionDraft>();

export function getCollectionDraft(key: string) {
  const draft = recentDrafts.get(key) ?? { keyword: '', selected: [], bindingPages: 1 };
  recentDrafts.delete(key);
  recentDrafts.set(key, draft);
  if (recentDrafts.size > 20) recentDrafts.delete(recentDrafts.keys().next().value!);
  return draft;
}

export function clearSelection(draft: CollectionDraft) {
  draft.selected = [];
  draft.selectionTopic = undefined;
  draft.bindingPages = 1;
  draft.reviewed = undefined;
  draft.returnFocus = undefined;
}

export async function readActiveTopic(id: string, signal: AbortSignal): Promise<TopicContext | undefined> {
  if (!id) return;
  try {
    const topic = await apiGet<Topic>(topicsPath + '/' + encodeURIComponent(id), signal);
    if (!topic.active) return;
    const category = await apiGet<Category>(categoriesPath + '/' + encodeURIComponent(topic.category_id), signal);
    if (category.active) return { topic, category };
  } catch (error) {
    if (!(error instanceof ApiError && (error.status === 404 || error.status === 422))) throw error;
  }
}

export async function readEligibleSources(topicId: string, pages: number, signal: AbortSignal) {
  const rows = new Map<string, Binding>();
  let more = false;
  for (let page = 0; page < pages; page++) {
    const data = await listPage<Binding>(bindingsPath(topicId), signal, bindingPageSize + 1, page * bindingPageSize,
      { eligible_only: 'true' });
    for (const row of data.slice(0, bindingPageSize)) {
      if (row.eligible && !row.disabled_at) rows.set(row.id, row);
    }
    more = data.length > bindingPageSize;
    if (!more) break;
  }
  return { rows: [...rows.values()], more };
}

export function samePin(first: Binding, second: Binding) {
  return first.id === second.id && first.source_id === second.source_id
    && first.profile_version_id === second.profile_version_id && first.config_hash === second.config_hash;
}

export function reviewKey(selection: CollectionSelection) {
  const { category, topic, keyword, sources } = selection;
  return JSON.stringify([category, topic, keyword, sources.map(row => [
    row.id, row.source_name, row.profile_version, row.profile_version_id, row.config_hash,
  ]).sort(([first], [second]) => String(first).localeCompare(String(second)))]);
}

export function keywordError(value: string) {
  const keyword = value.trim();
  if (!keyword) return 'Enter a keyword.';
  if ([...keyword].length > 128) return 'Use 128 characters or fewer.';
  if (/[\p{C}\p{Z}]/u.test(keyword.replaceAll(' ', ''))) return 'Use printable characters and ordinary spaces.';
  return '';
}
