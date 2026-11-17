import { Link, useLocation } from 'react-router';
import { Loading, Pagination, RequestProblem, Status } from '../../components/feedback';
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
  const { offset, changePage } = useResultPage();
  const { search } = useLocation();
  useResultReturn(result.state === 'ready');

  return (
    <>
      <div className="page-heading detail-heading">
        <h1>Sources</h1>
        <div className="profile-actions">
          <Link className="control" to={topicsPath}>Categories and topics</Link>
          <OperatorLink className="control primary" id="source-registration" to={sourcesPath + '/new'}
            state={{ sourcesSearch: search }}>Create source</OperatorLink>
        </div>
      </div>
      <section className="panel operator-sheet" aria-labelledby="catalog-heading">
        <div className="panel-heading"><h2 id="catalog-heading">Registered sources</h2>
          {result.state === 'ready' && <span className="muted">{result.data.length} registered</span>}
        </div>
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
            <table className="operator-ledger source-ledger" role="table">
              <caption className="sr-only">Registered sources</caption>
              <thead role="rowgroup"><tr role="row">
                <th scope="col">Source</th><th scope="col">Access authorization</th>
                <th scope="col">Permission reference</th><th scope="col">Next step</th>
              </tr></thead>
              <tbody role="rowgroup">
                {result.data.slice(offset, offset + pageSize).map(source => (
                  <tr key={source.source_id} role="row">
                    <th scope="row" role="rowheader">
                      <OperatorLink id={'source-' + source.source_id} to={sourcePath(source.source_id)}
                        state={{ sourcesSearch: search }}>{source.source_name}</OperatorLink>
                      <small>{adapterLabels[source.adapter_type]}</small>
                    </th>
                    <td role="cell" data-label="Access authorization"><Status value={source.approval_status} /></td>
                    <td role="cell" data-label="Permission reference">{source.permission_reference || 'Not recorded'}</td>
                    <td role="cell" data-label="Next step">{next[source.approval_status]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination label="Sources" offset={offset} size={pageSize}
              loaded={Math.max(0, result.data.length - offset)} change={changePage} />
          </>
        ))}
      </section>
    </>
  );
}
