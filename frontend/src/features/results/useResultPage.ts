import { useSearchParams } from 'react-router';
import { maxOffset } from '../collection-jobs/api';

export function useResultPage() {
  const [search, setSearch] = useSearchParams();
  const rawOffset = Number(search.get('offset'));
  const offset = Number.isInteger(rawOffset) && rawOffset >= 0 && rawOffset <= maxOffset ? rawOffset : 0;
  function changePage(next: number) {
    const params = new URLSearchParams(search);
    if (next) params.set('offset', String(next));
    else params.delete('offset');
    setSearch(params);
  }
  return { search, setSearch, offset, changePage };
}
