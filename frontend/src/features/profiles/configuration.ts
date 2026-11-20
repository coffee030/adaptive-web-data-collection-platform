import type { Adapter } from '../sources/api';
import { articleFields, type ArticleField, type ArticleMapping, type Configuration, type KeywordSearch, type RecordField, type Schema, type SelectorType, type SuggestedMapping } from './api';

interface Field extends RecordField {
  mapping: string;
  selectorType: SelectorType | '';
  mode: 'text' | 'attribute';
  attribute: string;
  resolveUrl: boolean;
}
export interface Draft {
  recordType: string;
  identity: number | null;
  selectorType: SelectorType;
  itemSelector: string;
  nextLinkSelector: string;
  maxPages: number;
  search?: KeywordSearch;
  article?: Partial<Record<ArticleField, number>>;
  fields: Field[];
}
export const emptyField = (): Field => ({
  name: '', value_type: 'string', required: true, mapping: '', selectorType: '',
  mode: 'text', attribute: '', resolveUrl: false,
});
export const emptySearch = (origin: string): KeywordSearch => ({
  origin, path: '/search', keyword_parameter: 'q', result_item_selector: '', detail_link_selector: '',
  max_detail_pages: 5, max_requests: 12,
});
export function draftFrom(configuration?: Configuration): Draft {
  const schema = configuration?.record_schema;
  const search = configuration?.adapter_type === 'web' ? configuration.search : undefined;
  const pagination = search?.pagination ?? (configuration?.adapter_type === 'web' ? configuration.pagination : undefined);
  const identity = schema?.fields.findIndex(field => field.name === schema.identity_field) ?? -1;
  const mapping = configuration?.adapter_type === 'web' ? configuration.article : undefined;
  return {
    recordType: schema?.record_type ?? '',
    identity: identity >= 0 ? identity : null,
    selectorType: configuration?.adapter_type === 'web' ? configuration.selector_type : 'css',
    itemSelector: configuration?.adapter_type === 'web' ? configuration.item_selector : '',
    nextLinkSelector: pagination?.next_link_selector ?? '',
    maxPages: pagination?.max_pages ?? 3,
    search,
    article: mapping && Object.fromEntries(Object.keys(articleFields).flatMap(key => {
      const field = key as ArticleField;
      const index = schema?.fields.findIndex(item => item.name === mapping[field]) ?? -1;
      return index >= 0 ? [[field, index]] : [];
    })),
    fields: schema?.fields.map(field => {
      const base = { ...emptyField(), ...field };
      if (configuration?.adapter_type === 'csv') {
        return { ...base, mapping: configuration.columns.find(column => column.name === field.name)?.column ?? '' };
      }
      const extraction = configuration?.fields.find(mapping => mapping.name === field.name);
      return extraction ? {
        ...base, mapping: extraction.selector, selectorType: extraction.selector_type ?? '',
        mode: extraction.mode, attribute: extraction.attribute ?? '', resolveUrl: extraction.resolve_url,
      } : base;
    }) ?? [emptyField()],
  };
}

export function suggestionSchema(draft: Draft): Schema | undefined {
  const hasSchema = draft.recordType.trim() || draft.identity !== null || draft.fields.length !== 1
    || draft.fields.some(field => field.name.trim() || field.value_type !== 'string' || !field.required);
  if (!hasSchema) return undefined;
  const { configuration, errors } = compileDraft(draft, 'web');
  if (errors['record-type'] || Object.keys(errors).some(key => key.startsWith('name-'))) {
    throw new Error('Complete the record type and field names in the editor before requesting a suggestion.');
  }
  return configuration.record_schema;
}

export function applySuggestion(draft: Draft, proposal: SuggestedMapping, schema?: Schema): Draft {
  const proposed = draftFrom({
    adapter_type: 'web',
    config_schema_version: '1',
    record_schema: proposal.record_schema,
    selector_type: 'xpath',
    item_selector: proposal.item_selector ?? '',
    search: proposal.search,
    fields: proposal.fields.flatMap(field => field.mapping ? [field.mapping] : []),
  });
  if (!schema) return proposed;
  const mappings = new Map(proposed.fields.map(field => [field.name, field]));
  return {
    ...proposed,
    article: draft.article,
    identity: draft.identity,
    fields: draft.fields.map(field => {
      const candidate = mappings.get(field.name.trim());
      if (candidate?.mapping) return candidate;
      return { ...field, selectorType: field.mapping ? field.selectorType || draft.selectorType : '' };
    }),
  };
}

