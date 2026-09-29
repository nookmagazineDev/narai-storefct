import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { AlertTriangle, BarChart3, Loader2, RefreshCw, Trash2, TrendingUp, Eye, X } from 'lucide-react';
import {
  kitchenCall, todayYmd, shiftYmd, formatThaiDate, formatQty, formatBaht,
} from '../../services/kitchenService';
import { fetchQcrdRecipe, fetchQcrdMenus } from '../../services/qcrdService';
import { runUsage, orderTotals, round3, batchesOf } from '../../services/kitchenUsage';
import { RangeQuick } from '../../components/kitchen/DateQuick';

/**
 * ดูรายงานการผลิต
 *
 * สองมุมจากข้อมูลชุดเดียว: ยอดรวมต่อสินค้า (ผลิตไปเท่าไหร่ เสียเท่าไหร่) และรายการดิบทีละครั้ง
 * ยอดรวมคำนวณฝั่ง SQL ไม่ใช่ให้เบราว์เซอร์บวกเอง เพราะช่วงวันที่กว้างๆ แถวเยอะได้
 *
 * ต้นทุนวัตถุดิบ office-server คิดจากใบเบิกของคำสั่งผลิต (ราคา ณ ตอนเบิก รวมของสูญเสีย)
 * แล้วแบ่งให้แต่ละครั้งที่ผลิตตามสัดส่วนจำนวนที่ได้ — ดู getProductionReport ใน office-server/kitchen.js
 * ต้นทุนต่อหน่วยของสินค้า = ต้นทุนรวม ÷ จำนวนที่ผลิตเฉพาะครั้งที่มีต้นทุน (costed_qty)
 *
 * ดูรายละเอียด (ปุ่มตาในรายการผลิต / กดแถวสรุปต่อสินค้า) = ยอดวัตถุดิบตามสูตร QC/RD เทียบใช้จริงจากใบเบิก
 * ของคำสั่งผลิต (ดู services/kitchenUsage.js) · สรุปต่อสินค้าที่ผลิตหลายครั้ง แสดงเป็นค่าเฉลี่ย
 *
 * จำนวนสูตร / ต้นทุนตามสูตร — จากเมนู QC/RD (ผลผลิตต่อสูตร, cost = ต้นทุนสูตร 1 ชุด) กติกาเดียวกับหน้าสถานะการผลิต
 * จำนวนสูตรของครั้งหนึ่ง = จำนวนสูตรของคำสั่ง × สัดส่วนที่ครั้งนี้ผลิตได้ (ผลิตนอกคำสั่ง = ผลิตได้ ÷ ผลผลิตต่อสูตร)
 * แบ่งแบบเดียวกับต้นทุนจริง ต้นทุนตามสูตรกับต้นทุนจริงของครั้งเดียวกันจึงเทียบกันได้
 */
