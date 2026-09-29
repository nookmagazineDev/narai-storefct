import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Loader2, Plus, RefreshCw, Users as UsersIcon, X, ShieldCheck, KeyRound } from 'lucide-react';
import { fetchUsers, saveUser } from '../../services/authService';
import { useAuth } from '../../contexts/AuthContext';
import { PAGE_GROUPS, PAGES, PRESETS } from '../../../lib/pages';
import { formatStamp } from '../../services/kitchenService';

const INPUT = 'w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-amber-500/60 disabled:opacity-60';
const LABEL = Object.fromEntries(PAGES.map((p) => [p.key, p.label]));

/** รายการสิทธิ์จาก server ([{key, edit}]) -> map key -> 'edit' | 'view' */
const toMap = (pages) => Object.fromEntries((pages || []).map((p) => [p.key, p.edit ? 'edit' : 'view']));

function Chips({ user }) {
  if (user.isAdmin) return <span className="text-[11px] px-2 py-0.5 rounded-md bg-amber-500/15 text-amber-300 border border-amber-500/30">แอดมิน · ทุกหน้า</span>;
  const pages = user.pages || [];
  if (pages.length === 0) return <span className="text-[11px] text-slate-600">ยังไม่มีสิทธิ์</span>;
  const edits = pages.filter((p) => p.edit);
  const views = pages.length - edits.length;
  return (
    <div className="flex flex-wrap gap-1">
      {edits.map((p) => (
        <span key={p.key} className="text-[11px] px-1.5 py-0.5 rounded-md bg-emerald-500/10 text-emerald-300 border border-emerald-500/25">{LABEL[p.key] || p.key}</span>
      ))}
      {views > 0 && (
        <span className="text-[11px] px-1.5 py-0.5 rounded-md border border-slate-700 text-slate-400"
          title={pages.filter((p) => !p.edit).map((p) => LABEL[p.key] || p.key).join(', ')}>
          ดูอย่างเดียว {views}
        </span>
      )}
    </div>
  );
}

function Check({ on, disabled, onClick, title }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={title}
      className={`w-4 h-4 rounded border mx-auto flex items-center justify-center text-[10px] font-bold ${on
        ? 'bg-amber-500 border-amber-500 text-slate-950' : 'border-slate-600'} disabled:opacity-25`}>
      {on ? '✓' : ''}
    </button>
  );
}

