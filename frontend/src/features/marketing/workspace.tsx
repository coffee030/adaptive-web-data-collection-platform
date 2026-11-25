import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { blankBrief, type Brief, type PlanLine } from './contracts';
import type { CampaignRequest, ScenarioRequest } from './intelligence';
import { demoBrief, demoCreators } from './demo/fixture';

export type WorkspaceMode = 'partner' | 'sample' | 'server-demo';

interface Draft {
  brief: Brief;
  saved: boolean;
  shortlist: string[];
  lines: PlanLine[];
  explorer: string;
  assumption?: string;
  evaluation?: CampaignRequest;
  scenario?: ScenarioRequest;
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

function useDraft(mode: WorkspaceMode, key: string, first: boolean) {
  const demo = mode === 'sample';
  const [draft, setDraft] = useState(() => {
    const value = readDraft(key, demo);
    return first && mode === 'server-demo' && !value.saved ? { ...value, brief: backendDemoBrief } : value;
  });
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
    draft, setDraft, demo, mode, path, storageFailed, creators: demo ? demoCreators : [],
    saveBrief: (brief: Brief) => {
      setDraft(old => ({ ...old, brief, saved: true, evaluation: undefined }));
    },
    toggleShortlist: (id: string) => setDraft(old => ({
      ...old, shortlist: old.shortlist.includes(id) ? old.shortlist.filter(item => item !== id) : [...old.shortlist, id],
    })),
    setLines: (lines: PlanLine[]) => setDraft(old => ({ ...old, lines })),
  };
}

interface CampaignNavigation {
  otherDrafts: () => { key: string; name: string }[];
  openDraft: (key?: string) => void;
}

const DraftContext = createContext<(ReturnType<typeof useDraft> & CampaignNavigation) | null>(null);

function ActiveDraft({ mode, draftKey, first, children, navigation }: {
  mode: WorkspaceMode; draftKey: string; first: boolean; children: ReactNode; navigation: CampaignNavigation;
}) {
  const value = useDraft(mode, draftKey, first);
  return <DraftContext.Provider value={{ ...value, ...navigation }}>{children}</DraftContext.Provider>;
}

export function MarketingDraft({ mode, children }: { mode: WorkspaceMode; children: ReactNode }) {
  const base = 'harbourline-draft-v1-' + (mode === 'sample' ? 'demo' : mode === 'partner' ? 'live' : 'server-demo');
  const pointer = base + '/active';
  const belongs = (key: string | null): key is string => key === base || Boolean(key?.startsWith(base + '/campaign/'));
  const [active, setActive] = useState(() => {
    try {
      const saved = sessionStorage.getItem(pointer) ?? localStorage.getItem(pointer);
      return belongs(saved) && localStorage.getItem(saved) ? saved : base;
    } catch { return base; }
  });
  function openDraft(key = base + '/campaign/' + crypto.randomUUID()) {
    if (!belongs(key)) return;
    setActive(key);
    try {
      sessionStorage.setItem(pointer, key);
      localStorage.setItem(pointer, key);
    } catch { /* The active draft stays available in this tab. */ }
  }
  function otherDrafts() {
    try {
      return Object.keys(localStorage).filter(key => key !== active && belongs(key)).flatMap(key => {
        const draft = readDraft(key, false);
        return draft.saved ? [{ key, name: draft.brief.name }] : [];
      });
    } catch { return []; }
  }
  return <ActiveDraft key={active} mode={mode} draftKey={active} first={active === base}
    navigation={{openDraft,otherDrafts}}>{children}</ActiveDraft>;
}

export function useMarketing() {
  const context = useContext(DraftContext);
  if (!context) throw new Error('Marketing draft provider is missing');
  return context;
}