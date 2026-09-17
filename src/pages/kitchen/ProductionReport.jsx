import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { BarChart3, Loader2, RefreshCw, Trash2, TrendingUp } from 'lucide-react';
import {
  kitchenCall, todayYmd, shiftYmd, formatThaiDate, formatQty,
} from '../../services/kitchenService';

/**
 * ดูรายงานการผลิต
 *
 * สองมุมจากข้อมูลชุดเดียว: ยอดรวมต่อสินค้า (ผลิตไปเท่าไหร่ เสียเท่าไหร่) และรายการดิบทีละครั้ง
 * ยอดรวมคำนวณฝั่ง SQL ไม่ใช่ให้เบราว์เซอร์บวกเอง เพราะช่วงวันที่กว้างๆ แถวเยอะได้
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

  return (
    <div className="p-4 md:p-6 space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-teal-400" />
            รายงานการผลิต
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            ผลิตอะไรไปเท่าไหร่ เสียเท่าไหร่ ในช่วงที่เลือก
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
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-slate-500 gap-2">
          <Loader2 className="w-5 h-5 animate-spin text-teal-400" /> กำลังโหลดรายงาน...
        </div>
      ) : runs.length === 0 ? (
        <div className="py-20 text-center text-slate-500 text-sm">ไม่มีการผลิตในช่วงวันที่นี้</div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <StatCard label="ผลิตทั้งหมด" value={formatQty(totalProduced)} tone="teal" />
            <StatCard label="ของเสียทั้งหมด" value={formatQty(totalWaste)} tone="rose" />
            <StatCard label="จำนวนครั้งที่ผลิต" value={runs.length} tone="slate" />
          </div>

          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-slate-300 flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-teal-400" /> สรุปต่อสินค้า
            </h2>
            <div className="bg-slate-900/60 border border-slate-800 rounded-xl overflow-x-auto">
              <table className="w-full text-sm min-w-[600px]">
                <thead className="bg-slate-900 text-slate-400 text-xs">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium">สินค้า</th>
                    <th className="text-center px-4 py-3 font-medium">ผลิตกี่ครั้ง</th>
                    <th className="text-right px-4 py-3 font-medium">ผลิตได้รวม</th>
                    <th className="text-right px-4 py-3 font-medium">ของเสีย</th>
                    <th className="text-right px-4 py-3 font-medium">เสีย %</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.map((s) => {
                    const produced = Number(s.total_produced) || 0;
                    const waste = Number(s.total_waste) || 0;
                    // คิดเป็นสัดส่วนของที่ทำออกมาทั้งหมด (ดีที่ขาย + ที่ทิ้ง) ไม่ใช่ของที่ดีอย่างเดียว
                    // ไม่งั้นทำ 10 ทิ้ง 10 จะได้ 100% ทั้งที่ของจริงคือเสียครึ่งหนึ่ง
                    const pct = produced + waste > 0 ? (waste / (produced + waste)) * 100 : 0;
                    return (
                      <tr key={s.product_key} className="border-t border-slate-800/70 hover:bg-slate-800/30">
                        <td className="px-4 py-3">
                          <div className="text-slate-200">{s.product_name}</div>
                          <div className="text-[11px] text-slate-500">{s.product_code}</div>
                        </td>
                        <td className="px-4 py-3 text-center text-slate-400">{s.run_count}</td>
                        <td className="px-4 py-3 text-right text-teal-300">
                          {formatQty(produced)} <span className="text-slate-500 text-xs">{s.unit || ''}</span>
                        </td>
                        <td className="px-4 py-3 text-right text-rose-300/80">
                          {waste ? formatQty(waste) : '-'}
                        </td>
                        <td className={`px-4 py-3 text-right ${pct >= 10 ? 'text-rose-400' : 'text-slate-400'}`}>
                          {pct ? `${pct.toFixed(1)}%` : '-'}
                        </td>
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
              <table className="w-full text-sm min-w-[820px]">
                <thead className="bg-slate-900 text-slate-400 text-xs">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium">วันที่</th>
                    <th className="text-left px-4 py-3 font-medium">สินค้า</th>
                    <th className="text-left px-4 py-3 font-medium">คำสั่งผลิต</th>
                    <th className="text-right px-4 py-3 font-medium">ผลิตได้</th>
                    <th className="text-right px-4 py-3 font-medium">ของเสีย</th>
                    <th className="text-left px-4 py-3 font-medium">ผู้บันทึก</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r) => (
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
                      <td className="px-4 py-3 text-right text-rose-300/80">
                        {Number(r.qty_waste) ? formatQty(r.qty_waste) : '-'}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500">{r.recorder || '-'}</td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => removeRun(r)}
                          className="p-1.5 text-slate-600 hover:text-rose-300"
                          title="ลบบันทึกนี้ (ยอดของคำสั่งผลิตจะถูกคิดใหม่)"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function StatCard({ label, value, tone }) {
  const toneClass = {
    teal: 'text-teal-300 border-teal-500/25 bg-teal-500/5',
    rose: 'text-rose-300 border-rose-500/25 bg-rose-500/5',
    slate: 'text-slate-300 border-slate-700 bg-slate-800/30',
  }[tone] || 'text-slate-300 border-slate-700 bg-slate-800/30';

  return (
    <div className={`rounded-xl border px-4 py-3 ${toneClass}`}>
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className="text-xl font-bold mt-0.5">{value}</div>
    </div>
  );
}