export function compileDraft(draft: Draft, adapter: Adapter) {
  const errors: Record<string, string> = {};
  function text(value: string, key: string, max: number, label: string) {
    const trimmed = value.trim();
    if (!trimmed) errors[key] = `Enter ${label}.`;
    else if (Array.from(trimmed).length > max) errors[key] = `Use ${max} characters or fewer.`;
    return trimmed;
  }

  const usedNames = new Set<string>();
  const fields = draft.fields.map((field, index) => {
    const name = text(field.name, `name-${index}`, 128, 'an output field name');
    if (name && usedNames.has(name)) errors[`name-${index}`] = 'Use a unique output field name.';
    usedNames.add(name);
    return { name, value_type: field.value_type, required: field.required };
  });
  const base = {
    config_schema_version: '1' as const,
    record_schema: {
      record_type: text(draft.recordType, 'record-type', 128, 'a record type'),
      schema_version: '1' as const,
      identity_field: draft.identity === null ? null : fields[draft.identity]?.name ?? null,
      fields,
    },
  };
  const pagination = draft.nextLinkSelector.trim() ? {
    next_link_selector: text(draft.nextLinkSelector, 'next-link-selector', 1024, 'a next-link selector'),
    max_pages: draft.maxPages,
  } : undefined;
  let search: KeywordSearch | undefined;
  if (adapter === 'web' && draft.search) {
    search = {
      ...draft.search, pagination,
      origin: text(draft.search.origin, 'search-origin', 261, 'an approved origin'),
      path: text(draft.search.path, 'search-path', 512, 'a search path'),
      keyword_parameter: text(draft.search.keyword_parameter, 'keyword-parameter', 64, 'a query parameter name'),
      result_item_selector: text(draft.search.result_item_selector, 'search-result-selector', 1024, 'a result-item selector'),
      detail_link_selector: text(draft.search.detail_link_selector, 'detail-link-selector', 1024, 'a detail-link selector'),
    };
    if (!/^\/(?!\/)[^\x00-\x20?#\\]*$/.test(search.path)) errors['search-path'] = 'Enter a path such as /search.';
    if (!/^[A-Za-z0-9_.-]{1,64}$/.test(search.keyword_parameter)) errors['keyword-parameter'] = 'Use letters, digits, dots, underscores or hyphens.';
    if (!Number.isInteger(search.max_detail_pages) || search.max_detail_pages < 1 || search.max_detail_pages > 10) errors['maximum-details'] = 'Enter a whole number from 1 to 10.';
    if (!Number.isInteger(search.max_requests) || search.max_requests < 3 || search.max_requests > 20) errors['maximum-requests'] = 'Enter a whole number from 3 to 20.';
  }
  let article: ArticleMapping | undefined;
  if (search && draft.article) {
    const mapping: Partial<Record<ArticleField, string>> = {};
    for (const [key, index] of Object.entries(draft.article)) {
      const field = fields[index];
      if (field && (field.value_type === 'string' || (key === 'stable_id' && field.value_type === 'integer'))) {
        mapping[key as ArticleField] = field.name;
      } else {
        errors[`article-${key}`] = 'Choose a compatible output field.';
      }
    }
    if (mapping.title && draft.article.title !== undefined && fields[draft.article.title]?.required) {
      article = { ...mapping, title: mapping.title };
    } else {
      errors['article-title'] = 'Choose a required text field for the article title.';
    }
  }
  const configuration: Configuration = adapter === 'csv' ? {
    ...base, adapter_type: 'csv',
    columns: draft.fields.map((field, index) => ({
      name: fields[index]!.name, column: text(field.mapping, `mapping-${index}`, 128, 'a CSV header'),
    })),
  } : {
    ...base, adapter_type: 'web', selector_type: draft.selectorType,
    item_selector: text(draft.itemSelector, 'item-selector', 1024, 'an item selector'),
    ...(search ? { search } : pagination ? { pagination } : {}),
    ...(article ? { article } : {}),
    fields: draft.fields.map((field, index) => ({
      name: fields[index]!.name,
      selector: text(field.mapping, `mapping-${index}`, 1024, 'a field selector'),
      selector_type: field.selectorType || null,
      mode: field.mode,
      attribute: field.mode === 'attribute' ? text(field.attribute, `attribute-${index}`, 128, 'an attribute name') : null,
      resolve_url: field.resolveUrl,
    })),
  };
  return { configuration, errors };
}
