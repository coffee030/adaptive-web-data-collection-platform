import { useState, useEffect, type FormEvent } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { PageHeader, Panel } from '../../components/studio/Workspace';
import { MarketMeasures } from './MarketMeasures';
import { Overlay } from './components';
import {
  BusinessProblem,
  displayDate,
  formatCount,
  marketBase,
  Platform,
  platformName,
  SaveMarketLead,
  SourceLink,
  useBusinessResource,
  type Activity,
  type CreatorDetail,
  type CreatorRecord,
  type Results,
  type MarketSummary,
} from './marketLibrary';

function SampleWork({ post }: { post: Activity }) {
  return (
    <article className="work-item">
      <div className="work-meta">
        <Platform value={post.platform} />
        <time dateTime={post.published_at}>{displayDate(post.published_at)}</time>
      </div>
      <h3>
        <SourceLink url={post.url}>{post.title}</SourceLink>
      </h3>
      {post.credit_role && (
        <p>
          {post.credit_role} · {post.creator_name}
          {post.series_title && <> · {post.series_title}</>}
        </p>
      )}
      {post.metrics.length > 0 && (
        <dl className="work-measures">
          {post.metrics.map((metric) => (
            <div key={metric.key}>
              <dt>{metric.label}</dt>
              <dd>{formatCount(metric.value)}</dd>
            </div>
          ))}
        </dl>
      )}
      <details>
        <summary>Source and usage</summary>
        <p>
          {post.attribution || 'Credited to ' + post.creator_name}. Observed{' '}
          {displayDate(post.observed_at)}. <SourceLink url={post.license_url}>Usage terms</SourceLink>{' '}
          {post.credit_url && <SourceLink url={post.credit_url}>Presenter credit</SourceLink>}{' '}
          {post.broadcaster_url && <SourceLink url={post.broadcaster_url}>Broadcaster</SourceLink>}
        </p>
      </details>
    </article>
  );
}

function ComparisonColumn({ id }: { id: string }) {
  const request = useBusinessResource<CreatorDetail>(marketBase + '/creators/' + encodeURIComponent(id));
  if (request.result.state === 'error')
    return <BusinessProblem error={request.result.error} retry={request.retry} />;
  if (request.result.state === 'loading') return <p role="status">Opening creator…</p>;
  const creator = request.result.data;
  return (
    <section>
      <Platform value={creator.platform} />
      <h3>
        <Link to={'/creators/' + encodeURIComponent(id)}>{creator.name}</Link>
      </h3>
      <dl className="compare-facts">
        <div>
          <dt>Published works in catalog</dt>
          <dd>{formatCount(creator.activity_count)}</dd>
        </div>
        <div>
          <dt>Latest publication</dt>
          <dd>{displayDate(creator.latest_published_at)}</dd>
        </div>
        <div>
          <dt>Topics</dt>
          <dd>{creator.topics.slice(0, 4).join(', ') || 'Unavailable'}</dd>
        </div>
      </dl>
      <SaveMarketLead creator={creator} showCampaignLink />
      <details className="comparison-evidence">
        <summary>View source and interactions</summary>
        {creator.example && <SampleWork post={creator.example} />}
        <MarketMeasures creatorId={creator.id} />
      </details>
    </section>
  );
}

