import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { MetricStrip, Panel } from '../../components/studio/Workspace';
import { ApiError, apiAttachment, apiPatch, apiPut, apiDelete } from '../../lib/api';
import { Overlay } from './components';
import {
  BusinessProblem,
  campaignBase,
  displayDate,
  formatCount,
  money,
  platformName,
  useBusinessResource,
} from './marketLibrary';

const dimensions = [
  ['reach', 'Unique reach'],
  ['impressions', 'Impressions'],
  ['clicks', 'Clicks'],
  ['conversions', 'Attributed conversions'],
  ['revenue_minor', 'Attributed revenue'],
  ['ad_spend_minor', 'Advertising spend'],
  ['campaign_cost_minor', 'Total campaign cost'],
  ['contribution_minor', 'Contribution before campaign cost'],
] as const;
const rates = [
  ['ctr', 'Click-through rate'],
  ['conversion_rate', 'Conversion rate'],
  ['roas', 'Return on ad spend'],
  ['roi', 'Return on investment'],
] as const;
type MeasureKey = (typeof dimensions)[number][0] | (typeof rates)[number][0];
type Actual = Record<MeasureKey, number | null>;
interface Period extends Partial<Actual> {
  id: string;
  channel: string;
  period_start: string;
  period_end: string;
  source: string;
  authorization_ref: string;
  recorded_by: string;
  recorded_at: string;
}
interface Report {
  version: number;
  status: string;
  currency: string;
  period_count: number;
  period_offset: number;
  periods: Period[];
  actual: Actual;
  planned: Partial<Actual>;
  planned_currency: string | null;
}

function showValue(key: MeasureKey, value: number | null | undefined) {
  if (value == null) return '—';
  if (key.endsWith('_minor')) return money(value);
  if (key === 'roas') return value.toLocaleString('en-HK', { maximumFractionDigits: 2 }) + '×';
  if (key === 'ctr' || key === 'conversion_rate' || key === 'roi')
    return (100 * value).toLocaleString('en-HK', { maximumFractionDigits: 2 }) + '%';
  return new Intl.NumberFormat('en-HK', { maximumFractionDigits: 1 }).format(value);
}

function reportError(error: unknown) {
  if (error instanceof ApiError) {
    if (error.code === 'reporting_overlap')
      return 'This channel already has a report for those dates. Edit that report or choose a separate period.';
    if (error.status === 409)
      return 'Someone changed this report. Reload its latest version before saving.';
    if (error.status === 422)
      return 'Check the dates and figures. Include advertising spend in total cost.';
    if (error.kind === 'timeout')
      return 'The request timed out. Reload to check whether the change was saved.';
  }
  return 'Couldn’t update the campaign report. Check your connection and try again.';
}

function PeriodForm({
  period,
  save,
  pending,
}: {
  period?: Period;
  save: (body: Record<string, unknown>) => void;
  pending: boolean;
}) {
  const [message, setMessage] = useState('');
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const body: Record<string, unknown> = {};
    for (const key of ['channel', 'period_start', 'period_end', 'source', 'authorization_ref'])
      body[key] = String(form.get(key) ?? '').trim();
    let count = 0;
    for (const [key] of dimensions) {
      const val = String(form.get(key) ?? '').trim();
      if (val) {
        body[key] = key.endsWith('_minor') ? Math.round(Number(val) * 100) : Number(val);
        count++;
      }
    }
    if (!count) {
      setMessage('Enter at least one observed result.');
      return;
    }
    setMessage('');
    save(body);
  }
  return (
    <form className="period-form" onSubmit={submit}>
      <p>
        Enter figures from a report your company can use. Assign each conversion and its value to one
        channel.
      </p>
      <div className="form-pair">
        <label>
          Channel
          <input
            name="channel"
            defaultValue={period?.channel}
            placeholder="Instagram"
            required
            maxLength={60}
            list="report-channels"
          />
        </label>
        <datalist id="report-channels">
          {['Instagram', 'YouTube', 'TikTok', 'Facebook', 'Direct'].map((c) => (
            <option key={c}>{c}</option>
          ))}
        </datalist>
        <label>
          Report source
          <input
            name="source"
            required
            minLength={2}
            maxLength={240}
            defaultValue={period?.source}
            placeholder="Source report or reference"
          />
        </label>
      </div>
      <div className="form-pair">
        <label>
          Period starts
          <input required type="date" name="period_start" defaultValue={period?.period_start} />
        </label>
        <label>
          Period ends
          <input required type="date" name="period_end" defaultValue={period?.period_end} />
        </label>
      </div>
      <fieldset>
        <legend>Observed results</legend>
        <p>Leave unavailable figures blank. All monetary amounts are HK dollars.</p>
        <div className="form-pair">
          {dimensions.map(([key, label]) => (
            <label key={key}>
              {label}
              <input
                name={key}
                type="number"
                min={key === 'contribution_minor' ? -10000000 : 0}
                max={key.endsWith('_minor') ? 10000000 : 1000000000000}
                step={key.endsWith('_minor') ? 0.01 : 1}
                defaultValue={
                  period?.[key] == null ? '' : Number(period[key]) / (key.endsWith('_minor') ? 100 : 1)
                }
              />
            </label>
          ))}
        </div>
      </fieldset>
      <label>
        Authorization reference
        <input
          required
          name="authorization_ref"
          minLength={2}
          maxLength={240}
          defaultValue={period?.authorization_ref}
          placeholder="Company-owned report or permission record"
        />
      </label>
      <label className="check-line">
        <input type="checkbox" required />
        My company can use and export these figures for this campaign.
      </label>
      {message && <p role="alert">{message}</p>}
      <button className="studio-primary" disabled={pending}>
        {pending ? 'Saving…' : 'Save reported results'}
      </button>
    </form>
  );
}

