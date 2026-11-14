import type { Adapter } from '../sources/api';
import type { Configuration, RecordField, SelectorType } from './api';

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
  fields: Field[];
}
export const emptyField = (): Field => ({
  name: '', value_type: 'string', required: true, mapping: '', selectorType: '',
  mode: 'text', attribute: '', resolveUrl: false,
});
export function draftFrom(configuration?: Configuration): Draft {
  const schema = configuration?.record_schema;
  const identity = schema?.fields.findIndex(field => field.name === schema.identity_field) ?? -1;
  return {
    recordType: schema?.record_type ?? '',
    identity: identity >= 0 ? identity : null,
    selectorType: configuration?.adapter_type === 'web' ? configuration.selector_type : 'css',
    itemSelector: configuration?.adapter_type === 'web' ? configuration.item_selector : '',
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
  const configuration: Configuration = adapter === 'csv' ? {
    ...base, adapter_type: 'csv',
    columns: draft.fields.map((field, index) => ({
      name: fields[index]!.name, column: text(field.mapping, `mapping-${index}`, 128, 'a CSV header'),
    })),
  } : {
    ...base, adapter_type: 'web', selector_type: draft.selectorType,
    item_selector: text(draft.itemSelector, 'item-selector', 1024, 'an item selector'),
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
