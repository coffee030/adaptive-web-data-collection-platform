import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { blankBrief, type Brief, type PlanLine } from './contracts';
import { campaignExpiry, type CampaignResult } from './intelligence';
import { demoBrief, demoCreators } from './demo/fixture';

export type WorkspaceMode = 'partner' | 'sample' | 'server-demo';

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

const backendDemoBrief: Brief = {
  ...blankBrief, name: 'Affordable dining campaign',
  description: 'Find Cantonese creators who cover affordable neighbourhood restaurants and café meals. 街坊粉麵餐廳 平價 探店',
  language: 'yue', platform: 'other', deliverable: 'short_video', creatorCount: 1,
  requireCantonese: true, requiredFacts: 'affordable_local_lunch',
};

function useDraft(mode: WorkspaceMode) {
  const demo = mode === 'sample';
  const key = 'harbourline-draft-v1-' + (demo ? 'demo' : mode === 'partner' ? 'live' : 'server-demo');
  const [draft, setDraft] = useState(() => {
    const value = readDraft(key, demo);
    return mode === 'server-demo' && !value.saved ? { ...value, brief: backendDemoBrief } : value;
  });
  const [report, setReport] = useState<CampaignResult>();
  useEffect(() => {
    if (!report) return;
    const expiry = campaignExpiry(report);
    if (expiry === undefined) return;
    let timer: ReturnType<typeof setTimeout>;
    function check() {
      if (expiry === undefined) return;
      if (expiry <= Date.now()) setReport(undefined);
      else timer = setTimeout(check, Math.min(2_000_000_000, expiry - Date.now()));
    }
    check();
    return () => clearTimeout(timer);
  }, [report]);
  const [storageFailed, setStorageFailed] = useState(false);

  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(draft)); }
    catch { setStorageFailed(true); }
  }, [draft, key]);

  const base = mode === 'server-demo' ? '/demo/connected' : demo ? '/demo' : '';
  function path(page = '') {
    return mode === 'partner' && !page && __PLATFORM_SYNTHETIC_DEMO__ ? '/workspace' : base + '/' + page;
  }
  return {
    draft, setDraft, demo, mode, report, setReport, path, storageFailed, creators: demo ? demoCreators : [],
    saveBrief: (brief: Brief) => {
      setReport(undefined);
      setDraft(old => ({ ...old, brief, saved: true }));
    },
    toggleShortlist: (id: string) => setDraft(old => ({
      ...old, shortlist: old.shortlist.includes(id) ? old.shortlist.filter(item => item !== id) : [...old.shortlist, id],
    })),
    setLines: (lines: PlanLine[]) => setDraft(old => ({ ...old, lines })),
  };
}

const DraftContext = createContext<ReturnType<typeof useDraft> | null>(null);

export function MarketingDraft({ mode, children }: { mode: WorkspaceMode; children: ReactNode }) {
  const value = useDraft(mode);
  return <DraftContext.Provider value={value}>{children}</DraftContext.Provider>;
}

export function useMarketing() {
  const context = useContext(DraftContext);
  if (!context) throw new Error('Marketing draft provider is missing');
  return context;
}