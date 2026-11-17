import { ApiError } from '../../lib/api';
import { forgetRequestIntent, isUncertainWrite, prepareRequestIntent } from '../../lib/requestIntent';
import type { JobInput } from './api';

export interface Submission {
  body: JobInput & { request_key: string };
  storageKey?: string;
}

const outstandingKey = 'collection-job:unconfirmed';
let outstanding: Submission | undefined;

function storedFingerprint() {
  try { return sessionStorage.getItem(outstandingKey); }
  catch { return null; }
}

export function pendingJobSubmission() {
  return { submission: outstanding, requiresExactInput: !outstanding && !!storedFingerprint() };
}

export async function prepareJobSubmission(input: JobInput) {
  const fingerprint = storedFingerprint();
  const intent = await prepareRequestIntent('collection-job', input);
  if (fingerprint && intent.storageKey !== fingerprint) {
    forgetRequestIntent(intent);
    return undefined;
  }
  return intent;
}

export function retainJobSubmission(intent: Submission) {
  outstanding = intent;
  if (intent.storageKey) {
    try { sessionStorage.setItem(outstandingKey, intent.storageKey); }
    catch { /* The open workspace still holds the original submission in memory. */ }
  }
}

export function resolveJobSubmission(intent: Submission) {
  if (outstanding !== intent) return;
  outstanding = undefined;
  forgetRequestIntent(intent);
  try { sessionStorage.removeItem(outstandingKey); }
  catch { /* Storage may be unavailable for this tab. */ }
}

export function submissionError(error: unknown): { message: string; uncertain: boolean } {
  if (isUncertainWrite(error)) {
    const message = error instanceof ApiError && error.kind === 'timeout'
      ? 'The request timed out.' : 'The backend did not confirm the submission.';
    const detail = error instanceof ApiError && error.status
      ? ` The service returned HTTP ${error.status}.` : '';
    return { message: message + detail + ' Retry the original submission before changing the Source, Profile Version, or input.', uncertain: true };
  }
  if (!(error instanceof ApiError)) throw error;
  let message: string;
  switch (error.code) {
    case 'source_not_approved':
      message = 'Source access is no longer approved. Check the Source access policy.';
      break;
    case 'profile_not_approved':
      message = 'This Profile Version is no longer approved. Reload the available versions.';
      break;
    case 'destination_denied':
    case 'dataset_not_allowed':
      message = 'The input is outside the current Source policy. Reload the Source and review the input.';
      break;
    case 'job_request_conflict':
      message = 'This request key already belongs to a different submission. Check Collection Jobs before trying again.';
      break;
    default:
      message = error.status === 422 ? 'The backend rejected the input. Check the selected version and input.'
        : error.status === 404 ? 'The Source or Profile Version is unavailable. Reload the available options.'
        : error.status === 409 ? 'The current Source or Profile Version conflicts with this submission.'
        : error.status === 413 ? 'The submitted content exceeds the server request limit.'
        : 'The backend rejected this submission. Review the Source, version and input.';
  }
  return { message: `${message} (HTTP ${error.status})`, uncertain: false };
}
