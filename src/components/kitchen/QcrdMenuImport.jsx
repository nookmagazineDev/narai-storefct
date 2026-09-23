import React, { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Search, X, Loader2, ChevronLeft, Download, AlertTriangle, RefreshCw } from 'lucide-react';
import { formatQty } from '../../services/kitchenService';

// ตารางครัวเก็บจำนวนเป็น DECIMAL(18,3) — ต่ำกว่านี้ปัดแล้วเป็น 0 ซึ่งบันทึกไม่ได้ (CHECK qty > 0)
const MIN_QTY = 0.001;
const round3 = (n) => Math.round(n * 1000) / 1000;

async function getJson(url) {
  let res;
  try {
    res = await fetch(url);
  } catch {
    throw new Error('ต่อเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจสอบการเชื่อมต่อแล้วลองใหม่');
  }
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.success) throw new Error(json?.error || `เกิดข้อผิดพลาด (HTTP ${res.status})`);
  return json;
}

/**
 * เลือกเมนูจาก QC/RD (naraipizzeria) มาเป็นสูตรตั้งต้นของครัวกลาง
 *
 * สูตรใน QC/RD เก็บยอดใช้เป็น "หน่วยเล็ก" (กรัม/มล.) แต่ครัวนับสต๊อก เบิก และคิดคงเหลือเป็น
 * หน่วยสต๊อก (กก./ถุง) จึงแปลงให้ด้วยตัวแปลงหน่วยของชีทก่อนส่งเข้าฟอร์ม ไม่งั้นใบเบิกที่
 * คำนวณจากสูตรจะเกินจริงเป็นพันเท่า — และโชว์ตัวเลขทั้งสองฝั่งให้ตรวจก่อนกดใช้
 *
 * ไม่ได้บันทึกเอง: ส่งร่างกลับไปเปิดในฟอร์มสูตรเดิม ให้คนตรวจแล้วกดบันทึกเหมือนสูตรที่กรอกมือ
 *
 * @param {object} props
 * @param {Array} props.stockItems รายการ stock_item (จาก getKitchenItems) ใช้จับคู่ชื่อ/หน่วยวัตถุดิบ
 * @param {Array} props.recipes สูตรครัวที่มีอยู่แล้ว ใช้เตือนว่าจะทับของเดิม
 * @param {(draft: object) => void} props.onImport
 * @param {() => void} props.onClose
 */
