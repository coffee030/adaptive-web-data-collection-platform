import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { Panel } from '../../components/studio/Workspace';
import { useResource } from '../../lib/useResource';
import { briefOptions, date, deliverableOptions, languageOptions, platformOptions, type CampaignRequest } from './intelligence';
import { CriteriaSummary, ResearchCriteriaReview } from './ResearchCriteriaReview';
import { ScenarioCurrencyReview, type ScenarioChoice } from './ResearchScenarioCurrency';
import type { BusinessBrief, Provenance, ResearchReviewDecisions, ResearchRun } from './researchClient';
import { ScenarioFields, readScenario } from './ScenarioFields';
import { useResearchPreparation } from './useResearchPreparation';
import { useMarketing } from './workspace';

export type BriefSeed = Partial<Omit<BusinessBrief, 'campaign'>> & {
  campaign: Partial<CampaignRequest>;
  campaignCurrencySource?: 'evaluation' | 'brief-default';
  previous?: ResearchRun;
};

const example = {
  question:
    'Find Hong Kong creators who cover affordable dining and compare funded options for a neighbourhood café launch.',
  product: 'Neighbourhood café lunch offer',
  audience: 'Hong Kong residents looking for affordable weekday lunches',
  focus: 'affordable dining',
};

export function BriefForm({
  initial,
  query,
  initialDestination,
  onOpen,
  onHistory,
}: {
  initial: BriefSeed | null;
  query: string;
  initialDestination: string | null;
  onOpen: (id: string) => void;
  onHistory: () => void;
}) {
  const { draft, campaignReceipt, otherDrafts, path } = useMarketing();
  const session = useResearchPreparation(onOpen, onHistory);
  const review = useRef<HTMLDivElement>(null);
  const errorRegion = useRef<HTMLParagraphElement>(null);
  const previewButton = useRef<HTMLButtonElement>(null);
  const [error, setError] = useState('');
  const [touched, setTouched] = useState(new Set<keyof Provenance>());
  const [languageRemoved, setLanguageRemoved] = useState(false);
  function mark(...keys: (keyof Provenance)[]) {
    setTouched((previous) => new Set([...previous, ...keys]));
  }
  const problem = error || session.error;
  useEffect(() => { if (problem) errorRegion.current?.focus(); }, [problem]);
  useEffect(() => { if (session.proposal) review.current?.focus(); }, [session.proposal]);
  function invalidate() {
    setError('');
    session.invalidate();
  }
  const initialCampaign = initial?.campaign;
  const prior = initial?.previous?.confirmed_criteria?.proposal.finalized;
  const inheritedAge = prior?.fields.max_evidence_age_days;
  const savedCampaign = initialDestination === 'standalone' ? null : initialDestination;
  const initialCurrency = initialCampaign?.currency ?? 'HKD';
  const [currency, setCurrency] = useState(initialCurrency);
  const savedScenario = initial?.scenario;
  const [scenarioChoice, setScenarioChoice] = useState<ScenarioChoice>('saved');
  const scenarioConflict = !!savedScenario && savedScenario.currency !== currency;
  const scenarioNeedsChoice = scenarioConflict && scenarioChoice === 'saved';

  function chooseScenario(choice: ScenarioChoice) {
    invalidate();
    setScenarioChoice(choice);
  }
  const [market, setMarket] = useState(initialCampaign ? initialCampaign.market ?? '' : 'HK');
  const [ageMode, setAgeMode] = useState<'wording' | 'maximum' | 'unlimited'>(
    inheritedAge?.origin === 'text' ? 'wording' : initial?.max_evidence_age_days != null ? 'maximum' :
      inheritedAge?.state === 'resolved' ? 'unlimited' : 'wording',
  );
  const [question, setQuestion] = useState(initialCampaign?.description ?? query);
  const [product, setProduct] = useState(initial?.product ?? '');
  const [audience, setAudience] = useState(initial?.audience ?? '');
  const [focus, setFocus] = useState(initial?.discovery_focus ?? query.slice(0, 120));
  const [budget, setBudget] = useState(
    initialCampaign?.budget_minor != null ? String(initialCampaign.budget_minor / 100) : '',
  );
  const [channel, setChannel] = useState<CampaignRequest['platform'] | ''>(
    initialCampaign?.platform ?? (initialDestination ? '' : 'instagram'),
  );
  const [deliverable, setDeliverable] = useState<CampaignRequest['deliverable'] | ''>(
    initialCampaign?.deliverable ?? (initialDestination ? '' : 'social_post'),
  );
  const [objective, setObjective] = useState<CampaignRequest['objective']>(
    initialCampaign?.objective ?? 'awareness',
  );
  const [alternative, setAlternative] = useState<CampaignRequest['platform'] | ''>(
    initial?.alternative_platforms?.[0] ?? '',
  );
  const [secondAlternative, setSecondAlternative] = useState<CampaignRequest['platform'] | ''>(
    initial?.alternative_platforms?.[1] ?? '',
  );
  const [testShare, setTestShare] = useState(String(initial?.test_share ?? 60));
  const [required, setRequired] = useState(initialCampaign?.required_facts?.join(', ') ?? '');
  const [preferred, setPreferred] = useState(initialCampaign?.preferred_facts?.join(', ') ?? '');
  const [marketShare, setMarketShare] = useState(
    initialCampaign?.minimum_market_share != null
      ? String(Number((100 * Number(initialCampaign.minimum_market_share)).toFixed(4)))
      : '',
  );
  const [language, setLanguage] = useState<CampaignRequest['language']>(initialCampaign?.language);
  const [requireLanguage, setRequireLanguage] = useState(
    initialCampaign?.require_language ?? false,
  );
  const fetchOptions = useCallback(
    (signal: AbortSignal) => briefOptions('partner', channel, signal),
    [channel],
  );
  const { result: criteria } = useResource(fetchOptions);
  const [destination, setDestination] = useState(initialDestination ?? 'new');
  const [scope, setScope] = useState<BusinessBrief['discovery_scope']>(
    initial?.discovery_scope ?? 'campaign_channels',
  );
  const [freshDays, setFreshDays] = useState(
    initial?.max_evidence_age_days ? String(initial.max_evidence_age_days) : '',
  );
  const [minimum, setMinimum] = useState(String(initialCampaign?.minimum_creators ?? 1));
  const [maximum, setMaximum] = useState(String(initialCampaign?.maximum_creators ?? 4));
  const destinations = [
    ...(campaignReceipt?.version
      ? [
          {
            key: campaignReceipt.id,
            name: draft.brief.name || draft.research?.title || 'Untitled campaign',
          },
        ]
      : []),
    ...otherDrafts(true),
  ];
  if (savedCampaign && !destinations.some((item) => item.key === initialDestination))
    destinations.push({ key: savedCampaign, name: initial?.product || 'Saved campaign' });
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (scenarioNeedsChoice || session.recovery || session.progress === 'save' || session.progress === 'submit') return;
    const terms = (value: string) => [
      ...new Set(
        value
          .split(',')
          .map((v) => v.trim())
          .filter(Boolean),
      ),
    ];
    const must = terms(required),
      preferences = terms(preferred);
    if (!channel || !deliverable) {
      setError('Choose a primary channel and required deliverable for this campaign.');
      return;
    }
    if ([question, product, audience].some((value) => value.trim().length < 2) || (focus.trim().length === 1)) {
      setError('Enter at least two characters in each required field and any discovery focus.');
      return;
    }
    if (question.trim().length > 1000) {
      setError('Shorten the research question to 1,000 characters.');
      return;
    }
    if (Number(minimum) > Number(maximum)) {
      setError('Choose a maximum creator count at least as large as the minimum.');
      return;
    }
    if (
      [...must, ...preferences].some((v) => !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(v)) ||
      Math.max(must.length, preferences.length) > 10
    ) {
      setError('Enter up to ten reviewed fact IDs per field, separated by commas.');
      return;
    }
    const campaign: CampaignRequest = {
      ...initialCampaign,
      description: question.trim(),
      platform: channel,
      objective,
      deliverable,
      minimum_creators: Number(minimum),
      maximum_creators: Number(maximum),
      market: market || undefined,
      language,
      require_language: !!language && requireLanguage,
      required_facts: must,
      preferred_facts: preferences,
      minimum_market_share: marketShare === '' ? undefined :
        !touched.has('minimum_market_share') && initialCampaign?.minimum_market_share != null
          ? initialCampaign.minimum_market_share : (Number(marketShare) / 100).toFixed(6),
      budget_minor: Math.round(Number(budget) * 100),
      currency,
    };
    const enteredScenario = scenarioChoice === 'omitted' ? null : readScenario(event.currentTarget, currency);
    const scenario = enteredScenario &&
      Object.entries(enteredScenario).some(([key, value]) => key !== 'currency' && value != null)
      ? enteredScenario : null;
    if (scenarioChoice === 'accepted' && !scenario) {
      setError('Enter an outcome assumption or leave the scenario out of this research.');
      return;
    }
    const brief: BusinessBrief = {
      product: product.trim(),
      audience: audience.trim(),
      discovery_focus: focus.trim() || null,
      test_share: Number(testShare),
      alternative_platforms:
        alternative && alternative !== channel
          ? [
              alternative,
              ...(secondAlternative &&
              secondAlternative !== alternative &&
              secondAlternative !== channel
                ? [secondAlternative]
                : []),
            ]
          : [],
      campaign,
      discovery_scope: scope,
      max_evidence_age_days: ageMode === 'maximum' ? Number(freshDays) : null,
      scenario,
    };
    const provenance: Provenance = {};
    const structured = {
      platform: campaign.platform,
      alternative_platforms: brief.alternative_platforms,
      deliverable: campaign.deliverable,
      language: campaign.language,
      require_language: campaign.require_language,
      market: campaign.market,
      minimum_market_share: campaign.minimum_market_share,
      budget_minor: campaign.budget_minor,
      currency: campaign.currency,
      minimum_creators: campaign.minimum_creators,
      maximum_creators: campaign.maximum_creators,
      required_facts: campaign.required_facts,
      preferred_facts: campaign.preferred_facts,
      max_evidence_age_days: brief.max_evidence_age_days,
    };
    for (const key of Object.keys(structured) as (keyof Provenance)[]) {
      if (key === 'max_evidence_age_days') {
        if (ageMode !== 'wording') {
          provenance[key] = touched.has(key) || (ageMode === 'unlimited' && inheritedAge?.origin === 'explicit')
            ? 'explicit' : 'legacy';
        }
      } else if (structured[key] != null) {
        if (touched.has(key)) provenance[key] = 'explicit';
        else if (initialCampaign && initialCampaign[key as keyof typeof initialCampaign] != null) provenance[key] = 'legacy';
        else if (initial?.alternative_platforms && key === 'alternative_platforms') provenance[key] = 'legacy';
        else provenance[key] = 'application_default';
      }
    }
    void session.preview({
      protocol: 'confirmed-v1',
      brief,
      campaign_id: destination === 'new' ? session.reservation : destination === 'standalone' ? null : destination,
      provenance,
      decisions: languageRemoved ? { language: { language: null, require_language: false } } : {},
    });
  }
  function useExample() {
    invalidate();
    setLanguageRemoved(false);
    setQuestion(example.question);
    setProduct(example.product);
    setAudience(example.audience);
    setFocus(example.focus);
    if (currency === 'HKD') {
      mark('budget_minor');
      setBudget('12000');
    }
  }
  const createCampaign = destination === 'new';
  const destinationName = createCampaign ? 'Create a new company campaign' :
    destination === 'standalone' ? 'Company research library only' :
      destinations.find((item) => item.key === destination)?.name ?? 'Saved company campaign';
  const locked = (session.recovery !== null && session.recovery !== 'integrity') ||
    session.progress === 'save' || session.progress === 'submit';
  return (
    <div className="rc-result">
      <Panel
        title={initial?.previous ? 'Adjust research brief' : savedCampaign ? 'Research this campaign' : 'Write a research brief'}
        description={
          savedCampaign
            ? 'Review your saved campaign details and fill in the remaining research criteria.'
            : 'Describe the decision you need to make. Preview how Harbourline interprets the brief before starting research.'
        }
      >
        <form onSubmit={submit} onChangeCapture={invalidate} className="rc-form">
          <fieldset className="rc-form-fields" disabled={locked}>
            <label>
              What are you trying to find?
              <textarea
                value={question}
                onChange={(e) => { setQuestion(e.target.value); setLanguageRemoved(false); }}
                minLength={2}
                maxLength={1000}
                required
                rows={3}
                placeholder="Describe your campaign and the evidence you need."
              />
            </label>
            {!savedCampaign && (
              <button type="button" className="rc-example" onClick={useExample}>
                Use a Hong Kong dining brief
              </button>
            )}
            <label>
              Save research to
              <select required value={destination} onChange={(e) => setDestination(e.target.value)}>
                <option value="" disabled>Choose a destination</option>
                <option value="new">Create a new company campaign</option>
                <option value="standalone">Company research library only</option>
                {destinations.map((item) => (
                  <option key={item.key} value={item.key}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="rc-pair">
              <label>
                Product or campaign
                <input
                  value={product}
                  onChange={(e) => { setProduct(e.target.value); setLanguageRemoved(false); }}
                  required
                  minLength={2}
                  maxLength={160}
                />
              </label>
              <label>
                Target audience
                <input
                  value={audience}
                  onChange={(e) => setAudience(e.target.value)}
                  required
                  minLength={2}
                  maxLength={300}
                />
              </label>
            </div>
            <div className="rc-triplet">
              <label>
                Budget cap ({currency})
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  max="10000000"
                  step=".01"
                  value={budget}
                  required
                  onChange={(e) => { mark('budget_minor'); setBudget(e.target.value); }}
                />
              </label>
              <label>
                Objective
                <select
                  value={objective}
                  onChange={(e) => setObjective(e.target.value as typeof objective)}
                >
                  <option value="awareness">Awareness</option>
                  <option value="engagement">Engagement</option>
                </select>
              </label>
              <label>
                Primary channel
                <select
                  required
                  value={channel}
                  onChange={(e) => {
                    mark('platform');
                    setChannel(e.target.value as typeof channel);
                    if (e.target.value === alternative) {
                      setAlternative(secondAlternative);
                      setSecondAlternative('');
                    } else if (e.target.value === secondAlternative) setSecondAlternative('');
                  }}
                >
                  <option value="" disabled>
                    Choose a channel
                  </option>
                  {Object.entries(platformOptions).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {savedScenario && scenarioConflict && (
              <ScenarioCurrencyReview
                scenario={savedScenario}
                currency={currency}
                choice={scenarioChoice}
                campaignBudget={initialCampaign?.budget_minor}
                budgetCurrency={initialCurrency}
                usesBriefDefault={initial?.campaignCurrencySource === 'brief-default'}
                onChoose={chooseScenario}
              />
            )}
            <details
              className="rc-settings"
              open={Boolean(savedCampaign && !initialCampaign?.deliverable)}
            >
              <summary>Research scope and alternatives</summary>
              <label>
                Discovery focus
                <input
                  maxLength={120}
                  value={focus}
                  onChange={(e) => { setFocus(e.target.value); setLanguageRemoved(false); }}
                  placeholder="Optional topic, creator or source phrase"
                />
              </label>
              <div className="rc-pair">
                <label>
                  Discovery channels
                  <select
                    value={scope}
                    onChange={(e) => setScope(e.target.value as NonNullable<typeof scope>)}
                  >
                    <option value="campaign_channels">Requested campaign channels</option>
                    <option value="all_sources">Any eligible publishing source</option>
                  </select>
                </label>
                <label>
                  Publication age
                  <select value={ageMode} onChange={(event) => {
                    mark('max_evidence_age_days');
                    setAgeMode(event.target.value as typeof ageMode);
                  }}>
                    <option value="wording">Use wording in the brief</option>
                    <option value="maximum">Set a maximum age</option>
                    <option value="unlimited">No publication-age limit</option>
                  </select>
                </label>
              </div>
              {ageMode === 'maximum' && (
                <label>
                  Maximum publication age (days)
                  <input min={1} max={3650} type="number" required value={freshDays} onChange={(event) => {
                    mark('max_evidence_age_days');
                    setFreshDays(event.target.value);
                  }} />
                </label>
              )}
              <div className="rc-pair">
                <label>
                  Required deliverable
                  <select
                    required
                    value={deliverable}
                    onChange={(e) => { mark('deliverable'); setDeliverable(e.target.value as typeof deliverable); }}
                  >
                    <option value="" disabled>
                      Choose a deliverable
                    </option>
                    {Object.entries(deliverableOptions).map(([key, label]) => (
                      <option key={key} value={key}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Also compare
                  <select
                    value={alternative === channel ? '' : alternative}
                    onChange={(e) => {
                      mark('alternative_platforms');
                      setAlternative(e.target.value as typeof alternative);
                      if (!e.target.value || e.target.value === secondAlternative) setSecondAlternative('');
                    }}
                  >
                    <option value="">No other channel</option>
                    {Object.entries(platformOptions)
                      .filter(([key]) => key !== channel)
                      .map(([key, label]) => (
                        <option key={key} value={key}>
                          {label}
                        </option>
                      ))}
                  </select>
                </label>
              </div>
              {alternative && alternative !== channel && (
                <label>
                  Second comparison channel
                  <select
                    value={
                      secondAlternative === alternative || secondAlternative === channel
                        ? ''
                        : secondAlternative
                    }
                    onChange={(event) => {
                      mark('alternative_platforms');
                      setSecondAlternative(event.target.value as typeof secondAlternative);
                    }}
                  >
                    <option value="">No third channel</option>
                    {Object.entries(platformOptions)
                      .filter(([key]) => key !== alternative && key !== channel)
                      .map(([key, label]) => (
                        <option key={key} value={key}>
                          {label}
                        </option>
                      ))}
                  </select>
                </label>
              )}
              <label>
                Test allocation (% of full budget)
                <input
                  type="number"
                  min={10}
                  max={90}
                  required
                  value={testShare}
                  onChange={(e) => setTestShare(e.target.value)}
                />
              </label>
              <div className="rc-pair">
                <label>
                  Minimum creators to fund
                  <input
                    type="number"
                    min={1}
                    max={8}
                    required
                    value={minimum}
                    onChange={(e) => { mark('minimum_creators'); setMinimum(e.target.value); }}
                  />
                </label>
                <label>
                  Maximum creators to fund
                  <input
                    type="number"
                    min={1}
                    max={8}
                    required
                    value={maximum}
                    onChange={(e) => { mark('maximum_creators'); setMaximum(e.target.value); }}
                  />
                </label>
              </div>
              <div className="rc-pair">
                <label>
                  Audience market (two-letter code)
                  <input value={market} pattern="[A-Z]{2}" maxLength={2} onChange={(event) => {
                    mark('market');
                    setMarket(event.target.value.toUpperCase());
                  }} />
                </label>
                <label>
                  Budget and scenario currency (three-letter code)
                  <input value={currency} required pattern="[A-Z]{3}" maxLength={3} onChange={(event) => {
                    const next = event.target.value.toUpperCase();
                    if (next === currency) return;
                    mark('currency');
                    setCurrency(next);
                    setBudget('');
                    setScenarioChoice('saved');
                  }} />
                </label>
              </div>
              <p className="rc-caption">Changing the campaign currency clears the budget so you can enter a new amount.</p>
              <div className="rc-pair">
                <label>
                  Required market audience share (%)
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step=".0001"
                    placeholder="Optional"
                    value={marketShare}
                    onChange={(e) => { mark('minimum_market_share'); setMarketShare(e.target.value); }}
                  />
                </label>
                <label>
                  Content language
                  <select
                    value={languageRemoved ? 'none' : language ?? ''}
                    onChange={(event) => {
                      setLanguageRemoved(event.target.value === 'none');
                      const value = event.target.value;
                      if (value === 'none') return;
                      setLanguage((value || undefined) as CampaignRequest['language']);
                      if (value) {
                        mark('language', 'require_language');
                      } else {
                        setRequireLanguage(false);
                        setTouched((previous) => new Set(
                          [...previous].filter((key) => key !== 'language' && key !== 'require_language'),
                        ));
                      }
                    }}
                  >
                    <option value="">Use wording in the brief</option>
                    <option value="none">No language condition</option>
                    {Object.entries(languageOptions).map(([key, text]) => (
                      <option key={key} value={key}>
                        {text}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {language && !languageRemoved && (
                <label className="rc-check">
                  <input
                    type="checkbox"
                    checked={requireLanguage}
                    onChange={(e) => { mark('require_language'); setRequireLanguage(e.target.checked); }}
                  />
                  Require evidence of this language (otherwise preferred)
                </label>
              )}
              {Array.from(
                new Set([
                  ...(criteria.state === 'ready' ? criteria.data.reviewed_facts : []),
                  ...required.split(',').map((x) => x.trim()),
                  ...preferred.split(',').map((x) => x.trim()),
                ]),
              )
                .filter(Boolean)
                .map((fact) => {
                  const must = required
                      .split(',')
                      .map((x) => x.trim())
                      .filter(Boolean),
                    nice = preferred
                      .split(',')
                      .map((x) => x.trim())
                      .filter(Boolean);
                  return (
                    <label key={fact}>
                      {fact.replaceAll('_', ' ')}
                      <select
                        value={
                          must.includes(fact) ? 'required' : nice.includes(fact) ? 'preferred' : 'any'
                        }
                        onChange={(e) => {
                          mark('required_facts', 'preferred_facts');
                          setRequired(
                            [
                              ...must.filter((x) => x !== fact),
                              ...(e.target.value === 'required' ? [fact] : []),
                            ].join(', '),
                          );
                          setPreferred(
                            [
                              ...nice.filter((x) => x !== fact),
                              ...(e.target.value === 'preferred' ? [fact] : []),
                            ].join(', '),
                          );
                        }}
                      >
                        <option value="any">No preference</option>
                        <option value="required">Must have reviewed evidence</option>
                        <option value="preferred">Prefer when supported</option>
                      </select>
                    </label>
                  );
                })}
            </details>
            {!scenarioNeedsChoice && scenarioChoice !== 'omitted' && (
              <details className="rc-settings">
                <summary>Outcome assumptions (optional)</summary>
                <p>Enter your own assumptions to calculate a scenario. Leave unknown inputs blank.</p>
                <div className="rc-triplet">
                  <ScenarioFields
                    key={savedScenario ? currency + '/' + scenarioChoice : undefined}
                    input={savedScenario}
                    currency={currency}
                  />
                </div>
              </details>
            )}
          </fieldset>
          {initial?.previous && (
            <details className="rc-method">
              <summary>Earlier research used to prefill this brief</summary>
              <p>Saved {date(initial.previous.created_at)}. Your approval applies to the earlier run.</p>
              {prior ? <CriteriaSummary resolution={prior} /> : <p>The earlier run did not record criterion origins.</p>}
            </details>
          )}
          {problem && <p className="rc-error" role="alert" tabIndex={-1} ref={errorRegion}>{problem}</p>}
          {session.progress && <p role="status">
            {session.progress === 'preview' ? 'Preparing criteria…' :
              session.progress === 'save' ? 'Saving company campaign…' : 'Starting confirmed research…'}
          </p>}
          <div className="rc-actions">
            {!session.recovery && <button ref={previewButton} className="studio-primary" disabled={locked || scenarioNeedsChoice || session.progress === 'preview'} type="submit">
              Preview research criteria
            </button>}
            {session.recovery === 'retry' && <button className="studio-primary" type="button" onClick={session.retry}>
              Retry approved research
            </button>}
            {session.recovery === 'campaign' && (
              <Link className="studio-secondary" to={path('research') + '?campaign=' + session.reservation}>
                Open the current saved campaign
              </Link>
            )}
            {(session.recovery === 'identity' || session.recovery === 'campaign') && (
              <button className="studio-secondary" type="button" onClick={() => {
                if (session.recovery === 'campaign') setDestination('');
                session.restart();
              }}>Return to brief and prepare again</button>
            )}
          </div>
        </form>
      </Panel>
      {session.proposal && !locked && (
        <div ref={review} tabIndex={-1} aria-label="Research criteria preview">
          <ResearchCriteriaReview
            key={session.proposal.fingerprint}
            proposal={session.proposal}
            destination={destinationName}
            createCampaign={createCampaign}
            onDecision={(decision: ResearchReviewDecisions) => {
              const preparation = session.proposal!.preparation;
              void session.preview({ ...preparation, decisions: { ...preparation.decisions, ...decision } });
            }}
            onConfirm={() => session.confirm(session.proposal!, createCampaign)}
            onClose={() => { invalidate(); previewButton.current?.focus(); }}
          />
        </div>
      )}
    </div>
  );
}
