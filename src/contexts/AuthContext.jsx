import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { fetchMe, loginRequest, logoutRequest, installAuthInterceptor } from '../services/authService';
import { canView, canEdit } from '../../lib/pages';

const AuthContext = createContext(null);

/**
 * ผู้ใช้ที่ล็อกอินอยู่ + สิทธิ์รายหน้า
 * user = null และ required = false คือช่วงยังไม่บังคับล็อกอิน — ใช้ได้ทุกหน้าเหมือนเดิม
 */
export function AuthProvider({ children }) {
  const [state, setState] = useState({ loading: true, user: null, required: false, configured: true });

  const refresh = useCallback(async () => {
    try {
      const r = await fetchMe();
      setState({ loading: false, user: r.user || null, required: Boolean(r.required), configured: r.configured !== false });
    } catch {
      // /api/auth/me ล่ม (เช่น deploy รุ่นเก่า) — ถือว่ายังไม่บังคับล็อกอิน ไม่ปิดหน้าเว็บทั้งแอป
      setState((s) => ({ ...s, loading: false }));
    }
  }, []);

  useEffect(() => {
    installAuthInterceptor();
    refresh();
    const onExpired = () => setState((s) => ({ ...s, user: null, required: true }));
    window.addEventListener('auth:expired', onExpired);
    return () => window.removeEventListener('auth:expired', onExpired);
  }, [refresh]);

  const login = useCallback(async (username, password) => {
    const r = await loginRequest(username, password);
    setState((s) => ({ ...s, user: r.user }));
    return r;
  }, []);

  const logout = useCallback(async () => {
    await logoutRequest().catch(() => {});
    setState((s) => ({ ...s, user: null }));
  }, []);

  const value = useMemo(() => {
    const { user, required } = state;
    // ไม่ได้ล็อกอินและยังไม่บังคับ = ใช้ได้ทุกหน้า (ช่วงเปลี่ยนผ่าน)
    const open = !user && !required;
    return {
      ...state,
      login,
      logout,
      refresh,
      canView: (key) => open || canView(user, key),
      canEdit: (key) => open || canEdit(user, key),
    };
  }, [state, login, logout, refresh]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
