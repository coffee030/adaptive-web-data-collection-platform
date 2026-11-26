import { useCatalogRevision } from './CatalogUpdates';
import { useCallback, useEffect } from 'react';
import { useResource } from '../../lib/useResource';
import { campaignExpiry, runCampaign, type CampaignRequest, type DataMode } from './intelligence';
import { useMarketing } from './workspace';

export function useEvaluation(mode: DataMode) {
  const { draft, setDraft } = useMarketing();
  const request = draft.evaluation;
  const load = useCallback((signal: AbortSignal) => runCampaign(mode, request!, signal), [mode, request]);
  const { result, retry } = useResource(load, useCatalogRevision(), false, Boolean(request));
  const report = result.state === 'ready' ? result.data : undefined;
  const expiry = report && campaignExpiry(report);

  useEffect(() => {
    if (!request) return;
    window.addEventListener('focus', retry);
    return () => window.removeEventListener('focus', retry);
  }, [request, retry]);

  useEffect(() => {
    if (expiry === undefined) return;
    const timer = window.setTimeout(retry, Math.min(2_000_000_000, Math.max(0, expiry - Date.now())));
    return () => clearTimeout(timer);
  }, [expiry, retry]);

  function evaluate(evaluation: CampaignRequest) {
    setDraft(old => ({ ...old, evaluation, brief: { ...old.brief,
      budget: evaluation.budget_minor / 100, creatorCount: evaluation.minimum_creators } }));
  }
  return { current: expiry !== undefined && expiry <= Date.now() ? undefined : report,
    running: Boolean(request) && result.state === 'loading',
    error: result.state === 'error' ? result.error : undefined, retry, evaluate };
}
