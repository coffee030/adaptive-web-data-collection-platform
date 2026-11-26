import { useEffect } from 'react';

const refreshDelay = 1000;

export function useVisibleJobPolling(enabled: boolean, busy: boolean, refresh: () => void) {
  useEffect(() => {
    if (!enabled || busy) return;
    let timer: number | undefined;

    function updateVisibility() {
      window.clearTimeout(timer);
      if (document.visibilityState === 'visible') refresh();
    }

    if (document.visibilityState === 'visible') timer = window.setTimeout(refresh, refreshDelay);
    document.addEventListener('visibilitychange', updateVisibility);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', updateVisibility);
    };
  }, [enabled, busy, refresh]);
}
