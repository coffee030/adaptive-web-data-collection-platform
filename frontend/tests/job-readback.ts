import { expect } from '@playwright/test';
import type { JobDetailResponse } from '../src/features/collection-jobs/api';

export function durableJobFields(detail: JobDetailResponse) {
  const { latest_worker_heartbeat_at: heartbeat, latest_worker_offline_detected_at: offline, ...durable } = detail;
  expect(heartbeat).toBeDefined();
  expect(offline).toBeDefined();
  if (heartbeat !== null) expect(Date.parse(heartbeat!)).toBeGreaterThan(0);
  if (offline !== null) {
    expect(heartbeat).not.toBeNull();
    expect(Date.parse(offline!)).toBeGreaterThanOrEqual(Date.parse(heartbeat!));
  }
  return durable;
}