export default function QcrdMenuImport({ stockItems, recipes, onImport, onClose }) {
  const [menus, setMenus] = useState([]);
  const [loadedAt, setLoadedAt] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [term, setTerm] = useState('');
  const [withRecipeOnly, setWithRecipeOnly] = useState(true);
  const [includeInactive, setIncludeInactive] = useState(false);

  const [picked, setPicked] = useState(null); // { menu, lines }
  const [pickLoading, setPickLoading] = useState(false);
  const [batch, setBatch] = useState('1');
  const [skipNoDeduct, setSkipNoDeduct] = useState(true);

  const loadMenus = async (refresh = false) => {
    setLoading(true);
    setError('');
    try {
      const res = await getJson(`/api/qcrd_menus${refresh ? '?refresh=1' : ''}`);
      setMenus(res.menus || []);
      setLoadedAt(res.loadedAt || '');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadMenus(); }, []);

  const stockByKey = useMemo(() => {
    const m = new Map();
    for (const it of stockItems || []) m.set(it.item_key, it);
    return m;
  }, [stockItems]);

  const recipeKeys = useMemo(
    () => new Set((recipes || []).map((r) => r.product_key)),
    [recipes]
  );

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

  const pick = async (menu) => {
    setPickLoading(true);
    try {
      const res = await getJson(`/api/qcrd_recipe?code=${encodeURIComponent(menu.code)}`);
      setPicked({ menu: res.menu, lines: res.lines || [] });
      setBatch('1');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setPickLoading(false);
    }
  };

  // บรรทัดที่แปลงเป็นหน่วยสต๊อกแล้ว ตามจำนวนชุดที่เลือก
  const preview = useMemo(() => {
    if (!picked) return [];
    const mult = Number(batch) > 0 ? Number(batch) : 0;
    return picked.lines.map((l) => {
      const stock = stockByKey.get(l.itemKey);
      const stockQty = mult && l.qty ? round3((l.qty * mult) / l.converter) : 0;
      return {
        ...l,
        stock,
        stockQty,
        stockUnit: stock?.unit || l.purchaseUnit || '',
        skipped: skipNoDeduct && l.noDeduct,
        tooSmall: stockQty < MIN_QTY,
      };
    });
  }, [picked, batch, stockByKey, skipNoDeduct]);

  const usable = preview.filter((l) => !l.skipped && !l.tooSmall && l.itemKey);
  const tooSmallCount = preview.filter((l) => !l.skipped && l.tooSmall).length;

  const apply = () => {
    const mult = Number(batch);
    if (!(mult > 0)) { toast.error('จำนวนชุดต้องมากกว่า 0'); return; }
    if (usable.length === 0) { toast.error('ไม่มีวัตถุดิบที่ใช้ได้ — ลองเพิ่มจำนวนชุดต่อการผลิต'); return; }
    const { menu } = picked;
    const baseYield = menu.yieldQty > 0 ? menu.yieldQty : 1;

    // รวมบรรทัดวัตถุดิบซ้ำ (สูตร QC/RD มีวัตถุดิบเดียวกันหลายแถวได้ แต่สูตรครัวคีย์ที่ item_key)
    const merged = new Map();
    for (const l of usable) {
      const prev = merged.get(l.itemKey);
      if (prev) {
        prev.qty = round3(Number(prev.qty) + l.stockQty);
        prev.note = `${prev.note} + ${formatQty(l.qty * mult)}`;
        continue;
      }
      merged.set(l.itemKey, {
        itemKey: l.itemKey,
        code: l.stock?.item_code || l.itemCode,
        name: l.stock?.item_name || l.itemName,
        qty: l.stockQty,
        unit: l.stockUnit,
        note: `QC/RD ${formatQty(l.qty * mult)}${l.useUnit ? ` ${l.useUnit}` : ''}`,
        notInStock: !l.stock,
      });
    }

    onImport({
      recipeId: null,
      productKey: menu.key,
      productCode: menu.code,
      productName: menu.name,
      yieldQty: String(round3(baseYield * mult)),
      yieldUnit: menu.yieldUnit || '',
      note: `นำเข้าจากเมนู QC/RD ${menu.code}${mult !== 1 ? ` (×${mult} สูตร)` : ''}`,
      isActive: true,
      fromQcrd: true,
      items: [...merged.values()].map((it) => ({ ...it, qty: String(it.qty) })),
    });
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-start justify-center overflow-y-auto p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-3xl my-8 shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
          <div className="flex items-center gap-2">
            {picked && (
              <button onClick={() => setPicked(null)} className="p-1 text-slate-400 hover:text-slate-200">
                <ChevronLeft className="w-4 h-4" />
              </button>
            )}
            <div>
              <h2 className="font-semibold text-slate-100">ดึงเมนูจาก QC/RD</h2>
              <p className="text-[11px] text-slate-500">ทะเบียนเมนูและสูตรของ naraipizzeria</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 text-slate-500 hover:text-slate-300">
            <X className="w-4 h-4" />
          </button>
        </div>

        {!picked ? (
          <div className="p-5 space-y-3">
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
              <button onClick={() => loadMenus(true)} disabled={loading}
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
                <div className="max-h-[55vh] overflow-y-auto border border-slate-800 rounded-lg divide-y divide-slate-800/70">
                  {matches.length === 0 ? (
                    <div className="py-10 text-center text-sm text-slate-500">ไม่พบเมนู</div>
                  ) : matches.map((m) => (
                    <button
                      key={m.code}
                      onClick={() => pick(m)}
                      disabled={pickLoading}
                      className="w-full text-left px-3 py-2 hover:bg-slate-800/50 flex items-center gap-3 disabled:opacity-50"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-slate-200 truncate">{m.name}</div>
                        <div className="text-[11px] text-slate-500">
                          {m.code}{m.groupName ? ` · ${m.groupName}` : ''}
                          {m.status === 'ปิดการใช้งาน' ? ' · ปิดใช้งาน' : ''}
                        </div>
                      </div>
                      {recipeKeys.has(m.key) && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded border bg-amber-500/10 text-amber-300 border-amber-500/30">
                          มีสูตรครัวแล้ว
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
        ) : (
          <div className="p-5 space-y-4">
            <div>
              <div className="text-slate-100 font-medium">{picked.menu.name}</div>
              <div className="text-[11px] text-slate-500">
                {picked.menu.code}{picked.menu.groupName ? ` · ${picked.menu.groupName}` : ''}
                {' · '}สูตร QC/RD 1 ชุด ได้ {formatQty(picked.menu.yieldQty || 1)} {picked.menu.yieldUnit || '(ไม่ระบุหน่วย)'}
              </div>
            </div>

            {recipeKeys.has(picked.menu.key) && (
              <div className="flex items-start gap-2 text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                เมนูนี้มีสูตรในครัวกลางอยู่แล้ว — กดบันทึกในขั้นถัดไปจะทับสูตรเดิม
              </div>
            )}

            <div className="flex flex-wrap items-end gap-4">
              <div>
                <label className="block text-xs text-slate-400 mb-1.5">ครัวผลิตครั้งละกี่สูตร</label>
                <input
                  type="number" min="0" step="1"
                  value={batch}
                  onChange={(e) => setBatch(e.target.value)}
                  className="w-28 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-right text-slate-100 focus:outline-none focus:border-purple-500/60"
                />
              </div>
              <div className="text-xs text-slate-400 pb-2">
                = ได้ {formatQty((picked.menu.yieldQty || 1) * (Number(batch) || 0))} {picked.menu.yieldUnit} ต่อการผลิตหนึ่งครั้ง
              </div>
              <label className="flex items-center gap-1.5 text-xs text-slate-400 pb-2 ml-auto">
                <input type="checkbox" className="accent-purple-500" checked={skipNoDeduct}
                  onChange={(e) => setSkipNoDeduct(e.target.checked)} />
                ข้ามรายการ "ไม่ตัด BOM"
              </label>
            </div>

            <div className="border border-slate-800 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-900 text-slate-400 text-xs">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">วัตถุดิบ</th>
                    <th className="text-right px-3 py-2 font-medium">ตามสูตร QC/RD</th>
                    <th className="text-right px-3 py-2 font-medium">เป็นหน่วยสต๊อก</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.length === 0 ? (
                    <tr><td colSpan={3} className="px-3 py-6 text-center text-slate-500">เมนูนี้ยังไม่มีสูตรใน QC/RD</td></tr>
                  ) : preview.map((l, i) => (
                    <tr key={`${l.itemKey}-${i}`} className={`border-t border-slate-800/70 ${l.skipped || l.tooSmall ? 'opacity-45' : ''}`}>
                      <td className="px-3 py-2">
                        <div className="text-slate-200">{l.stock?.item_name || l.itemName}</div>
                        <div className="text-[11px] text-slate-500 flex flex-wrap gap-x-2">
                          <span>{l.itemCode}</span>
                          {!l.stock && <span className="text-amber-400">ไม่มีในทะเบียนสต๊อก</span>}
                          {l.noDeduct && <span>ไม่ตัด BOM</span>}
                          {l.tag && <span>{l.tag}</span>}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right text-slate-400 whitespace-nowrap">
                        {formatQty((l.qty || 0) * (Number(batch) || 0))} {l.useUnit}
                        <div className="text-[10px] text-slate-600">÷ {formatQty(l.converter)}</div>
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        {l.tooSmall && !l.skipped ? (
                          <span className="text-[11px] text-rose-300">น้อยเกินบันทึก</span>
                        ) : (
                          <span className="text-slate-200">{formatQty(l.stockQty)} <span className="text-slate-500">{l.stockUnit}</span></span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {tooSmallCount > 0 && (
              <div className="text-[11px] text-rose-300">
                {tooSmallCount} รายการน้อยกว่า 0.001 หน่วยสต๊อก จะไม่ถูกใส่ในสูตร — เพิ่มจำนวนสูตรต่อการผลิตเพื่อให้ติดมาด้วย
              </div>
            )}
          </div>
        )}

        {picked && (
          <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-slate-800">
            <button onClick={() => setPicked(null)} className="px-4 py-2 rounded-lg text-xs text-slate-300 hover:bg-slate-800">
              เลือกเมนูอื่น
            </button>
            <button
              onClick={apply}
              disabled={usable.length === 0}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-purple-500 text-slate-950 hover:bg-purple-400 disabled:opacity-50"
            >
              <Download className="w-3.5 h-3.5" /> ใช้สูตรนี้ ({usable.length} วัตถุดิบ)
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
