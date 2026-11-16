import { apiAttachment } from '../../lib/api';
import { jobPath } from '../collection-jobs/api';
import { requestPath } from '../topic-collections/api';
import { ActionFeedback, useAction } from '../topic-collections/support';

const formats = [
  { extension: 'csv', label: 'CSV', type: 'text/csv' },
  { extension: 'json', label: 'JSON', type: 'application/json' },
] as const;

export function RecordExport({ scope, id, pending }: {
  scope: 'job' | 'request'; id: string; pending: boolean;
}) {
  const action = useAction('Could not download records. Check the connection and try again.', scope + ':' + id);
  const path = scope === 'job' ? jobPath(id) : requestPath(id);

  function download({ extension, type }: (typeof formats)[number]) {
    void action.run(signal => apiAttachment(`${path}/records/export?format=${extension}`, signal, type), blob => {
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${scope}-${id}-records.${extension}`;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    });
  }

  return <section className="panel detail-panel" aria-labelledby="record-export-title">
    <div className="panel-heading">
      <h2 id="record-export-title">Download validated records</h2>
      <div className="profile-actions">
        {formats.map(format => <button key={format.extension} type="button" disabled={pending || action.busy}
          onClick={() => download(format)}>Download {format.label}</button>)}
      </div>
    </div>
    <p className="export-scope muted">Includes all published records from this {scope === 'job' ? 'job' : 'collection request'}, with every persisted field.</p>
    {pending && <p className="notice muted">Downloads are available after the jobs in this collection finish.</p>}
    {(action.busy || action.error) && <div className="notice">
      <ActionFeedback action={action} pending="Preparing download…" />
    </div>}
  </section>;
}
