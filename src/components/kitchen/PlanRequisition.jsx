import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Loader2, RefreshCw, Send, X, CheckCircle2, AlertTriangle, FileDown, FileSpreadsheet, FileText, ChevronUp } from 'lucide-react';
import { kitchenCall, todayYmd, shiftYmd, formatThaiDate, formatQty } from '../../services/kitchenService';
import { fetchQcrdMenus, fetchQcrdRecipe, round3 } from '../../services/qcrdService';
import { exportRequisitionExcel, printRequisitionPdf } from '../../services/kitchenExport';

const normKey = (v) => String(v ?? '').trim().replace(/\.0+$/, '').replace(/^0+/, '').toLowerCase();

/**
 * จำนวนสูตรของแผนหนึ่งแถว — กติกาเดียวกับหน้าแพลนผลิต/สถานะการผลิต
 * ยอดแผน ÷ ผลผลิตต่อสูตรของ QC/RD (หน่วยต้องตรง) · สูตรที่ไม่มีผลผลิต แผนเก็บเป็นหน่วย "สูตร"
 * คิดไม่ได้ = null (แผนนั้นไม่ถูกนับ และขึ้นเตือน)
 */
function planBatches(plan, menu) {
  const qty = Number(plan.planned_qty);
  const yieldQty = Number(menu?.yieldQty);
  const unit = String(plan.unit || '');
  if (yieldQty > 0 && (!unit || !menu.yieldUnit || unit === menu.yieldUnit)) return qty / yieldQty;
  if (unit === 'สูตร') return qty;
  return null;
}

/**
 * ปัดยอดเบิกตามหน่วยเบิก — กฎเดียวกับปุ่มคำนวณยอดเบิกของสาขา (Narai-branch src/pages/StockList.jsx)
 * เศษเกิน 30% ของหน่วย → ปัดขึ้น ไม่เกิน → ปัดลง เช่น หน่วยเบิก 5: 12 → 15 · 10.5 → 10
 */
function roundLikeBranch(qty, unitSize) {
  const size = Number(unitSize) > 0 ? Number(unitSize) : 1;
  const ratio = qty / size;
  const whole = Math.floor(ratio);
  return round3((ratio - whole > 0.3 + 1e-9 ? whole + 1 : whole) * size);
}

