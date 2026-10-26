import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { BookOpen, Search, RefreshCw, Eye, EyeOff, Loader2, AlertTriangle, Recycle, Plus, Trash2, Save, X, Pencil } from 'lucide-react';
import { kitchenCall, formatQty } from '../../services/kitchenService';
import { fetchQcrdMenus, round3 } from '../../services/qcrdService';
import { isKitchenItemName } from '../../../lib/kitchenRequests';
import Modal from '../../components/kitchen/KitchenModal';
import { useRecipeData, RecipeTable } from '../../components/kitchen/RecipeView';
import ItemPicker from '../../components/kitchen/ItemPicker';

// กติกาเดียวกับตัวเลือกเมนูของแพลนผลิต — ชื่อขึ้นต้นด้วย FC และไม่ได้ปิดใน QC/RD
const isKitchenMenu = (menu) => isKitchenItemName(menu.name) && menu.status !== 'ปิดการใช้งาน';
const byCode = (a, b) => String(a.code).localeCompare(String(b.code), undefined, { numeric: true });

const INPUT = 'bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-cyan-500/60';

/**
 * เมนูครัวกลาง — เมนู FC ทั้งหมดจาก QC/RD · กดแถว = ดูสูตร · สวิตช์ = เปิด/ปิดการแสดงในหน้าครัวกลาง
 *
 * ปิดเมนู = ไม่ขึ้นในตัวเลือกเมนูของแพลนผลิต (ใช้ร่วมกันทุกคน เก็บที่ dbo.kitchen_menu_setting ของ office-server)
 * ไม่แตะทะเบียนเมนูของ QC/RD และแผน/คำสั่งผลิตที่มีอยู่แล้วของเมนูนั้นยังอยู่ครบ
 */
