import type { Source } from './api';

export type CollectionInput = { adapter_type: 'web'; url: string }
  | { adapter_type: 'web'; keyword: string }
  | { adapter_type: 'csv'; dataset_id: string; content: string };

export function allowedInputs(source: Source) {
  return source.adapter_type === 'web' ? source.allowed_origins : source.allowed_datasets;
}

export function compileCollectionInput(source: Source, target: string, content: string, keywordSearch = false):
  { entry: CollectionInput; error?: never } | { error: string; entry?: never } {
  if (!allowedInputs(source).includes(target)) return { error: 'Choose an input allowed by the Source policy.' };
  if (source.adapter_type === 'web') {
    if (keywordSearch) {
      const keyword = content.trim();
      if (!keyword || Array.from(keyword).length > 128 || /[\p{C}\p{Z}]/u.test(keyword.replaceAll(' ', ''))) {
        return { error: 'Enter a keyword of 1–128 printable characters.' };
      }
      return { entry: { adapter_type: 'web', keyword } };
    }
    if (!content.startsWith('/') || content.startsWith('//') || /[\x00-\x20\x7f\\]/.test(content)
      || Array.from(target + content).length > 2048) {
      return { error: 'Enter a path beginning with a single slash, without spaces or backslashes.' };
    }
    return { entry: { adapter_type: 'web', url: target + content } };
  }
  if (!content.trim() || content.includes('\0') || new TextEncoder().encode(content).length > 1024 * 1024) {
    return { error: 'Enter CSV text with a header, up to 1 MiB in UTF-8 and without NUL characters.' };
  }
  return { entry: { adapter_type: 'csv', dataset_id: target, content } };
}
