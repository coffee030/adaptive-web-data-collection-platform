import { emptyField, emptySearch } from './configuration';
import type { Draft } from './configuration';
import type { Adapter } from '../sources/api';
import { paginationLimits, selectorTypes, valueTypes, type KeywordSearch } from './api';

type Props = {
  draft: Draft; adapter: Adapter; origins: string[]; errors: Record<string, string>;
  change: (draft: Draft) => void;
};

export function ConfigurationEditor({ draft, adapter, origins, errors, change }: Props) {
  const web = adapter === 'web';
  const search = draft.search;
  function patchSearch(patch: Partial<KeywordSearch>) {
    if (search) change({ ...draft, search: { ...search, ...patch } });
  }
  function patchField(index: number, patch: Partial<Draft['fields'][number]>) {
    change({ ...draft, fields: draft.fields.map((field, position) =>
      index === position ? { ...field, ...patch } : field) });
  }

  function removeField(index: number) {
    const identity = draft.identity;
    change({
      ...draft, fields: draft.fields.filter((_, position) => position !== index),
      identity: identity === index ? null : identity !== null && identity > index ? identity - 1 : identity,
    });
  }

  function error(id: string) {
    return errors[id] && <span className="field-error" id={id + '-error'} aria-hidden="true">{errors[id]}</span>;
  }

  function invalid(id: string) {
    return { id, 'aria-invalid': !!errors[id] || undefined, 'aria-describedby': errors[id] ? id + '-error' : undefined };
  }

  return (
    <>
      <div className="profile-grid">
        <label>Record type
          <input {...invalid('record-type')} value={draft.recordType} required
            onChange={event => change({ ...draft, recordType: event.target.value })} />
          {error('record-type')}
        </label>
        <label>Identity field
          <select value={draft.identity ?? ''} onChange={event =>
            change({ ...draft, identity: event.target.value === '' ? null : Number(event.target.value) })}>
            <option value="">None</option>
            {draft.fields.map((field, index) =>
              <option key={index} value={index}>{field.name.trim() || `Field ${index + 1}`}</option>)}
          </select>
        </label>
      </div>
      <p className="muted">Configuration and record schema use version 1.</p>
      {web && <label>Collection mode
        <select value={search ? 'search' : 'document'} onChange={event => change({
          ...draft, search: event.target.value === 'search' ? emptySearch(origins[0] ?? '') : undefined,
        })}>
          <option value="document">Controlled document</option>
          <option value="search">Keyword search and detail pages</option>
        </select>
      </label>}
      {search && <div className="profile-grid">
        <label>Search origin
          <select {...invalid('search-origin')} value={search.origin} onChange={event => patchSearch({ origin: event.target.value })}>
            <option value="">Choose a registered origin</option>
            {origins.map(origin => <option key={origin} value={origin}>{origin}</option>)}
          </select>
          {error('search-origin')}
        </label>
        {([
          ['path', 'search-path', 'Search path'], ['keyword_parameter', 'keyword-parameter', 'Keyword parameter'],
          ['result_item_selector', 'search-result-selector', 'Search result item selector'],
          ['detail_link_selector', 'detail-link-selector', 'Detail link selector'],
        ] as const).map(([key, id, label]) => <label key={id}>{label}
          <input {...invalid(id)} value={search[key]} required onChange={event => patchSearch({ [key]: event.target.value })} />
          {error(id)}
        </label>)}
        <label>Maximum detail pages
          <input {...invalid('maximum-details')} type="number" min={1} max={10} required value={search.max_detail_pages || ''}
            onChange={event => patchSearch({ max_detail_pages: Number(event.target.value) })} />
          {error('maximum-details')}
        </label>
        <label>Maximum HTTP requests
          <input {...invalid('maximum-requests')} type="number" min={3} max={20} required value={search.max_requests || ''}
            onChange={event => patchSearch({ max_requests: Number(event.target.value) })} />
          {error('maximum-requests')}
        </label>
      </div>}
      {web && <div className="profile-grid">
        <label>Selector type
          <select value={draft.selectorType} onChange={event =>
            change({ ...draft, selectorType: event.target.value === 'xpath' ? 'xpath' : 'css' })}>
            {selectorTypes.map(type => <option key={type} value={type}>{type === 'css' ? 'CSS' : 'XPath'}</option>)}
          </select>
        </label>
        <label>{search ? 'Detail item selector' : 'Item selector'}
          <input {...invalid('item-selector')} value={draft.itemSelector} required
            onChange={event => change({ ...draft, itemSelector: event.target.value })} />
          {error('item-selector')}
        </label>
        <label>{search ? 'Search next-link selector (optional)' : 'Next-link selector (optional)'}
          <input {...invalid('next-link-selector')} value={draft.nextLinkSelector}
            onChange={event => change({ ...draft, nextLinkSelector: event.target.value })} />
          {error('next-link-selector')}
        </label>
        <label>{search ? 'Maximum search pages' : 'Maximum HTML pages'}
          <select value={draft.maxPages} disabled={!draft.nextLinkSelector.trim()}
            onChange={event => change({ ...draft, maxPages: Number(event.target.value) })}>
            {paginationLimits.map(limit => <option key={limit} value={limit}>{limit}</option>)}
          </select>
        </label>
      </div>}
      <h3>Output fields</h3>
      <div className="profile-fields">
        {draft.fields.map((field, index) => (
          <fieldset className="profile-field" key={index}>
            <legend>Field {index + 1}</legend>
            <div className="profile-grid">
              <label>Output field name
                <input {...invalid(`name-${index}`)} required value={field.name}
                  onChange={event => patchField(index, { name: event.target.value })} />
                {error(`name-${index}`)}
              </label>
              <label>Value type
                <select value={field.value_type} onChange={event =>
                  patchField(index, { value_type: valueTypes.find(type => type === event.target.value) ?? 'string' })}>
                  {valueTypes.map(type => <option key={type} value={type}>{type === 'number' ? 'Finite number' : type}</option>)}
                </select>
              </label>
              <label>{web ? 'Field selector' : 'CSV header'}
                <input {...invalid(`mapping-${index}`)} required value={field.mapping}
                  onChange={event => patchField(index, { mapping: event.target.value })} />
                {error(`mapping-${index}`)}
              </label>
              {web && <>
                <label>Field selector type
                  <select value={field.selectorType} onChange={event =>
                    patchField(index, { selectorType: selectorTypes.find(type => type === event.target.value) ?? '' })}>
                    <option value="">Use item selector type</option>
                    <option value="css">CSS</option><option value="xpath">XPath</option>
                  </select>
                </label>
                <label>Extraction mode
                  <select value={field.mode} onChange={event =>
                    patchField(index, { mode: event.target.value === 'attribute' ? 'attribute' : 'text' })}>
                    <option value="text">Text</option><option value="attribute">Attribute</option>
                  </select>
                </label>
                {field.mode === 'attribute' && <label>Attribute name
                  <input {...invalid(`attribute-${index}`)} required value={field.attribute}
                    onChange={event => patchField(index, { attribute: event.target.value })} />
                  {error(`attribute-${index}`)}
                </label>}
              </>}
            </div>
            <div className="profile-actions">
              <label className="check"><input type="checkbox" checked={field.required}
                onChange={event => patchField(index, { required: event.target.checked })} />Required field</label>
              {web && <label className="check"><input type="checkbox" checked={field.resolveUrl}
                onChange={event => patchField(index, { resolveUrl: event.target.checked })} />Resolve relative URLs</label>}
              {draft.fields.length > 1 && <button type="button" aria-label={`Remove field ${index + 1}`}
                onClick={() => removeField(index)}>Remove field</button>}
            </div>
          </fieldset>
        ))}
      </div>
      <button type="button" disabled={draft.fields.length >= 64}
        onClick={() => change({ ...draft, fields: [...draft.fields, emptyField()] })}>Add field</button>
    </>
  );
}