export function PerformanceReport({ id }: { id: string }) {
  const url = campaignBase + '/' + encodeURIComponent(id) + '/tracking';
  const [revision, setRevision] = useState(0);
  const [offset, setOffset] = useState(0);
  const request = useBusinessResource<Report>(url + '?offset=' + offset + '&limit=15', revision);
  const [form, setForm] = useState<{ id: string; period?: Period } | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const state = request.result;
  if (state.state === 'loading') return <p role="status">Opening campaign report…</p>;
  if (state.state === 'error') return <BusinessProblem error={state.error} retry={request.retry} />;
  const data = state.data;
  async function update(work: () => Promise<unknown>, success: string) {
    if (pending) return;
    setPending(true);
    setError('');
    setNotice('');
    try {
      await work();
      setForm(null);
      setRevision((r) => r + 1);
      setNotice(success);
    } catch (cause) {
      setError(reportError(cause));
    } finally {
      setPending(false);
    }
  }
  async function download() {
    setError('');
    try {
      const csv = await apiAttachment(url + '/export', new AbortController().signal, 'text/csv');
      const href = URL.createObjectURL(csv);
      const a = document.createElement('a');
      a.href = href;
      a.download = 'harbourline-performance.csv';
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(href), 1000);
    } catch (cause) {
      setError(reportError(cause));
    }
  }
  const errorMessage = error && (
    <p role="alert" className="business-feedback">
      {error}{' '}
      <button
        onClick={() => {
          request.retry();
          setError('');
        }}
      >
        Reload report
      </button>
    </p>
  );
  return (
    <section className="campaign-performance">
      <div className="report-actions">
        <label>
          Campaign status
          <select
            value={data.status}
            disabled={pending}
            onChange={(e) => {
              const status = e.target.value;
              void update(
                () => apiPatch(url, { version: data.version, status }, new AbortController().signal),
                'Campaign status updated.'
              );
            }}
          >
            {['planning', 'active', 'paused', 'completed'].map((s) => (
              <option value={s} key={s}>
                {s[0]?.toUpperCase() + s.slice(1)}
              </option>
            ))}
          </select>
        </label>
        <div className="biz-actions">
          <button className="studio-secondary" onClick={download}>
            Export report
          </button>
          <button
            className="studio-primary"
            onClick={() => {
              setError('');
              setForm({ id: crypto.randomUUID() });
            }}
          >
            Record results
          </button>
        </div>
      </div>
      {notice && <p role="status">{notice}</p>}
      {!form && errorMessage}
      {data.period_count > 0 && (
        <MetricStrip
          items={[
            { label: 'Reported impressions', value: showValue('impressions', data.actual.impressions) },
            {
              label: 'Attributed conversions',
              value: showValue('conversions', data.actual.conversions),
            },
            {
              label: 'Attributed revenue',
              value: showValue('revenue_minor', data.actual.revenue_minor),
            },
            { label: 'Return on ad spend', value: showValue('roas', data.actual.roas) },
          ]}
        />
      )}
      <Panel
        title="Reporting periods"
        description={
          data.period_count ? formatCount(data.period_count) + ' company-supplied reports' : undefined
        }
      >
        {data.periods.length > 0 ? (
          <>
            <div
              className="studio-table-scroll"
              tabIndex={0}
              role="region"
              aria-label="Reporting period records"
            >
              <table className="studio-table">
                <thead>
                  <tr>
                    <th>Period and channel</th>
                    <th>Source</th>
                    <th>Impressions</th>
                    <th>Conversions</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {data.periods.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <strong>{platformName(p.channel)}</strong>
                        <small>
                          {p.period_start} – {p.period_end}
                        </small>
                      </td>
                      <td>
                        {p.source}
                        <small>Recorded {displayDate(p.recorded_at)}</small>
                      </td>
                      <td>{showValue('impressions', p.impressions)}</td>
                      <td>{showValue('conversions', p.conversions)}</td>
                      <td>
                        <button
                          onClick={() => {
                            setError('');
                            setForm({ id: p.id, period: p });
                          }}
                        >
                          Edit
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {data.period_count > 15 && (
              <div className="market-paging">
                <button disabled={!offset} onClick={() => setOffset(Math.max(0, offset - 15))}>
                  Previous
                </button>
                <button
                  disabled={offset + 15 >= data.period_count}
                  onClick={() => setOffset(offset + 15)}
                >
                  Next
                </button>
              </div>
            )}
          </>
        ) : (
          <div className="business-empty">
            <h3>No results recorded</h3>
            <p>
              Add a period from your company’s channel report to compare actual results with the plan.
            </p>
          </div>
        )}
      </Panel>
      <Panel
        title="Actuals and plan"
        description="Compare company-reported results with your saved scenario. A dash means an input is unavailable."
      >
        <div className="studio-table-scroll" role="region" aria-label="Reported and assumed figures" tabIndex={0}>
          <table className="studio-table">
            <thead>
              <tr>
                <th>Measure</th>
                <th>Reported</th>
                <th>Scenario assumption</th>
              </tr>
            </thead>
            <tbody>
              {[...dimensions, ...rates].map(([key, label]) => (
                <tr key={key}>
                  <th scope="row">{label}</th>
                  <td>{showValue(key, data.actual[key])}</td>
                  <td>
                    {key.endsWith('_minor') && data.planned_currency && data.planned_currency !== 'HKD'
                      ? data.planned_currency +
                        ' ' +
                        (data.planned[key] == null ? '—' : Number(data.planned[key]) / 100)
                      : showValue(key, data.planned[key])}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <details className="market-observations">
          <summary>Calculation and coverage</summary>
          <p>
            Totals require every reported period to supply that measure. Unique reach is available for a
            single period. Returns use attributed revenue divided by advertising spend, or contribution
            after total campaign cost divided by total cost. A zero denominator leaves the return
            unavailable.
          </p>
        </details>
        <Link to="/plan">Edit scenario assumptions →</Link>
      </Panel>
      {form && (
        <Overlay
          title={form.period ? 'Edit reported results' : 'Record campaign results'}
          close={() => {
            if (!pending) setForm(null);
          }}
        >
          {errorMessage}
          <PeriodForm
            period={form.period}
            pending={pending}
            save={(body) =>
              void update(
                () =>
                  apiPut(
                    url + '/periods/' + form.id,
                    { ...body, version: data.version },
                    new AbortController().signal
                  ),
                'Reporting period saved.'
              )
            }
          />
          {form.period && (
            <button
              className="revoke-report"
              disabled={pending}
              onClick={() => {
                if (window.confirm('Withdraw this reporting period from the campaign and its exports?'))
                  void update(
                    () =>
                      apiDelete(
                        url + '/periods/' + form.id + '?version=' + data.version,
                        new AbortController().signal
                      ),
                    'Reporting period withdrawn.'
                  );
              }}
            >
              Withdraw reporting period
            </button>
          )}
        </Overlay>
      )}
    </section>
  );
}
