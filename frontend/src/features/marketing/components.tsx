import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Link } from 'react-router';
import { TableRegion } from '../../components/feedback';
import { audience, compact, eligibility, fee, type Creator } from './contracts';
import { useMarketing } from './workspace';

export function Brand() {
  return <span className="hl-brand"><span className="hl-mark"><svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M3 17 9 7l4 6 3-4 5 8M3 21h18M6 17h12" /></svg></span>Harbourline</span>;
}

export function Identity({ creator }: { creator: Creator }) {
  return <span className="hl-identity"><img src={creator.portrait} alt="" width="40" height="40" /><span><strong>{creator.name}</strong><small>{creator.handle} · {creator.district}</small></span></span>;
}

export function SaveCreator({ creator }: { creator: Creator }) {
  const { draft, toggleShortlist } = useMarketing();
  const saved = draft.shortlist.includes(creator.id);
  return <button type="button" aria-pressed={saved} aria-label={`Shortlist ${creator.name}`}
    className={saved ? 'hl-saved' : undefined} onClick={() => toggleShortlist(creator.id)}>{saved && <span aria-hidden="true">✓ </span>}Shortlist</button>;
}

export function Evidence({ creator }: { creator: Creator }) {
  const { draft } = useMarketing();
  return <div className="hl-evidence">
    <p className="hl-note">Fictional Instagram evidence · {creator.post.date}</p>
    <figure><img className="hl-post-image" src={creator.post.still} alt="" width="440" height="439" /><figcaption>{creator.post.title}</figcaption></figure>
    <blockquote><p lang={creator.post.lang}>{creator.post.caption}</p>
      {creator.post.translation && <p><strong>English translation</strong> {creator.post.translation}</p>}
    </blockquote>
    <dl className="hl-facts">
      <div><dt>Content fit</dt><dd>{creator.reason}</dd></div>
      <div><dt>Eligibility</dt><dd>{eligibility(creator, draft.brief)}</dd></div>
      <div><dt>Spoken language evidence</dt><dd>{creator.post.transcript ? <blockquote>
        <strong>Sample transcript · {creator.post.transcript.time}</strong>
        <p lang={creator.post.lang}>{creator.post.transcript.text}</p>
        <p><strong>English translation</strong> {creator.post.transcript.translation}</p>
      </blockquote> : 'Insufficient evidence of spoken Cantonese.'}</dd></div>
      <div><dt>HK audience</dt><dd>{audience(creator.hk)} · {creator.expired ? 'Expired sample' : 'Sample observation'} · {creator.observed}</dd></div>
      <div><dt>Typical historical views</dt><dd>{compact(creator.typicalViews)} median across {creator.sample} sample Reels</dd></div>
      <div><dt>Quote per Reel</dt><dd>{creator.quote === null ? 'Quote missing' : fee(creator.quote) + ' · Sample quote'}</dd></div>
      <div><dt>Suggested category</dt><dd>{creator.category}</dd></div>
    </dl>
  </div>;
}

export function CreatorProfile({ creator, evidence, close }: { creator: Creator; evidence: () => void; close: () => void }) {
  const { draft } = useMarketing();
  return <section className="hl-inspector" aria-label={`Creator profile for ${creator.name}`}>
    <div className="hl-row-between"><h2>Creator profile</h2><button type="button" onClick={close}>Close profile</button></div>
    <Identity creator={creator} />
    <p className="hl-decision">{eligibility(creator, draft.brief)}</p>
    <p>{creator.reason}</p>
    <dl className="hl-inspector-stats">
      <div><dt>HK audience</dt><dd>{audience(creator.hk)}</dd></div>
      <div><dt>Historical views</dt><dd>{compact(creator.typicalViews)}</dd></div>
    </dl>
    <button type="button" className="hl-content-trigger" onClick={evidence}>
      <img src={creator.post.still} alt="" width="64" height="52" /><span>{creator.post.title}<small>Open historical evidence</small></span>
    </button>
    <p className="hl-note">{creator.quote === null ? 'Quote missing' : fee(creator.quote) + ' sample quote / Reel'}{creator.expired && ' · Audience snapshot expired'}</p>
    <SaveCreator creator={creator} />
  </section>;
}

export function Overlay({ title, close, children, wide = false }: { title: string; close: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const heading = useId();
  useEffect(() => {
    const dialog = ref.current;
    const previous = document.activeElement;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);
  return <dialog ref={ref} className={wide ? 'hl-overlay hl-wide' : 'hl-overlay'} aria-labelledby={heading}
    onCancel={event => { event.preventDefault(); close(); }}>
    <header className="hl-row-between"><h2 id={heading}>{title}</h2><button type="button" onClick={close}>Close</button></header>
    <div className="hl-overlay-body">{children}</div>
  </dialog>;
}

export function Compare({ creators, close }: { creators: Creator[]; close: () => void }) {
  const { draft, path } = useMarketing();
  const rows: [string, (creator: Creator) => string][] = [
    ['Eligibility', creator => eligibility(creator, draft.brief)], ['HK audience', creator => audience(creator.hk)],
    ['Median historical Reel views', creator => compact(creator.typicalViews)],
    ['Quote per Reel', creator => creator.quote === null ? 'Quote missing' : fee(creator.quote)],
    ['Audience snapshot', creator => creator.observed + (creator.expired ? ' · Expired' : '')],
    ['Historical content fit', creator => creator.reason],
  ];
  return <Overlay title="Compare shortlisted creators" close={close} wide>
    <p className="hl-note">Fictional Instagram samples. Historical performance is listed in the same format for each creator.</p>
    <TableRegion label="Creator comparison"><table className="hl-comparison"><thead><tr><th scope="col">Measure</th>
      {creators.map(creator => <th scope="col" key={creator.id}>{creator.name}</th>)}</tr></thead>
      <tbody>{rows.map(([label, value]) => <tr key={label}><th scope="row">{label}</th>
        {creators.map(creator => <td key={creator.id}>{value(creator)}</td>)}</tr>)}</tbody></table></TableRegion>
    <div className="hl-actions"><Link className="hl-button hl-primary" to={path('plan')}>Open campaign plan</Link></div>
  </Overlay>;
}