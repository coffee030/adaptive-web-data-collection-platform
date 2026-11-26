import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ApiError, apiLocal, getOperatorCredential } from '../../lib/api';

const origins = {
  profile: 'creator_profile',
  content: 'creator_authored',
  quote: 'creator_quote',
  performance: 'creator_first_party_performance',
  audience: 'creator_opt_in_survey',
} as const;
type Kind = keyof typeof origins;
const referencePattern = '[A-Za-z0-9][A-Za-z0-9_.\\-]{0,63}';
function Reference({ name, label }: { name: string; label: string }) {
  return (
    <label>
      {label}
      <input name={name} pattern={referencePattern} maxLength={64} required />
    </label>
  );
}
function Timestamp({ name, label }: { name: string; label: string }) {
  return (
    <label>
      {label}
      <input name={name} type="datetime-local" required />
    </label>
  );
}
function Numeric({
  name,
  label,
  required = false,
  max = 1000000000000,
  step = 1,
}: {
  name: string;
  label: string;
  required?: boolean;
  max?: number;
  step?: number;
}) {
  return (
    <label>
      {label}
      <input name={name} type="number" min={0} max={max} step={step} required={required} />
    </label>
  );
}

export function FirstPartyEvidence({ company }: { company: string }) {
  const [kind, setKind] = useState<Kind>('profile');
  const [error, setError] = useState('');
  const [receipt, setReceipt] = useState('');
  const [busy, setBusy] = useState(false);
  const flight = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => flight.current?.abort(), []);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (flight.current) return;
    const form = e.currentTarget,
      fields = new FormData(form);
    const get = (key: string) => String(fields.get(key) ?? '').trim();
    const time = (key: string) => new Date(get(key)).toISOString();
    const record: Record<string, unknown> = {
      kind,
      id: get('record'),
      creator_id: get('creator'),
      observed_at: time('observed'),
      evidence_ref: get('evidence'),
    };
    const platform = get('platform');
    if (get('url')) record.source_url = get('url');
    if (kind === 'profile')
      Object.assign(record, {
        name: get('name'),
        description: get('description'),
        accounts: [{ platform, account_id: get('account') }],
      });
    if (kind === 'content')
      Object.assign(record, {
        platform,
        account_id: get('account'),
        published_at: time('published'),
        text: get('text'),
        languages: get('language') ? [get('language')] : [],
        reviewed_facts: get('facts')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      });
    if (kind === 'quote')
      Object.assign(record, {
        platform,
        deliverable: get('deliverable'),
        currency: 'HKD',
        amount_minor: Math.round(Number(get('fee')) * 100),
        quote_type: get('quote_type'),
        valid_until: time('valid'),
        terms: get('terms'),
      });
    if (kind === 'audience')
      Object.assign(record, {
        platform,
        market: 'HK',
        period_start: time('start'),
        period_end: time('end'),
        data_status: 'observed',
        basis: 'opt_in_survey_respondents',
        denominator: Number(get('denominator')),
        share: Number(get('share')) / 100,
      });
    if (kind === 'performance') {
      Object.assign(record, { platform, post_id: get('post'), window_end: time('window') });
      for (const key of ['views', 'likes', 'comments'])
        if (get(key) !== '') record[key] = Number(get(key));
      if (record.views == null && record.likes == null && record.comments == null) {
        setError('Enter at least one measured figure.');
        return;
      }
    }
    const grant = {
      owner_ref: get('creator'),
      origin: origins[kind],
      authorization_ref: get('permission'),
      attribution: get('credit'),
      expires_at: time('expires'),
      commercial_display: fields.has('display'),
      pilot_analytics: fields.has('analytics'),
      company_plan_export: fields.has('export'),
    };
    const ctrl = new AbortController();
    flight.current = ctrl;
    setError('');
    setReceipt('');
    setBusy(true);
    try {
      const added = await apiLocal<{ dataset_id: string }>(
        '/marketing/intelligence/operator/partner/receipts?company=' + encodeURIComponent(company),
        getOperatorCredential(),
        ctrl.signal,
        'POST',
        { grant, records: [record] }
      );
      setReceipt(added.dataset_id);
    } catch (cause) {
      if (!ctrl.signal.aborted)
        setError(
          cause instanceof ApiError && cause.code === 'receipt_exists'
            ? 'This record already exists with different contents. Review the original before replacing it.'
            : cause instanceof ApiError && cause.status === 403
              ? 'The operator or supplied permission does not authorize this use.'
              : 'Check the references, reported dates, permission dates and figures.'
        );
    } finally {
      flight.current = undefined;
      if (!ctrl.signal.aborted) setBusy(false);
    }
  }
  return (
    <details className="first-party-entry">
      <summary>Record creator-supplied evidence</summary>
      <p>
        Use a separate permission record for each type of evidence. Only record material the creator has
        authorized this company to analyze and display.
      </p>
      <form
        className="period-form"
        onSubmit={submit}
        onChange={() => {
          setError('');
          setReceipt('');
        }}
      >
        <fieldset disabled={busy}>
          <legend>Source record</legend>
          <div className="form-pair">
            <label>
              Evidence type
              <select value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
                <option value="profile">Creator profile</option>
                <option value="content">Published content</option>
                <option value="quote">Commercial quote</option>
                <option value="performance">Post performance</option>
                <option value="audience">Audience survey</option>
              </select>
            </label>
            <label>
              Platform
              <select name="platform">
                {['instagram', 'youtube', 'tiktok', 'facebook', 'other'].map((p) => (
                  <option key={p} value={p}>
                    {
                      (
                        {
                          instagram: 'Instagram',
                          youtube: 'YouTube',
                          tiktok: 'TikTok',
                          facebook: 'Facebook',
                          other: 'Other',
                        } as Record<string, string>
                      )[p]
                    }
                  </option>
                ))}
              </select>
            </label>
            <Reference name="creator" label="Creator reference" />
            <Reference name="record" label="Record identifier" />
            <Reference name="evidence" label="Evidence reference" />
            <Timestamp name="observed" label="Observed or received at" />
          </div>
          <p>
            Reuse the same creator reference across their records. References accept letters, digits,
            periods, underscores and hyphens.
          </p>
          <label>
            Source link (optional)
            <input type="url" name="url" maxLength={2048} />
          </label>
          <div className="form-pair" key={kind}>
            {(kind === 'profile' || kind === 'content') && (
              <Reference name="account" label="Platform account identifier" />
            )}
            {kind === 'profile' && (
              <>
                <label>
                  Creator name
                  <input name="name" maxLength={120} required />
                </label>
                <label>
                  Profile description
                  <textarea name="description" maxLength={1000} />
                </label>
              </>
            )}
            {kind === 'content' && (
              <>
                <Timestamp name="published" label="Published at" />
                <label>
                  Permitted post text
                  <textarea required name="text" minLength={2} maxLength={1800} />
                </label>
                <label>
                  Content language
                  <select name="language">
                    <option value="">Unverified</option>
                    <option value="yue">Cantonese</option>
                    <option value="zh-Hant">Traditional Chinese</option>
                    <option value="en">English</option>
                    <option value="mix">Mixed</option>
                  </select>
                </label>
                <label>
                  Reviewed fact references (optional)
                  <input name="facts" placeholder="Comma-separated" />
                </label>
              </>
            )}
            {kind === 'quote' && (
              <>
                <Numeric name="fee" label="Quoted fee (HK$)" max={10000000} required step={0.01} />
                <label>
                  Quote type
                  <select name="quote_type" required defaultValue="">
                    <option value="" disabled>
                      Choose type
                    </option>
                    <option value="firm">Firm</option>
                    <option value="indicative">Indicative</option>
                  </select>
                </label>
                <label>
                  Deliverable
                  <select name="deliverable">
                    <option value="short_video">Short video</option>
                    <option value="social_post">Social post</option>
                    <option value="video_integration">Video integration</option>
                    <option value="dedicated_video">Dedicated video</option>
                  </select>
                </label>
                <Timestamp name="valid" label="Quote valid until" />
                <label>
                  Quote terms
                  <input required maxLength={120} name="terms" />
                </label>
              </>
            )}
            {kind === 'performance' && (
              <>
                <Reference name="post" label="Published content record identifier" />
                <Timestamp name="window" label="Measurement window ended" />
                {['views', 'likes', 'comments'].map((key) => (
                  <Numeric key={key} name={key} label={key[0]!.toUpperCase() + key.slice(1)} />
                ))}
              </>
            )}
            {kind === 'audience' && (
              <>
                <Timestamp name="start" label="Survey started" />
                <Timestamp name="end" label="Survey ended" />
                <label>
                  Opt-in respondents
                  <input name="denominator" type="number" min={30} max={1000000000000} required />
                </label>
                <Numeric name="share" label="Hong Kong share (%)" max={100} step={0.01} required />
              </>
            )}
          </div>
        </fieldset>
        <fieldset disabled={busy}>
          <legend>Permission for this record</legend>
          <div className="form-pair">
            <Reference name="permission" label="Permission record identifier" />
            <label>
              Required attribution
              <input name="credit" maxLength={120} required />
            </label>
            <Timestamp name="expires" label="Permission expires" />
          </div>
          <label className="check-line">
            <input type="checkbox" name="analytics" required />
            Company analysis is authorized.
          </label>
          <label className="check-line">
            <input type="checkbox" name="display" required />
            Display in this commercial workspace is authorized.
          </label>
          <label className="check-line">
            <input type="checkbox" name="export" />
            Including this evidence in company plan exports is authorized.
          </label>
        </fieldset>
        <button className="studio-primary" disabled={busy}>
          Register reviewed evidence
        </button>
        {error && <p role="alert">{error}</p>}
        {receipt && (
          <p role="status">
            Evidence registered for the selected company. Reference <code>{receipt}</code>.
          </p>
        )}
      </form>
    </details>
  );
}
