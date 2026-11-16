import { useCallback, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router';
import { Status, TableRegion, Timestamp } from '../../components/feedback';
import { apiGet, apiPost, apiPut } from '../../lib/api';
import { useResource } from '../../lib/useResource';
import { profilePath } from '../profiles/api';
import { listSources, listVersions, sourcesPath } from '../sources/api';
import { bindingsPath, listCategories, listTopics, topicsPath, type Binding, type Category, type Topic } from './api';
import { ActionFeedback, Page, Resource, useAction } from './support';

export function TopicCatalog() {
  const [revision, setRevision] = useState(0);
  const categories = useResource(listCategories, revision, true);
  const topics = useResource(listTopics, revision, true);
  function reload() { setRevision(value => value + 1); }
  return <>
    <nav className="breadcrumb" aria-label="Breadcrumb"><Link to={sourcesPath}>Sources</Link></nav>
    <div className="page-heading"><h1>Categories and topics</h1></div>
    <Resource label="categories" state={categories}>{categoryRows => <>
      <CatalogForm items={categoryRows} label="Category" path="/categories" reload={reload} />
      <Resource label="topics" state={topics}>{topicRows =>
        <CatalogForm items={topicRows} label="Topic" path={topicsPath} reload={reload} categories={categoryRows} />
      }</Resource>
    </>}</Resource>
  </>;
}

function CatalogForm({ items, label, path, reload, categories }: {
  items: (Category | Topic)[]; label: 'Category' | 'Topic'; path: string; reload: () => void;
  categories?: Category[];
}) {
  const [selected, setSelected] = useState<Category | Topic>();
  const [name, setName] = useState('');
  const [active, setActive] = useState(true);
  const [categoryId, setCategoryId] = useState('');
  const action = useAction();
  const lower = label.toLowerCase();

  function choose(value: string) {
    const item = items.find(row => row.id === value);
    setSelected(item);
    setName(item?.name ?? '');
    setActive(item?.active ?? true);
    setCategoryId(item && 'category_id' in item ? item.category_id : '');
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    const data = { name: name.trim(), active };
    void action.run(
      signal => selected ? apiPut<Category | Topic>(`${path}/${selected.id}`, data, signal)
        : apiPost<Category | Topic>(path, categories ? { ...data, category_id: categoryId } : data, signal),
      row => { setSelected(row); setName(row.name); setActive(row.active); reload(); },
      selected ? `${label} updated.` : `${label} created.`,
    );
  }

  return <section className="panel detail-panel" aria-labelledby={`manage-${lower}`}>
    <div className="panel-heading"><h2 id={`manage-${lower}`}>{categories ? 'Topics' : 'Categories'}</h2></div>
    <form className="profile-body" onSubmit={submit}>
      <fieldset className="profile-form" disabled={action.busy}>
        <label>{label} to manage
          <select value={selected?.id ?? ''} onChange={event => choose(event.target.value)}>
            <option value="">Create a new {lower}</option>
            {items.map(item => {
              const category = 'category_id' in item ? categories?.find(row => row.id === item.category_id) : undefined;
              return <option key={item.id} value={item.id}>
                {category ? `${category.name} / ` : ''}{item.name}{item.active ? '' : ' (inactive)'}
              </option>;
            })}
          </select>
        </label>
        {categories && !selected && <label>Parent category
          <select required value={categoryId} onChange={event => setCategoryId(event.target.value)}>
            <option value="">Select a category</option>
            {categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}
          </select>
        </label>}
        <label>{label} name
          <input required maxLength={128} value={name} onChange={event => setName(event.target.value)} />
        </label>
        <label className="check">
          <input type="checkbox" checked={active} onChange={event => setActive(event.target.checked)} />
          Active {lower}
        </label>
        <div className="profile-actions">
          <button type="submit" className="primary" disabled={!name.trim() || (!!categories && !selected && !categoryId)}>
            {selected ? 'Save' : 'Create'} {lower}
          </button>
          {categories && selected && <Link to={`${topicsPath}/${selected.id}`}>Manage approved bindings</Link>}
        </div>
      </fieldset>
      <ActionFeedback action={action} />
    </form>
  </section>;
}

export function TopicBindings() {
  const { topicId = '' } = useParams();
  return <BindingWorkspace key={topicId} topicId={topicId} />;
}

function BindingWorkspace({ topicId }: { topicId: string }) {
  const localOperator = __LOCAL_PROFILE_APPROVAL__ && window.location.protocol === 'http:'
    && window.location.hostname === '127.0.0.1';
  const load = useCallback((signal: AbortSignal) => apiGet<Topic>(`${topicsPath}/${encodeURIComponent(topicId)}`, signal), [topicId]);
  const topic = useResource(load);
  const sources = useResource(listSources, 0, false, localOperator);
  const [sourceId, setSource] = useState('');
  const [profileId, setProfile] = useState('');
  const [operator, setOperator] = useState('');
  const [revision, setRevision] = useState(0);
  const action = useAction();
  const loadVersions = useCallback((signal: AbortSignal) => listVersions(sourceId, signal), [sourceId]);
  const profiles = useResource(loadVersions, 0, false, !!sourceId);
  const path = bindingsPath(topicId);

  function changeBinding(actionPath: string, body: object, confirmation: string) {
    void action.run(signal => apiPost<Binding>(actionPath, body, signal),
      () => setRevision(value => value + 1), confirmation);
  }

  return <>
    <nav className="breadcrumb" aria-label="Breadcrumb"><Link to={topicsPath}>Categories and topics</Link></nav>
    <Resource label="topic" state={topic}>{item => <>
      <div className="page-heading collection-text"><h1>{item.name}</h1></div>
      <section className="panel detail-panel" aria-labelledby="approve-binding">
        <div className="panel-heading"><h2 id="approve-binding">Approve a source binding</h2></div>
        {!localOperator ? <p className="notice muted">Binding changes require local operator approval mode.</p>
          : <form className="profile-body" onSubmit={event => {
          event.preventDefault();
          if (sourceId && profileId && operator.trim()) changeBinding(path, {
            source_id: sourceId, profile_version_id: profileId, approved_by: operator.trim(),
          }, 'Binding approved.');
        }}>
          <fieldset className="profile-form" disabled={action.busy}>
            <Resource label="authorized sources" state={sources}>{rows => <label>Authorized source
              <select required value={sourceId} onChange={event => { setSource(event.target.value); setProfile(''); }}>
                <option value="">Select a source</option>
                {rows.filter(row => row.adapter_type === 'web' && row.approval_status === 'approved')
                  .map(row => <option key={row.source_id} value={row.source_id}>{row.source_name}</option>)}
              </select>
            </label>}</Resource>
            {sourceId && <Resource label="approved profiles" state={profiles}>{rows => <label>Approved keyword profile
              <select required value={profileId} onChange={event => setProfile(event.target.value)}>
                <option value="">Select a profile version</option>
                {rows.filter(row => row.approval_status === 'approved' &&
                  row.configuration.adapter_type === 'web' && row.configuration.search)
                  .map(row => <option key={row.profile_version_id} value={row.profile_version_id}>Version {row.version}</option>)}
              </select>
            </label>}</Resource>}
            <label>Operator name
              <input required maxLength={128} value={operator} onChange={event => setOperator(event.target.value)} />
            </label>
            <div><button className="primary" type="submit" disabled={!sourceId || !profileId || !operator.trim()}>
              Approve binding
            </button></div>
          </fieldset>
          <ActionFeedback action={action} />
        </form>}
      </section>
      <section className="panel detail-panel" aria-labelledby="binding-list">
        <div className="panel-heading"><h2 id="binding-list">Source bindings</h2></div>
        <Page<Binding> label="Bindings" path={path} revision={revision} empty="This topic has no approved bindings.">
          {rows => <TableRegion label="Topic source bindings">
            <table>
              <thead><tr><th scope="col">Source and profile</th><th scope="col">Approval (UTC)</th>
                <th scope="col">Eligibility</th><th scope="col">Action</th></tr></thead>
              <tbody>{rows.map(row => <tr key={row.id}>
                <th scope="row"><Link to={profilePath(row.source_id, row.profile_version_id)}>
                  {row.source_name} · Version {row.profile_version}
                </Link></th>
                <td>{row.approved_by} <Timestamp value={row.approved_at} /></td>
                <td><Status value={row.eligible ? 'eligible' : row.disabled_at ? 'disabled' : 'unavailable'} /></td>
                <td>{!localOperator ? '—' : row.disabled_at ? <button type="button" disabled={action.busy || !operator.trim()}
                  onClick={() => changeBinding(`${path}/${row.id}/approve`, { approved_by: operator.trim() }, 'Binding approved.')}>
                  Approve again
                </button> : <button type="button" disabled={action.busy}
                  onClick={() => changeBinding(`${path}/${row.id}/disable`, {}, 'Binding disabled.')}>Disable binding</button>}</td>
              </tr>)}</tbody>
            </table>
          </TableRegion>}
        </Page>
      </section>
    </>}</Resource>
  </>;
}
