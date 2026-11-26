import { useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { apiPost } from '../../lib/api';
import { isLocalOperator, localOperatorHelp } from '../operator/operator';
import { worldwideTrendsPath } from '../operator/OperationsTasks';
import { actionProblem, articleTitle, daysAgo, number, trendBase, type Discovery, type Provider, type Series } from './api';
import { useAction } from '../topic-collections/support';

interface Sample { project: string; article: string; day: string; rank?: number }

function ArticleSeries({ sample, provider, refresh }: {
  sample: Sample; provider: Provider; refresh: () => void;
}) {
  const approval = useAction(actionProblem);
  const save = useAction(actionProblem);
  const [saved, setSaved] = useState<Series>();
  const earliest = daysAgo(90);
  const latest = daysAgo(2);
  const initial = sample.day < earliest ? earliest : sample.day > latest ? latest : sample.day;

  function approve(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isLocalOperator() || provider.blocked) return;
    const approver = String(new FormData(event.currentTarget).get('approver')).trim();
    void approval.run(signal => apiPost<Provider>(trendBase + '/provider', {
      project: sample.project, article: sample.article, day: sample.day, approver,
    }, signal, 30000).catch(cause => { refresh(); throw cause; }), refresh);
  }

  function schedule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!provider.authorized || provider.blocked) return;
    const form = new FormData(event.currentTarget);
    void save.run(signal => apiPost<Series>(trendBase + '/series', {
      project: sample.project, article: sample.article, day: form.get('day'), topic: String(form.get('topic')).trim(),
    }, signal), setSaved);
  }

  return <div className="trend-body">
    <h3>{articleTitle(sample.article)}</h3>
    <p>{sample.project} · {sample.rank ? 'Rank ' + number.format(sample.rank) + ' on ' + sample.day + ' UTC' : 'Operator-entered article title'}</p>
    {!provider.authorized && !provider.blocked && (
      isLocalOperator() ? <form className="operator-review trend-fields" onSubmit={approve}>
        <h4>Approve the Wikimedia source</h4>
        <p>Core validates this article and date against the daily pageview mapping before scheduling collection.</p>
        <label>Approver name<input name="approver" required maxLength={128} /></label>
        <label className="trend-choice"><input type="checkbox" required />I reviewed the <a href={provider.policy}>publisher access policy</a> and approve this source.</label>
        <button type="submit" disabled={approval.busy}>{approval.busy ? 'Validating sample…' : 'Approve source'}</button>
        {approval.error && <p role="alert">{approval.error}</p>}
      </form> : <p className="notice">{localOperatorHelp}</p>
    )}
    {provider.authorized && !provider.blocked && !saved && <form className="trend-fields" onSubmit={schedule}>
      <label>Topic name<input name="topic" required maxLength={128} defaultValue={articleTitle(sample.article)} /></label>
      <label>First collection date (UTC)<input type="date" name="day" min={earliest} max={latest} defaultValue={initial} required /></label>
      <p className="muted">Choose a start date between {earliest} and {latest}. Core schedules later days automatically.</p>
      <button className="primary" type="submit" disabled={save.busy}>{save.busy ? 'Saving…' : 'Save series'}</button>
      {save.error && <p role="alert">{save.error}</p>}
    </form>}
    {saved && <p role="status">Saved {saved.topic} for {saved.project}. <Link to={worldwideTrendsPath + '?view=saved'}>Open saved series</Link></p>}
  </div>;
}

export function DiscoveryPane({ provider, refresh }: { provider: Provider; refresh: () => void }) {
  const request = useAction(actionProblem);
  const [found, setFound] = useState<Discovery>();
  const [selected, setSelected] = useState<Sample>();
  const [known, setKnown] = useState(false);
  const detail = useRef<HTMLHeadingElement>(null);
  const trigger = useRef('trend-submit');

  function discover(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const edition = String(form.get('project')).trim().toLowerCase();
    const project = edition.includes('.') ? edition : edition + '.wikipedia.org';
    const day = String(form.get('day'));
    setSelected(undefined);
    setFound(undefined);
    if (known) {
      choose({ project, day, article: String(form.get('article')).trim() }, 'trend-submit');
      return;
    }
    void request.run(signal => apiPost<Discovery>(trendBase + '/discover', { project, day }, signal, 30000).finally(refresh), setFound);
  }

  function choose(sample: Sample, id: string) {
    trigger.current = id;
    setSelected(sample);
    requestAnimationFrame(() => detail.current?.focus());
  }

  function back() {
    setSelected(undefined);
    requestAnimationFrame(() => document.getElementById(trigger.current)?.focus());
  }

  return <section className="panel operator-sheet" aria-labelledby="trend-discovery">
    <div className="panel-heading"><h2 id="trend-discovery">Discover articles</h2></div>
    <form className="trend-controls" onSubmit={discover}>
      <label>Find by<select value={known ? 'title' : 'rank'} onChange={event => {
        setKnown(event.currentTarget.value === 'title'); setSelected(undefined); setFound(undefined); request.clearError();
      }} disabled={request.busy}><option value="rank">Publisher ranking</option><option value="title">Known article title</option></select></label>
      <label>Wikipedia edition<input name="project" list="trend-editions" defaultValue="en.wikipedia.org" required maxLength={80} /></label>
      <datalist id="trend-editions">{['en', 'es', 'fr', 'ja', 'pt', 'zh'].map(code => <option key={code} value={code + '.wikipedia.org'} />)}</datalist>
      <label>{known ? 'Sample date (UTC)' : 'Top-list date (UTC)'}<input name="day" type="date" defaultValue={daysAgo(2)} min="2015-07-01" max={daysAgo(1)} required /></label>
      {known && <label>Article title<input name="article" required maxLength={250} pattern=".*\S.*" /></label>}
      <button className="primary" id="trend-submit" disabled={request.busy || provider.blocked} type="submit">{known ? 'Review article' : request.busy ? 'Finding articles…' : 'Find articles'}</button>
    </form>
    {request.error && <div className="notice" role="alert">{request.error}</div>}
    {selected ? <div>
      <div className="panel-heading"><h2 ref={detail} tabIndex={-1}>Save article series</h2><button onClick={back}>{found ? 'Back to results' : 'Back to search'}</button></div>
      <ArticleSeries key={JSON.stringify(selected)} sample={selected} provider={provider} refresh={refresh} />
    </div> : found && <>
      <div className="panel-heading"><h3>{found.project} · {found.day_utc} UTC</h3><a href={found.source_url}>Publisher top list ↗</a></div>
      {found.articles.length ? <table className="operator-ledger" role="table">
        <caption className="sr-only">Wikimedia top articles by published rank</caption>
        <thead><tr><th scope="col">Article</th><th scope="col">Publisher rank</th><th scope="col">Top-list pageviews</th><th scope="col">Collection</th></tr></thead>
        <tbody>{found.articles.map((row, index) => <tr key={row.article}>
          <th scope="row">{articleTitle(row.article)}</th><td data-label="Publisher rank">{number.format(row.rank)}</td>
          <td data-label="Top-list pageviews">{number.format(row.views)}</td>
          <td data-label="Action"><button id={'trend-article-' + index} aria-label={'Select ' + articleTitle(row.article)}
            onClick={event => choose({ project: found.project, article: row.article, day: found.day_utc, rank: row.rank }, event.currentTarget.id)}>Select article</button></td>
        </tr>)}</tbody>
      </table> : <p className="notice" role="status">The publisher returned no ranked articles for this edition and date.</p>}
    </>}
  </section>;
}
