import { useCallback, useEffect, useRef, useState, type FormEvent, type MouseEvent } from 'react';
import { useLocation, useSearchParams } from 'react-router';
import { Status } from '../../components/feedback';
import { ApiError, apiGet, apiPost, apiPut } from '../../lib/api';
import { isUncertainWrite } from '../../lib/requestIntent';
import { useResource } from '../../lib/useResource';
import { OperatorLink, OperatorReturn } from '../operator/navigation';
import { readId, readOffset, rememberPosition, resultId, useResultReturn } from '../results/resultNavigation';
import { profilePath } from '../profiles/api';
import { sourcesPath } from '../sources/api';
import { categoriesPath, topicsPath, type Category, type Topic } from './api';
import { ActionFeedback, Page, Resource, useAction } from './support';

type CatalogEditor = { kind: 'category' | 'topic'; item?: Category | Topic; parent?: Category };
type CatalogValues = Pick<Category, 'name' | 'active'>;
const topicPath = (id: string) => topicsPath + '/' + encodeURIComponent(id);

export function TopicCatalog() {
  const { state, key } = useLocation();
  const [search, setSearch] = useSearchParams();
  const categoryId = readId(search, 'category_id');
  const profileSource = resultId(state?.profileSourceId ?? null);
  const profileVersion = resultId(state?.profileVersionId ?? null);
  const [revision, setRevision] = useState(0);
  const [editor, setEditor] = useState<CatalogEditor>();
  const editTrigger = useRef<HTMLElement | null>(null);
  const topicsHeading = useRef<HTMLHeadingElement>(null);
  const focusTopics = useRef('');
  const loadCategory = useCallback((signal: AbortSignal) =>
    apiGet<Category>(categoriesPath + '/' + categoryId, signal), [categoryId]);
  const category = useResource(loadCategory, revision, false, !!categoryId);
  const currentEditor = editor?.kind === 'topic' && editor.parent?.id !== categoryId ? undefined : editor;
  useResultReturn(!categoryId || category.result.state === 'ready');
  useEffect(() => {
    if (category.result.state === 'ready' && focusTopics.current === categoryId && topicsHeading.current) {
      focusTopics.current = '';
      topicsHeading.current.focus();
    }
  }, [categoryId, category.result.state]);

  function changeSearch(values: Record<string, string | number>) {
    const next = new URLSearchParams(search);
    for (const [key, value] of Object.entries(values)) {
      if (value) next.set(key, String(value));
      else next.delete(key);
    }
    setSearch(next, { state: { profileSourceId: profileSource, profileVersionId: profileVersion } });
  }

  function openEditor(event: MouseEvent<HTMLButtonElement>, next: CatalogEditor) {
    editTrigger.current = event.currentTarget;
    setEditor(next);
  }

  function dismissEditor() {
    setEditor(undefined);
    requestAnimationFrame(() => editTrigger.current?.focus());
  }

  function saved(row: Category | Topic, kind: CatalogEditor['kind']) {
    setRevision(value => value + 1);
    if (kind === 'category' && row.id !== categoryId) changeSearch({ category_id: row.id, topic_offset: 0 });
    setEditor(previous => previous && { ...previous, item: row });
  }

  return <>
    <nav className="breadcrumb" aria-label="Breadcrumb">
      {profileSource && profileVersion
        ? <OperatorReturn to={profilePath(profileSource, profileVersion)}>Profile version</OperatorReturn>
        : <OperatorReturn to={sourcesPath}>Sources</OperatorReturn>}
    </nav>
    <div className="page-heading operator-title"><h1>Categories and topics</h1>
      <p>Choose a category to manage its topics. Each topic has its own approved Source Bindings.</p>
    </div>
    <div className="catalog-workspace">
      <section className="panel operator-sheet" aria-labelledby="manage-categories">
        <div className="panel-heading"><h2 id="manage-categories">Categories</h2>
          <button type="button" onClick={event => openEditor(event, { kind: 'category' })}>New category</button>
        </div>
        <Page<Category> path={categoriesPath} label="Categories" revision={revision} empty="No categories on this page."
          paging={{ offset: readOffset(search, 'category_offset'), change: offset => changeSearch({ category_offset: offset }) }}>
          {items => <ul className="catalog-list">{items.map(item => <li key={item.id} data-selected={item.id === categoryId}>
            <div>
              <button type="button" className="catalog-select" id={'category-' + item.id} aria-pressed={item.id === categoryId} onClick={event => {
                if (item.id === categoryId) return;
                rememberPosition(key, event.currentTarget.id);
                if (window.matchMedia('(max-width: 785px)').matches) focusTopics.current = item.id;
                setEditor(undefined);
                changeSearch({ category_id: item.id, topic_offset: 0 });
              }}>{item.name}</button>
              <div className="muted">{item.active ? 'Active' : 'Inactive'}</div>
            </div>
            <button type="button" onClick={event => openEditor(event, { kind: 'category', item })}
              aria-label={`Edit category ${item.name}`}>Edit</button>
          </li>)}</ul>}
        </Page>
        {currentEditor?.kind === 'category' && <CatalogForm editor={currentEditor}
          close={dismissEditor} saved={saved} refresh={() => setRevision(value => value + 1)} />}
      </section>
      <section className="panel operator-sheet" aria-label="Topics">
        {categoryId ? <Resource label="selected category" state={category}>{parent => <>
          <div className="panel-heading"><div><h2 ref={topicsHeading} tabIndex={-1}>Topics in {parent.name}</h2>
            {!parent.active && <p className="muted">Inactive category · Topics unavailable for future collection</p>}
          </div>
            <button type="button" onClick={event => openEditor(event, { kind: 'topic', parent })}>New topic</button>
          </div>
          <Page<Topic> key={parent.id} path={topicsPath} filters={{ category_id: parent.id }} label="Topics" revision={revision}
            empty="No topics on this page." paging={{ offset: readOffset(search, 'topic_offset'),
              change: offset => changeSearch({ topic_offset: offset }) }}>
            {items => <ul className="catalog-list">{items.map(item => <li key={item.id}>
              <div>
                <strong>{item.name}</strong>
                <div className="muted">{item.active ? 'Active' : 'Inactive'}</div>
              </div>
              <div className="profile-actions">
                <button type="button" onClick={event => openEditor(event, { kind: 'topic', item, parent })}
                  aria-label={`Edit topic ${item.name}`}>Edit</button>
                <OperatorLink id={'topic-' + item.id} to={topicPath(item.id)} state={{
                  catalogSearch: search.toString(), profileSourceId: profileSource, profileVersionId: profileVersion,
                }}
                  aria-label={`Manage approved bindings for ${item.name}`}>Manage approved bindings</OperatorLink>
              </div>
            </li>)}</ul>}
          </Page>
        </>}</Resource> : <>
          <div className="panel-heading"><h2 id="manage-topics">Topics</h2></div>
          <p className="notice muted">Select a category to view or create its topics.</p>
        </>}
        {currentEditor?.kind === 'topic' && <CatalogForm editor={currentEditor} close={dismissEditor}
          saved={saved} refresh={() => setRevision(value => value + 1)} />}
      </section>
    </div>
  </>;
}

