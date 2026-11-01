import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from './api.js';

const SessionContext = createContext(null);

export function SessionProvider({ children }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const data = await api.get('/api/meta/bootstrap');
      setSession(data);
    } catch (error) {
      setSession({ user: null, quota: null, models: null, site: { name: '在线办公' }, error: error.message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const login = useCallback(async (email, password) => {
    const data = await api.post('/api/auth/login', { email, password });
    await refresh();
    return data;
  }, [refresh]);

  const register = useCallback(async (payload) => {
    const data = await api.post('/api/auth/register', payload);
    await refresh();
    return data;
  }, [refresh]);

  const logout = useCallback(async () => {
    await api.post('/api/auth/logout');
    await refresh();
  }, [refresh]);

  const value = useMemo(
    () => ({
      ...(session || {}),
      loading,
      user: session?.user || null,
      quota: session?.quota || null,
      models: session?.models || null,
      site: session?.site || { name: '在线办公', allowRegister: true },
      refresh,
      login,
      register,
      logout,
      isAdmin: session?.user?.role === 'admin',
    }),
    [session, loading, refresh, login, register, logout],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession 必须在 SessionProvider 内使用');
  return ctx;
}