async function requisitionApi(method, query, body) {
  let res;
  try {
    res = await fetch(`/api/kitchen_requisition${query || ''}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error('ต่อเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจสอบการเชื่อมต่อแล้วลองใหม่');
  }
  const json = await res.json().catch(() => null);
  if (!res.ok || json?.status !== 'success') throw new Error(json?.message || `เกิดข้อผิดพลาด (HTTP ${res.status})`);
  return json;
}

/**
 * แท็บ "เบิกตามแพลน" ของหน้าเบิกวัตถุดิบ
 *
 * แพลนผลิตในช่วงวันที่ → สูตร BOM ของ QC/RD × จำนวนสูตร → รวมวัตถุดิบต่อรายการ
 *   ตามสูตร  = ยอดตามสูตรแปลงเป็นหน่วยสต๊อก (ดูอย่างเดียว)
 *   เบิกจริง = ตามสูตรปัดตามหน่วยเบิกเหมือนสาขา แก้ได้
 * แล้วส่งเป็นใบเบิก TRF ของสาขาครัวกลางไปคลังกลาง (ที่เดียวกับปุ่ม "สั่งของ" ของ Narai-branch)
 *
 * ไม่บันทึกเป็น "เบิกออกไปใช้ผลิต" ของครัว — ยอดใช้จริงบันทึกตอนผลิตในฟอร์มผลิตอยู่แล้ว
 */
export default function PlanRequisition() {
  const today = todayYmd();
  const [planFrom, setPlanFrom] = useState(() => shiftYmd(today, 1));
  const [planTo, setPlanTo] = useState(() => shiftYmd(today, 1));
  const [deldate, setDeldate] = useState(today);
  const [plans, setPlans] = useState([]);
  const [recipes, setRecipes] = useState({}); // product_key -> { menu, lines } | { error }
  const [menus, setMenus] = useState(() => new Map());
  const [items, setItems] = useState(() => new Map()); // item_key -> stock_item
  const [balance, setBalance] = useState(() => new Map());
  const [off, setOff] = useState(() => new Set()); // plan_id ที่ติ๊กออก
  const [edited, setEdited] = useState({}); // item_key -> string
  const [sentDocs, setSentDocs] = useState([]); // ใบที่ครัวส่งไปแล้วของวันส่งของนี้ พร้อมรายการที่สั่ง (orderd)
  const [received, setReceived] = useState([]); // ใบเลขเดียวกันที่คลังจ่ายแล้ว (trans) — ยอดรับจริง
  const [receivedError, setReceivedError] = useState('');
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [viewDocNo, setViewDocNo] = useState(null); // ป๊อปอัพเทียบยอดเบิก/ยอดรับของใบเดียว
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);
  const recipeCache = useRef(new Map());

  // ของที่ไม่ขึ้นกับช่วงวันที่ — โหลดครั้งเดียว
  useEffect(() => {
    kitchenCall('getKitchenItems')
      .then((res) => setItems(new Map((res.items || []).map((it) => [normKey(it.item_key), it]))))
      .catch((err) => toast.error(`โหลดทะเบียนวัตถุดิบไม่ได้: ${err.message}`));
    fetchQcrdMenus()
      .then((res) => setMenus(new Map((res.menus || []).map((m) => [m.key, m]))))
      .catch((err) => toast.error(`โหลดเมนู QC/RD ไม่ได้: ${err.message}`));
    kitchenCall('getKitchenBalance', {})
      .then((res) => setBalance(new Map((res.items || []).map((r) => [normKey(r.item_key), Number(r.balance)]))))
      .catch(() => {}); // คอลัมน์เสริม โหลดไม่ได้ก็แสดง "-"
  }, []);

  const loadPlans = useCallback(async () => {
    if (!planFrom || !planTo) return;
    setLoading(true);
    setEdited({});
    setResult(null);
    try {
      const res = await kitchenCall('getDatedPlans', { dateFrom: planFrom, dateTo: planTo });
      // แผนที่ผลิตเสร็จแล้วไม่ต้องเบิกอีก · คำสั่งที่ยกเลิกยังนับ (แผนยังอยู่)
      const list = (res.plans || []).filter((p) => p.order_status !== 'ผลิตเสร็จ');
      setPlans(list);
      setOff(new Set());
      const keys = [...new Set(list.map((p) => p.product_key))];
      await Promise.all(keys.map(async (key) => {
        if (recipeCache.current.has(key)) return;
        const p = list.find((x) => x.product_key === key);
        try {
          recipeCache.current.set(key, await fetchQcrdRecipe(p.product_code || key));
        } catch (err) {
          recipeCache.current.set(key, { error: err.message });
        }
      }));
      setRecipes(Object.fromEntries(keys.map((k) => [k, recipeCache.current.get(k)])));
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [planFrom, planTo]);

  useEffect(() => { loadPlans(); }, [loadPlans]);

  const loadSent = useCallback(() => {
    if (!deldate) return;
    requisitionApi('GET', `?deldate=${deldate}`)
      .then((res) => {
        setSentDocs(res.docs || []);
        setReceived(res.received || []);
        setReceivedError(res.receivedError || '');
      })
      .catch((err) => { setSentDocs([]); setReceived([]); setReceivedError(err.message); });
  }, [deldate]);

  useEffect(() => { loadSent(); }, [loadSent]);

  /** แผนแต่ละแถวพร้อมจำนวนสูตร และเหตุผลถ้านับไม่ได้ */
  const planInfo = useMemo(() => plans.map((p) => {
    const recipe = recipes[p.product_key];
    const menu = recipe?.menu || menus.get(p.product_key);
    const batches = planBatches(p, menu);
    let problem = '';
    if (!recipe) problem = 'กำลังโหลดสูตร';
    else if (recipe.error) problem = `โหลดสูตรไม่ได้: ${recipe.error}`;
    else if (!recipe.lines?.length) problem = 'เมนูนี้ไม่มีสูตร BOM ใน QC/RD';
    else if (batches === null) problem = 'หน่วยของแผนไม่ตรงกับหน่วยของสูตร คิดจำนวนสูตรไม่ได้';
    return { plan: p, recipe, batches, problem };
  }), [plans, recipes, menus]);

  const rows = useMemo(() => {
    const byKey = new Map();
    for (const { plan, recipe, batches, problem } of planInfo) {
      if (problem || off.has(plan.plan_id)) continue;
      for (const line of recipe.lines) {
        if (line.noDeduct) continue; // "ไม่ตัด BOM" ใน QC/RD — กติกาเดียวกับหน้าสั่งผลิต
        const key = line.itemKey || normKey(line.itemCode);
        const stockQty = (Number(line.qty) || 0) * batches / (Number(line.converter) || 1000);
        if (!(stockQty > 0)) continue;
        if (!byKey.has(key)) {
          const it = items.get(key);
          byKey.set(key, {
            key,
            code: it?.item_code || line.itemCode,
            name: it?.item_name || line.itemName,
            unit: it?.unit || line.purchaseUnit || '',
            price: Number(it?.price) || 0,
            requestUnit: Number(it?.request_unit) || 1,
            inRegistry: Boolean(it),
            qty: 0,
            uses: new Map(), // ชื่อเมนู -> จำนวนสูตรรวม
          });
        }
        const r = byKey.get(key);
        r.qty += stockQty;
        const menuName = plan.product_name || recipe.menu?.name || plan.product_code;
        r.uses.set(menuName, (r.uses.get(menuName) || 0) + batches);
      }
    }
    return [...byKey.values()]
      .map((r) => ({ ...r, qty: round3(r.qty), suggested: roundLikeBranch(r.qty, r.requestUnit) }))
      .sort((a, b) => a.name.localeCompare(b.name, 'th'));
  }, [planInfo, off, items]);

  /**
   * เทียบใบเบิกที่ส่งไปแล้ว (ยอดใบ · orderd) กับยอดที่คลังจ่ายจริง (trans · Trn_InvNo = เลขใบ) ต่อวัตถุดิบ
   *   ok       รับตรงยอดใบ
   *   diff     รับไม่ตรงยอดใบ
   *   missing  ใบนั้นคลังจ่ายแล้ว แต่ไม่มีรายการนี้
   *   waiting  ใบที่มีรายการนี้ คลังยังไม่จ่าย
   *   extra    ได้รับมาแต่ไม่มีในใบเบิก (รายการเพิ่มมา)
   */
  const receipt = useMemo(() => {
    const receivedNos = new Set(received.map((d) => Number(d.invNo)));
    const ordered = new Map(); // key -> { code, name, unit, qtyDone, qtyWaiting }
    for (const d of sentDocs) {
      const done = receivedNos.has(Number(d.no));
      for (const l of d.lines || []) {
        const key = normKey(l.itemCode);
        if (!ordered.has(key)) ordered.set(key, { code: l.itemCode, name: l.itemName, unit: l.unit, qtyDone: 0, qtyWaiting: 0 });
        const o = ordered.get(key);
        if (done) o.qtyDone += Number(l.qty) || 0; else o.qtyWaiting += Number(l.qty) || 0;
      }
    }
    const got = new Map(); // key -> { code, name, unit, qty }
    for (const d of received) {
      for (const it of d.items || []) {
        const key = normKey(it.itemCode);
        if (!got.has(key)) got.set(key, { code: it.itemCode, name: it.itemName, unit: it.unit, qty: 0 });
        got.get(key).qty += Number(it.qty) || 0;
      }
    }
    const statusOf = (key) => {
      const o = ordered.get(key);
      const g = got.get(key);
      if (g && !o) return { status: 'extra', got: round3(g.qty), unit: g.unit };
      if (!o) return null;
      if (g) {
        // ยอดรับมาได้จากใบที่คลังจ่ายแล้วเท่านั้น — เทียบกับยอดในใบเหล่านั้น ไม่รวมใบที่ยังรอรับ
        const want = round3(o.qtyDone > 0 ? o.qtyDone : o.qtyWaiting);
        return { status: round3(g.qty) === want ? 'ok' : 'diff', got: round3(g.qty), ordered: want, unit: g.unit || o.unit };
      }
      return o.qtyDone > 0
        ? { status: 'missing', got: 0, ordered: round3(o.qtyDone), unit: o.unit }
        : { status: 'waiting', ordered: round3(o.qtyWaiting), unit: o.unit };
    };
    const docs = sentDocs.map((d) => ({ no: d.no, count: d.count, done: receivedNos.has(Number(d.no)) }));
    return { ordered, got, statusOf, docs };
  }, [sentDocs, received]);

  // วัตถุดิบที่อยู่ในใบเบิก/ใบรับแต่ไม่อยู่ในตารางแพลนที่เลือก — ต่อท้ายตารางให้เห็นครบ
  const extraRows = useMemo(() => {
    const inTable = new Set(rows.map((r) => r.key));
    const out = [];
    for (const key of new Set([...receipt.ordered.keys(), ...receipt.got.keys()])) {
      if (inTable.has(key)) continue;
      const src = receipt.ordered.get(key) || receipt.got.get(key);
      out.push({ key, code: src.code, name: items.get(key)?.item_name || src.name, unit: items.get(key)?.unit || src.unit });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name, 'th'));
  }, [rows, receipt, items]);

  const receiptCounts = useMemo(() => {
    const c = { ok: 0, diff: 0, missing: 0, waiting: 0, extra: 0 };
    for (const key of new Set([...receipt.ordered.keys(), ...receipt.got.keys()])) {
      const st = receipt.statusOf(key);
      if (st) c[st.status] += 1;
    }
    return c;
  }, [receipt]);

  const actualOf = (r) => (edited[r.key] !== undefined ? Number(edited[r.key]) : r.suggested);
  const sendRows = rows.filter((r) => actualOf(r) > 0);
  const badEdit = rows.some((r) => edited[r.key] !== undefined && !(Number(edited[r.key]) >= 0));
  const countedPlans = planInfo.filter((x) => !x.problem && !off.has(x.plan.plan_id));

  const togglePlan = (id) => setOff((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  // ไฟล์ Excel สำหรับพิมพ์ — ช่องเบิกจริงเว้นว่างให้เขียนด้วยมือ (ดู services/kitchenExport.js)
  // เลขที่ใบใส่ให้เฉพาะใบที่เพิ่งส่งจากหน้านี้ของวันส่งของเดียวกัน ใบเก่าในวันเดียวกันอาจเป็นคนละชุดรายการ
  const [exporting, setExporting] = useState(false);
  const [exportMenu, setExportMenu] = useState(false);
  const exportParams = () => ({
    docNo: result && result.deldate === deldate ? result.orderNo : '',
    deldate,
    planFrom,
    planTo,
    rows: rows.map((r) => ({ code: r.code, name: r.name, unit: r.unit, qty: r.qty, uses: [...r.uses] })),
    plans: countedPlans.map(({ plan, batches }) => ({
      date: plan.plan_date,
      name: plan.product_name,
      batches: round3(batches),
      qty: plan.planned_qty,
      unit: plan.unit,
      order: plan.order_doc_no ? `${plan.order_doc_no} · ${plan.order_status}` : '',
    })),
  });
  const exportAs = async (kind) => {
    setExportMenu(false);
    setExporting(true);
    try {
      if (kind === 'pdf') printRequisitionPdf(exportParams());
      else await exportRequisitionExcel(exportParams());
    } catch (err) {
      toast.error(`สร้างไฟล์ ${kind === 'pdf' ? 'PDF' : 'Excel'} ไม่ได้: ${err.message}`);
    } finally {
      setExporting(false);
    }
  };

  const send = async () => {
    setSending(true);
    try {
      const res = await requisitionApi('POST', '', {
        deldate,
        items: sendRows.map((r) => ({
          itemCode: r.code, itemName: r.name, qty: actualOf(r), unit: r.unit, price: r.price,
        })),
      });
      toast.success(res.message || `ส่งใบเบิกเลขที่ ${res.orderNo} แล้ว`);
      setResult({ orderNo: res.orderNo, count: res.count, deldate: res.deldate || deldate });
      setConfirming(false);
      loadSent();
    } catch (err) {
      toast.error(err.message, { duration: 8000 });
    } finally {
      setSending(false);
    }
  };

  const INPUT = 'bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-slate-100 focus:outline-none focus:border-amber-500/60';

  return (
    <div className="space-y-4 pb-24">
      <div className="flex flex-wrap items-end gap-3 bg-slate-900/60 border border-slate-800 rounded-xl p-4">
        <div>
          <label className="block text-[11px] text-slate-500 mb-1">แพลนผลิตตั้งแต่วันที่</label>
          <input type="date" value={planFrom} onChange={(e) => setPlanFrom(e.target.value)} className={INPUT} />
        </div>
        <div>
          <label className="block text-[11px] text-slate-500 mb-1">ถึงวันที่</label>
          <input type="date" value={planTo} min={planFrom} onChange={(e) => setPlanTo(e.target.value)} className={INPUT} />
        </div>
        <div>
          <label className="block text-[11px] text-slate-500 mb-1">วันที่ต้องการของ (วันส่งของ)</label>
          <input type="date" value={deldate} onChange={(e) => setDeldate(e.target.value)} className={INPUT} />
        </div>
        <button onClick={loadPlans}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> คำนวณใหม่
        </button>
        <span className="text-[11px] text-slate-500">นับแพลนตามวันที่ของแพลน · วันส่งของคือวันที่ใส่ในใบเบิกให้สโตร์</span>
      </div>

      {result && (
        <div className="flex items-center gap-2 text-sm text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 rounded-xl px-4 py-3">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          ส่งใบเบิกเลขที่ <strong className="font-mono">{result.orderNo}</strong> แล้ว · {result.count} รายการ · ส่งของ {formatThaiDate(result.deldate)} ·
          สโตร์จะเห็นในหน้าจัดของเหมือนใบเบิกของสาขา
        </div>
      )}

      {sentDocs.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs bg-slate-900/60 border border-slate-800 rounded-xl px-4 py-2.5">
          <span className="text-slate-400">ใบเบิกของวันส่งของนี้:</span>
          {receipt.docs.map((d) => (
            <button key={d.no} onClick={() => setViewDocNo(d.no)} title="กดเพื่อดูยอดเบิกกับยอดรับของใบนี้"
              className={`px-2 py-0.5 rounded border font-mono hover:brightness-125 underline-offset-2 hover:underline ${d.done
                ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' : 'bg-slate-700/40 text-slate-300 border-slate-600/40'}`}>
              #{d.no} · {d.done ? 'คลังจ่ายแล้ว' : 'รอรับ'}
            </button>
          ))}
          {receiptCounts.ok > 0 && <span className="text-emerald-300">ตรงใบ {receiptCounts.ok}</span>}
          {receiptCounts.diff > 0 && <span className="text-amber-300">ไม่ตรงใบ {receiptCounts.diff}</span>}
          {receiptCounts.missing > 0 && <span className="text-rose-300">ไม่ได้รับ {receiptCounts.missing}</span>}
          {receiptCounts.extra > 0 && <span className="text-amber-200">รายการเพิ่มมา {receiptCounts.extra}</span>}
          {receiptCounts.waiting > 0 && <span className="text-slate-400">รอรับ {receiptCounts.waiting}</span>}
          {receivedError && <span className="text-rose-300">ดึงยอดรับจริงไม่ได้: {receivedError}</span>}
          <button onClick={loadSent} className="ml-auto flex items-center gap-1 text-slate-400 hover:text-slate-200">
            <RefreshCw className="w-3 h-3" /> โหลดยอดรับใหม่
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20 text-slate-500 gap-2">
          <Loader2 className="w-5 h-5 animate-spin text-amber-400" /> กำลังคำนวณจากแพลน...
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[300px_minmax(0,1fr)] gap-4 items-start">
          {/* แพลนในช่วงวันที่ */}
          <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 space-y-2">
            <p className="text-sm text-slate-200">
              แพลนในช่วงวันที่ <span className="text-[11px] text-slate-500">· นับ {countedPlans.length}/{plans.length} แพลน</span>
            </p>
            <p className="text-[11px] text-slate-500">ติ๊กออกเพื่อไม่นับแพลนนั้น · แพลนที่ผลิตเสร็จแล้วไม่ขึ้นที่นี่</p>
            {planInfo.length === 0 && <p className="py-6 text-center text-xs text-slate-500">ไม่มีแพลนผลิตในช่วงวันที่นี้</p>}
            {planInfo.map(({ plan, batches, problem }) => {
              const on = !off.has(plan.plan_id) && !problem;
              return (
                <label key={plan.plan_id}
                  className={`grid grid-cols-[auto_minmax(0,1fr)_auto] gap-2.5 items-start p-2.5 rounded-lg border bg-slate-950/40 cursor-pointer ${
                    problem ? 'border-amber-500/30' : 'border-slate-800'} ${on ? '' : 'opacity-50'}`}>
                  <input type="checkbox" className="mt-0.5 accent-cyan-400" checked={on} disabled={Boolean(problem)}
                    onChange={() => togglePlan(plan.plan_id)} />
                  <div className="min-w-0">
                    <div className="text-xs text-slate-200 break-words">{plan.product_name}</div>
                    <div className="text-[10px] text-slate-500">
                      {formatThaiDate(plan.plan_date)}
                      {plan.order_status && ` · ${plan.order_status}`}
                    </div>
                    {problem && <div className="text-[10px] text-amber-300 mt-0.5">{problem}</div>}
                  </div>
                  <div className="text-right text-xs font-mono text-slate-200">
                    {batches !== null ? `${formatQty(round3(batches))} สูตร` : '-'}
                    <div className="text-[10px] text-slate-500 font-sans">{formatQty(plan.planned_qty)} {plan.unit || ''}</div>
                  </div>
                </label>
              );
            })}
          </div>

          {/* วัตถุดิบ */}
          <div className="bg-slate-900/60 border border-slate-800 rounded-xl overflow-x-auto min-w-0">
            <table className="w-full text-sm min-w-[920px]">
              <thead className="bg-slate-900 text-slate-400 text-xs">
                <tr>
                  <th className="text-left px-3 py-2.5 font-medium">วัตถุดิบ · ใช้ผลิตเมนูอะไร กี่สูตร</th>
                  <th className="text-left px-3 py-2.5 font-medium">หน่วย</th>
                  <th className="text-right px-3 py-2.5 font-medium">ตามสูตร</th>
                  <th className="text-right px-3 py-2.5 font-medium">เบิกจริง</th>
                  <th className="text-right px-3 py-2.5 font-medium">รับจริง</th>
                  <th className="text-right px-3 py-2.5 font-medium">ต่างจากสูตร</th>
                  <th className="text-right px-3 py-2.5 font-medium">คงเหลือครัว</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td colSpan={7} className="py-12 text-center text-xs text-slate-500">ไม่มีวัตถุดิบที่ต้องเบิกจากแพลนที่เลือก</td></tr>
                ) : rows.map((r) => {
                  const isEdited = edited[r.key] !== undefined;
                  const actual = actualOf(r);
                  const diff = Number.isFinite(actual) ? round3(actual - r.qty) : 0;
                  const bal = balance.get(r.key);
                  return (
                    <tr key={r.key} className="border-t border-slate-800/70 align-top">
                      <td className="px-3 py-2.5">
                        <div className="text-slate-200">{r.name}</div>
                        <div className="text-[10px] text-slate-500 font-mono">{r.code}</div>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {[...r.uses].map(([menuName, b]) => (
                            <span key={menuName} className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-200 border border-cyan-500/25">
                              {menuName} × {formatQty(round3(b))} สูตร
                            </span>
                          ))}
                          {!r.inRegistry && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/30"
                              title="ไม่มีรหัสนี้ในทะเบียนวัตถุดิบ (stock_item) ใบเบิกอาจส่งไม่ผ่านเพราะหา itemId ไม่เจอ">
                              ไม่พบในทะเบียน
                            </span>
                          )}
                          {r.suggested === 0 && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/30"
                              title={`ปัดตามหน่วยเบิก (${formatQty(r.requestUnit)}) แบบสาขาแล้วเป็น 0 — ใส่ยอดเองถ้าต้องการเบิก`}>
                              ปัดแล้วเป็น 0
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-xs text-slate-400">{r.unit}</td>
                      <td className="px-3 py-2.5 text-right">
                        <span className="inline-block min-w-[80px] font-mono text-slate-400 bg-slate-800/40 border border-slate-800 rounded px-2 py-1"
                          title="ยอดตามสูตร × จำนวนสูตร แปลงเป็นหน่วยสต๊อก (แก้ไม่ได้)">
                          {formatQty(r.qty)}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <input
                          type="number" step="any" min="0" inputMode="decimal"
                          value={isEdited ? edited[r.key] : String(r.suggested)}
                          onChange={(e) => setEdited((prev) => ({ ...prev, [r.key]: e.target.value }))}
                          className={`w-24 text-right font-mono text-sm rounded px-2 py-1 bg-slate-900 text-slate-100 border focus:outline-none ${
                            isEdited ? 'border-cyan-400 bg-cyan-500/5' : 'border-amber-500/50'}`}
                        />
                        {isEdited && (
                          <button onClick={() => setEdited((prev) => { const n = { ...prev }; delete n[r.key]; return n; })}
                            className="block ml-auto mt-0.5 text-[10px] text-slate-500 hover:text-slate-300">คืนค่าตามสูตร</button>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right"><ReceivedCell st={receipt.statusOf(r.key)} hasDocs={sentDocs.length > 0} /></td>
                      <td className={`px-3 py-2.5 text-right font-mono text-xs ${
                        diff > 0 ? 'text-rose-300' : diff < 0 ? 'text-emerald-300' : 'text-slate-500'}`}>
                        {diff > 0 ? '+' : ''}{formatQty(diff)}
                      </td>
                      <td className={`px-3 py-2.5 text-right font-mono text-xs ${
                        bal === undefined ? 'text-slate-600' : bal < r.qty ? 'text-rose-300' : 'text-slate-400'}`}>
                        {bal === undefined ? '-' : formatQty(bal)}
                      </td>
                    </tr>
                  );
                })}
                {extraRows.map((r) => {
                  const st = receipt.statusOf(r.key);
                  const bal = balance.get(r.key);
                  return (
                    <tr key={`extra-${r.key}`} className="border-t border-slate-800/70 align-top bg-amber-500/[0.04]">
                      <td className="px-3 py-2.5">
                        <div className="text-slate-200">{r.name}</div>
                        <div className="text-[10px] text-slate-500 font-mono">{r.code}</div>
                        <div className="mt-1">
                          {st?.status === 'extra' ? (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-200 border border-amber-500/40"
                              title="คลังจ่ายรายการนี้มาในใบเลขเดียวกัน แต่ไม่มีในใบเบิกที่ครัวส่ง">
                              รายการเพิ่มมา · ไม่มีในใบเบิก
                            </span>
                          ) : (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700/40 text-slate-300 border border-slate-600/40"
                              title="อยู่ในใบเบิกที่ส่งไปแล้ว แต่ไม่อยู่ในแพลนที่เลือกตอนนี้ (อาจติ๊กแพลนออก หรือแพลนเปลี่ยนหลังส่ง)">
                              อยู่ในใบเบิก · ไม่อยู่ในแพลนที่เลือก
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-xs text-slate-400">{r.unit}</td>
                      <td className="px-3 py-2.5 text-right text-slate-600">-</td>
                      <td className="px-3 py-2.5 text-right font-mono text-xs text-slate-400" title="ยอดในใบเบิกที่ส่งไปแล้ว">
                        {st?.ordered !== undefined ? formatQty(st.ordered) : '-'}
                      </td>
                      <td className="px-3 py-2.5 text-right"><ReceivedCell st={st} hasDocs /></td>
                      <td className="px-3 py-2.5 text-right text-slate-600">-</td>
                      <td className="px-3 py-2.5 text-right font-mono text-xs text-slate-400">{bal === undefined ? '-' : formatQty(bal)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="px-3 py-2 text-[10px] text-slate-500 border-t border-slate-800">
              ตามสูตร = ยอดในสูตร QC/RD × จำนวนสูตร แปลงเป็นหน่วยสต๊อก · เบิกจริงเริ่มจากตามสูตรปัดตามหน่วยเบิกแบบเดียวกับสาขา (เศษเกิน 30% ปัดขึ้น) แล้วแก้ได้ ·
              ต่างจากสูตร แดง = เบิกเกินสูตร เขียว = น้อยกว่าสูตร ·
              รับจริง = ยอดที่คลังจ่ายตามใบเบิกเลขเดียวกันของวันส่งของนี้ (ข้อมูลชุดเดียวกับหน้าต้นทุนของ Narai-branch) เทียบกับยอดในใบ
            </p>
          </div>
        </div>
      )}

      {/* แถบส่งใบเบิก */}
      <div className="fixed bottom-0 left-0 right-0 z-30 bg-slate-950/95 border-t border-slate-800 backdrop-blur px-4 py-3">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
          <span className="text-xs text-slate-400">
            <strong className="text-slate-100">{sendRows.length}</strong> รายการ · จาก <strong className="text-slate-100">{countedPlans.length}</strong> แพลน ·
            ส่งของ <strong className="text-slate-100">{formatThaiDate(deldate)}</strong>
            {Object.keys(edited).length > 0 && <> · แก้ยอดไว้ <strong className="text-slate-100">{Object.keys(edited).length}</strong> รายการ</>}
            {sentDocs.length > 0 && <span className="text-amber-300"> · วันส่งของนี้ส่งไปแล้ว {sentDocs.length} ใบ</span>}
          </span>
          <div className="flex items-center gap-2">
          <div className="relative">
            <button onClick={() => setExportMenu((v) => !v)} disabled={rows.length === 0 || loading || exporting}
              aria-haspopup="menu" aria-expanded={exportMenu}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm bg-slate-800 text-slate-200 hover:bg-slate-700 border border-slate-700 disabled:opacity-40">
              {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />} พิมพ์รายการเบิก
              <ChevronUp className={`w-3.5 h-3.5 transition-transform ${exportMenu ? '' : 'rotate-180'}`} />
            </button>
            {exportMenu && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setExportMenu(false)} />
                <div role="menu" className="absolute bottom-full mb-2 right-0 z-40 w-60 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl p-1">
                  <button role="menuitem" onClick={() => exportAs('pdf')}
                    className="w-full flex items-start gap-2.5 px-3 py-2 rounded-lg text-left hover:bg-slate-800">
                    <FileText className="w-4 h-4 mt-0.5 text-rose-300 shrink-0" />
                    <span><span className="block text-sm text-slate-100">PDF (A4)</span>
                      <span className="block text-[11px] text-slate-500">เปิดหน้าต่างพิมพ์ เลือก "บันทึกเป็น PDF" หรือสั่งพิมพ์ได้เลย</span></span>
                  </button>
                  <button role="menuitem" onClick={() => exportAs('excel')}
                    className="w-full flex items-start gap-2.5 px-3 py-2 rounded-lg text-left hover:bg-slate-800">
                    <FileSpreadsheet className="w-4 h-4 mt-0.5 text-emerald-300 shrink-0" />
                    <span><span className="block text-sm text-slate-100">ไฟล์ Excel</span>
                      <span className="block text-[11px] text-slate-500">ดาวน์โหลดไฟล์ .xlsx</span></span>
                  </button>
                </div>
              </>
            )}
          </div>
          <button onClick={() => setConfirming(true)} disabled={sendRows.length === 0 || badEdit || loading}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold bg-amber-500 text-slate-950 hover:bg-amber-400 disabled:opacity-40">
            <Send className="w-4 h-4" /> ส่งใบเบิก
          </button>
          </div>
        </div>
      </div>

      {viewDocNo !== null && (
        <DocCompareModal
          doc={sentDocs.find((d) => Number(d.no) === Number(viewDocNo))}
          receivedDoc={received.find((d) => Number(d.invNo) === Number(viewDocNo))}
          items={items}
          deldate={deldate}
          onClose={() => setViewDocNo(null)}
        />
      )}

      {confirming && (
        <div className="fixed inset-0 z-40 bg-black/70 flex items-start justify-center overflow-y-auto p-4" onClick={() => !sending && setConfirming(false)}>
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-lg my-16 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
              <h2 className="font-semibold text-slate-100 text-sm">ส่งใบเบิกวัตถุดิบไปคลังกลาง?</h2>
              <button onClick={() => setConfirming(false)} disabled={sending} className="p-1 text-slate-500 hover:text-slate-300"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-5 space-y-3 text-sm">
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
                <dt className="text-slate-500">จากสาขา</dt><dd className="text-slate-200">ครัวกลาง (FCT · outlet 950)</dd>
                <dt className="text-slate-500">วันส่งของ</dt><dd className="text-slate-200">{formatThaiDate(deldate)}</dd>
                <dt className="text-slate-500">รายการ</dt><dd className="text-slate-200">{sendRows.length} รายการ</dd>
                <dt className="text-slate-500">อ้างอิงแพลน</dt>
                <dd className="text-slate-300 text-xs">
                  {countedPlans.map((x) => `${x.plan.product_name} ×${formatQty(round3(x.batches))}`).join(' · ') || '-'}
                </dd>
              </dl>
              {sentDocs.length > 0 && (
                <div className="flex gap-2 text-xs text-amber-200 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>
                    วันส่งของนี้ครัวกลางส่งใบเบิกไปแล้ว {sentDocs.length} ใบ
                    ({sentDocs.map((d) => `เลขที่ ${d.no} · ${d.count} รายการ`).join(', ')}) · ส่งอีกครั้งจะได้ใบใหม่อีกใบ
                  </span>
                </div>
              )}
              <div className="flex justify-end gap-2 pt-1">
                <button onClick={() => setConfirming(false)} disabled={sending}
                  className="px-3 py-1.5 rounded-lg text-xs text-slate-400 hover:bg-slate-800">ยกเลิก</button>
                <button onClick={send} disabled={sending}
                  className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold bg-amber-500 text-slate-950 hover:bg-amber-400 disabled:opacity-50">
                  {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                  ยืนยันส่ง
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** ช่อง "รับจริง" — ยอดที่คลังจ่ายตามใบเบิกเลขเดียวกัน เทียบกับยอดในใบ */
function ReceivedCell({ st, hasDocs }) {
  if (!hasDocs) return <span className="text-slate-600" title="ยังไม่ได้ส่งใบเบิกของวันส่งของนี้">-</span>;
  if (!st) return <span className="text-slate-600" title="ไม่มีรายการนี้ในใบเบิกที่ส่งไป">-</span>;
  const unit = st.unit ? ` ${st.unit}` : '';
  if (st.status === 'waiting') {
    return <span className="text-[11px] text-slate-500" title={`ยอดในใบ ${formatQty(st.ordered)}${unit} · คลังยังไม่จ่าย`}>รอรับ</span>;
  }
  if (st.status === 'ok') {
    return (
      <span className="font-mono text-sm text-emerald-300" title="รับตรงยอดในใบ">
        {formatQty(st.got)} <CheckCircle2 className="inline w-3.5 h-3.5 -mt-0.5" />
      </span>
    );
  }
  if (st.status === 'extra') {
    return <span className="font-mono text-sm text-amber-200" title="ไม่มีในใบเบิก">{formatQty(st.got)}</span>;
  }
  // diff / missing — ไม่ตรงยอดใบ
  const d = round3(st.got - st.ordered);
  return (
    <span className={`inline-block text-right ${st.status === 'missing' ? 'text-rose-300' : 'text-amber-300'}`}
      title={`ยอดในใบ ${formatQty(st.ordered)}${unit} · รับจริง ${formatQty(st.got)}${unit}`}>
      <span className="font-mono text-sm">{formatQty(st.got)}</span>
      <span className="block text-[10px]">
        {st.status === 'missing' ? 'ไม่ได้รับ' : 'ไม่ตรงใบ'} · ใบ {formatQty(st.ordered)} ({d > 0 ? '+' : ''}{formatQty(d)})
      </span>
    </span>
  );
}

/**
 * ป๊อปอัพเทียบยอดเบิก (ยอดในใบ · orderd) กับยอดรับจริง (trans · Trn_InvNo = เลขใบ) ของใบเดียว
 * ใช้กติกาเดียวกับคอลัมน์รับจริงในตาราง แต่ไม่รวมใบอื่นของวันส่งของเดียวกัน
 */
function DocCompareModal({ doc, receivedDoc, items, deldate, onClose }) {
  const lines = useMemo(() => {
    const byKey = new Map();
    for (const l of doc?.lines || []) {
      const key = normKey(l.itemCode);
      if (!byKey.has(key)) byKey.set(key, { key, code: l.itemCode, name: l.itemName, unit: l.unit, ordered: 0, got: null, unitPrice: 0 });
      byKey.get(key).ordered += Number(l.qty) || 0;
    }
    for (const it of receivedDoc?.items || []) {
      const key = normKey(it.itemCode);
      if (!byKey.has(key)) byKey.set(key, { key, code: it.itemCode, name: it.itemName, unit: it.unit, ordered: null, got: null, unitPrice: 0 });
      const r = byKey.get(key);
      r.got = (r.got || 0) + (Number(it.qty) || 0);
      r.unitPrice = Number(it.unitPrice) || r.unitPrice;
    }
    const done = Boolean(receivedDoc);
    return [...byKey.values()].map((r) => {
      const ordered = r.ordered === null ? null : round3(r.ordered);
      const got = r.got === null ? (done && ordered !== null ? 0 : null) : round3(r.got);
      let status = 'waiting';
      if (ordered === null) status = 'extra';
      else if (done) status = got === ordered ? 'ok' : got === 0 ? 'missing' : 'diff';
      return { ...r, name: items.get(r.key)?.item_name || r.name, ordered, got, status };
    }).sort((a, b) => (a.status === 'extra') - (b.status === 'extra') || a.name.localeCompare(b.name, 'th'));
  }, [doc, receivedDoc, items]);

  const counts = lines.reduce((c, l) => ({ ...c, [l.status]: (c[l.status] || 0) + 1 }), {});
  const totalAmt = lines.reduce((sum, l) => sum + (l.got || 0) * (l.unitPrice || 0), 0);
  const STATUS = {
    ok: ['ตรงใบ', 'text-emerald-300'],
    diff: ['ไม่ตรงใบ', 'text-amber-300'],
    missing: ['ไม่ได้รับ', 'text-rose-300'],
    extra: ['รายการเพิ่มมา', 'text-amber-200'],
    waiting: ['รอรับ', 'text-slate-400'],
  };

  return (
    <div className="fixed inset-0 z-40 bg-black/70 flex items-start justify-center overflow-y-auto p-4" onClick={onClose}>
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-3xl my-10 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-slate-800">
          <div>
            <h2 className="font-semibold text-slate-100 text-sm">ใบเบิกเลขที่ <span className="font-mono">{doc?.no}</span> · ยอดเบิกเทียบยอดรับ</h2>
            <p className="text-[11px] text-slate-500 mt-0.5">
              ส่งของ {formatThaiDate(deldate)} ·{' '}
              {receivedDoc ? `คลังจ่ายเมื่อ ${formatThaiDate(receivedDoc.docDate)}` : 'คลังยังไม่จ่ายใบนี้'}
            </p>
            <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5 text-[11px]">
              {['ok', 'diff', 'missing', 'extra', 'waiting'].filter((k) => counts[k]).map((k) => (
                <span key={k} className={STATUS[k][1]}>{STATUS[k][0]} {counts[k]}</span>
              ))}
            </div>
          </div>
          <button onClick={onClose} className="p-1 text-slate-500 hover:text-slate-300"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-4 overflow-x-auto">
          <table className="w-full text-sm min-w-[620px]">
            <thead className="bg-slate-900 text-slate-400 text-xs">
              <tr>
                <th className="text-left px-3 py-2 font-medium">วัตถุดิบ</th>
                <th className="text-left px-3 py-2 font-medium">หน่วย</th>
                <th className="text-right px-3 py-2 font-medium">ยอดเบิก (ในใบ)</th>
                <th className="text-right px-3 py-2 font-medium">ยอดรับจริง</th>
                <th className="text-right px-3 py-2 font-medium">ต่าง</th>
                <th className="text-left px-3 py-2 font-medium">สถานะ</th>
              </tr>
            </thead>
            <tbody>
              {lines.length === 0 ? (
                <tr><td colSpan={6} className="py-10 text-center text-xs text-slate-500">ไม่มีรายการ</td></tr>
              ) : lines.map((l) => {
                const d = l.got !== null && l.ordered !== null ? round3(l.got - l.ordered) : null;
                return (
                  <tr key={l.key} className={`border-t border-slate-800/70 ${l.status === 'extra' ? 'bg-amber-500/[0.04]' : ''}`}>
                    <td className="px-3 py-2">
                      <div className="text-slate-200">{l.name}</div>
                      <div className="text-[10px] text-slate-500 font-mono">{l.code}</div>
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-400">{l.unit}</td>
                    <td className="px-3 py-2 text-right font-mono text-slate-300">{l.ordered === null ? '-' : formatQty(l.ordered)}</td>
                    <td className={`px-3 py-2 text-right font-mono ${STATUS[l.status][1]}`}>{l.got === null ? '-' : formatQty(l.got)}</td>
                    <td className={`px-3 py-2 text-right font-mono text-xs ${d > 0 ? 'text-amber-300' : d < 0 ? 'text-rose-300' : 'text-slate-500'}`}>
                      {d === null ? '-' : `${d > 0 ? '+' : ''}${formatQty(d)}`}
                    </td>
                    <td className={`px-3 py-2 text-xs ${STATUS[l.status][1]}`}>{STATUS[l.status][0]}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {receivedDoc && (
            <p className="mt-3 text-[11px] text-slate-500 text-right">
              มูลค่าที่รับจริง (ยอดรับ × ราคาในใบจ่าย) {totalAmt.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาท
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
