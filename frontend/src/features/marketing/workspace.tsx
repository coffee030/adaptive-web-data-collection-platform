import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { blankBrief, type Brief, type PlanLine } from './contracts';
import { demoBrief, demoCreators } from './demo/fixture';

interface Draft {
  brief: Brief;
  saved: boolean;
  shortlist: string[];
  lines: PlanLine[];
  explorer: string;
  assumption?: string;
}

function readDraft(key: string, demo: boolean): Draft {
  const base = { brief: demo ? demoBrief : blankBrief, saved: demo, shortlist: demo ? ['mira', 'ethan'] : [], lines: [], explorer: '' };
  try {
    const saved = JSON.parse(localStorage.getItem(key) ?? 'null') as Draft | null;
    return saved && typeof saved.brief?.name === 'string' && Array.isArray(saved.shortlist) && Array.isArray(saved.lines)
      ? { ...base, ...saved, brief: { ...base.brief, ...saved.brief } }
      : base;
  } catch { return base; }
}

function useDraft(demo: boolean) {
  const key = 'harbourline-draft-v1-' + (demo ? 'demo' : 'live');
  const [draft, setDraft] = useState(() => readDraft(key, demo));
  const [storageFailed, setStorageFailed] = useState(false);

  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(draft)); }
    catch { setStorageFailed(true); }
  }, [draft, key]);

  const base = demo ? '/demo' : '';
  function path(page = '') {
    return !demo && !page && __PLATFORM_SYNTHETIC_DEMO__ ? '/workspace' : base + '/' + page;
  }
  return {
    draft, setDraft, demo, path, storageFailed, creators: demo ? demoCreators : [],
    saveBrief: (brief: Brief) => setDraft(old => ({ ...old, brief, saved: true })),
    toggleShortlist: (id: string) => setDraft(old => ({
      ...old, shortlist: old.shortlist.includes(id) ? old.shortlist.filter(item => item !== id) : [...old.shortlist, id],
    })),
    setLines: (lines: PlanLine[]) => setDraft(old => ({ ...old, lines })),
  };
}

const DraftContext = createContext<ReturnType<typeof useDraft> | null>(null);

export function MarketingDraft({ demo, children }: { demo: boolean; children: ReactNode }) {
  const value = useDraft(demo);
  return <DraftContext.Provider value={value}>{children}</DraftContext.Provider>;
}

export function useMarketing() {
  const context = useContext(DraftContext);
  if (!context) throw new Error('Marketing draft provider is missing');
  return context;
}