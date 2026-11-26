import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { PageHeader, Panel } from '../../components/studio/Workspace';
import { blankBrief } from './contracts';
import { apiAttachment } from '../../lib/api';
import {
  BusinessProblem,
  campaignBase,
  displayDate,
  marketBase,
  money,
  Platform,
  SaveMarketLead,
  useBusinessResource,
  type CampaignSummary,
  type CreatorDetail,
} from './marketLibrary';
import { Overlay } from './components';
import { PerformanceReport } from './PerformanceReport';
import { useMarketing } from './workspace';

function SavedLead({ id }: { id: string }) {
  const request = useBusinessResource<CreatorDetail>(marketBase + '/creators/' + encodeURIComponent(id));
  const result = request.result;
  const { setDraft } = useMarketing();
  if (result.state === 'loading') return <li role="status">Opening saved creator…</li>;
  if (result.state === 'error')
    return (
      <li>
        <span>Creator unavailable</span>
        <button
          onClick={() =>
            setDraft((old) => ({
              ...old,
              market_leads: old.market_leads?.filter((lead) => lead !== id),
            }))
          }
        >
          Remove from shortlist
        </button>
      </li>
    );
  return (
    <li>
      <div>
        <Link to={'/creators/' + encodeURIComponent(id)}>{result.data.name}</Link>
        <Platform value={result.data.platform} />
      </div>
      <SaveMarketLead creator={result.data} />
    </li>
  );
}

