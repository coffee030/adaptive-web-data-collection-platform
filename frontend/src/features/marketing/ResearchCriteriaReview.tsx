import { useState, type ReactNode } from 'react';
import { Panel } from '../../components/studio/Workspace';
import { amount, deliverableOptions, languageOptions, platformOptions } from './intelligence';
import type { Criteria, ResearchPreview, ResearchReviewDecisions, Resolution } from './researchClient';
import { ScenarioMonetaryAmounts } from './ResearchScenarioCurrency';

const fields: Record<keyof Criteria, string> = {
  platform: 'Primary channel',
  alternative_platforms: 'Comparison channels',
  excluded_platforms: 'Excluded channels',
  platform_intent: 'Channel relationship',
  deliverable: 'Deliverable',
  max_evidence_age_days: 'Publication age',
  language: 'Content language',
  require_language: 'Language condition',
  budget_minor: 'Budget cap',
  currency: 'Currency',
  minimum_creators: 'Minimum creators',
  maximum_creators: 'Maximum creators',
  market: 'Audience market',
  minimum_market_share: 'Minimum audience share',
  required_facts: 'Required evidence',
  preferred_facts: 'Preferred evidence',
};
const origins = {
  explicit: 'Your choice',
  application_default: 'Application default',
  legacy: 'Inherited or original origin unknown',
  text: 'Wording in the brief',
  absent: 'Unspecified',
};
const platformName = (key: string) => platformOptions[key as keyof typeof platformOptions] ?? key;
const names = (keys: string[] | null) => keys?.map(platformName).join(', ') || 'None specified';
const languages = Object.entries(languageOptions);
const platforms = Object.entries(platformOptions) as [NonNullable<Criteria['platform']>, string][];
const relationships = {
  single: 'One primary channel',
  comparison: 'Compare channels',
  alternatives: 'Consider alternative channels',
};

function issueValue(field: keyof Criteria, value: Resolution['issues'][number]['candidates'][number]['value']) {
  if (field === 'max_evidence_age_days') return value == null ? 'No age limit' : value + ' days';
  if (value == null) return 'None';
  if (field === 'platform') return platformName(String(value));
  if (field === 'deliverable') return deliverableOptions[value as keyof typeof deliverableOptions] ?? String(value);
  if (field === 'language') return languageOptions[value as keyof typeof languageOptions] ?? String(value);
  if (Array.isArray(value)) return value.length ? value.map(platformName).join(', ') : 'None';
  return String(value);
}