function UserEditor({ initial, isSelf, onClose, onSaved }) {
  const isNew = !initial;
  const [form, setForm] = useState(() => ({
    username: initial?.username || '',
    name: initial?.name || '',
    isAdmin: Boolean(initial?.isAdmin),
    isActive: initial ? initial.isActive !== false : true,
    pages: toMap(initial?.pages),
    password: '',
  }));
  const [busy, setBusy] = useState(false);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const setAccess = (key, level) => setForm((f) => {
    const pages = { ...f.pages };
    if (level) pages[key] = level; else delete pages[key];
    return { ...f, pages };
  });
  const toggleView = (key) => setAccess(key, form.pages[key] ? null : 'view');
  const toggleEdit = (key) => setAccess(key, form.pages[key] === 'edit' ? 'view' : 'edit');
  const toggleGroup = (group) => {
    const keys = group.pages.map((p) => p.key);
    const all = keys.every((k) => form.pages[k]);
    setForm((f) => {
      const pages = { ...f.pages };
      for (const p of group.pages) {
        if (all) delete pages[p.key];
        else if (!pages[p.key]) pages[p.key] = p.viewOnly ? 'view' : 'edit';
      }
      return { ...f, pages };
    });
  };

  const submit = async () => {
    setBusy(true);
    try {
      const user = await saveUser({ ...form, isNew, password: form.password || undefined });
      toast.success(isNew ? `เพิ่มผู้ใช้ ${user.username} แล้ว` : `บันทึกสิทธิ์ของ ${user.username} แล้ว`);
      onSaved();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const canSave = form.username.trim() && (!isNew || form.password.length >= 6) && (!form.password || form.password.length >= 6);

  return (
    <div className="fixed inset-0 z-40 bg-black/70 flex items-start justify-center overflow-y-auto p-4" onClick={onClose}>
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-lg my-8 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between px-5 py-4 border-b border-slate-800">
          <div>
            <h2 className="font-semibold text-slate-100 text-sm">{isNew ? 'เพิ่มผู้ใช้' : `${initial.username}${initial.name ? ` · ${initial.name}` : ''}`}</h2>
            <p className="text-[11px] text-slate-500 mt-0.5">"ใช้ได้" = เห็นเมนูและเปิดหน้าได้ · "แก้ไขได้" = กดบันทึก/ส่ง/ลบได้</p>
          </div>
          <button onClick={onClose} className="p-1 text-slate-500 hover:text-slate-300"><X className="w-4 h-4" /></button>
        </div>

        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">ชื่อผู้ใช้ (ใช้ล็อกอิน)</label>
              <input className={INPUT} value={form.username} disabled={!isNew} autoCapitalize="none"
                onChange={(e) => set({ username: e.target.value.replace(/\s/g, '') })} placeholder="เช่น kitchen01" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">ชื่อที่แสดง</label>
              <input className={INPUT} value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="เช่น หัวหน้าครัว" />
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1.5 flex items-center gap-1.5">
              <KeyRound className="w-3.5 h-3.5" /> {isNew ? 'รหัสผ่าน (อย่างน้อย 6 ตัว)' : 'รีเซ็ตรหัสผ่าน (เว้นว่าง = ใช้รหัสเดิม)'}
            </label>
            <input className={INPUT} type="text" value={form.password} autoComplete="off"
              onChange={(e) => set({ password: e.target.value })} placeholder={isNew ? '' : 'ไม่เปลี่ยน'} />
            {form.password && form.password.length < 6 && <p className="text-[11px] text-rose-400 mt-1">อย่างน้อย 6 ตัวอักษร</p>}
          </div>

          <div className="flex flex-wrap gap-4 text-sm">
            <label className={`flex items-center gap-2 ${isSelf ? 'opacity-50' : ''}`}>
              <input type="checkbox" className="accent-amber-500" checked={form.isAdmin} disabled={isSelf}
                onChange={(e) => set({ isAdmin: e.target.checked })} />
              <ShieldCheck className="w-4 h-4 text-amber-400" /> แอดมิน (ใช้ได้ทุกหน้า + จัดการผู้ใช้)
            </label>
            <label className={`flex items-center gap-2 ${isSelf ? 'opacity-50' : ''}`}>
              <input type="checkbox" className="accent-emerald-500" checked={form.isActive} disabled={isSelf}
                onChange={(e) => set({ isActive: e.target.checked })} />
              เปิดใช้งาน
            </label>
          </div>

          {!form.isAdmin && (
            <>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] text-slate-500">ชุดสำเร็จ:</span>
                {PRESETS.map((p) => (
                  <button key={p.key} type="button" onClick={() => set({ pages: { ...p.pages } })}
                    className="text-[11px] px-2 py-1 rounded-md border border-slate-700 text-slate-300 hover:bg-slate-800">
                    {p.label}
                  </button>
                ))}
                <button type="button" onClick={() => set({ pages: {} })}
                  className="text-[11px] px-2 py-1 rounded-md text-slate-500 hover:text-slate-300">ล้าง</button>
              </div>

              {PAGE_GROUPS.map((g) => (
                <div key={g.key} className="border border-slate-800 rounded-xl overflow-hidden">
                  <div className="flex items-center justify-between px-3 py-2 bg-slate-950/60 text-xs">
                    <span className="font-medium text-slate-200">{g.label}</span>
                    <button type="button" onClick={() => toggleGroup(g)} className="text-slate-500 hover:text-slate-300">ติ๊กทั้งหมด</button>
                  </div>
                  <div className="grid grid-cols-[1fr_64px_64px] px-3 py-1 text-[10px] text-slate-500 border-t border-slate-800">
                    <span /><span className="text-center">ใช้ได้</span><span className="text-center">แก้ไขได้</span>
                  </div>
                  {g.pages.map((p) => (
                    <div key={p.key} className="grid grid-cols-[1fr_64px_64px] items-center px-3 py-1.5 border-t border-slate-800 text-sm text-slate-300">
                      <span>{p.label}</span>
                      <Check on={Boolean(form.pages[p.key])} onClick={() => toggleView(p.key)} />
                      <Check on={form.pages[p.key] === 'edit'} disabled={!form.pages[p.key] || p.viewOnly}
                        title={p.viewOnly ? 'หน้านี้มีแต่ข้อมูลให้ดู' : undefined} onClick={() => toggleEdit(p.key)} />
                    </div>
                  ))}
                </div>
              ))}
            </>
          )}
        </div>

        <div className="flex justify-end gap-2 px-5 py-4 border-t border-slate-800">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-xs text-slate-400 hover:bg-slate-800">ยกเลิก</button>
          <button onClick={submit} disabled={busy || !canSave}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs bg-amber-500/15 text-amber-300 border border-amber-500/30 hover:bg-amber-500/25 disabled:opacity-40">
            {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} บันทึก
          </button>
        </div>
      </div>
    </div>
  );
}

/** หน้าจัดการผู้ใช้ — เฉพาะแอดมิน (กันทั้งที่ PageGate และ /api/auth/users) */
export default function Users() {
  const auth = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null); // null = ปิด · 'new' · user object

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setUsers(await fetchUsers());
    } catch (err) {
      setError(/ไม่รู้จักคำสั่ง/.test(err.message)
        ? 'office-server ที่ออฟฟิศยังเป็นรุ่นเก่า — รัน update-office-server.bat ของ Narai-branch ก่อน'
        : err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/25 flex items-center justify-center">
            <UsersIcon className="w-5 h-5 text-amber-400" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-slate-100">จัดการผู้ใช้</h1>
            <p className="text-xs text-slate-500">ผู้ใช้ทั้งหมด {users.length} คน · กดแถวเพื่อแก้สิทธิ์ · แก้แล้วมีผลเมื่อผู้ใช้เปิดหน้าเว็บใหม่ (ช้าสุด 10 นาที)</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700">
            <RefreshCw className="w-3.5 h-3.5" /> รีเฟรช
          </button>
          <button onClick={() => setEditing('new')} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs bg-amber-500/15 text-amber-300 hover:bg-amber-500/25 border border-amber-500/30">
            <Plus className="w-3.5 h-3.5" /> เพิ่มผู้ใช้
          </button>
        </div>
      </header>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-slate-500 gap-2"><Loader2 className="w-5 h-5 animate-spin text-amber-400" /> กำลังโหลด...</div>
      ) : error ? (
        <div className="text-sm text-rose-300 bg-rose-500/10 border border-rose-500/25 rounded-xl p-4">{error}</div>
      ) : (
        <div className="bg-slate-900/60 border border-slate-800 rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] text-slate-500 border-b border-slate-800">
                <th className="text-left font-normal px-4 py-2.5">ชื่อผู้ใช้</th>
                <th className="text-left font-normal px-4 py-2.5">ชื่อที่แสดง</th>
                <th className="text-left font-normal px-4 py-2.5">หน้าที่ใช้ได้</th>
                <th className="text-left font-normal px-4 py-2.5 whitespace-nowrap">เข้าล่าสุด</th>
                <th className="text-left font-normal px-4 py-2.5">สถานะ</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.username} onClick={() => setEditing(u)} className="border-b border-slate-800/70 hover:bg-slate-800/40 cursor-pointer">
                  <td className="px-4 py-2.5 text-slate-200 whitespace-nowrap">{u.username}{u.username === auth.user?.username && <span className="text-[10px] text-slate-500"> (คุณ)</span>}</td>
                  <td className="px-4 py-2.5 text-slate-300">{u.name || '-'}</td>
                  <td className="px-4 py-2.5"><Chips user={u} /></td>
                  <td className="px-4 py-2.5 text-xs text-slate-400 whitespace-nowrap">{u.lastLoginAt ? formatStamp(u.lastLoginAt) : (u.hasPassword ? '-' : 'ยังไม่เคยเข้า')}</td>
                  <td className={`px-4 py-2.5 text-xs whitespace-nowrap ${u.isActive ? 'text-emerald-400' : 'text-rose-400'}`}>{u.isActive ? 'ใช้งาน' : 'ปิดใช้งาน'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <UserEditor
          initial={editing === 'new' ? null : editing}
          isSelf={editing !== 'new' && editing.username === auth.user?.username}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); auth.refresh(); }}
        />
      )}
    </div>
  );
}
