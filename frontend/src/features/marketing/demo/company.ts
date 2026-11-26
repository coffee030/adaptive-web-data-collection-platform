import type { Creator } from '../contracts';

export { blankBrief as demoBrief } from '../contracts';
export const demoCreators: readonly Creator[] = [];
export const demoSearch = () => demoCreators;
