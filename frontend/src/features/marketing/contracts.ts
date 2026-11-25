export interface Brief {
  name: string;
  description: string;
  budget: number;
  objective: string;
  market: string;
  language: string;
  platform: string;
  deliverable: string;
  required: string;
  preferred: string;
  minAudience: number;
  requireCantonese: boolean;
  creatorCount: number;
}

export interface Creator {
  id: string;
  name: string;
  handle: string;
  district: string;
  category: string;
  followers: number;
  hk: number | null;
  typicalViews: number;
  quote: number | null;
  observed: string;
  sample: number;
  cantonese: boolean | null;
  expired: boolean;
  post: {
    title: string; date: string; caption: string; lang?: string; translation?: string; still: string;
    transcript?: { time: string; text: string; translation: string };
  };
  portrait: string;
  reason: string;
}

export interface PlanLine {
  creatorId: string;
  quantity: number;
  quote: number | null;
}

export const blankBrief: Brief = {
  name: '', description: '', budget: 30000, objective: 'Local awareness', market: 'Hong Kong',
  language: '', platform: '', deliverable: '', required: '', preferred: '', minAudience: 0,
  requireCantonese: false, creatorCount: 2,
};

export const hkd = (value: number) => new Intl.NumberFormat('en-HK', { maximumFractionDigits: 0 }).format(value);
export const fee = (value: number) => 'HK$' + hkd(value);
export const compact = (value: number) => new Intl.NumberFormat('en-HK', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
export const audience = (value: number | null) => value === null ? 'Unavailable' : value + '%';

export function eligibility(creator: Creator, brief: Brief) {
  if (brief.minAudience > 0 && creator.hk === null) return 'Audience data unavailable';
  if (creator.hk !== null && creator.hk < brief.minAudience) return 'Below HK audience minimum';
  if (brief.requireCantonese && creator.cantonese !== true) return 'Insufficient language evidence';
  if (brief.minAudience > 0 && creator.expired) return 'Audience snapshot expired';
  return 'Meets structured requirements';
}

export const eligible = (creator: Creator, brief: Brief) => eligibility(creator, brief) === 'Meets structured requirements';

export function planStatus(lines: PlanLine[], creators: readonly Creator[], brief: Brief) {
  const known = lines.reduce((total, line) => total + line.quantity * (line.quote ?? 0), 0);
  const missing = lines.filter(line => line.quote === null);
  const gaps = lines.flatMap(line => {
    const creator = creators.find(item => item.id === line.creatorId);
    return creator && eligible(creator, brief) ? [] : [creator?.name ?? 'Unavailable creator'];
  });
  const over = Math.max(0, known - brief.budget);
  const scopeMet = lines.length === brief.creatorCount;
  const manualReview = Boolean(brief.required.trim())
    || (brief.language.trim() !== '' && !(brief.language.trim().toLowerCase() === 'cantonese' && brief.requireCantonese))
    || (brief.market.trim() !== '' && brief.market.trim().toLowerCase() !== 'hong kong');
  const status = over ? 'Infeasible within budget' : missing.length ? 'Budget feasibility unknown'
    : !scopeMet || gaps.length || manualReview ? 'Requirements need review' : 'Feasible within budget';
  return { known, missing, gaps, over, scopeMet, manualReview, status };
}