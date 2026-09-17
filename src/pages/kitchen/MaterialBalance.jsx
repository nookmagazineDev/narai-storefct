import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Boxes, Loader2, RefreshCw, Search, AlertTriangle } from 'lucide-react';
import { kitchenCall, todayYmd, formatThaiDate, formatQty } from '../../services/kitchenService';

/**
 * วัตถุดิบคงเหลือ (ครัวกลาง)
 *
 * ไม่ได้อ่านตัวเลข "คงเหลือ" จากที่ไหน — คำนวณสดจากเหตุการณ์ทุกครั้ง:
 *
 *   คงเหลือ = ยอดนับล่าสุด + รับเข้าหลังวันนับ - เบิกไปใช้หลังวันนับ + ผลิตได้หลังวันนับ
 *
 * ตัวตั้งคือการนับจริง การนับสต๊อกรอบใหม่จึงล้างความคลาดเคลื่อนสะสมให้เอง
 * หน้านี้แสดงทุกตัวตั้งแยกกัน เพื่อให้ตรวจย้อนได้ว่าตัวเลขสุดท้ายมาจากไหน
 */
export default function MaterialBalance() {
  const [asOf, setAsOf] = useState(() => todayYmd());
  const [rows, setRows] = useState([]);
  const [branch, setBranch] = useState('');
  const [term, setTerm] = useState('');
  const [onlyMoved, setOnlyMoved] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await kitchenCall('getKitchenBalance', { asOf });
      setRows(res.items || []);
      setBranch(res.branch || '');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [asOf]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = term.trim().toLowerCase();
    return rows.filter((r) => {
      if (onlyMoved) {
        const moved = Number(r.received_qty) || Number(r.issued_qty) || Number(r.produced_qty);
        if (!moved) return false;
      }
      if (!q) return true;
      return String(r.item_name || '').toLowerCase().includes(q)
        || String(r.item_code || '').toLowerCase().includes(q);
    });
  }, [rows, term, onlyMoved]);

  const neverCounted = useMemo(
    () => rows.filter((r) => !r.count_date).length,
    [rows]
  );

  return (
    <div className="p-4 md:p-6 space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2">
            <Boxes className="w-5 h-5 text-sky-400" />
            วัตถุดิบคงเหลือ
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            คำนวณสดจาก: ยอดนับล่าสุด + รับเข้า − เบิกใช้ + ผลิตได้
            {branch ? ` · สาขา ${branch}` : ''}
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
          <label className="block text-[11px] text-slate-500 mb-1">คงเหลือ ณ วันที่</label>
          <input
            type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)}
            className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-slate-100 focus:outline-none focus:border-sky-500/60"
          />
        </div>
        <div className="flex-1 min-w-[200px]">
          <label className="block text-[11px] text-slate-500 mb-1">ค้นหา</label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
            <input
              type="text" value={term} onChange={(e) => setTerm(e.target.value)}
              placeholder="ชื่อหรือรหัสวัตถุดิบ"
              className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-9 pr-3 py-1.5 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-sky-500/60"
            />
          </div>
        </div>
        <label className="flex items-center gap-2 text-xs text-slate-400 pb-1.5">
          <input
            type="checkbox" checked={onlyMoved}
            onChange={(e) => setOnlyMoved(e.target.checked)}
            className="accent-sky-500"
          />
          เฉพาะที่มีความเคลื่อนไหว
        </label>
      </div>

      {neverCounted > 0 && !loading && (
        <div className="flex items-start gap-2 bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-3">
          <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
          <p className="text-xs text-amber-200/90">
            มี {neverCounted} รายการที่ยังไม่เคยถูกนับสต๊อกที่ครัวกลางเลย —
            ตัวเลขคงเหลือของรายการเหล่านั้นมาจากการรวมรับเข้า/เบิกใช้ทั้งหมดตั้งแต่ต้น
            ซึ่งจะแม่นก็ต่อเมื่อบันทึกครบทุกครั้ง นับสต๊อกสักรอบแล้วตัวเลขจะเริ่มนับใหม่จากของจริง
          </p>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20 text-slate-500 gap-2">
          <Loader2 className="w-5 h-5 animate-spin text-sky-400" /> กำลังคำนวณคงเหลือ...
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-20 text-center text-slate-500 text-sm">
          {rows.length === 0
            ? 'ยังไม่มีวัตถุดิบในระบบครัวกลาง — เพิ่มสูตรการผลิตก่อน แล้ววัตถุดิบในสูตรจะขึ้นที่นี่'
            : 'ไม่พบรายการที่ตรงกับเงื่อนไข'}
        </div>
      ) : (
        <div className="bg-slate-900/60 border border-slate-800 rounded-xl overflow-x-auto">
          <table className="w-full text-sm min-w-[820px]">
            <thead className="bg-slate-900 text-slate-400 text-xs">
              <tr>
                <th className="text-left px-4 py-3 font-medium">วัตถุดิบ</th>
                <th className="text-right px-4 py-3 font-medium">นับล่าสุด</th>
                <th className="text-right px-4 py-3 font-medium">รับเข้า</th>
                <th className="text-right px-4 py-3 font-medium">เบิกใช้</th>
                <th className="text-right px-4 py-3 font-medium">ผลิตได้</th>
                <th className="text-right px-4 py-3 font-medium">คงเหลือ</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const balance = Number(r.balance);
                return (
                  <tr key={r.item_key} className="border-t border-slate-800/70 hover:bg-slate-800/30">
                    <td className="px-4 py-3">
                      <div className="text-slate-200">{r.item_name}</div>
                      <div className="text-[11px] text-slate-500">
                        {r.item_code}{r.unit ? ` · ${r.unit}` : ''}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="text-slate-300">{formatQty(r.counted_qty)}</div>
                      <div className="text-[10px] text-slate-600">
                        {r.count_date ? formatThaiDate(r.count_date) : 'ยังไม่เคยนับ'}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right text-emerald-300/80">
                      {Number(r.received_qty) ? `+${formatQty(r.received_qty)}` : '-'}
                    </td>
                    <td className="px-4 py-3 text-right text-rose-300/80">
                      {Number(r.issued_qty) ? `−${formatQty(r.issued_qty)}` : '-'}
                    </td>
                    <td className="px-4 py-3 text-right text-purple-300/80">
                      {Number(r.produced_qty) ? `+${formatQty(r.produced_qty)}` : '-'}
                    </td>
                    <td className={`px-4 py-3 text-right font-semibold ${balance < 0 ? 'text-rose-400' : 'text-slate-100'}`}>
                      {formatQty(balance)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-[11px] text-slate-600">
        รายการที่ติดลบแปลว่าเบิกใช้มากกว่าที่รับเข้า ตั้งแต่วันที่นับล่าสุด —
        มักเกิดจากลืมบันทึกรับของ หรือเบิกเกินจริง ไม่ใช่ข้อมูลเสีย
      </p>
    </div>
  );
}
