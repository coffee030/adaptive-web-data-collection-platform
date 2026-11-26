import { Link } from 'react-router';
import { Loading, Pagination, RequestProblem, Status } from '../../components/feedback';
import { PageHeader, Panel } from '../../components/studio/Workspace';
import { useResource } from '../../lib/useResource';
import { adapterLabels, listSources, sourcePath, sourcesPath } from './api';
import { useResultPage } from '../results/useResultPage';
import { topicsPath } from '../topic-collections/api';
import { useResultReturn } from '../results/resultNavigation';
import { OperatorLink } from '../operator/navigation';

const pageSize = 20;
const next = { pending: 'Review access policy', approved: 'View profile versions', revoked: 'Review revoked access' };

export function SourceList() {
  const { result, retry } = useResource(listSources);
  const { search, setSearch, offset, changePage } = useResultPage();
  const sourcesSearch = search.size ? '?' + search.toString() : '';
  const text = search.get('q') ?? '';
  const approval = search.get('authorization') ?? '';
  const needle = text.trim().toLocaleLowerCase();
  const filtered = result.state === 'ready' ? result.data.filter(source =>
    (!approval || source.approval_status === approval) && (!needle || source.source_name.toLocaleLowerCase().includes(needle))) : [];
  useResultReturn(result.state === 'ready');

  function filter(key: string, value: string) {
    const params = new URLSearchParams(search);
    if (value) params.set(key,value); else params.delete(key);
    params.delete('offset'); setSearch(params,{replace:true,preventScrollReset:true});
  }

  return <div className="ops-source-catalog">
    <PageHeader title="Sources" description="Review a source’s permissions, approved mappings and collection policy."
      actions={<><Link className="studio-secondary" to={topicsPath}>Categories and topics</Link>
        <OperatorLink className="studio-primary" id="source-registration" to={sourcesPath + '/new'}
          state={{sourcesSearch}}>Create source</OperatorLink></>}/>
    <Panel title="Registered sources" actions={result.state === 'ready' && <span className="muted">{result.data.length} registered</span>}>
      <div className="ops-source-filters">
        <div><label htmlFor="ops-source-name">Source name</label><input id="ops-source-name" type="search" autoComplete="off" maxLength={128} value={text} onChange={event => filter('q',event.target.value)}/></div>
        <div><label htmlFor="ops-source-approval">Authorization</label><select id="ops-source-approval" value={approval} onChange={event => filter('authorization',event.target.value)}>
          <option value="">All authorizations</option><option value="approved">Approved</option>
          <option value="pending">Pending</option><option value="revoked">Revoked</option>
        </select></div>
      </div>
      {result.state === 'loading' && <Loading>Loading sources…</Loading>}
      {result.state === 'error' && <RequestProblem error={result.error} resource="sources" retry={retry}/>}
      {result.state === 'ready' && (filtered.length <= offset ? <div className="notice" role="status">
        <strong>{offset ? 'This page is empty' : result.data.length ? 'No matching sources' : 'No sources registered'}</strong>
        <p>{offset ? 'Return to the previous page.' : result.data.length ? 'Try a different name or authorization filter.'
          : 'Create a source to register its permission reference and allowed inputs.'}</p>
        {offset > 0 && <Pagination label="Sources" offset={offset} size={pageSize} loaded={0} change={changePage}/>}
      </div> : <>
        {(needle || approval) && <p className="ops-match-count" role="status">{filtered.length} matching {filtered.length === 1 ? 'source' : 'sources'}</p>}
        <table className="studio-table studio-panel-table operator-ledger source-ledger" role="table">
          <caption className="sr-only">Registered sources</caption><thead role="rowgroup"><tr role="row">
            <th scope="col">Source</th><th scope="col">Access authorization</th><th scope="col">Permission reference</th><th scope="col">Next step</th>
          </tr></thead>
          <tbody role="rowgroup">{filtered.slice(offset,offset + pageSize).map(source =>
            <tr key={source.source_id} role="row"><th scope="row" role="rowheader">
              <OperatorLink id={'source-' + source.source_id} to={sourcePath(source.source_id)} state={{sourcesSearch}}>{source.source_name}</OperatorLink>
              <small>{adapterLabels[source.adapter_type]}</small></th>
              <td role="cell" data-label="Access authorization"><Status value={source.approval_status}/></td>
              <td role="cell" data-label="Permission reference">{source.permission_reference || 'Not recorded'}</td>
              <td role="cell" data-label="Next step">{next[source.approval_status]}</td>
            </tr>)}</tbody>
        </table>
        <Pagination label="Sources" offset={offset} size={pageSize} loaded={Math.max(0,filtered.length - offset)} change={changePage}/>
      </>)}
    </Panel>
  </div>;
}
