import React, { useEffect, useMemo, useState } from 'react';
import { Search, Loader2, RefreshCw } from 'lucide-react';
import { formatQty } from '../../services/kitchenService';
import { fetchQcrdMenus } from '../../services/qcrdService';

/**
 * รายการเมนู QC/RD แบบพิมพ์ค้น — ใช้ทั้งหน้าสูตรการผลิตและหน้าผลิตตามสูตร
 *
 * เมนูมีหลายพันรายการ โหลดมาทั้งชุดครั้งเดียวแล้วกรองในเบราว์เซอร์ แสดงสูงสุด 100 รายการ
 *
 * @param {object} props
 * @param {(menu: object) => void} props.onPick
 * @param {Set<string>} [props.markedKeys] เมนูที่จะขึ้นป้าย (เช่น มีสูตรครัวแล้ว)
 * @param {string} [props.markLabel]
 * @param {boolean} [props.disabled]
 * @param {string} [props.listClassName] ความสูงของรายการ
 */
export default function QcrdMenuPicker({ onPick, markedKeys, markLabel, disabled, listClassName = 'max-h-[55vh]' }) {
  const [menus, setMenus] = useState([]);
  const [loadedAt, setLoadedAt] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [term, setTerm] = useState('');
  const [withRecipeOnly, setWithRecipeOnly] = useState(true);
  const [includeInactive, setIncludeInactive] = useState(false);

  const load = async (refresh = false) => {
    setLoading(true);
    setError('');
    try {
      const res = await fetchQcrdMenus(refresh);
      setMenus(res.menus || []);
      setLoadedAt(res.loadedAt || '');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const matches = useMemo(() => {
    const q = term.trim().toLowerCase();
    const out = [];
    for (const m of menus) {
      if (withRecipeOnly && m.lineCount === 0) continue;
      if (!includeInactive && m.status === 'ปิดการใช้งาน') continue;
      if (q && !m.name.toLowerCase().includes(q) && !m.code.toLowerCase().includes(q)
        && !m.groupName.toLowerCase().includes(q)) continue;
      out.push(m);
      if (out.length >= 100) break;
    }
    return out;
  }, [menus, term, withRecipeOnly, includeInactive]);

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
        <input
          autoFocus
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="ค้นหาชื่อเมนู รหัส หรือหมวด..."
          className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-9 pr-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-purple-500/60"
        />
      </div>
      <div className="flex flex-wrap items-center gap-4 text-xs text-slate-400">
        <label className="flex items-center gap-1.5">
          <input type="checkbox" className="accent-purple-500" checked={withRecipeOnly}
            onChange={(e) => setWithRecipeOnly(e.target.checked)} />
          เฉพาะเมนูที่มีสูตร
        </label>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" className="accent-purple-500" checked={includeInactive}
            onChange={(e) => setIncludeInactive(e.target.checked)} />
          รวมเมนูที่ปิดใช้งาน
        </label>
        <button onClick={() => load(true)} disabled={loading}
          className="ml-auto flex items-center gap-1 text-slate-500 hover:text-slate-300 disabled:opacity-50">
          <RefreshCw className="w-3 h-3" /> โหลดใหม่จากชีท
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-slate-500 gap-2 text-sm">
          <Loader2 className="w-4 h-4 animate-spin text-purple-400" /> กำลังโหลดเมนูจาก QC/RD...
        </div>
      ) : error ? (
        <div className="py-10 text-center text-sm text-rose-300">{error}</div>
      ) : (
        <>
          <div className="text-[11px] text-slate-500">
            {menus.length.toLocaleString()} เมนู{matches.length >= 100 ? ' · แสดง 100 รายการแรก พิมพ์ค้นให้แคบลง' : ''}
          </div>
          <div className={`${listClassName} overflow-y-auto border border-slate-800 rounded-lg divide-y divide-slate-800/70`}>
            {matches.length === 0 ? (
              <div className="py-10 text-center text-sm text-slate-500">ไม่พบเมนู</div>
            ) : matches.map((m) => (
              <button
                key={m.code}
                onClick={() => onPick(m)}
                disabled={disabled}
                className="w-full text-left px-3 py-2 hover:bg-slate-800/50 flex items-center gap-3 disabled:opacity-50"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-slate-200 truncate">{m.name}</div>
                  <div className="text-[11px] text-slate-500">
                    {m.code}{m.groupName ? ` · ${m.groupName}` : ''}
                    {m.status === 'ปิดการใช้งาน' ? ' · ปิดใช้งาน' : ''}
                  </div>
                </div>
                {markedKeys?.has(m.key) && markLabel && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded border bg-amber-500/10 text-amber-300 border-amber-500/30">
                    {markLabel}
                  </span>
                )}
                <span className="text-[11px] text-slate-500 shrink-0">
                  {m.lineCount} วัตถุดิบ
                  {m.yieldQty ? ` · ได้ ${formatQty(m.yieldQty)} ${m.yieldUnit}` : ''}
                </span>
              </button>
            ))}
          </div>
          {loadedAt && (
            <div className="text-[10px] text-slate-600 text-right">
              โหลดจากชีทเมื่อ {new Date(loadedAt).toLocaleString('th-TH')}
            </div>
          )}
        </>
      )}
    </div>
  );
}
