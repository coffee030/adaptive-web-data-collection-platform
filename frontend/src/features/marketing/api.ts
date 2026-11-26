import { ApiError, apiGet } from '../../lib/api';

export interface MarketingCapability {
  company_accounts?: boolean;
  provider: 'youtube_data_api';
  policy_url: string;
  permission_status: 'additional_permission_pending';
  permitted_purposes: ['research'];
  retention_days: number;
  customer_intelligence: 'available' | 'unavailable';
  demo_intelligence?: 'available' | 'unavailable';
}

export async function getMarketingCapability(signal: AbortSignal): Promise<MarketingCapability> {
  const cap = await apiGet<Partial<MarketingCapability>>('/marketing/capabilities', signal);
  if (cap?.provider !== 'youtube_data_api' || cap.permission_status !== 'additional_permission_pending'
    || !['available', 'unavailable'].includes(cap.customer_intelligence ?? '')
    || (cap.demo_intelligence !== undefined && !['available', 'unavailable'].includes(cap.demo_intelligence))
    || !Array.isArray(cap.permitted_purposes)
    || cap.permitted_purposes.length !== 1 || cap.permitted_purposes[0] !== 'research'
    || !Number.isInteger(cap.retention_days) || (cap.retention_days ?? 0) < 1
    || typeof cap.policy_url !== 'string') throw new ApiError('invalid-response');
  return cap as MarketingCapability;
}
