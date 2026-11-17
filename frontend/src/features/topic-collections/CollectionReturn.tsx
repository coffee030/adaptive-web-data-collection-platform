import { useLocation, useNavigate } from 'react-router';

export const collectionReturnState = { fromCollectionDraft: true };

export function BackToCollection() {
  const { state } = useLocation();
  const navigate = useNavigate();
  if (state?.fromCollectionDraft !== true) return null;
  return <button type="button" onClick={() => void navigate(-1)}>Back to collection</button>;
}
