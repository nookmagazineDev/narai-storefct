import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { Loader2, X } from 'lucide-react';
import { changePassword } from '../../services/authService';

const INPUT = 'w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-amber-500/60';

export default function ChangePasswordModal({ onClose }) {
  const [oldPw, setOldPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const mismatch = confirm && newPw !== confirm;

  const submit = async (e) => {
    e.preventDefault();
    if (newPw !== confirm) return;
    setBusy(true);
    try {
      await changePassword(oldPw, newPw);
      toast.success('เปลี่ยนรหัสผ่านแล้ว');
      onClose();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
      <form onSubmit={submit} onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm bg-slate-900 border border-slate-700 rounded-2xl p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-100">เปลี่ยนรหัสผ่าน</h2>
          <button type="button" onClick={onClose} className="p-1 text-slate-500 hover:text-slate-300"><X className="w-4 h-4" /></button>
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1.5">รหัสผ่านเดิม</label>
          <input type="password" className={INPUT} value={oldPw} onChange={(e) => setOldPw(e.target.value)} autoComplete="current-password" />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1.5">รหัสผ่านใหม่ (อย่างน้อย 6 ตัว)</label>
          <input type="password" className={INPUT} value={newPw} onChange={(e) => setNewPw(e.target.value)} autoComplete="new-password" />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1.5">ยืนยันรหัสผ่านใหม่</label>
          <input type="password" className={INPUT} value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
          {mismatch && <p className="text-[11px] text-rose-400 mt-1">รหัสผ่านใหม่สองช่องไม่ตรงกัน</p>}
        </div>
        <button type="submit" disabled={busy || !oldPw || newPw.length < 6 || newPw !== confirm}
          className="w-full flex items-center justify-center gap-2 py-2 rounded-lg text-sm bg-amber-500/15 text-amber-300 border border-amber-500/30 hover:bg-amber-500/25 disabled:opacity-40">
          {busy && <Loader2 className="w-4 h-4 animate-spin" />} บันทึกรหัสใหม่
        </button>
      </form>
    </div>
  );
}
