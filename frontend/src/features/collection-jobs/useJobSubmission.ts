import { useCallback, useEffect, useRef, useState } from 'react';
import { useBeforeUnload, useNavigate } from 'react-router';
import { createJob, jobPath, type JobInput } from './api';
import { pendingJobSubmission, prepareJobSubmission, resolveJobSubmission, retainJobSubmission, submissionError } from './submission';

export function useJobSubmission(jobsSearch: string) {
  const navigate = useNavigate();
  const request = useRef<AbortController | null>(null);
  const [pending, setPending] = useState(false);
  const [recovery, setRecovery] = useState(pendingJobSubmission);
  const [problem, setProblem] = useState('');

  useEffect(() => () => request.current?.abort(), []);
  useBeforeUnload(useCallback(event => {
    if (pending || recovery.submission) event.preventDefault();
  }, [pending, recovery.submission]));

  async function send(input?: JobInput) {
    if (request.current) return;
    const previous = pendingJobSubmission();
    if ((previous.submission && input) || (!previous.submission && !input)) return;
    const controller = new AbortController();
    request.current = controller;
    setPending(true);
    setProblem('');
    let intent = previous.submission;
    try {
      if (input) intent = await prepareJobSubmission(input);
      controller.signal.throwIfAborted();
      if (!intent) {
        setProblem('A previous submission is still unconfirmed. Re-enter its original Source, Profile Version and input to reconcile it.');
        return;
      }
      retainJobSubmission(intent);
      const job = await createJob(intent.body, controller.signal);
      controller.signal.throwIfAborted();
      resolveJobSubmission(intent);
      void navigate(jobPath(job.job_id), { replace: true, state: { jobsSearch, jobConfirmed: true } });
    } catch (error) {
      if (controller.signal.aborted) return;
      if (!intent) {
        setProblem('Could not prepare a request key. Open the console on loopback or HTTPS and retry.');
      } else {
        const failure = submissionError(error);
        setProblem(failure.message);
        if (!failure.uncertain) resolveJobSubmission(intent);
      }
    } finally {
      request.current = null;
      if (!controller.signal.aborted) {
        setPending(false);
        setRecovery(pendingJobSubmission());
      }
    }
  }

  return { pending, recovery, locked: pending || !!recovery.submission, problem, send };
}
