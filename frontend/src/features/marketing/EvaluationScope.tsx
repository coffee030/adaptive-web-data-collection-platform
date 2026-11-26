import { languageOptions, type CampaignResult } from './intelligence';

export const readable = (value: string) => {
  if (value.startsWith('required_fact_unverified:')) {
    return 'Required fact unverified (' + value.slice('required_fact_unverified:'.length).replaceAll('_', ' ') + ')';
  }
  if (value.startsWith('language:')) {
    const language = value.slice('language:'.length) as keyof typeof languageOptions;
    return 'Language evidence (' + (languageOptions[language] ?? language) + ')';
  }
  return ({
    confirmed_quote_unavailable: 'Current firm quote unavailable',
    target_market_evidence_unavailable: 'Audience evidence unavailable',
    insufficient_relevant_content: 'Insufficient supporting content',
    quote_exceeds_budget: 'Quote exceeds budget',
    required_language_unverified: 'Required language unverified',
    required_market_share_unverified: 'Required audience share unverified',
    required_market_share_below_minimum: 'Audience share below minimum',
    relevance: 'Content relevance',
    performance: 'Historical performance',
    consistency: 'Historical consistency',
    cost: 'Quote fit',
    market: 'Audience fit',
    language: 'Language evidence',
    preferences: 'Reviewed preferences',
  }[value] ?? value.replaceAll('_', ' '));
};

export function EvaluationScope({ result }: { result: CampaignResult }) {
  const scope = result.campaign.shortlist;
  const reasons = new Map<string,number>();
  if (result.plan.status === 'infeasible') {
    for (const candidate of result.recommendations.filter(row=>!row.eligible)) {
      for (const reason of new Set(candidate.limitations)) {
        if (reason === 'target_market_evidence_unavailable' || reason === 'target_language_evidence_unavailable') continue;
        reasons.set(reason,(reasons.get(reason) ?? 0)+1);
      }
    }
  }
  const leading = [...reasons].sort((a,b)=>b[1]-a[1] || a[0].localeCompare(b[0])).slice(0,3);
  return <div className="hl-evaluated-scope"><p><strong>Evaluated scope</strong> · {scope ? 'Selected pool (' + scope.length + ')' : 'All creators'} · {result.recommendations.length} reviewed</p>
    {result.plan.status === 'infeasible' && (leading.length
      ? <><strong>Leading exclusions</strong><ul>{leading.map(([reason,count])=><li key={reason}>{readable(reason)} · {count} {count===1?'creator':'creators'}</li>)}</ul></>
      : <p>{result.recommendations.length ? 'The available quotes and eligible creator count cannot meet this budget and required team size.' : 'No current records are available for this pool.'}</p>)}
  </div>;
}
