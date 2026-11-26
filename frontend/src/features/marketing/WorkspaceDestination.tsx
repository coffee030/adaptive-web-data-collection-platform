import { useEffect, useState } from 'react';
import { Link } from 'react-router';

export function WorkspaceDestination({ destination }: { destination: 'demo' | 'pilot' }) {
  const [peer, setPeer] = useState('');
  useEffect(() => {
    if (__HARBOURLINE_INSTALLATION__ === 'core' || __HARBOURLINE_INSTALLATION__ === destination ||
        !__HARBOURLINE_PEER_PORT__ || location.hostname !== '127.0.0.1' || location.protocol !== 'http:') return;
    const origin = 'http://127.0.0.1:' + __HARBOURLINE_PEER_PORT__;
    const lifetime = new AbortController();
    let sequence = 0;
    async function check() {
      const turn = ++sequence;
      let available = false;
      try {
        const response = await fetch(origin + '/harbourline-installation.json', {
          credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer',
          signal: AbortSignal.any([lifetime.signal, AbortSignal.timeout(2000)]),
        });
        if (response.ok && response.headers.get('content-type')?.includes('application/json')) {
          const info = await response.json();
          available = info.application === 'Harbourline' && info.workspace === destination;
        }
      } catch {}
      if (!lifetime.signal.aborted && turn === sequence) setPeer(available ? origin : '');
    }
    void check();
    window.addEventListener('focus', check);
    return () => { lifetime.abort(); window.removeEventListener('focus', check); };
  }, [destination]);

  if (destination === 'demo') return <div className="hl-demo-choice">
    <a className="hl-button" href={peer ? peer + '/demo/connected' : '/demo'}>Try the demo without an account</a>
    <p>{peer ? 'Search real public profiles or try a fictional campaign plan.' : 'Explore a fictional sample campaign on this installation.'}</p>
  </div>;
  if (__HARBOURLINE_INSTALLATION__ === 'pilot') return <Link to="/">Company pilot · sign-in required</Link>;
  if (peer) return <a href={peer + '/'}>Company pilot · sign-in required</a>;
  if (__HARBOURLINE_INSTALLATION__ === 'demo') return <details className="hl-pilot-help"><summary>Company pilot access</summary><p>Run <code>Start-Harbourline-Pilot.bat</code> and open the printed company sign-in URL.</p></details>;
  return <Link to={__PLATFORM_SYNTHETIC_DEMO__ ? '/workspace' : '/'}>Local campaign workspace</Link>;
}