export default function KitchenMenus() {
  const [menus, setMenus] = useState([]);
  const [hidden, setHidden] = useState(() => new Set());
  const [loading, setLoading] = useState(true);
  const [missingTable, setMissingTable] = useState(false);
  const [term, setTerm] = useState('');
  const [show, setShow] = useState('all'); // all | on | off
  const [group, setGroup] = useState('');
  const [saving, setSaving] = useState(() => new Set()); // key ที่กำลังบันทึก
  const [bulkBusy, setBulkBusy] = useState(false);
  const [open, setOpen] = useState(null); // เมนูที่เปิดดูสูตร

  const load = useCallback(async (refresh = false) => {
    setLoading(true);
    try {
      const [res, setting] = await Promise.all([
        fetchQcrdMenus(refresh),
        kitchenCall('getKitchenMenuSettings').catch((err) => ({ hidden: [], error: err.message })),
      ]);
      setMenus((res.menus || []).filter(isKitchenMenu).sort(byCode));
      setHidden(new Set(setting.hidden || []));
      setMissingTable(Boolean(setting.missingTable || setting.error));
    } catch (err) {
      toast.error(`โหลดเมนู QC/RD ไม่ได้: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const groups = useMemo(() => [...new Set(menus.map((m) => m.groupName).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'th')), [menus]);

  const shown = useMemo(() => {
    const q = term.trim().toLowerCase();
    return menus.filter((m) => {
      if (group && m.groupName !== group) return false;
      const off = hidden.has(m.key);
      if (show === 'on' && off) return false;
      if (show === 'off' && !off) return false;
      return !q || m.name.toLowerCase().includes(q) || String(m.code).toLowerCase().includes(q);
    });
  }, [menus, hidden, term, show, group]);

  const offCount = menus.filter((m) => hidden.has(m.key)).length;

  const applyHidden = (list, value) => setHidden((prev) => {
    const next = new Set(prev);
    list.forEach((m) => (value ? next.add(m.key) : next.delete(m.key)));
    return next;
  });

  const save = async (list, value) => {
    const res = await kitchenCall('setKitchenMenuHidden', {
      items: list.map((m) => ({ productKey: m.key, productCode: m.code, productName: m.name, hidden: value })),
    });
    toast.success(res.message || 'บันทึกแล้ว');
  };

  // สวิตช์รายเมนู — เปลี่ยนบนจอก่อน พลาดค่อยย้อนกลับ
  const toggle = async (menu) => {
    if (saving.has(menu.key)) return;
    const value = !hidden.has(menu.key);
    applyHidden([menu], value);
    setSaving((prev) => new Set(prev).add(menu.key));
    try {
      await save([menu], value);
    } catch (err) {
      applyHidden([menu], !value);
      toast.error(err.message);
    } finally {
      setSaving((prev) => { const n = new Set(prev); n.delete(menu.key); return n; });
    }
  };

  const bulk = async (value) => {
    const list = shown.filter((m) => hidden.has(m.key) !== value);
    if (list.length === 0) { toast(value ? 'เมนูที่แสดงอยู่ปิดหมดแล้ว' : 'เมนูที่แสดงอยู่เปิดหมดแล้ว', { icon: 'ℹ️' }); return; }
    if (!window.confirm(`${value ? 'ปิด' : 'เปิด'} ${list.length} เมนูที่กรองอยู่ ใช่ไหม?`)) return;
    setBulkBusy(true);
    try {
      await save(list, value);
      applyHidden(list, value);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBulkBusy(false);
    }
  };

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="glass-panel rounded-2xl p-5 border border-slate-800 bg-gradient-to-r from-slate-900 via-slate-900 to-violet-950/30 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold text-violet-400 mb-1">
            <BookOpen className="w-4 h-4" />
            <span>ครัวกลาง · เมนูครัวกลาง</span>
          </div>
          <h1 className="text-xl md:text-2xl font-bold text-slate-100">เมนูครัวกลาง</h1>
          <p className="text-xs text-slate-400 mt-1">
            เมนู FC ทั้งหมดจาก QC/RD · กดที่เมนูเพื่อดูสูตร · ปิดเมนูที่ไม่ใช้ แล้วจะไม่ขึ้นในตัวเลือกเมนูของแพลนผลิต
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Stat label="ทั้งหมด" value={menus.length} tone="text-slate-200" />
          <Stat label="แสดงอยู่" value={menus.length - offCount} tone="text-emerald-400" />
          <Stat label="ปิดไว้" value={offCount} tone="text-slate-400" />
        </div>
      </div>

      {missingTable && (
        <div className="flex gap-2 items-start text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-xl px-3.5 py-2.5">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>office-server ที่ออฟฟิศยังไม่รองรับการเปิด/ปิดเมนู — รัน update-office-server.bat ของ Narai-branch ก่อน (ตอนนี้ทุกเมนูแสดงตามปกติ)</span>
        </div>
      )}

      <div className="glass-card rounded-2xl p-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-48">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="ค้นหาชื่อหรือรหัสเมนู..." className={`${INPUT} w-full pl-8`} />
        </div>
        <select value={group} onChange={(e) => setGroup(e.target.value)} className={INPUT}>
          <option value="">ทุกหมวด</option>
          {groups.map((g) => <option key={g} value={g}>{g}</option>)}
        </select>
        <div className="flex items-center bg-slate-950 p-1 rounded-xl border border-slate-800">
          {[['all', 'ทั้งหมด'], ['on', 'แสดงอยู่'], ['off', 'ปิดไว้']].map(([k, label]) => (
            <button key={k} onClick={() => setShow(k)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${show === k ? 'bg-amber-500 text-slate-950' : 'text-slate-400 hover:text-slate-200'}`}>
              {label}
            </button>
          ))}
        </div>
        <button onClick={() => load(true)} title="ดึงเมนูจาก QC/RD ใหม่"
          className="p-2 rounded-xl bg-slate-950 border border-slate-800 text-slate-300 hover:text-amber-400">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-amber-400' : ''}`} />
        </button>
      </div>

      <div className="glass-panel rounded-2xl border border-slate-800 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-slate-800 text-xs text-slate-400">
          <span>แสดง {shown.length.toLocaleString()} จาก {menus.length.toLocaleString()} เมนู · เรียงตามรหัส</span>
          <div className="flex items-center gap-1.5">
            <button data-write onClick={() => bulk(false)} disabled={bulkBusy || missingTable}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/20 disabled:opacity-40">
              <Eye className="w-3.5 h-3.5" /> เปิดทั้งหมดที่กรองอยู่
            </button>
            <button data-write onClick={() => bulk(true)} disabled={bulkBusy || missingTable}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700 disabled:opacity-40">
              <EyeOff className="w-3.5 h-3.5" /> ปิดทั้งหมดที่กรองอยู่
            </button>
          </div>
        </div>

        {loading && menus.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-12 text-xs text-slate-500"><Loader2 className="w-4 h-4 animate-spin" /> กำลังโหลดเมนู...</div>
        ) : shown.length === 0 ? (
          <div className="py-12 text-center text-xs text-slate-500">ไม่พบเมนู</div>
        ) : (
          <div className="divide-y divide-slate-800/70">
            {shown.map((m) => {
              const off = hidden.has(m.key);
              return (
                <div key={m.key} role="button" tabIndex={0} onClick={() => setOpen(m)}
                  onKeyDown={(e) => { if (e.key === 'Enter') setOpen(m); }}
                  className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-slate-800/40 ${off ? 'opacity-50' : ''}`}>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-slate-100 truncate">{m.name}</div>
                    <div className="text-[11px] text-slate-500 truncate">
                      {m.code}{m.groupName && ` · ${m.groupName}`}
                      {Number(m.yieldQty) > 0 && ` · 1 สูตร ได้ ${formatQty(m.yieldQty)} ${m.yieldUnit || ''}`}
                    </div>
                  </div>
                  {off && <span className="hidden md:inline text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700">ปิดไว้</span>}
                  <span className="hidden md:flex items-center gap-1 text-[11px] text-cyan-300"><BookOpen className="w-3.5 h-3.5" /> ดูสูตร</span>
                  <button data-write
                    onClick={(e) => { e.stopPropagation(); toggle(m); }}
                    disabled={missingTable}
                    title={off ? 'กดเพื่อแสดงในหน้าครัวกลาง' : 'กดเพื่อปิด ไม่ให้ขึ้นในหน้าครัวกลาง'}
                    className={`relative w-10 h-6 rounded-full shrink-0 transition-colors disabled:opacity-40 ${off ? 'bg-slate-700' : 'bg-emerald-500'}`}>
                    <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${off ? 'left-0.5' : 'left-[18px]'}`} />
                    {saving.has(m.key) && <Loader2 className="absolute inset-0 m-auto w-3 h-3 animate-spin text-slate-900" />}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {open && <MenuRecipeModal menu={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function Stat({ label, value, tone }) {
  return (
    <div className="px-3 py-2 rounded-xl bg-slate-950/60 border border-slate-800">
      <p className="text-[10px] text-slate-400">{label}</p>
      <p className={`text-sm font-bold ${tone}`}>{Number(value).toLocaleString()}</p>
    </div>
  );
}

/** สูตรของเมนูหนึ่งตัว — ใส่จำนวนสูตรเพื่อคูณยอดวัตถุดิบได้ (ดูอย่างเดียว) */
function MenuRecipeModal({ menu, onClose }) {
  const data = useRecipeData(menu.code || menu.key);
  const [batches, setBatches] = useState('1');
  const n = Number(batches);
  const ok = Number.isFinite(n) && n > 0;
  const base = data.recipe?.menu || menu;
  const yieldQty = Number(base.yieldQty) || 0;

  return (
    <Modal onClose={onClose}
      title={<span className="flex items-center gap-2"><BookOpen className="w-4 h-4 text-violet-400" /> สูตร · {menu.name}</span>}>
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] text-slate-400">
          <span>{menu.code}{menu.groupName && ` · ${menu.groupName}`}</span>
          {yieldQty > 0 && <span>1 สูตร ได้ <strong className="text-slate-200">{formatQty(yieldQty)} {base.yieldUnit || ''}</strong></span>}
          <label className="flex items-center gap-1.5 ml-auto">
            คิดที่
            <input type="number" inputMode="decimal" min="0" step="any" value={batches} onChange={(e) => setBatches(e.target.value)}
              className={`${INPUT} w-20 text-right py-1`} />
            สูตร
            {ok && yieldQty > 0 && <span className="text-cyan-300">= {formatQty(round3(n * yieldQty))} {base.yieldUnit || ''}</span>}
          </label>
        </div>
        <RecipeTable data={data} mult={ok ? n : 1}
          scaledLabel={ok && n !== 1 ? `${formatQty(n)} สูตร` : undefined} />
        <LeftoverSection menu={menu} />
      </div>
    </Modal>
  );
}

/**
 * ของเหลือจากการผลิตของเมนูนี้ (เช่น เศษลูกชิ้น) — ผูกไอเทมได้หลายตัว หนึ่งไอเทมผูกได้หลายเมนู
 * ผูกแล้ว: ปิดงานผลิตเมนูนี้มีช่องกรอกของเหลือ (เข้าสต๊อกครัว) · ผลิตครั้งต่อไปขึ้นของเหลือที่มีให้ใช้ (ตัดสต๊อก)
 * ไอเทมเลือกจากทะเบียนสินค้า หรือสร้างใหม่ (รหัส LO-xxxx ติ๊กสาขาครัวให้เอง) — getLeftoverLinks / saveMenuLeftovers / createLeftoverItem
 */
function LeftoverSection({ menu }) {
  const [links, setLinks] = useState(null); // ไอเทมที่ผูกกับเมนูนี้ (ตามที่บันทึกแล้ว)
  const [draft, setDraft] = useState(null); // ชุดที่กำลังแก้ (null = ยังไม่ได้แตะ)
  const [allLinks, setAllLinks] = useState([]);
  const [items, setItems] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(null); // { name, unit, price } | null
  const [editing, setEditing] = useState(null); // { item_key, item_code, name, unit, price, oldUnit } — แก้ไอเทม LO-

  const load = useCallback(async () => {
    try {
      const [res, it] = await Promise.all([
        kitchenCall('getLeftoverLinks'),
        kitchenCall('getKitchenItems'),
      ]);
      if (res.ready === false) { setError('ยังไม่มีตารางของเหลือ — รัน update-office-server.bat ที่เครื่องออฟฟิศก่อน'); return; }
      setAllLinks(res.links || []);
      setLinks((res.links || []).filter((l) => l.product_key === menu.key));
      setItems(it.items || []);
      setDraft(null);
    } catch (err) {
      setError(/ไม่รู้จัก/.test(err.message)
        ? 'office-server ที่ออฟฟิศยังเป็นรุ่นเก่า — รัน update-office-server.bat ของ Narai-branch ก่อน'
        : err.message);
    }
  }, [menu.key]);
  useEffect(() => { load(); }, [load]);

  const list = draft ?? links ?? [];
  const dirty = draft !== null;
  const keys = useMemo(() => new Set(list.map((l) => l.item_key)), [list]);
  // ไอเทมนี้ผูกกับเมนูอื่นอยู่ด้วย — บอกไว้ ให้รู้ว่าของเหลือตัวเดียวกันใช้ข้ามเมนูได้
  const otherMenus = (itemKey) => allLinks.filter((l) => l.item_key === itemKey && l.product_key !== menu.key)
    .map((l) => l.product_name || l.product_key);

  const add = (it) => setDraft([...list, { item_key: it.item_key, item_code: it.item_code, item_name: it.item_name, unit: it.unit }]);
  const remove = (key) => setDraft(list.filter((l) => l.item_key !== key));

  const save = async () => {
    setBusy(true);
    try {
      const res = await kitchenCall('saveMenuLeftovers', {
        productKey: menu.key, productCode: menu.code, productName: menu.name, itemKeys: list.map((l) => l.item_key),
      });
      toast.success(res.message);
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    if (!creating.name.trim()) { toast.error('ใส่ชื่อไอเทม'); return; }
    if (!creating.unit.trim()) { toast.error('ใส่หน่วย'); return; }
    setBusy(true);
    try {
      const res = await kitchenCall('createLeftoverItem', {
        name: creating.name.trim(), unit: creating.unit.trim(), price: Number(creating.price) || 0,
      });
      toast.success(res.message);
      setItems((prev) => [...prev, res.item]);
      add(res.item);
      setCreating(null);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  // แก้ชื่อ/หน่วย/ราคาของไอเทม LO- (updateLeftoverItem) — ไอเทมอื่นในทะเบียนแก้ที่ QC/RD
  const isLo = (l) => /^LO-/i.test(String(l.item_code || ''));
  const startEdit = (l) => setEditing({
    item_key: l.item_key, item_code: l.item_code, name: l.item_name || '', unit: l.unit || '',
    price: Number(l.price) > 0 ? String(Number(l.price)) : '', oldUnit: l.unit || '',
  });
  const saveEdit = async () => {
    if (!editing.name.trim()) { toast.error('ใส่ชื่อไอเทม'); return; }
    if (!editing.unit.trim()) { toast.error('ใส่หน่วย'); return; }
    if (editing.oldUnit && editing.unit.trim() !== editing.oldUnit
      && !window.confirm(`เปลี่ยนหน่วยจาก "${editing.oldUnit}" เป็น "${editing.unit.trim()}" ใช่ไหม?\nยอดคงเหลือ/ใบรับเข้า/ใบเบิกเดิมไม่ถูกแปลงหน่วยให้ — ตัวเลขเดิมจะถูกอ่านเป็นหน่วยใหม่`)) return;
    setBusy(true);
    try {
      const res = await kitchenCall('updateLeftoverItem', {
        itemKey: editing.item_key, name: editing.name.trim(), unit: editing.unit.trim(), price: editing.price,
      });
      toast.success(res.message);
      const patch = (l) => (l.item_key === editing.item_key
        ? { ...l, item_name: res.item.item_name, unit: res.item.unit, ...(res.item.price !== undefined ? { price: res.item.price } : {}) }
        : l);
      setItems((prev) => prev.map(patch));
      setAllLinks((prev) => prev.map(patch));
      setLinks((prev) => (prev || []).map(patch));
      setDraft((prev) => (prev ? prev.map(patch) : prev));
      setEditing(null);
    } catch (err) {
      toast.error(/ไม่รู้จัก/.test(err.message)
        ? 'office-server ที่ออฟฟิศยังเป็นรุ่นเก่า — รัน update-office-server.bat ของ Narai-branch ก่อน'
        : err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-teal-500/30 bg-teal-500/5 p-3.5 space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold text-teal-300 flex items-center gap-1.5">
          <Recycle className="w-3.5 h-3.5" /> ของเหลือจากการผลิต — เก็บเข้าสต๊อกครัว ใช้ผลิตครั้งต่อไป
        </h3>
        {dirty && (
          <button data-write onClick={save} disabled={busy}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-teal-500 text-slate-950 hover:bg-teal-400 disabled:opacity-40">
            {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />} บันทึกการผูก
          </button>
        )}
      </div>
      {error ? (
        <p className="text-[11px] text-amber-300">{error}</p>
      ) : links === null ? (
        <div className="flex items-center gap-2 text-[11px] text-slate-500"><Loader2 className="w-3 h-3 animate-spin" /> กำลังโหลด...</div>
      ) : (
        <>
          {list.length === 0 && <p className="text-[11px] text-slate-500">ยังไม่ได้ผูกของเหลือกับเมนูนี้</p>}
          {list.map((l) => {
            const others = otherMenus(l.item_key);
            if (editing?.item_key === l.item_key) {
              return (
                <div key={l.item_key} className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-2.5 space-y-2 text-xs">
                  <div className="flex items-center justify-between text-[11px] text-amber-300">
                    แก้ไอเทม <span className="font-mono">{l.item_code}</span>
                    <button onClick={() => setEditing(null)} className="text-slate-500 hover:text-slate-300"><X className="w-3.5 h-3.5" /></button>
                  </div>
                  <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} autoFocus
                    placeholder="ชื่อไอเทม" className={`${INPUT} w-full`} />
                  <div className="grid grid-cols-2 gap-2">
                    <input value={editing.unit} onChange={(e) => setEditing({ ...editing, unit: e.target.value })}
                      placeholder="หน่วย" className={INPUT} />
                    <input type="number" inputMode="decimal" min="0" step="any" value={editing.price}
                      onChange={(e) => setEditing({ ...editing, price: e.target.value })}
                      placeholder="ราคา/หน่วย (ไม่ใส่ก็ได้)" className={`${INPUT} text-right`} />
                  </div>
                  {others.length > 0 && <p className="text-[10px] text-slate-500">เปลี่ยนแล้วมีผลกับเมนูอื่นที่ผูกไว้ด้วย: {others.join(', ')}</p>}
                  <div className="flex justify-end gap-2">
                    <button onClick={() => setEditing(null)} className="px-3 py-1.5 rounded-lg text-xs text-slate-400 hover:bg-slate-800">ยกเลิก</button>
                    <button data-write onClick={saveEdit} disabled={busy}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-500 text-slate-950 hover:bg-amber-400 disabled:opacity-40">
                      {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />} บันทึก
                    </button>
                  </div>
                </div>
              );
            }
            return (
              <div key={l.item_key} className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs">
                <div className="min-w-0">
                  <span className="text-slate-100">{l.item_name}</span>
                  <span className="text-slate-500 font-mono"> · {l.item_code}{l.unit ? ` · ${l.unit}` : ''}</span>
                  {others.length > 0 && <div className="text-[10px] text-slate-500 truncate">ใช้กับเมนูอื่นด้วย: {others.join(', ')}</div>}
                </div>
                <div className="flex items-center gap-0.5 shrink-0">
                  {isLo(l) && (
                    <button data-write onClick={() => startEdit(l)} title="แก้ชื่อ / หน่วย / ราคา"
                      className="p-1 rounded text-slate-500 hover:text-amber-300 hover:bg-slate-800"><Pencil className="w-3.5 h-3.5" /></button>
                  )}
                  <button data-write onClick={() => remove(l.item_key)} title="เลิกผูกกับเมนูนี้"
                    className="p-1 rounded text-slate-500 hover:text-rose-300 hover:bg-slate-800"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              </div>
            );
          })}
          <div data-write className="space-y-2">
            <ItemPicker items={items} excludeKeys={keys} onSelect={add} placeholder="เพิ่มไอเทมของเหลือ — พิมพ์ชื่อหรือรหัสจากทะเบียนสินค้า..." />
            {creating ? (
              <div className="rounded-lg border border-dashed border-teal-500/40 p-2.5 space-y-2">
                <div className="flex items-center justify-between text-[11px] text-teal-300">
                  สร้างไอเทมใหม่ (รหัส LO-xxxx ให้เอง · ติ๊กสาขาครัวให้)
                  <button onClick={() => setCreating(null)} className="text-slate-500 hover:text-slate-300"><X className="w-3.5 h-3.5" /></button>
                </div>
                <input value={creating.name} onChange={(e) => setCreating({ ...creating, name: e.target.value })} autoFocus
                  placeholder="ชื่อไอเทม เช่น เศษลูกชิ้นเนื้อ (ต้มแล้ว)" className={`${INPUT} w-full`} />
                <div className="grid grid-cols-2 gap-2">
                  <input value={creating.unit} onChange={(e) => setCreating({ ...creating, unit: e.target.value })}
                    placeholder="หน่วย เช่น กก." className={INPUT} />
                  <input type="number" inputMode="decimal" min="0" step="any" value={creating.price}
                    onChange={(e) => setCreating({ ...creating, price: e.target.value })}
                    placeholder="ราคา/หน่วย (ไม่ใส่ก็ได้)" className={`${INPUT} text-right`} />
                </div>
                <div className="flex justify-end">
                  <button onClick={create} disabled={busy}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-teal-500 text-slate-950 hover:bg-teal-400 disabled:opacity-40">
                    {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />} สร้างแล้วเพิ่มเข้าเมนูนี้
                  </button>
                </div>
              </div>
            ) : (
              <button onClick={() => setCreating({ name: '', unit: '', price: '' })}
                className="w-full flex items-center justify-center gap-1 px-3 py-2 rounded-lg text-xs text-teal-300 border border-dashed border-teal-500/40 hover:bg-teal-500/10">
                <Plus className="w-3.5 h-3.5" /> สร้างไอเทมของเหลือใหม่
              </button>
            )}
          </div>
          {dirty && <p className="text-[10px] text-amber-300">ยังไม่ได้บันทึก — กด "บันทึกการผูก"</p>}
        </>
      )}
    </div>
  );
}