function CatalogForm({ editor, close, saved, refresh }: {
  editor: CatalogEditor; close: () => void; saved: (row: Category | Topic, kind: CatalogEditor['kind']) => void;
  refresh: () => void;
}) {
  const { item, kind, parent } = editor;
  const path = kind === 'category' ? categoriesPath : topicsPath;
  const [name, setName] = useState(item?.name ?? '');
  const [active, setActive] = useState(item?.active ?? true);
  const [latest, setLatest] = useState<CatalogValues>();
  const [uncertain, setUncertain] = useState(false);
  const nameField = useRef<HTMLInputElement>(null);
  const action = useAction(error => {
    if (isUncertainWrite(error)) return 'The save could not be confirmed. Check the refreshed catalog before opening another editor.';
    if (error instanceof ApiError) {
      if (error.code === 'catalog_changed') return 'This item changed since you opened it. Review the current values before saving.';
      if (error.code === 'duplicate_catalog_name') return 'This name is already in use.';
      if (error.code === 'category_not_found') return 'The parent category could not be found. Choose a current category.';
      if (error.status === 404) return 'This item could not be found. Refresh the catalog.';
      if (error.status === 422 || error.status === 400) return 'Check the name and active state, then try again.';
    }
    return 'The server declined this change. Check the catalog and try again.';
  });

  useEffect(() => {
    setName(item?.name ?? '');
    setActive(item?.active ?? true);
    setLatest(undefined);
    setUncertain(false);
  }, [item]);
  useEffect(() => { nameField.current?.focus(); }, [kind, item?.id]);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (action.busy || uncertain || latest || !name.trim()) return;
    const values = { name: name.trim(), active };
    void action.run(async signal => {
      try {
        if (!item) return await apiPost<Category | Topic>(path, parent ? { ...values, category_id: parent.id } : values, signal);
        const current = await apiGet<Category | Topic>(path + '/' + item.id, signal);
        if (current.name !== item.name || current.active !== item.active) {
          setLatest(current);
          refresh();
          throw new ApiError('http', 409, 'catalog_changed');
        }
        return await apiPut<Category | Topic>(path + '/' + item.id, values, signal);
      } catch (error) {
        if (!signal.aborted && (isUncertainWrite(error) || (error instanceof ApiError && error.status === 404))) {
          setUncertain(true);
          refresh();
        }
        throw error;
      }
    }, row => saved(row, kind), `${kind === 'category' ? 'Category' : 'Topic'} ${item ? 'updated' : 'created'}.`);
  }

  return <form className="profile-body catalog-editor" onSubmit={submit}>
    <fieldset className="profile-form" disabled={action.busy}>
      <legend>{item ? 'Edit' : 'New'} {kind}</legend>
      {parent && <p className="muted">Parent category · {parent.name}</p>}
      <label>{kind === 'category' ? 'Category' : 'Topic'} name
        <input ref={nameField} required maxLength={128} value={name} onChange={event => setName(event.target.value)} />
      </label>
      <label className="check"><input type="checkbox" checked={active}
        onChange={event => setActive(event.target.checked)} />Active {kind}</label>
      <p className="muted">{kind === 'category' ? 'Deactivating the category makes its topics unavailable for future collection.'
        : 'Deactivating the topic makes its bindings unavailable for future collection.'} Past requests remain in collection history.</p>
      <div className="profile-actions">
        <button type="submit" className="primary" disabled={!name.trim() || uncertain || !!latest}>
          {item ? 'Save' : 'Create'} {kind}
        </button>
        <button type="button" onClick={close}>Close editor</button>
      </div>
    </fieldset>
    <ActionFeedback action={action} />
    {latest && <p className="notice">Current server values: {latest.name} · {latest.active ? 'Active' : 'Inactive'}. Reopen the item to load these values.</p>}
  </form>;
}
