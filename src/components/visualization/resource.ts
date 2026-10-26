"use client";
import { useEffect, useRef, useState } from 'react';
import { getStoredAuthToken } from '@/lib/auth-storage';
import type { Snapshot } from './model';
import { credentialStillCurrent, deniedNavigationRole } from './credential';
import { useVisualizationViewer } from './shell';
type Resource = { key: string; data: Snapshot | null; error: 'login' | 'forbidden' | 'query' | 'failed' | null; loading: boolean };
export function useOverviewResource(key: string | null, retry: number) {
  const [state, setState] = useState<Resource>({ key: '', data: null, error: null, loading: false });
  const sequence = useRef(0);
  const setViewer = useVisualizationViewer();
  useEffect(() => {
    if (!key) return;
    const current = ++sequence.current;
    const requestKey = key + '|' + retry;
    const controller = new AbortController();
    const load = async () => {
      setState({ key: requestKey, data: null, error: null, loading: true });
      const token = getStoredAuthToken();
      if (!token) { setViewer('denied'); setState({ key: requestKey, data: null, error: 'login', loading: false }); return; }
      try {
        const response = await fetch('/api/visualization/overview?' + key, { headers: { Authorization: 'Bearer ' + token }, cache: 'no-store', signal: controller.signal });
        if (!credentialStillCurrent(token)) return;
        const deniedRole = response.status === 401 || response.status === 403 ? await deniedNavigationRole(response) : null;
        if (!credentialStillCurrent(token)) return;
        const error = response.status === 401 ? 'login' : response.status === 403 ? 'forbidden' : response.status === 400 ? 'query' : !response.ok ? 'failed' : null;
        if (deniedRole && current === sequence.current && !controller.signal.aborted) setViewer(deniedRole);
        if (error) { if (current === sequence.current && !controller.signal.aborted) setState({ key: requestKey, data: null, error, loading: false }); return; }
        const data = await response.json();
        if (!data?.modules?.orders || !data?.modules?.finances || !data?.details || !data.generatedAt) throw new Error('INVALID_RESPONSE');
        if (current === sequence.current && !controller.signal.aborted && credentialStillCurrent(token)) { setViewer('admin'); setState({ key: requestKey, data, error: null, loading: false }); }
      } catch { if (current === sequence.current && !controller.signal.aborted && credentialStillCurrent(token)) setState({ key: requestKey, data: null, error: 'failed', loading: false }); }
    };
    void load();
    return () => { ++sequence.current; controller.abort(); };
  }, [key, retry, setViewer]);
  return key && state.key !== key + '|' + retry ? { key, data: null, error: null, loading: true } : state;
}