function RateRequest({ id, version }: { id: string; version: number }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function download() {
    setBusy(true);
    setError('');
    try {
      const file = await apiAttachment(
        campaignBase + '/' + id + '/rate-request?version=' + version,
        new AbortController().signal,
        'text/csv'
      );
      const href = URL.createObjectURL(file);
      const anchor = document.createElement('a');
      anchor.href = href;
      anchor.download = 'harbourline-rate-request.csv';
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(href), 1000);
    } catch {
      setError(
        'The shortlist changed or its sources are unavailable. Reopen the campaign and check the saved creators.'
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      <button className="studio-secondary" disabled={busy} onClick={download}>
        Download rate request
      </button>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}

export function CampaignDetail({ report = false }: { report?: boolean }) {
  const { id = '' } = useParams();
  const { campaignReceipt, openDraft, draft, otherDrafts } = useMarketing();
  const same = campaignReceipt?.id === id;
  const available = otherDrafts().some((item) => item.key === id);
  useEffect(() => {
    if (!same && available) openDraft(id);
  }, [same, id, available, openDraft]);
  if (!same && !available)
    return (
      <section className="biz-page business-empty">
        <h1>Campaign unavailable</h1>
        <p>This campaign could not be found in your company workspace.</p>
        <Link to="/campaigns">Open campaigns</Link>
      </section>
    );
  if (!same || !campaignReceipt || campaignReceipt.version === 0 || campaignReceipt.pending)
    return (
      <p className="biz-page" role="status">
        Opening the saved campaign…
      </p>
    );
  return (
    <div className="biz-page">
      <Link className="business-back" to={report ? '/reports' : '/campaigns'}>
        ← {report ? 'Campaign reports' : 'Campaigns'}
      </Link>
      <PageHeader
        title={draft.brief.name || 'Untitled campaign'}
        description={draft.brief.description || undefined}
        actions={
          <Link className="studio-secondary" to="/advisor">
            Edit campaign brief
          </Link>
        }
      />
      <nav aria-label="Campaign views" className="business-tabs">
        <Link to={'/campaigns/' + id} aria-current={!report ? 'page' : undefined}>
          Plan and shortlist
        </Link>
        <Link to={'/reports/' + id} aria-current={report ? 'page' : undefined}>
          Performance report
        </Link>
      </nav>
      {report ? (
        <PerformanceReport key={id} id={id} />
      ) : (
        <>
          <div className="biz-two-col">
            <Panel title="Campaign plan" actions={<Link to="/plan">Open plan →</Link>}>
              <dl className="compare-facts">
                <div>
                  <dt>Planning budget</dt>
                  <dd>{money(Math.round(draft.brief.budget * 100))}</dd>
                </div>
                <div>
                  <dt>Objective</dt>
                  <dd>{draft.brief.objective || 'Unspecified'}</dd>
                </div>
                <div>
                  <dt>Required</dt>
                  <dd>{draft.brief.required || 'None specified'}</dd>
                </div>
                <div>
                  <dt>Preferred</dt>
                  <dd>{draft.brief.preferred || 'None specified'}</dd>
                </div>
              </dl>
              <Link className="studio-primary" to={'/research?' + new URLSearchParams({ campaign: id })}>
                Research this campaign
              </Link>
            </Panel>
            <Panel
              title="Saved creators"
              description="Public contributors selected for outreach. Confirm current rates and audience before booking."
            >
              {draft.market_leads?.length ? (
                <ul className="saved-leads">
                  {draft.market_leads.map((key) => (
                    <SavedLead key={key} id={key} />
                  ))}
                </ul>
              ) : (
                <p>
                  Your shortlist is empty. <Link to="/creators">Find creators →</Link>
                </p>
              )}
              {Boolean(draft.market_leads?.length) && (
                <RateRequest id={id} version={campaignReceipt.version} />
              )}
              {draft.shortlist.length > 0 && (
                <Link to="/creators/company">
                  {draft.shortlist.length} company-evidence candidates →
                </Link>
              )}
            </Panel>
          </div>
          <Panel title="Campaign performance">
            <p>
              Manage campaign status, record authorized results and compare with your planned outcomes.
            </p>
            <Link to={'/reports/' + id}>Open performance report →</Link>
          </Panel>
        </>
      )}
    </div>
  );
}

export function CampaignDesk({ reports = false }: { reports?: boolean }) {
  const [params, setParams] = useSearchParams();
  const { openDraft } = useMarketing();
  const navigate = useNavigate();
  const [offset, setOffset] = useState(0);
  const result = useBusinessResource<CampaignSummary[]>(
    campaignBase + '/summaries?limit=16&offset=' + offset
  );
  const creating = !reports && params.has('new');
  function newCampaign(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const name = String(form.get('name') ?? '').trim(),
      description = String(form.get('description') ?? '').trim();
    if (!name || !description) return;
    const id = openDraft(undefined, {
      ...blankBrief,
      name,
      description,
      budget: Number(form.get('budget')),
      objective: String(form.get('objective')),
    });
    if (id) navigate('/campaigns/' + id);
  }
  const data = result.result.state === 'ready' ? result.result.data : undefined;
  return (
    <div className="biz-page">
      <PageHeader
        title={reports ? 'Campaign reports' : 'Campaigns'}
        description={
          reports
            ? 'Review reported performance against each campaign’s planned outcomes.'
            : 'Manage briefs, shortlists and budgets with your team.'
        }
        actions={
          !reports && (
            <button className="studio-primary" onClick={() => setParams({ new: '1' })}>
              Create campaign
            </button>
          )
        }
      />
      {result.result.state === 'error' && (
        <BusinessProblem error={result.result.error} retry={result.retry} />
      )}
      {result.result.state === 'loading' && <p role="status">Loading campaigns…</p>}
      {data &&
        (data.length > 0 ? (
          <>
            <div
              className="studio-table-scroll"
              role="region"
              aria-label={reports ? 'Available reports' : 'Company campaigns'}
              tabIndex={0}
            >
              <table className="studio-table">
                <thead>
                  <tr>
                    <th>Campaign</th>
                    <th>Status</th>
                    <th>Last updated</th>
                    <th>Workspace</th>
                  </tr>
                </thead>
                <tbody>
                  {data.slice(0, 15).map((c) => (
                    <tr key={c.id}>
                      <td>
                        <Link
                          className="creator-title"
                          to={(reports ? '/reports/' : '/campaigns/') + c.id}
                        >
                          {c.name}
                        </Link>
                      </td>
                      <td>
                        <span className={'campaign-state state-' + c.status}>{c.status}</span>
                      </td>
                      <td>{displayDate(c.updated_at)}</td>
                      <td>
                        <Link to={(reports ? '/reports/' : '/campaigns/') + c.id}>
                          {reports ? 'View report' : 'Open campaign'} →
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {(offset > 0 || data.length > 15) && (
              <div className="market-paging">
                <button disabled={!offset} onClick={() => setOffset(Math.max(0, offset - 15))}>
                  Previous
                </button>
                <button disabled={data.length <= 15} onClick={() => setOffset(offset + 15)}>
                  Next
                </button>
              </div>
            )}
          </>
        ) : (
          <div className="business-empty">
            <h2>{reports ? 'No campaign reports yet' : 'Your first campaign'}</h2>
            <p>
              {reports
                ? 'Reports open as soon as a company campaign has been saved.'
                : 'Start with your campaign goal and budget. Add creators as you research.'}
            </p>
            <Link className="studio-secondary" to="/campaigns?new=1">
              Create a campaign
            </Link>
          </div>
        ))}
      {creating && (
        <Overlay title="Create campaign" close={() => setParams({})}>
          <form className="period-form" onSubmit={newCampaign}>
            <label>
              Campaign name
              <input name="name" required maxLength={160} />
            </label>
            <label>
              Campaign brief
              <textarea
                name="description"
                required
                maxLength={2000}
                rows={3}
                placeholder="Describe your product, customer and goal"
              />
            </label>
            <div className="form-pair">
              <label>
                Budget (HK$)
                <input type="number" min={0} max={10000000} step={0.01} name="budget" required />
              </label>
              <label>
                Objective
                <select name="objective">
                  <option>Local awareness</option>
                  <option>Engagement</option>
                  <option>Conversions</option>
                </select>
              </label>
            </div>
            <button className="studio-primary">Save campaign</button>
          </form>
        </Overlay>
      )}
    </div>
  );
}
