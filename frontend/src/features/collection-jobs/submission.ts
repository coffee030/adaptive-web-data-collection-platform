import { ApiError } from '../../lib/api';
import { isUncertainWrite } from '../../lib/requestIntent';
import type { JobInput } from './api';

export interface Submission {
  body: JobInput & { request_key: string };
  storageKey?: string;
}

export function submissionError(error: unknown): { message: string; uncertain: boolean } {
  if (isUncertainWrite(error)) {
    const message = error instanceof ApiError && error.kind === 'timeout'
      ? 'The request timed out.' : 'The backend did not confirm the submission.';
    const detail = error instanceof ApiError && error.status
      ? ` The service returned HTTP ${error.status}.` : '';
    return { message: message + detail + ' Retry this submission to check for the original Job.', uncertain: true };
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
