import { Link, useLocation } from 'react-router';
import { Loading, Pagination, RequestProblem, Status, TableRegion } from '../../components/feedback';
import { useResource } from '../../lib/useResource';
import { adapterLabels, listSources, sourcePath, sourcesPath } from './api';
import { useResultPage } from '../results/useResultPage';
import { topicsPath } from '../topic-collections/api';

const pageSize = 20;

export function SourceList() {
  const { result, retry } = useResource(listSources);
  const { offset, changePage } = useResultPage();
  const { search } = useLocation();

  return (
    <>
      <div className="page-heading detail-heading">
        <h1>Sources</h1>
        <div className="profile-actions">
          <Link className="control" to={topicsPath}>Categories and topics</Link>
          <Link className="control primary" to={sourcesPath + '/new'}>Create source</Link>
        </div>
      </div>
      <section className="panel" aria-label="Registered sources">
        {result.state === 'loading' && <Loading>Loading sources…</Loading>}
        {result.state === 'error' && <RequestProblem error={result.error} resource="sources" retry={retry} />}
        {result.state === 'ready' && (result.data.length <= offset ? (
          <div className="notice" role="status">
            <strong>{offset ? 'This page is empty' : 'No sources registered'}</strong>
            <p>{offset ? 'Return to the previous page.' : 'Create a source to register its permission reference and allowed inputs.'}</p>
            {offset > 0 && <Pagination label="Sources" offset={offset} size={pageSize} loaded={0} change={changePage} />}
          </div>
        ) : (
          <>
            <TableRegion label="Registered sources table, scroll horizontally for more columns">
              <table className="sources-table">
                <caption className="sr-only">Registered sources</caption>
                <thead><tr>
                  <th scope="col">Source</th><th scope="col">Access authorization</th>
                  <th scope="col">Adapter</th><th scope="col">Permission reference</th>
                </tr></thead>
                <tbody>
                  {result.data.slice(offset, offset + pageSize).map(source => (
                    <tr key={source.source_id}>
                      <th scope="row">
                        <Link to={sourcePath(source.source_id)} state={{ sourcesSearch: search }}>{source.source_name}</Link>
                        <div className="identifier muted">{source.source_id}</div>
                      </th>
                      <td><Status value={source.approval_status} /></td>
                      <td>{adapterLabels[source.adapter_type]}</td>
                      <td>{source.permission_reference || 'Not recorded'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableRegion>
            <Pagination label="Sources" offset={offset} size={pageSize}
              loaded={Math.max(0, result.data.length - offset)} change={changePage} />
          </>
        ))}
      </section>
    </>
  );
}
