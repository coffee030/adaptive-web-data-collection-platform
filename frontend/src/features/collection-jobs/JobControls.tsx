import { useEffect, useRef, useState } from 'react';
import { ApiError } from '../../lib/api';
import { ActionFeedback, useAction } from '../topic-collections/support';
import { controlJob, jobAwaitingOutcome, type CollectionJob, type JobAction } from './api';

const confirmations: Record<JobAction, string> = {
  pause: 'Pause confirmed.',
  resume: 'Resume confirmed.',
  cancel: 'Cancellation confirmed.',
};

export function JobControls({ job, refresh }: { job: CollectionJob; refresh: () => void }) {
  const canControl = jobAwaitingOutcome(job.status);
  const held = job.status === 'pausing' || job.status === 'paused';
  const [confirming, setConfirming] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const keep = useRef<HTMLButtonElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const action = useAction(error => error instanceof ApiError && error.code === 'invalid_job_transition'
    ? 'The job changed while you were reviewing it. Check its latest status.'
    : 'The change could not be confirmed. Check this job and try again.', job.job_id);

  useEffect(() => {
    if (confirming) keep.current?.focus();
  }, [confirming]);

  function submit(command: JobAction) {
    void action.run(signal => controlJob(job.job_id, command, signal).catch(error => {
      if (error instanceof ApiError && error.code === 'invalid_job_transition') refresh();
      throw error;
    }), () => {
      heading.current?.focus();
      setConfirming(false);
      refresh();
    }, confirmations[command]);
  }

  if (!canControl && !action.busy && !action.notice && !action.error) return null;
  return <section className="job-controls" aria-labelledby="job-control-title">
    <h3 id="job-control-title" ref={heading} tabIndex={-1}>Job controls</h3>
    {canControl && <div className="profile-actions">
      <button type="button" disabled={action.busy || confirming} onClick={() => submit(held ? 'resume' : 'pause')}>
        {held ? 'Resume job' : 'Pause job'}
      </button>
      <button ref={cancel} type="button" disabled={action.busy} aria-expanded={confirming}
        onClick={() => { action.clearError(); setConfirming(true); }}>Cancel job</button>
    </div>}
    {canControl && confirming && <div role="group" aria-label="Confirm cancellation" className="job-control-confirmation">
      <p>Cancel this job? Published results stay available. New attempts stop.</p>
      <div className="profile-actions">
        <button ref={keep} type="button" disabled={action.busy} onClick={() => {
          setConfirming(false);
          cancel.current?.focus();
        }}>Keep job</button>
        <button type="button" disabled={action.busy} onClick={() => submit('cancel')}>Confirm cancellation</button>
      </div>
    </div>}
    <ActionFeedback action={action} pending="Updating the job…" />
  </section>;
}