export function InterpretationAudit({ resolution }: { resolution: Resolution }) {
  return (
    <>
      {resolution.assumptions.length > 0 && <ul>{resolution.assumptions.map((item) => <li key={item}>{item}</li>)}</ul>}
      {resolution.issues.length > 0 ? (
        <ul>
          {resolution.issues.map((issue, i) => (
            <li key={issue.code + '/' + issue.field + '/' + i}>
              <strong>{fields[issue.field]} · {issue.severity === 'notice' ? 'Interpretation note' : 'Review issue'}</strong>
              <p>{issue.explanation} {issue.action}</p>
              {issue.candidates.length > 0 && (
                <ul>
                  {issue.candidates.map((candidate, index) => (
                    <li key={index}>
                      {issueValue(issue.field, candidate.value)} · {origins[candidate.origin]}
                      {candidate.references.flatMap((ref) => ref.matched_text ? [' · “' + ref.matched_text + '”'] : [])}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      ) : <p>No interpretation issues were recorded.</p>}
    </>
  );
}

export function CriteriaSummary({ resolution, destination }: { resolution: Resolution; destination?: string }) {
  const c = resolution.criteria;
  const row = (key: keyof Criteria, value: ReactNode) => {
    const field = resolution.fields[key];
    return (
      <div>
        <dt>{fields[key]}</dt>
        <dd>
          {field?.state === 'unresolved' || field?.state === 'invalid' ? 'Needs review' : value}
          {field?.origin && <small>{origins[field.origin]}</small>}
        </dd>
      </div>
    );
  };
  return (
    <dl className="rc-criteria">
      {row('platform', c.platform ? platformName(c.platform) : 'None specified')}
      {row('alternative_platforms', names(c.alternative_platforms))}
      {row('platform_intent', c.platform_intent ? relationships[c.platform_intent] : 'Unspecified')}
      {row('excluded_platforms', names(c.excluded_platforms))}
      {row('deliverable', c.deliverable ? deliverableOptions[c.deliverable] : 'Unspecified')}
      {row('max_evidence_age_days', c.max_evidence_age_days != null ? 'Past ' + c.max_evidence_age_days + ' days'
        : resolution.fields.max_evidence_age_days?.state === 'resolved' ? 'No publication-age limit' : 'No age criterion specified')}
      {row('language', c.language ? languageOptions[c.language] : 'No language specified')}
      {row('require_language', c.language ? (c.require_language ? 'Required' : 'Preferred') : 'No language condition')}
      {row('budget_minor', c.budget_minor == null || !c.currency ? 'Unspecified' : amount(c.budget_minor, c.currency))}
      {row('currency', c.currency ?? 'Unspecified')}
      {row('minimum_creators', c.minimum_creators ?? 'Unspecified')}
      {row('maximum_creators', c.maximum_creators ?? 'Unspecified')}
      {row('market', c.market ?? 'Unspecified')}
      {row('minimum_market_share', c.minimum_market_share == null ? 'Unspecified' : (Number(c.minimum_market_share) * 100).toLocaleString() + '%')}
      {row('required_facts', c.required_facts?.join(', ') || 'None specified')}
      {row('preferred_facts', c.preferred_facts?.join(', ') || 'None specified')}
      {destination && <div><dt>Save research to</dt><dd>{destination}</dd></div>}
    </dl>
  );
}

function PlatformChoice({ proposal, onDecision }: { proposal: ResearchPreview; onDecision: (decision: ResearchReviewDecisions) => void }) {
  const c = proposal.finalized.criteria;
  const [primary, setPrimary] = useState<NonNullable<Criteria['platform']> | ''>(c.platform ?? '');
  const [alternatives, setAlternatives] = useState(c.alternative_platforms ?? []);
  const [excluded, setExcluded] = useState(c.excluded_platforms ?? []);
  const [relation, setRelation] = useState<'comparison' | 'alternatives'>(c.platform_intent === 'alternatives' ? 'alternatives' : 'comparison');
  return (
    <form onSubmit={(event) => {
      event.preventDefault();
      if (!primary) return;
      onDecision({ platforms: {
        platform: primary,
        alternative_platforms: alternatives,
        excluded_platforms: excluded,
        platform_intent: alternatives.length ? relation : 'single',
      } });
    }}>
      <label>
        Confirm primary channel
        <select value={primary} required onChange={(event) => {
          const next = event.target.value as typeof primary;
          setPrimary(next);
          setAlternatives((items) => items.flatMap((item) => item !== next ? [item] : primary ? [primary] : []));
        }}>
          <option value="">Choose a primary channel</option>
          {platforms.filter(([key]) => !excluded.includes(key)).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
      </label>
      <div className="rc-pair">
        <fieldset>
          <legend>Comparison channels (up to two)</legend>
          {platforms.map(([key, label]) => (
            <label key={key} className="rc-check">
              <input type="checkbox" checked={alternatives.includes(key)}
                disabled={key === primary || excluded.includes(key) || (alternatives.length >= 2 && !alternatives.includes(key))}
                onChange={(event) => setAlternatives(event.target.checked ? [...alternatives, key] : alternatives.filter((item) => item !== key))} />
              {label}
            </label>
          ))}
        </fieldset>
        <fieldset>
          <legend>Excluded channels</legend>
          {platforms.map(([key, label]) => (
            <label key={key} className="rc-check">
              <input type="checkbox" checked={excluded.includes(key)}
                disabled={key === primary || alternatives.includes(key) || (excluded.length === 4 && !excluded.includes(key))}
                onChange={(event) => setExcluded(event.target.checked ? [...excluded, key] : excluded.filter((item) => item !== key))} />
              {label}
            </label>
          ))}
        </fieldset>
      </div>
      {alternatives.length > 0 && (
        <label>
          Channel relationship
          <select value={relation} onChange={(event) => setRelation(event.target.value as typeof relation)}>
            <option value="comparison">Compare these channels</option>
            <option value="alternatives">Consider these as alternatives</option>
          </select>
        </label>
      )}
      <button className="studio-secondary" type="submit">Use selected primary and preview</button>
    </form>
  );
}

export function ResearchCriteriaReview({ proposal, destination, createCampaign, onDecision, onConfirm, onClose }: {
  proposal: ResearchPreview;
  destination: string;
  createCampaign: boolean;
  onDecision: (decision: ResearchReviewDecisions) => void;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const c = proposal.finalized.criteria;
  const [decisionEdited, setDecisionEdited] = useState(false);
  const [age, setAge] = useState(c.max_evidence_age_days?.toString() ?? '');
  const [language, setLanguage] = useState<NonNullable<Criteria['language']> | ''>(c.language ?? '');
  const [strength, setStrength] = useState(c.require_language ? 'required' : 'preferred');
  const [deliverable, setDeliverable] = useState<NonNullable<Criteria['deliverable']> | ''>(c.deliverable ?? '');
  const ready = proposal.execution.status === 'ready' && !!proposal.effective_brief;
  const needs = (...keys: (keyof Criteria)[]) => proposal.execution.issues.some((issue) => keys.includes(issue.field));
  const choices = proposal.preparation.decisions;
  const request = proposal.preparation.brief;
  const allowDecisions = proposal.finalized.status !== 'invalid';
  return (
    <Panel title="Review research criteria" description={ready ? 'This interpretation is ready for your approval.' : 'Resolve the issues below before starting research.'}>
      <div className="rc-inset rc-review" onChangeCapture={() => setDecisionEdited(true)}>
        <CriteriaSummary resolution={proposal.finalized} destination={destination} />
        <p>Discovery scope · {request.discovery_scope === 'all_sources' ? 'Any eligible publishing source' : 'Requested campaign channels'}
          {' · '}{request.test_share}% test budget
        </p>
        {request.scenario ? (
          <section aria-label="Outcome assumptions">
            <h3>Outcome assumptions in {request.scenario.currency}</h3>
            <ScenarioMonetaryAmounts scenario={request.scenario} />
          </section>
        ) : <p>Outcome assumptions omitted.</p>}
        {!ready && (
          <ul className="rc-blockers">
            {proposal.execution.issues.map((issue, index) => (
              <li key={index}><strong>{fields[issue.field] ?? 'Research criteria'}</strong> {issue.explanation} {issue.action}</li>
            ))}
            {!proposal.execution.issues.length && <li>Edit the brief and preview the criteria again.</li>}
          </ul>
        )}
        <details className="rc-method">
          <summary>Original interpretation and provenance</summary>
          {Object.values(choices ?? {}).some(Boolean) && <CriteriaSummary resolution={proposal.initial} />}
          <InterpretationAudit resolution={proposal.initial} />
        </details>
        {allowDecisions && (needs('platform', 'alternative_platforms', 'platform_intent', 'excluded_platforms') || !!choices?.platforms) && (
          <PlatformChoice proposal={proposal} onDecision={onDecision} />
        )}
        {allowDecisions && (needs('max_evidence_age_days') || !!choices?.publication_age) && (
          <form onSubmit={(event) => {
            event.preventDefault();
            onDecision({ publication_age: { max_evidence_age_days: Number(age) } });
          }}>
            <label>Clarified maximum publication age (days)
              <input type="number" min={1} max={3650} required value={age} onChange={(event) => setAge(event.target.value)} />
            </label>
            <div className="rc-actions">
              <button className="studio-secondary" type="submit">Use maximum age and preview</button>
              <button className="studio-secondary" type="button" onClick={() => onDecision({ publication_age: { max_evidence_age_days: null } })}>Use no age limit and preview</button>
            </div>
          </form>
        )}
        {allowDecisions && (needs('language', 'require_language') || !!choices?.language) && (
          <form onSubmit={(event) => {
            event.preventDefault();
            onDecision({ language: { language: language || null, require_language: !!language && strength === 'required' } });
          }}>
            <label>Clarified content language
              <select value={language} onChange={(event) => setLanguage(event.target.value as typeof language)}>
                <option value="">No language condition</option>
                {languages.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
              </select>
            </label>
            {language && <label>Clarified language condition
              <select value={strength} onChange={(event) => setStrength(event.target.value)}>
                <option value="preferred">Preferred</option>
                <option value="required">Required</option>
              </select>
            </label>}
            <button className="studio-secondary" type="submit">Use language choice and preview</button>
          </form>
        )}
        {allowDecisions && (needs('deliverable') || !!choices?.deliverable) && (
          <form onSubmit={(event) => {
            event.preventDefault();
            if (deliverable) onDecision({ deliverable });
          }}>
            <label>Clarified deliverable
              <select required value={deliverable} onChange={(event) => setDeliverable(event.target.value as typeof deliverable)}>
                <option value="">Choose a deliverable</option>
                {Object.entries(deliverableOptions).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
              </select>
            </label>
            <button className="studio-secondary" type="submit">Use deliverable and preview</button>
          </form>
        )}
        {decisionEdited && <p role="status">Apply your updated choice and preview again before confirming.</p>}
        <div className="rc-actions">
          {ready && <button className="studio-primary" type="button" disabled={decisionEdited} onClick={onConfirm}>
            {createCampaign ? 'Confirm, create campaign and start research' : 'Confirm and start research'}
          </button>}
          <button className="studio-secondary" type="button" onClick={onClose}>Back to brief</button>
        </div>
      </div>
    </Panel>
  );
}