export default function ProductionReport() {
  const [dateFrom, setDateFrom] = useState(() => shiftYmd(todayYmd(), -30));
  const [dateTo, setDateTo] = useState(() => todayYmd());
  const [runs, setRuns] = useState([]);
  const [summary, setSummary] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await kitchenCall('getProductionReport', { dateFrom, dateTo });
      setRuns(res.runs || []);
      setSummary(res.summary || []);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo]);

  useEffect(() => { load(); }, [load]);

  // ยอดวัตถุดิบ — โหลดเมื่อเปิดรายละเอียดครั้งแรก ไม่ถ่วงการเปิดรายงาน
  // ใบเบิกดึงตามวันที่เบิก ซึ่งอาจก่อนวันผลิตได้ จึงย้อนกว้างกว่าช่วงรายงาน แล้วจับด้วยเลขคำสั่ง
  const [detail, setDetail] = useState(null); // { kind: 'run', run } | { kind: 'product', productKey }
  const [issuesByOrder, setIssuesByOrder] = useState(null);
  const [recipes, setRecipes] = useState({});
  const [usageError, setUsageError] = useState('');
  const issuesRange = useRef('');
  const totals = useMemo(() => orderTotals(runs), [runs]);

  // เมนู QC/RD (ผลผลิต/ต้นทุนต่อสูตร) — โหลดครั้งเดียว โหลดไม่ได้ = คอลัมน์ตามสูตรขึ้น "-"
  const [menus, setMenus] = useState(null);
  useEffect(() => {
    fetchQcrdMenus()
      .then((res) => setMenus(new Map((res.menus || []).map((m) => [m.key, m]))))
      .catch(() => setMenus(new Map()));
  }, []);

  /** จำนวนสูตรและต้นทุนตามสูตรของการผลิตครั้งหนึ่ง */
  const recipeOf = useCallback((r) => {
    const menu = menus?.get(r.product_key);
    const produced = Number(r.qty_produced) || 0;
    const share = r.order_id ? produced / (totals.get(String(r.order_id)) || produced || 1) : 1;
    const base = r.order_id ? batchesOf(r.order_qty, r.unit, menu) : batchesOf(produced, r.unit, menu);
    const batches = base === null ? null : base * (r.order_id ? share : 1);
    const cost = Number(menu?.cost);
    const unit = String(r.unit || '');
    const perBatchQty = Number(menu?.yieldQty) > 0 && (!unit || !menu.yieldUnit || unit === menu.yieldUnit) ? Number(menu.yieldQty) : 1;
    const hasCost = cost > 0 && batches !== null;
    return {
      batches,
      recipeCost: hasCost ? batches * cost : null,
      recipePerUnit: hasCost ? cost / perBatchQty : null,
    };
  }, [menus, totals]);

  const recipeByProduct = useMemo(() => {
    const m = new Map();
    for (const r of runs) {
      const x = recipeOf(r);
      if (!m.has(r.product_key)) m.set(r.product_key, { batches: 0, known: 0, recipeCost: 0, costed: 0, recipePerUnit: null });
      const a = m.get(r.product_key);
      if (x.batches !== null) { a.batches += x.batches; a.known += 1; }
      if (x.recipeCost !== null) { a.recipeCost += x.recipeCost; a.costed += 1; a.recipePerUnit = x.recipePerUnit; }
    }
    return m;
  }, [runs, recipeOf]);

  const ensureUsage = async (productRuns) => {
    const range = `${dateFrom}|${dateTo}`;
    const jobs = [];
    if (issuesRange.current !== range) {
      issuesRange.current = range;
      setIssuesByOrder(null);
      setUsageError('');
      jobs.push(kitchenCall('getMaterialIssues', { dateFrom: shiftYmd(dateFrom, -60), dateTo: shiftYmd(dateTo, 1) })
        .then((res) => {
          const m = new Map();
          for (const it of res.issues || []) {
            if (!it.order_id) continue;
            const k = String(it.order_id);
            if (!m.has(k)) m.set(k, []);
            m.get(k).push(it);
          }
          setIssuesByOrder(m);
        })
        .catch((err) => { setIssuesByOrder(new Map()); setUsageError(`โหลดใบเบิกไม่ได้: ${err.message}`); }));
    }
    const need = [...new Map(productRuns.map((r) => [r.product_key, r])).values()].filter((r) => !(r.product_key in recipes));
    if (need.length) {
      jobs.push(Promise.all(need.map((r) => fetchQcrdRecipe(r.product_code || r.product_key)
        .then((res) => [r.product_key, res])
        .catch(() => [r.product_key, null])))
        .then((pairs) => setRecipes((prev) => ({ ...prev, ...Object.fromEntries(pairs) }))));
    }
    await Promise.all(jobs);
  };

  const openRun = (run) => { setDetail({ kind: 'run', run }); ensureUsage([run]); };
  const openProduct = (productKey) => {
    setDetail({ kind: 'product', productKey });
    ensureUsage(runs.filter((r) => r.product_key === productKey));
  };

  const removeRun = async (run) => {
    if (!window.confirm(`ลบบันทึกการผลิต "${run.product_name}" จำนวน ${formatQty(run.qty_produced)} ใช่ไหม?`)) return;
    try {
      const res = await kitchenCall('deleteProductionRun', { runId: run.run_id });
      toast.success(res.message);
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const totalProduced = summary.reduce((sum, s) => sum + Number(s.total_produced || 0), 0);
  const totalWaste = summary.reduce((sum, s) => sum + Number(s.total_waste || 0), 0);
  // office-server รุ่นก่อนมีต้นทุนไม่ส่งคอลัมน์ cost มาเลย — ซ่อนคอลัมน์ต้นทุนแล้วบอกให้อัปเดต
  const hasCost = runs.some((r) => r.cost !== undefined);
  const totalCost = summary.reduce((sum, s) => sum + Number(s.total_cost || 0), 0);
  const totalLossCost = summary.reduce((sum, s) => sum + Number(s.total_loss_cost || 0), 0);
  const totalRecipeCost = [...recipeByProduct.values()].reduce((sum, a) => sum + a.recipeCost, 0);

  return (
    <div className="p-4 md:p-6 space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-teal-400" />
            รายงานการผลิต
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            ผลิตอะไรไปเท่าไหร่ เสียเท่าไหร่ ต้นทุนวัตถุดิบเท่าไหร่ ในช่วงที่เลือก
          </p>
        </div>
        <button
          onClick={load}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700"
        >
          <RefreshCw className="w-3.5 h-3.5" /> รีเฟรช
        </button>
      </header>

      <div className="flex flex-wrap items-end gap-3 bg-slate-900/60 border border-slate-800 rounded-xl p-4">
        <div>
          <label className="block text-[11px] text-slate-500 mb-1">ตั้งแต่วันที่</label>
          <input
            type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
            className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-slate-100 focus:outline-none focus:border-teal-500/60"
          />
        </div>
        <div>
          <label className="block text-[11px] text-slate-500 mb-1">ถึงวันที่</label>
          <input
            type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
            className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-slate-100 focus:outline-none focus:border-teal-500/60"
          />
        </div>
        <RangeQuick from={dateFrom} to={dateTo} onChange={(f, t) => { setDateFrom(f); setDateTo(t); }} presets={['today', 'week', 'month', 'lastMonth']} />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-slate-500 gap-2">
          <Loader2 className="w-5 h-5 animate-spin text-teal-400" /> กำลังโหลดรายงาน...
        </div>
      ) : runs.length === 0 ? (
        <div className="py-20 text-center text-slate-500 text-sm">ไม่มีการผลิตในช่วงวันที่นี้</div>
      ) : (
        <>
          <div className={`grid grid-cols-2 gap-3 ${hasCost ? 'md:grid-cols-5' : 'md:grid-cols-4'}`}>
            <StatCard label="ผลิตทั้งหมด" value={formatQty(totalProduced)} tone="teal" />
            <StatCard label="ของเสียทั้งหมด" value={formatQty(totalWaste)} tone="rose" />
            <StatCard
              label="ต้นทุนตามสูตรรวม"
              value={menus === null ? '…' : formatBaht(totalRecipeCost)}
              sub="ต้นทุนสูตร QC/RD × จำนวนสูตร"
              tone="slate"
            />
            {hasCost && (
              <StatCard
                label="ต้นทุนวัตถุดิบจริงรวม"
                value={formatBaht(totalCost)}
                sub={totalLossCost > 0 ? `จากของสูญเสีย ${formatBaht(totalLossCost)}` : ''}
                tone="amber"
              />
            )}
            <StatCard label="จำนวนครั้งที่ผลิต" value={runs.length} tone="slate" />
          </div>

          {!hasCost && (
            <div className="flex items-start gap-2 rounded-xl border border-amber-500/25 bg-amber-500/5 px-4 py-3 text-xs text-amber-300">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              ยังไม่มีคอลัมน์ต้นทุน — ต้องรัน update-office-server.bat ที่เครื่องออฟฟิศก่อน
            </div>
          )}

          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-slate-300 flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-teal-400" /> สรุปต่อสินค้า
            </h2>
            <div className="bg-slate-900/60 border border-slate-800 rounded-xl overflow-x-auto">
              <table className={`w-full text-sm ${hasCost ? 'min-w-[1080px]' : 'min-w-[820px]'}`}>
                <thead className="bg-slate-900 text-slate-400 text-xs">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium">สินค้า</th>
                    <th className="text-center px-4 py-3 font-medium">ผลิตกี่ครั้ง</th>
                    <th className="text-right px-4 py-3 font-medium">ผลิตได้รวม</th>
                    <th className="text-right px-4 py-3 font-medium">จำนวนสูตร</th>
                    <th className="text-right px-4 py-3 font-medium">ของเสีย</th>
                    <th className="text-right px-4 py-3 font-medium">เสีย %</th>
                    <th className="text-right px-4 py-3 font-medium">ต้นทุนตามสูตร<div className="font-normal text-slate-500">รวม / ต่อหน่วย</div></th>
                    {hasCost && <th className="text-right px-4 py-3 font-medium">ต้นทุนจริง</th>}
                    {hasCost && <th className="text-right px-4 py-3 font-medium">ต้นทุนจริงเฉลี่ย/หน่วย</th>}
                  </tr>
                </thead>
                <tbody>
                  {summary.map((s) => {
                    const produced = Number(s.total_produced) || 0;
                    const waste = Number(s.total_waste) || 0;
                    // คิดเป็นสัดส่วนของที่ทำออกมาทั้งหมด (ดีที่ขาย + ที่ทิ้ง) ไม่ใช่ของที่ดีอย่างเดียว
                    // ไม่งั้นทำ 10 ทิ้ง 10 จะได้ 100% ทั้งที่ของจริงคือเสียครึ่งหนึ่ง
                    const pct = produced + waste > 0 ? (waste / (produced + waste)) * 100 : 0;
                    const rec = recipeByProduct.get(s.product_key);
                    return (
                      <tr key={s.product_key} onClick={() => openProduct(s.product_key)}
                        title="กดเพื่อดูยอดวัตถุดิบเฉลี่ย ตามสูตรเทียบใช้จริง"
                        className="border-t border-slate-800/70 hover:bg-slate-800/30 cursor-pointer">
                        <td className="px-4 py-3">
                          <div className="text-slate-200 flex items-center gap-1.5">
                            {s.product_name}
                            <Eye className="w-3.5 h-3.5 text-slate-600" />
                          </div>
                          <div className="text-[11px] text-slate-500">{s.product_code}</div>
                        </td>
                        <td className="px-4 py-3 text-center text-slate-400">{s.run_count}</td>
                        <td className="px-4 py-3 text-right text-teal-300">
                          {formatQty(produced)} <span className="text-slate-500 text-xs">{s.unit || ''}</span>
                        </td>
                        <td className="px-4 py-3 text-right text-slate-300 font-mono">
                          {rec?.known ? formatQty(round3(rec.batches)) : <span className="text-slate-600">-</span>}
                          {rec && rec.known > 0 && rec.known < Number(s.run_count) && (
                            <div className="text-[10px] text-slate-500 font-sans" title="บางครั้งคิดจำนวนสูตรไม่ได้ (หน่วยไม่ตรงสูตร / ไม่มีผลผลิตต่อสูตร)">
                              คิดได้ {rec.known}/{s.run_count} ครั้ง
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right text-rose-300/80">
                          {waste ? formatQty(waste) : '-'}
                        </td>
                        <td className={`px-4 py-3 text-right ${pct >= 10 ? 'text-rose-400' : 'text-slate-400'}`}>
                          {pct ? `${pct.toFixed(1)}%` : '-'}
                        </td>
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          {rec?.costed ? (
                            <>
                              <div className="text-slate-300">{formatBaht(rec.recipeCost)}</div>
                              <div className="text-[11px] text-slate-500">{formatBaht(rec.recipePerUnit)}/{s.unit || 'หน่วย'}</div>
                            </>
                          ) : <span className="text-slate-600" title="เมนูนี้ไม่มีต้นทุนหรือผลผลิตต่อสูตรใน QC/RD">-</span>}
                        </td>
                        {hasCost && <SummaryCost s={s} recipePerUnit={rec?.recipePerUnit ?? null} />}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-slate-300">รายการผลิตทีละครั้ง</h2>
            <div className="bg-slate-900/60 border border-slate-800 rounded-xl overflow-x-auto">
              <table className={`w-full text-sm ${hasCost ? 'min-w-[1280px]' : 'min-w-[1000px]'}`}>
                <thead className="bg-slate-900 text-slate-400 text-xs">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium">วันที่</th>
                    <th className="text-left px-4 py-3 font-medium">สินค้า</th>
                    <th className="text-left px-4 py-3 font-medium">คำสั่งผลิต</th>
                    <th className="text-right px-4 py-3 font-medium">ผลิตได้</th>
                    <th className="text-right px-4 py-3 font-medium">จำนวนสูตร</th>
                    <th className="text-right px-4 py-3 font-medium">ของเสีย</th>
                    <th className="text-right px-4 py-3 font-medium">ต้นทุนตามสูตร<div className="font-normal text-slate-500">รวม / ต่อหน่วย</div></th>
                    {hasCost && <th className="text-right px-4 py-3 font-medium">ต้นทุนจริง</th>}
                    {hasCost && <th className="text-right px-4 py-3 font-medium">ต้นทุนจริง/หน่วย</th>}
                    <th className="text-left px-4 py-3 font-medium">ผู้บันทึก</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r) => {
                    const rec = recipeOf(r);
                    return (
                    <tr key={r.run_id} className="border-t border-slate-800/70 hover:bg-slate-800/30">
                      <td className="px-4 py-3 text-slate-400 text-xs">{formatThaiDate(r.produce_date)}</td>
                      <td className="px-4 py-3">
                        <div className="text-slate-200">{r.product_name}</div>
                        <div className="text-[11px] text-slate-500">{r.product_code}</div>
                      </td>
                      <td className="px-4 py-3">
                        {r.order_doc_no ? (
                          <span className="font-mono text-[11px] text-amber-300/90">{r.order_doc_no}</span>
                        ) : (
                          <span className="text-[11px] text-slate-600">ผลิตนอกคำสั่ง</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right text-teal-300">
                        {formatQty(r.qty_produced)} <span className="text-slate-500 text-xs">{r.unit || ''}</span>
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-slate-300">
                        {rec.batches === null ? <span className="text-slate-600" title="คิดไม่ได้ — หน่วยไม่ตรงสูตร หรือเมนูไม่มีผลผลิตต่อสูตรใน QC/RD">-</span> : formatQty(round3(rec.batches))}
                      </td>
                      <td className="px-4 py-3 text-right text-rose-300/80">
                        {Number(r.qty_waste) ? formatQty(r.qty_waste) : '-'}
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        {rec.recipeCost === null ? <span className="text-slate-600">-</span> : (
                          <>
                            <div className="text-slate-300">{formatBaht(rec.recipeCost)}</div>
                            <div className="text-[11px] text-slate-500">{formatBaht(rec.recipePerUnit)}/{r.unit || 'หน่วย'}</div>
                          </>
                        )}
                      </td>
                      {hasCost && <RunCost r={r} recipePerUnit={rec.recipePerUnit} />}
                      <td className="px-4 py-3 text-xs text-slate-500">{r.recorder || '-'}</td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <button
                          onClick={() => openRun(r)}
                          className="p-1.5 text-slate-500 hover:text-teal-300"
                          title="ดูยอดวัตถุดิบ ตามสูตรเทียบใช้จริง"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                        <button data-write
                          onClick={() => removeRun(r)}
                          className="p-1.5 text-slate-600 hover:text-rose-300"
                          title="ลบบันทึกนี้ (ยอดของคำสั่งผลิตจะถูกคิดใหม่)"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {detail && (
        <UsageModal
          detail={detail}
          runs={runs}
          totals={totals}
          issuesByOrder={issuesByOrder}
          recipes={recipes}
          error={usageError}
          onClose={() => setDetail(null)}
        />
      )}
    </div>
  );
}

/**
 * ยอดวัตถุดิบ ตามสูตรเทียบใช้จริง
 *   ครั้งเดียว — ยอดของการผลิตครั้งนั้น (ส่วนแบ่งของคำสั่งตามจำนวนที่ได้)
 *   ต่อสินค้า — ทุกครั้งในช่วงรายงาน แสดงเป็นค่าเฉลี่ยต่อครั้ง หรือต่อ 1 สูตร
 *              ถ้ามีครั้งที่มีใบเบิก ทุกคอลัมน์เฉลี่ยจากครั้งเหล่านั้นชุดเดียวกัน (ครั้งที่ไม่มีใบเบิกไม่รู้ยอดใช้
 *              ไม่ใช่ใช้ 0 — ถ้าเอาไปรวมเฉพาะฝั่งสูตร ผลต่างจะเทียบคนละชุดกัน) · ไม่มีใบเบิกเลย = เฉลี่ยสูตรจากทุกครั้ง
 */
function UsageModal({ detail, runs, totals, issuesByOrder, recipes, error, onClose }) {
  const [per, setPer] = useState('run'); // 'run' | 'batch'
  const isRun = detail.kind === 'run';
  const targetRuns = useMemo(
    () => (isRun ? [detail.run] : runs.filter((r) => r.product_key === detail.productKey)),
    [isRun, detail, runs]
  );
  const first = targetRuns[0] || {};
  const loading = issuesByOrder === null || !(first.product_key in recipes);

  const data = useMemo(() => {
    if (loading) return null;
    const recipe = recipes[first.product_key];
    const perRun = targetRuns.map((r) => runUsage(r, {
      recipe, issues: r.order_id ? issuesByOrder.get(String(r.order_id)) || [] : [], totals,
    }));
    const agg = new Map();
    let batchesAll = 0; let batchesIssued = 0;
    const nIssued = perRun.filter((u) => u.hasIssues).length;
    // ชุดที่ใช้เฉลี่ย: ครั้งที่มีใบเบิก (ถ้ามี) ไม่งั้นทุกครั้ง — ตามสูตรกับใช้จริงต้องมาจากชุดเดียวกัน
    const pool = nIssued > 0 ? perRun.filter((u) => u.hasIssues) : perRun;
    perRun.forEach((u) => { if (u.batches !== null) batchesAll += u.batches; });
    pool.forEach((u) => {
      if (u.batches !== null) batchesIssued += u.batches;
      for (const l of u.lines.values()) {
        if (!agg.has(l.key)) agg.set(l.key, { ...l, recipe: 0, actual: 0, loss: 0, cost: 0 });
        const a = agg.get(l.key);
        a.recipe += l.recipe; a.actual += l.actual; a.loss += l.loss; a.cost += l.cost;
        if (l.actual > 0) { a.unit = l.unit; a.name = l.name; }
      }
    });
    const n = perRun.length;
    const nPool = pool.length;
    return { recipe, perRun, rows: [...agg.values()].sort((a, b) => a.name.localeCompare(b.name, 'th')), n, nIssued, nPool, batchesAll, batchesIssued };
  }, [loading, recipes, issuesByOrder, totals, first.product_key, targetRuns]);

  // ตัวหารของค่าเฉลี่ย — ครั้งเดียวไม่หาร
  const div = () => {
    if (isRun || !data) return 1;
    return per === 'batch' ? data.batchesIssued : data.nPool;
  };
  const avg = (v) => { const d = div(); return d > 0 ? round3(v / d) : null; };
  const label = isRun ? '' : per === 'batch' ? ' / 1 สูตร' : ' เฉลี่ย/ครั้ง';

  return (
    <div className="fixed inset-0 z-40 bg-black/70 flex items-start justify-center overflow-y-auto p-4" onClick={onClose}>
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-4xl my-10 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-slate-800">
          <div className="min-w-0">
            <h2 className="font-semibold text-slate-100 text-sm">{first.product_name} · ยอดวัตถุดิบ ตามสูตรเทียบใช้จริง</h2>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {isRun ? (
                <>ผลิต {formatThaiDate(first.produce_date)} · ได้ {formatQty(first.qty_produced)} {first.unit || ''}
                  {first.order_doc_no ? ` · คำสั่ง ${first.order_doc_no}` : ' · ผลิตนอกคำสั่ง (ไม่มีใบเบิก)'}
                  {data?.perRun[0]?.batches !== null && data?.perRun[0]?.batches !== undefined && ` · ${formatQty(round3(data.perRun[0].batches))} สูตร`}
                  {data && data.perRun[0]?.share < 1 && ` · ส่วนแบ่ง ${Math.round(data.perRun[0].share * 100)}% ของคำสั่ง (ผลิตหลายครั้ง)`}</>
              ) : data ? (
                <>ผลิต {data.n} ครั้งในช่วงรายงาน · รวม {formatQty(round3(data.batchesAll))} สูตร · มีใบเบิก {data.nIssued} ครั้ง ·{' '}
                  {data.nIssued > 0
                    ? `เฉลี่ยจาก ${data.nIssued} ครั้งที่มีใบเบิก (${formatQty(round3(data.batchesIssued))} สูตร)`
                    : 'ไม่มีใบเบิก — เฉลี่ยเฉพาะยอดตามสูตร'}</>
              ) : 'กำลังโหลด...'}
            </p>
          </div>
          <button onClick={onClose} className="p-1 text-slate-500 hover:text-slate-300"><X className="w-4 h-4" /></button>
        </div>

        <div className="p-4 space-y-3">
          {!isRun && (
            <div className="flex gap-1 p-1 bg-slate-950/60 border border-slate-800 rounded-lg w-fit text-xs">
              {[['run', 'เฉลี่ยต่อครั้งที่ผลิต'], ['batch', 'เฉลี่ยต่อ 1 สูตร']].map(([k, t]) => (
                <button key={k} onClick={() => setPer(k)}
                  className={`px-3 py-1.5 rounded-md ${per === k ? 'bg-teal-500/15 text-teal-300 border border-teal-500/30' : 'text-slate-400 hover:text-slate-200'}`}>
                  {t}
                </button>
              ))}
            </div>
          )}
          {error && <p className="text-xs text-rose-300">{error}</p>}
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-500"><Loader2 className="w-4 h-4 animate-spin text-teal-400" /> กำลังโหลดใบเบิกและสูตร...</div>
          ) : (
            <>
              {!data.recipe && <p className="text-xs text-amber-300">ไม่พบสูตร BOM ของเมนูนี้ใน QC/RD — แสดงเฉพาะยอดใช้จริง</p>}
              {data.nIssued === 0 && <p className="text-xs text-amber-300">ไม่มีใบเบิกวัตถุดิบของการผลิตนี้ — แสดงเฉพาะยอดตามสูตร</p>}
              <div className="overflow-x-auto border border-slate-800 rounded-lg">
                <table className="w-full text-sm min-w-[760px]">
                  <thead className="bg-slate-950/60 text-slate-400 text-xs">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium">วัตถุดิบ</th>
                      <th className="text-left px-3 py-2 font-medium">หน่วย</th>
                      <th className="text-right px-3 py-2 font-medium">ตามสูตร{label}</th>
                      <th className="text-right px-3 py-2 font-medium">ใช้จริง{label}</th>
                      <th className="text-right px-3 py-2 font-medium">สูญเสีย{label}</th>
                      <th className="text-right px-3 py-2 font-medium">ใช้จริง − สูตร</th>
                      <th className="text-right px-3 py-2 font-medium">ต้นทุนใช้จริง{label}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.length === 0 ? (
                      <tr><td colSpan={7} className="py-10 text-center text-xs text-slate-500">ไม่มีข้อมูลวัตถุดิบ</td></tr>
                    ) : data.rows.map((r) => {
                      const rec = r.recipe > 0 ? avg(r.recipe) : null;
                      const act = data.nIssued > 0 ? avg(r.actual) : null;
                      const loss = data.nIssued > 0 ? avg(r.loss) : null;
                      const cost = data.nIssued > 0 && r.cost > 0 ? r.cost / (div() || 1) : null;
                      const d = rec !== null && act !== null ? round3(act - rec) : null;
                      const notInRecipe = r.recipe === 0 && r.actual > 0;
                      return (
                        <tr key={r.key} className="border-t border-slate-800/70">
                          <td className="px-3 py-2">
                            <div className="text-slate-200">{r.name}</div>
                            <div className="text-[10px] text-slate-500 font-mono">
                              {r.code}
                              {notInRecipe && <span className="ml-1.5 font-sans text-amber-300">· ไม่มีในสูตร</span>}
                            </div>
                          </td>
                          <td className="px-3 py-2 text-xs text-slate-400">{r.unit}</td>
                          <td className="px-3 py-2 text-right font-mono text-slate-400">{rec === null ? '-' : formatQty(rec)}</td>
                          <td className="px-3 py-2 text-right font-mono text-slate-100">{act === null ? '-' : formatQty(act)}</td>
                          <td className="px-3 py-2 text-right font-mono text-rose-300/80">{loss ? formatQty(loss) : '-'}</td>
                          <td className={`px-3 py-2 text-right font-mono text-xs ${d > 0 ? 'text-rose-300' : d < 0 ? 'text-emerald-300' : 'text-slate-500'}`}>
                            {d === null ? '-' : `${d > 0 ? '+' : ''}${formatQty(d)}`}
                          </td>
                          <td className="px-3 py-2 text-right text-xs text-amber-300/90">{cost === null ? '-' : formatBaht(cost)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="text-[10px] text-slate-500">
                ตามสูตร = สูตร BOM ของ QC/RD × จำนวนสูตรของคำสั่งผลิต · ใช้จริง = ใบเบิกวัตถุดิบของคำสั่ง (รวมของสูญเสียแล้ว)
                · คำสั่งที่ผลิตหลายครั้งแบ่งตามสัดส่วนจำนวนที่ได้ · ใช้จริง − สูตร แดง = ใช้เกินสูตร เขียว = ใช้น้อยกว่าสูตร
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** ต้นทุนรวมของสินค้า + ต้นทุนเฉลี่ยต่อหน่วย (สองช่องท้ายตารางสรุป) */
/** สีต้นทุนจริงต่อหน่วยเทียบต้นทุนตามสูตร — แดง = แพงกว่าสูตร เขียว = ไม่เกินสูตร */
const vsRecipe = (actual, recipe) => (recipe === null || recipe === undefined || actual === null
  ? 'text-amber-200' : actual > recipe ? 'text-rose-300' : 'text-emerald-300');

function SummaryCost({ s, recipePerUnit }) {
  const cost = s.total_cost === null || s.total_cost === undefined ? null : Number(s.total_cost);
  const lossCost = Number(s.total_loss_cost) || 0;
  const costedQty = Number(s.costed_qty) || 0;
  const perUnit = cost !== null && costedQty > 0 ? cost / costedQty : null;
  const uncosted = Number(s.uncosted_runs) || 0;
  const partial = Number(s.partial_runs) || 0;
  return (
    <>
      <td className="px-4 py-3 text-right whitespace-nowrap">
        {cost === null ? <span className="text-slate-600">-</span> : <div className="text-amber-300">{formatBaht(cost)}</div>}
        {lossCost > 0 && <div className="text-[11px] text-rose-300/70">สูญเสีย {formatBaht(lossCost)}</div>}
        {uncosted > 0 && (
          <div className="text-[11px] text-slate-500" title="คำสั่งผลิตไม่มีใบเบิก หรือผลิตนอกคำสั่ง — ไม่นับในต้นทุนเฉลี่ย">
            ไม่มีต้นทุน {uncosted} ครั้ง
          </div>
        )}
        {partial > 0 && (
          <div className="text-[11px] text-amber-400/80" title="บางบรรทัดในใบเบิกไม่มีราคา — ต้นทุนต่ำกว่าจริง">
            ราคาไม่ครบ {partial} ครั้ง
          </div>
        )}
      </td>
      <td className="px-4 py-3 text-right whitespace-nowrap">
        {perUnit === null ? <span className="text-slate-600">-</span> : (
          <>
            <span className={`font-semibold ${vsRecipe(perUnit, recipePerUnit)}`}
              title={recipePerUnit !== null ? 'แดง = แพงกว่าตามสูตร · เขียว = ไม่เกินตามสูตร' : undefined}>{formatBaht(perUnit)}</span>
            <span className="text-slate-500 text-xs">/{s.unit || 'หน่วย'}</span>
          </>
        )}
      </td>
    </>
  );
}

/** ต้นทุนของการผลิตครั้งเดียว — ส่วนแบ่งจากใบเบิกของคำสั่งผลิตตามจำนวนที่ได้ */
function RunCost({ r, recipePerUnit }) {
  const cost = r.cost === null || r.cost === undefined ? null : Number(r.cost);
  const qty = Number(r.qty_produced) || 0;
  const noPrice = Number(r.no_price_count) || 0;
  // ผลิตนอกคำสั่ง = ไม่มีทางรู้ต้นทุน · มีคำสั่งแต่ไม่มีใบเบิก หรือใบเบิกไม่มีราคาเลยสักบรรทัด
  const why = !r.order_id ? '-' : Number(r.issue_lines) ? 'ไม่มีราคา' : 'ไม่มีใบเบิก';
  return (
    <>
      <td className="px-4 py-3 text-right whitespace-nowrap">
        {cost === null ? (
          <span className={`text-[11px] ${why === 'ไม่มีราคา' ? 'text-amber-400/80' : 'text-slate-600'}`}>{why}</span>
        ) : (
          <>
            <div className="text-amber-300">{formatBaht(cost)}</div>
            {Number(r.loss_cost) > 0 && <div className="text-[11px] text-rose-300/70">สูญเสีย {formatBaht(r.loss_cost)}</div>}
            {noPrice > 0 && (
              <div className="text-[11px] text-amber-400/80" title="บรรทัดในใบเบิกที่ไม่มีราคา ไม่ได้รวมในต้นทุน">
                ไม่มีราคา {noPrice} รายการ
              </div>
            )}
          </>
        )}
      </td>
      <td className="px-4 py-3 text-right whitespace-nowrap">
        {cost === null || qty <= 0 ? <span className="text-slate-600">-</span> : (
          <>
            <span className={vsRecipe(cost / qty, recipePerUnit)}
              title={recipePerUnit !== null ? 'แดง = แพงกว่าตามสูตร · เขียว = ไม่เกินตามสูตร' : undefined}>{formatBaht(cost / qty)}</span>
            <span className="text-slate-500 text-xs">/{r.unit || 'หน่วย'}</span>
          </>
        )}
      </td>
    </>
  );
}

function StatCard({ label, value, sub, tone }) {
  const toneClass = {
    teal: 'text-teal-300 border-teal-500/25 bg-teal-500/5',
    rose: 'text-rose-300 border-rose-500/25 bg-rose-500/5',
    amber: 'text-amber-300 border-amber-500/25 bg-amber-500/5',
    slate: 'text-slate-300 border-slate-700 bg-slate-800/30',
  }[tone] || 'text-slate-300 border-slate-700 bg-slate-800/30';

  return (
    <div className={`rounded-xl border px-4 py-3 ${toneClass}`}>
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className="text-xl font-bold mt-0.5">{value}</div>
      {sub && <div className="text-[11px] text-slate-500 mt-0.5">{sub}</div>}
    </div>
  );
}
