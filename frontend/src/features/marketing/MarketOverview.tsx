import { useState } from 'react';
import { MarketMeasures } from './MarketMeasures';
import { Link, useNavigate } from 'react-router';
import { PageHeader, Panel } from '../../components/studio/Workspace';
import {
  BusinessProblem,
  campaignBase,
  displayDate,
  formatCount,
  marketBase,
  Platform,
  SourceLink,
  useBusinessResource,
  type CampaignSummary,
  type CreatorRecord,
  type MarketSummary,
  type Results,
} from './marketLibrary';

function PublicationTrend({ summary }: { summary: MarketSummary }) {
  const months = summary.months ?? [];
  const [hover, setHover] = useState<string | null>(null);
  const max = Math.max(...months.map((m) => m.activity_count), 1);
  const selected = months.find((m) => m.month === hover);
  return (
    <section className="trend-panel">
      <div className="trend-heading">
        <div>
          <h2>Publication activity</h2>
          <p>Collected works by publication month</p>
        </div>
        <strong>
          {selected
            ? formatCount(selected.activity_count)
            : formatCount(months.reduce((s, m) => s + m.activity_count, 0))}
          <small>{selected ? selected.month : 'Trailing 12 months'}</small>
        </strong>
      </div>
      {months.length && summary.activity_count ? (
        <>
          <div className="publication-chart">
            <div className="chart-scale">
              <span>{formatCount(max)}</span>
              <span>0</span>
            </div>
            <div className="chart-bars">
              {months.map((m) => (
                <button
                  key={m.month}
                  aria-label={m.month + ' · ' + m.activity_count + ' publications'}
                  onFocus={() => setHover(m.month)}
                  onBlur={() => setHover(null)}
                  onMouseOver={() => setHover(m.month)}
                  onMouseLeave={() => setHover(null)}
                  type="button"
                  onClick={() => setHover(m.month)}
                  className={m.month === hover ? 'selected' : ''}
                >
                  <i style={{ height: (100 * m.activity_count) / max + '%' }} />
                </button>
              ))}
            </div>
          </div>
          <div className="chart-labels">
            <span>{months[0]?.month}</span>
            <span>{months.at(-1)?.month}</span>
          </div>
          <details className="chart-data">
            <summary>View monthly counts</summary>
            <dl>
              {months.map((m) => (
                <div key={m.month}>
                  <dt>{m.month}</dt>
                  <dd>{formatCount(m.activity_count)}</dd>
                </div>
              ))}
            </dl>
          </details>
        </>
      ) : (
        <p className="business-empty">
          Publication activity will appear when eligible sources have published records.
        </p>
      )}
    </section>
  );
}

