import { useState, useCallback } from 'react';

export function useEnterToSearch(initial = '') {
  const [draft, setDraft] = useState(initial);
  const [applied, setApplied] = useState(initial);
  const apply = useCallback(() => setApplied(draft.trim()), [draft]);
  const clear = useCallback(() => { setDraft(''); setApplied(''); }, []);
  const applyValue = useCallback((value) => {
    const v = String(value ?? '').trim();
    setDraft(v);
    setApplied(v);
  }, []);
  const onKeyDown = useCallback((e) => {
    if (e.key === 'Enter') { e.preventDefault(); apply(); }
  }, [apply]);
  return { draft, setDraft, applied, apply, clear, applyValue, onKeyDown };
}