export function MarketDiscovery() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const platform = params.get('platform') ?? '';
  const topic = params.get('topic') ?? '';
  const sort = params.get('sort') ?? 'recent';
  const page = Math.max(1, Number(params.get('page')) || 1);
  const selected = Array.from(new Set(params.getAll('compare'))).slice(0, 4);
  const [query, setQuery] = useState(q);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [comparing, setComparing] = useState(false);
  useEffect(() => setQuery(q), [q]);
  const search = new URLSearchParams({ page: String(page), page_size: '15', sort });
  if (q) search.set('q', q);
  if (platform) search.set('platform', platform);
  if (topic) search.set('topic', topic);
  const list = useBusinessResource<Results<CreatorRecord>>(marketBase + '/creators?' + search);
  const catalog = useBusinessResource<MarketSummary>(marketBase + '/overview');
  function update(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.delete('page');
    setParams(next);
  }
  function compare(id: string) {
    const next = new URLSearchParams(params);
    if (selected.includes(id)) next.delete('compare', id);
    else if (selected.length < 4) next.append('compare', id);
    setParams(next, { replace: true });
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    update('q', query.trim());
  }
  const data = list.result.state === 'ready' ? list.result.data : undefined;
  const summary = catalog.result.state === 'ready' ? catalog.result.data : undefined;
  return (
    <div className="biz-page">
      <PageHeader
        title="Creator discovery"
        description="Find contributors by name, topic or published work."
        actions={
          <Link className="studio-primary" to="/research">
            Start research
          </Link>
        }
      />
      <nav className="business-tabs" aria-label="Creator catalog">
        <span aria-current="page">Published work</span>
        <Link to="/creators/company">Company evidence</Link>
      </nav>
      <form className="market-controls" onSubmit={submit}>
        <label className="market-query">
          Search creators
          <div>
            <input
              type="search"
              value={query}
              maxLength={120}
              placeholder="Name or topic"
              onChange={(e) => setQuery(e.target.value)}
            />
            <button className="studio-primary">Search</button>
          </div>
        </label>
        <button
          type="button"
          className="mobile-filter-button"
          aria-expanded={filtersOpen}
          aria-controls="creator-filters"
          onClick={() => setFiltersOpen(!filtersOpen)}
        >
          Filters and sort
          {platform || topic
            ? ' · ' + [platform && platformName(platform), topic].filter(Boolean).join(', ')
            : ''}
        </button>
        <div id="creator-filters" className="supplemental-filters" data-open={filtersOpen}>
          <label>
            Platform
            <select value={platform} onChange={(e) => update('platform', e.target.value)}>
              <option value="">All platforms</option>
              {(summary?.platforms ?? []).map((item) => (
                <option key={item.platform} value={item.platform}>
                  {platformName(item.platform)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Topic
            <select value={topic} onChange={(e) => update('topic', e.target.value)}>
              <option value="">All topics</option>
              {topic && !(summary?.topics ?? []).some((t) => t.value === topic) && (
                <option>{topic}</option>
              )}
              {(summary?.topics ?? []).map((item) => (
                <option key={item.value} value={item.value}>
                  {item.value}
                </option>
              ))}
            </select>
          </label>
          <label>
            Sort by
            <select value={sort} onChange={(e) => update('sort', e.target.value)}>
              <option value="recent">Latest work</option>
              <option value="activity">Most publications</option>
              <option value="name">Creator name</option>
            </select>
          </label>
        </div>
      </form>
      <div className="results-heading">
        <h2>
          {data
            ? formatCount(data.total) + ' ' + (data.total === 1 ? 'creator' : 'creators')
            : 'Search results'}
        </h2>
        {selected.length > 0 && (
          <button
            className="studio-secondary"
            disabled={selected.length < 2}
            onClick={() => setComparing(true)}
          >
            Compare {selected.length} selected
          </button>
        )}
      </div>
      {list.result.state === 'loading' && <p role="status">Finding creators…</p>}
      {list.result.state === 'error' && <BusinessProblem error={list.result.error} retry={list.retry} />}
      {data &&
        (data.items.length ? (
          <>
            <div
              className="studio-table-scroll discovery-results"
              role="region"
              aria-label="Creator results"
              tabIndex={0}
            >
              <table className="studio-table">
                <thead>
                  <tr>
                    <th>Compare</th>
                    <th>Creator</th>
                    <th>Recent work</th>
                    <th>Publications</th>
                    <th>Latest</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((person) => (
                    <tr key={person.id}>
                      <td>
                        <input
                          aria-label={'Compare ' + person.name}
                          type="checkbox"
                          checked={selected.includes(person.id)}
                          disabled={!selected.includes(person.id) && selected.length >= 4}
                          onChange={() => compare(person.id)}
                        />
                      </td>
                      <td>
                        <Link
                          className="creator-title"
                          to={{
                            pathname: '/creators/' + encodeURIComponent(person.id),
                            search: '?' + params,
                          }}
                        >
                          {person.name}
                        </Link>
                        <Platform value={person.platform} />
                      </td>
                      <td>{person.example?.title ?? 'No credited example available'}</td>
                      <td className="numeric">
                        <span className="row-label">Publications </span>
                        {formatCount(person.activity_count)}
                      </td>
                      <td>
                        <span className="row-label">Latest </span>
                        {displayDate(person.latest_published_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="market-paging">
              <span>
                Page {page} of {Math.ceil(data.total / data.page_size)}
              </span>
              <button disabled={page === 1} onClick={() => update('page', String(page - 1))}>
                Previous
              </button>
              <button
                disabled={page * data.page_size >= data.total}
                onClick={() => update('page', String(page + 1))}
              >
                Next
              </button>
            </div>
          </>
        ) : (
          <div className="business-empty">
            <h3>{page > 1 ? 'No creators on this page' : 'No exact matches in these creator sources'}</h3>
            <p>
              Campaign Advisor can also check archived work and company evidence for this brief.
            </p>
            {data.related?.basis === 'dining_coverage_without_price_evidence' && (
              <section className="related-discovery">
                <h3>Related dining coverage</h3>
                <p>
                  These presenters cover Hong Kong food. Meal prices are unverified in their published credits.
                </p>
                <ul>
                  {data.related.items.map((creator) => (
                    <li key={creator.id}>
                      <Link to={'/creators/' + encodeURIComponent(creator.id) + '?' + params}>
                        {creator.name}
                      </Link>
                      {creator.example && (
                        <span>{creator.example.series_title || creator.example.title}</span>
                      )}
                    </li>
                  ))}
                </ul>
                <Link
                  to={
                    '/creators?' +
                    new URLSearchParams({ q: data.related.query, ...(platform ? { platform } : {}) })
                  }
                >
                  Explore dining coverage →
                </Link>
              </section>
            )}
            <div className="biz-actions">
              <button
                className="studio-secondary"
                onClick={() => {
                  setQuery('');
                  setParams({});
                }}
              >
                Show all creators
              </button>
              <Link to={'/research' + (q ? '?q=' + encodeURIComponent(q) : '')}>
                Research this brief →
              </Link>
            </div>
          </div>
        ))}
      {comparing && (
        <Overlay wide close={() => setComparing(false)} title="Compare creators">
          <div className="market-compare">
            {selected.map((id) => (
              <ComparisonColumn key={id} id={id} />
            ))}
          </div>
          <p className="studio-muted">
            Publication counts describe the collected work. Confirm audience fit, current availability
            and fees with each creator.
          </p>
        </Overlay>
      )}
    </div>
  );
}

export function MarketProfile() {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const resource = useBusinessResource<CreatorDetail>(
    marketBase + '/creators/' + encodeURIComponent(id)
  );
  const state = resource.result;
  return (
    <div className="biz-page">
      <Link className="business-back" to={'/creators?' + params}>
        ← Creator discovery
      </Link>
      {state.state === 'loading' ? (
        <p role="status">Opening profile…</p>
      ) : state.state === 'error' ? (
        <BusinessProblem error={state.error} retry={resource.retry} />
      ) : (
        <>
          <PageHeader
            title={state.data.name}
            description={<Platform value={state.data.platform} />}
            actions={<SaveMarketLead creator={state.data} showCampaignLink />}
          />
          <div className="biz-two-col">
            <section>
              <h2>Published work</h2>
              <div className="work-list">
                {state.data.activity.map((post) => (
                  <SampleWork key={post.id} post={post} />
                ))}
              </div>
            </section>
            <aside>
              <Panel title="Creator details">
                <dl className="compare-facts">
                  <div>
                    <dt>Publications in catalog</dt>
                    <dd>{formatCount(state.data.activity_count)}</dd>
                  </div>
                  <div>
                    <dt>Most recent</dt>
                    <dd>{displayDate(state.data.latest_published_at)}</dd>
                  </div>
                  <div>
                    <dt>Topics</dt>
                    <dd>{state.data.topics.slice(0, 6).join(', ') || 'Unavailable'}</dd>
                  </div>
                </dl>
                <SourceLink url={state.data.profile_url}>Publisher profile</SourceLink>
              </Panel>
              <MarketMeasures creatorId={state.data.id} />
              <Panel title="Campaign eligibility">
                <p>
                  Current audience, availability and fees require company evidence. Save this creator for
                  outreach or check your company’s supplied records.
                </p>
                <Link to="/creators/company">Inspect company evidence →</Link>
              </Panel>
            </aside>
          </div>
          {state.data.measurements.length > 0 && (
            <details className="market-observations">
              <summary>Measurement history</summary>
              <ul>
                {state.data.measurements.map((row, index) => (
                  <li key={row.activity_id + row.observed_at + index}>
                    <strong>
                      {state.data.activity.find((a) => a.id === row.activity_id)?.title ?? 'Publication'}
                    </strong>{' '}
                    · {displayDate(row.observed_at)} ·{' '}
                    {row.metrics.map((m) => m.label + ' ' + formatCount(m.value)).join(' · ')}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </div>
  );
}
