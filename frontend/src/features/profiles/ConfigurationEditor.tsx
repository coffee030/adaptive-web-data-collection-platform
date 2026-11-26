import { emptyField, emptySearch } from './configuration';
import type { Draft } from './configuration';
import type { Adapter } from '../sources/api';
import { articleFields, paginationLimits, selectorTypes, valueTypes, type ArticleField, type KeywordSearch } from './api';

type Props = {
  draft: Draft; adapter: Adapter; origins: string[]; renderingOrigin: string | null; errors: Record<string, string>;
  change: (draft: Draft) => void;
};

export function ConfigurationEditor({ draft, adapter, origins, renderingOrigin, errors, change }: Props) {
  const web = adapter === 'web';
  const search = draft.search;
  const rendering = draft.rendering;
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
      article: draft.article && Object.fromEntries(Object.entries(draft.article)
        .filter(([, mapped]) => mapped !== index)
        .map(([field, mapped]) => [field, mapped > index ? mapped - 1 : mapped])),
    });
  }

  function error(id: string) {
    return errors[id] && <span className="field-error" id={id + '-error'} aria-hidden="true">{errors[id]}</span>;
  }

  function invalid(id: string) {
    return { id, 'aria-invalid': !!errors[id] || undefined, 'aria-describedby': errors[id] ? id + '-error' : undefined };
  }

  function setMode(mode: string) {
    change({
      ...draft,
      search: mode === 'search' ? emptySearch(origins[0] ?? '') : undefined,
      rendering: mode === 'rendered' ? { ready_selector: '', script_sha256: [], timeout_ms: 1500 } : undefined,
      article: undefined,
    });
  }

  return (
    <>
      <section className="operator-form-section" aria-labelledby="editor-record">
        <h3 id="editor-record">Record identity</h3>
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
      </section>
      {web && <section className="operator-form-section" aria-labelledby="editor-collection">
        <h3 id="editor-collection">Collection and selectors</h3>
        <label>Collection mode
          <select {...invalid('collection-mode')} value={rendering ? 'rendered' : search ? 'search' : 'document'} onChange={event => setMode(event.target.value)}>
            <option value="document">Controlled document</option>
            <option value="search">Keyword search and detail pages</option>
            {(renderingOrigin || rendering) && <option value="rendered" disabled={!renderingOrigin || !!draft.nextLinkSelector.trim()}>Rendered document</option>}
          </select>
          {error('collection-mode')}
        </label>
        {renderingOrigin && draft.nextLinkSelector.trim() && <p className="muted">Clear the next-link selector to use single-page rendering.</p>}
        {rendering && <div className="profile-form">
          {renderingOrigin && <p>Core runs reviewed inline scripts from <strong>{renderingOrigin}</strong> and waits for the ready element before extracting fields.</p>}
          <div className="profile-grid">
            <label>Ready element (CSS selector)<input {...invalid('render-ready')} required value={rendering.ready_selector} maxLength={1024}
              onChange={event => change({ ...draft, rendering: { ...rendering, ready_selector: event.target.value } })} />
              {error('render-ready')}</label>
            <label>Maximum wait (milliseconds)<input {...invalid('render-timeout')} type="number" min={250} max={5000} step={1} required
              value={rendering.timeout_ms || ''} onChange={event => change({ ...draft, rendering: { ...rendering, timeout_ms: Number(event.target.value) } })} />
              {error('render-timeout')}</label>
          </div>
          <label>Reviewed inline script SHA-256 hashes
            <textarea {...invalid('render-hashes')} rows={3} wrap="off" required spellCheck={false} autoCapitalize="none"
              aria-describedby={errors['render-hashes'] ? 'render-hash-help render-hashes-error' : 'render-hash-help'}
              value={rendering.script_sha256.join('\n')} onChange={event => change({ ...draft, rendering: { ...rendering, script_sha256: event.target.value.split('\n') } })} />
            {error('render-hashes')}</label>
          <p id="render-hash-help" className="muted">Enter one lowercase hash per line, up to eight. External scripts are blocked.</p>
        </div>}
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
        </div>}
        <div className="profile-grid">
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
        </div>
        {!rendering && <details className="profile-options">
          <summary>Pagination and request limits</summary>
          <div className="profile-grid">
            {search && <>
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
              <label>Request timeout (DNS and transfer)
                <select value={search.timeout_seconds ?? 2}
                  onChange={event => patchSearch({ timeout_seconds: Number(event.target.value) })}>
                  {[1, 2, 3, 4, 5].map(seconds => <option key={seconds} value={seconds}>
                    {seconds} {seconds === 1 ? 'second' : 'seconds'}
                  </option>)}
                </select>
              </label>
            </>}
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
          </div>
        </details>}
      </section>}
      <section className="operator-form-section" aria-labelledby="editor-fields">
        <h3 id="editor-fields">Output fields</h3>
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
      </section>
      {search && <details className="profile-options operator-form-section">
        <summary>Article mapping</summary>
        <div className="profile-form">
          <label className="check"><input type="checkbox" checked={!!draft.article}
            onChange={event => change({ ...draft, article: event.target.checked ? {} : undefined })} />Store article history</label>
          {draft.article && <>
            <p className="muted">Use a stable ID field when a detail page contains multiple records. URL identity is available for single-record detail pages.</p>
            <div className="profile-grid">
              {Object.entries(articleFields).map(([key, label]) => {
                const field = key as ArticleField;
                const id = `article-${key}`;
                return <label key={key}>{label}
                  <select {...invalid(id)} value={draft.article?.[field] ?? ''} onChange={event => {
                    const article = { ...draft.article };
                    if (event.target.value === '') delete article[field];
                    else article[field] = Number(event.target.value);
                    change({ ...draft, article });
                  }}>
                    <option value="">{field === 'title' ? 'Choose a required field' : field === 'canonical_url' ? 'Use detail URL' : 'Unmapped'}</option>
                    {draft.fields.map((item, index) => (item.value_type === 'string'
                      || (field === 'stable_id' && item.value_type === 'integer')) && (field !== 'title' || item.required)
                      ? <option key={index} value={index}>{item.name.trim() || `Field ${index + 1}`}</option> : null)}
                  </select>
                  {error(id)}
                </label>;
              })}
            </div>
          </>}
        </div>
      </details>}
    </>
  );
}