export function PlatformAnalysis() {
  const request = useBusinessResource<MarketSummary>(marketBase + '/overview');
  const state = request.result;
  return (
    <div className="biz-page">
      <PageHeader
        title="Platform analysis"
        description="Compare published activity and the evidence available from each platform."
      />
      {state.state === 'error' ? (
        <BusinessProblem error={state.error} retry={request.retry} />
      ) : state.state === 'loading' ? (
        <p role="status">Opening platform activity…</p>
      ) : (
        <>
          <MarketMeasures />
          <PublicationTrend summary={state.data} />
          <Panel
            title="Platform comparison"
            description="Publication counts cover the collected catalog. Source-specific interactions have different definitions."
          >
            <div
              role="region"
              aria-label="Platform publication counts"
              className="studio-table-scroll"
              tabIndex={0}
            >
              <table className="studio-table">
                <thead>
                  <tr>
                    <th>Platform</th>
                    <th>Creators</th>
                    <th>Publications</th>
                    <th>Works with measures</th>
                    <th>Latest publication</th>
                  </tr>
                </thead>
                <tbody>
                  {state.data.platforms.map((p) => (
                    <tr key={p.platform}>
                      <td>
                        <Link to={'/creators?platform=' + encodeURIComponent(p.platform)}>
                          <Platform value={p.platform} />
                        </Link>
                      </td>
                      <td>{formatCount(p.creator_count)}</td>
                      <td>{formatCount(p.activity_count)}</td>
                      <td>
                        {formatCount(p.measured_count)}
                        <small>{p.measurement_scope}</small>
                      </td>
                      <td>{displayDate(p.latest_published_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!state.data.platforms.length && (
              <p className="business-empty">
                No platforms have published eligible records yet.{' '}
                <Link to="/research">Start a research request</Link>
              </p>
            )}
          </Panel>
          <details className="market-observations">
            <summary>How to read platform activity</summary>
            <p>
              The same person may use different publishing accounts. Publication volume describes the
              collected works. Likes, comments and views use the individual source’s definitions.
              Audience size and advertising returns require separate evidence.
            </p>
          </details>
        </>
      )}
    </div>
  );
}

function DiningSearchLink() {
  const query = new URLSearchParams({ q: 'affordable dining' });
  const { result } = useBusinessResource<Results<CreatorRecord>>(
    marketBase + '/creators?' + query + '&page_size=1'
  );
  const related = result.state === 'ready' ? result.data.related : undefined;
  const hasRelatedCoverage = related?.basis === 'dining_coverage_without_price_evidence';
  return (
    <span>
      <Link to={'/creators?' + query} aria-describedby={hasRelatedCoverage ? 'dining-search-coverage' : undefined}>
        Affordable dining
      </Link>
      {hasRelatedCoverage && (
        <span id="dining-search-coverage">
          {' · '}{formatCount(related.total)} related {related.total === 1 ? 'match' : 'matches'} without verified prices
        </span>
      )}
    </span>
  );
}

export function MarketOverview() {
  const navigate = useNavigate();
  const market = useBusinessResource<MarketSummary>(marketBase + '/overview');
  const campaigns = useBusinessResource<CampaignSummary[]>(campaignBase + '/summaries?limit=5');
  const available = market.result.state === 'ready' ? market.result.data : undefined;
  const topics = available?.topics.map((entry) => entry.value) ?? [];
  const entryTopics = [...new Set(['Dining', 'Urban travel', 'Outdoor photography', ...topics])]
    .filter((topic) => topics.includes(topic))
    .slice(0, 3);
  const latest = [...(available?.latest_by_source ?? [])].sort((a, b) =>
    b.published_at.localeCompare(a.published_at)
  );
  return (
    <div className="biz-page overview-desk">
      <PageHeader
        title="Market overview"
        actions={
          <Link className="studio-primary" to="/research">
            Start campaign research
          </Link>
        }
      />
      <section className="overview-search">
        <div>
          <h2>Find creators covering Hong Kong</h2>
          <form
            role="search"
            onSubmit={(e) => {
              e.preventDefault();
              const q = String(new FormData(e.currentTarget).get('q') ?? '').trim();
              navigate('/creators' + (q ? '?' + new URLSearchParams({ q }) : ''));
            }}
          >
            <label className="sr-only" htmlFor="overview-search">
              Creator name or topic
            </label>
            <input
              type="search"
              id="overview-search"
              name="q"
              placeholder="Creator name, industry or topic"
              maxLength={120}
            />
            <button className="studio-primary">Search creators</button>
          </form>
          {entryTopics.length > 0 && (
            <p className="suggested-topics">
              Try a search{' '}
              {entryTopics.map((topic) => topic === 'Dining' ? (
                <DiningSearchLink key={topic} />
              ) : (
                <Link key={topic} to={'/creators?topic=' + encodeURIComponent(topic)}>
                  {topic}
                </Link>
              ))}
            </p>
          )}
        </div>
      </section>
      <div className="biz-two-col">
        <div className="overview-primary">
          <Panel
            title="Latest work from each source"
            actions={<Link to="/creators">Explore creators →</Link>}
          >
            {available ? (
              latest.length ? (
                <ol className="latest-works">
                  {latest.map((a) => (
                    <li key={a.id}>
                      <div>
                        <Platform value={a.platform} />
                        <time dateTime={a.published_at}>{displayDate(a.published_at)}</time>
                      </div>
                      <h3>
                        <SourceLink url={a.url}>{a.title}</SourceLink>
                      </h3>
                      <Link to={'/creators/' + encodeURIComponent(a.creator_id)}>{a.creator_name}</Link>{' '}
                      {a.credit_role && <small>· {a.credit_role}</small>}
                    </li>
                  ))}
                </ol>
              ) : (
                <p>
                  There are no eligible publications yet.{' '}
                  <Link to="/research">Research a campaign brief</Link> to check available sources.
                </p>
              )
            ) : market.result.state === 'error' ? (
              <BusinessProblem error={market.result.error} retry={market.retry} />
            ) : (
              <p role="status">Opening publications…</p>
            )}
          </Panel>
          {market.result.state === 'error' ? (
            <BusinessProblem error={market.result.error} retry={market.retry} />
          ) : available ? (
            <PublicationTrend summary={available} />
          ) : (
            <p role="status">Loading market activity…</p>
          )}
        </div>
        <aside>
          <Panel
            title="Platform activity"
            actions={
              <Link to="/platforms" aria-label="Compare platforms">
                Compare →
              </Link>
            }
          >
            {available && available.platforms.length > 0 ? (
              <ul className="platform-scale">
                {available.platforms.map((p) => (
                  <li key={p.platform}>
                    <Link to={'/creators?platform=' + encodeURIComponent(p.platform)}>
                      <Platform value={p.platform} />
                      <strong>{formatCount(p.activity_count)}</strong>
                    </Link>
                    <meter
                      min={0}
                      max={Math.max(...available.platforms.map((item) => item.activity_count), 1)}
                      value={p.activity_count}
                      aria-label="Published works"
                    />
                  </li>
                ))}
              </ul>
            ) : (
              <p>{available ? 'No platform observations yet.' : 'Loading platforms…'}</p>
            )}
            {available?.latest_observed_at && (
              <p className="biz-caption">
                Publications observed through {displayDate(available.latest_observed_at)}.
              </p>
            )}
          </Panel>
          <Panel title="Your campaigns" actions={<Link to="/campaigns">View all →</Link>}>
            {campaigns.result.state === 'ready' ? (
              campaigns.result.data.length > 0 ? (
                <ul className="portfolio-mini">
                  {campaigns.result.data.map((c) => (
                    <li key={c.id}>
                      <Link to={'/campaigns/' + c.id}>{c.name}</Link>
                      <span>{c.status}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <>
                  <p>
                    Create a campaign to keep a brief, shortlisted creators and performance reports
                    together.
                  </p>
                  <Link to="/campaigns?new=1">Create campaign →</Link>
                </>
              )
            ) : campaigns.result.state === 'error' ? (
              <BusinessProblem error={campaigns.result.error} retry={campaigns.retry} />
            ) : (
              <p role="status">Loading campaigns…</p>
            )}
          </Panel>
        </aside>
      </div>
    </div>
  );
}
