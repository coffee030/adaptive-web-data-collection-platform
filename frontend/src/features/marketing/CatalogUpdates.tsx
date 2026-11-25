import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { processing, type DataMode } from './intelligence';

const Changes = createContext(0);

export function useCatalogRevision() { return useContext(Changes); }

export function CatalogUpdates({ mode, children }: { mode?: DataMode; children: ReactNode }) {
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!mode) return;
    const controller = new AbortController();
    let previous: string | undefined;
    let timer: number;
    async function check() {
      if (document.visibilityState === 'visible') {
        let version: string;
        try {
          const status = await processing(mode!, controller.signal);
          version = status.revision + '/' + status.state;
        } catch { version = 'unavailable'; }
        if (controller.signal.aborted) return;
        if (previous !== undefined && previous !== version) setRevision(value => value + 1);
        previous = version;
      }
      timer = window.setTimeout(check, 15000);
    }
    void check();
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [mode]);
  return <Changes.Provider value={revision}>{children}</Changes.Provider>;
}
