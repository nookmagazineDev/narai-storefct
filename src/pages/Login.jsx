import React, { useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Loader2, Store, LogIn, AlertTriangle } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { firstAllowedPath } from '../components/auth/PageGate';
import { canView, pageOfPath } from '../../lib/pages';

const INPUT = 'w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-amber-500/60';

export default function Login() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  /** กลับไปหน้าที่ตั้งใจจะเปิด ถ้ามีสิทธิ์ — ไม่งั้นหน้าแรกที่เปิดได้ */
  const destination = (user) => {
    const next = params.get('next');
    const nextPage = next && next.startsWith('/') && !next.startsWith('/login') ? pageOfPath(next.split('?')[0]) : null;
    if (next && (!nextPage || canView(user, nextPage.key)) && next.startsWith('/') && !next.startsWith('/login')) return next;
    return firstAllowedPath((k) => canView(user, k)) || '/';
  };

  if (!auth.loading && auth.user) return <Navigate to={destination(auth.user)} replace />;

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await auth.login(username.trim(), password);
      if (r.firstPassword) toast.success('ตั้งรหัสผ่านครั้งแรกเรียบร้อย — ใช้รหัสนี้ในครั้งต่อไป');
      navigate(destination(r.user), { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4 font-['Prompt',sans-serif]">
      <form onSubmit={submit} className="w-full max-w-sm bg-slate-900/80 border border-slate-800 rounded-2xl p-7 shadow-2xl">
        <div className="w-11 h-11 rounded-xl bg-gradient-to-tr from-amber-500 to-orange-500 flex items-center justify-center mb-4">
          <Store className="w-5 h-5 text-slate-950 stroke-[2.5]" />
        </div>
        <h1 className="text-lg font-semibold text-slate-100">ระบบสโตร์ + ครัวกลาง</h1>
        <p className="text-xs text-slate-500 mt-0.5 mb-5">เข้าสู่ระบบเพื่อใช้งาน</p>

        {!auth.configured && (
          <div className="mb-4 flex gap-2 text-xs text-amber-300 bg-amber-500/10 border border-amber-500/25 rounded-lg p-2.5">
            <AlertTriangle className="w-4 h-4 shrink-0" /> ยังไม่ได้ตั้ง AUTH_SECRET บน Vercel — ล็อกอินยังไม่ได้
          </div>
        )}

        <label className="block text-xs text-slate-400 mb-1.5">ชื่อผู้ใช้</label>
        <input className={INPUT} value={username} onChange={(e) => setUsername(e.target.value)}
          autoComplete="username" autoCapitalize="none" autoFocus />
        <label className="block text-xs text-slate-400 mb-1.5 mt-4">รหัสผ่าน</label>
        <input className={INPUT} type="password" value={password} onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password" />

        {error && <p className="mt-3 text-xs text-rose-400">{error}</p>}

        <button type="submit" disabled={busy || !username.trim() || !password}
          className="mt-6 w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium bg-amber-500 text-slate-950 hover:bg-amber-400 disabled:opacity-50">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />} เข้าสู่ระบบ
        </button>
      </form>
    </div>
  );
}
