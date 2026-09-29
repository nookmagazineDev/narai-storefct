import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, X, ChevronDown, ChevronRight } from 'lucide-react';
import { kitchenCall, todayYmd, formatThaiDate, formatQty } from '../../services/kitchenService';
import { buildStockCard, quickRange } from '../../services/stockCard';
import { RangeQuick } from './DateQuick';

const KIND = {
  receipt: ['รับเข้า', 'text-emerald-300'],
  store: ['รับจากใบเบิก', 'text-emerald-300'],
  issue: ['เบิกใช้', 'text-rose-300'],
  produce: ['ผลิตได้', 'text-purple-300'],
  count: ['ยอดนับ', 'text-sky-300'],
};

const INPUT = 'bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-sm text-slate-100 focus:outline-none focus:border-sky-500/60';

/**
 * สต๊อกการ์ดของวัตถุดิบหนึ่งตัว — ยอดยกมา แล้วเดินยอดรายวัน (รับเข้า / เบิกใช้ / ผลิตได้ / ยอดนับ → คงเหลือสิ้นวัน)
 * กดวันเพื่อกางดูเอกสารของวันนั้น · ยอดตรงกับหน้าคงเหลือ (กติกาเดียวกับ getKitchenBalance)
 */
export default function StockCard({ row, onClose }) {
  const today = todayYmd();
  const [[from, to], setRange] = useState(() => quickRange('month', today));
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [onlyActive, setOnlyActive] = useState(true);
  const [open, setOpen] = useState(() => new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await kitchenCall('getKitchenStockCard', { itemKey: row.item_key, dateFrom: from, dateTo: to }));
      setOpen(new Set());
    } catch (err) {
      setData(null);
      setError(/ไม่รู้จักคำสั่ง|unknown action/i.test(err.message)
        ? 'office-server ที่ออฟฟิศยังเป็นรุ่นเก่า ยังดูสต๊อกการ์ดไม่ได้ — รัน update-office-server.bat ของ Narai-branch ก่อน'
        : err.message);
    } finally {
      setLoading(false);
    }
  }, [row.item_key, from, to]);

  useEffect(() => { load(); }, [load]);

  const days = useMemo(
    () => (data ? buildStockCard(data.opening?.balance, data.events, data.dateFrom, data.dateTo > today ? today : data.dateTo) : []),
    [data, today]
  );
  const shown = onlyActive ? days.filter((d) => d.events.length > 0) : days;
  const totals = days.reduce((t, d) => ({
    received: t.received + d.received, issued: t.issued + d.issued, loss: t.loss + d.loss, produced: t.produced + d.produced,
  }), { received: 0, issued: 0, loss: 0, produced: 0 });
  const unit = row.unit || '';
  const toggle = (d) => setOpen((prev) => { const n = new Set(prev); if (n.has(d)) n.delete(d); else n.add(d); return n; });
  const num = (v, cls, sign = '') => (v ? <span className={cls}>{sign}{formatQty(v)}</span> : <span className="text-slate-700">-</span>);

  return (
    <div className="fixed inset-0 z-40 bg-black/70 flex items-start justify-center overflow-y-auto p-4" onClick={onClose}>
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-4xl my-8 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-slate-800">
          <div className="min-w-0">
            <h2 className="font-semibold text-slate-100 text-sm">สต๊อกการ์ด · {row.item_name}</h2>
            <p className="text-[11px] text-slate-500 mt-0.5">{row.item_code}{unit ? ` · หน่วย ${unit}` : ''} · ครัวกลาง</p>
          </div>
          <button onClick={onClose} className="p-1 text-slate-500 hover:text-slate-300"><X className="w-4 h-4" /></button>
        </div>

        <div className="p-4 space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="flex flex-wrap items-end gap-2">
              <RangeQuick from={from} to={to} onChange={(f, t) => setRange([f, t])} presets={['today', 'week', 'month', 'lastMonth']} />
              <input type="date" value={from} max={to} onChange={(e) => setRange([e.target.value, to])} className={INPUT} aria-label="ตั้งแต่วันที่" />
              <span className="text-xs text-slate-500 pb-2">ถึง</span>
              <input type="date" value={to} min={from} onChange={(e) => setRange([from, e.target.value])} className={INPUT} aria-label="ถึงวันที่" />
            </div>
            <label className="flex items-center gap-2 text-xs text-slate-400 pb-1.5">
              <input type="checkbox" className="accent-sky-500" checked={onlyActive} onChange={(e) => setOnlyActive(e.target.checked)} />
              เฉพาะวันที่มีความเคลื่อนไหว
            </label>
          </div>

          {loading ? (
            <div className="flex items-center justify-center gap-2 py-14 text-sm text-slate-500"><Loader2 className="w-4 h-4 animate-spin text-sky-400" /> กำลังโหลดสต๊อกการ์ด...</div>
          ) : error ? (
            <p className="text-sm text-rose-300 py-6 text-center">{error}</p>
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
                {[
                  ['ยกมา', data.opening?.balance, 'text-slate-200',
                    data.opening?.count_date ? `นับล่าสุด ${formatThaiDate(data.opening.count_date)}` : 'ยังไม่เคยนับ'],
                  ['รับเข้า', totals.received, 'text-emerald-300'],
                  ['เบิกใช้', totals.issued, 'text-rose-300', totals.loss ? `สูญเสีย ${formatQty(totals.loss)}` : ''],
                  ['ผลิตได้', totals.produced, 'text-purple-300'],
                  ['คงเหลือ', days.length ? days[days.length - 1].close : data.opening?.balance, 'text-sky-200', `สิ้นวัน ${formatThaiDate(data.dateTo)}`],
                ].map(([label, v, cls, sub]) => (
                  <div key={label} className="rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2">
                    <div className="text-slate-500">{label}</div>
                    <div className={`text-base font-semibold font-mono ${cls}`}>{formatQty(Number(v) || 0)} <span className="text-[10px] text-slate-500 font-sans">{unit}</span></div>
                    {sub && <div className="text-[10px] text-slate-500">{sub}</div>}
                  </div>
                ))}
              </div>

              <div className="overflow-x-auto border border-slate-800 rounded-lg">
                <table className="w-full text-sm min-w-[720px]">
                  <thead className="bg-slate-950/60 text-slate-400 text-xs">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium">วันที่</th>
                      <th className="text-right px-3 py-2 font-medium">ยกมา</th>
                      <th className="text-right px-3 py-2 font-medium">รับเข้า</th>
                      <th className="text-right px-3 py-2 font-medium">เบิกใช้</th>
                      <th className="text-right px-3 py-2 font-medium">ผลิตได้</th>
                      <th className="text-right px-3 py-2 font-medium">ยอดนับ</th>
                      <th className="text-right px-3 py-2 font-medium">คงเหลือสิ้นวัน</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.length === 0 ? (
                      <tr><td colSpan={7} className="py-10 text-center text-xs text-slate-500">ไม่มีความเคลื่อนไหวในช่วงวันที่นี้</td></tr>
                    ) : shown.map((d) => {
                      const isOpen = open.has(d.date);
                      const hasEv = d.events.length > 0;
                      return (
                        <React.Fragment key={d.date}>
                          <tr onClick={() => hasEv && toggle(d.date)}
                            className={`border-t border-slate-800/70 ${hasEv ? 'cursor-pointer hover:bg-slate-800/40' : 'opacity-50'}`}>
                            <td className="px-3 py-2 text-slate-300 whitespace-nowrap">
                              {hasEv ? (isOpen ? <ChevronDown className="inline w-3.5 h-3.5 mr-1 text-slate-500" /> : <ChevronRight className="inline w-3.5 h-3.5 mr-1 text-slate-500" />) : <span className="inline-block w-[18px]" />}
                              {formatThaiDate(d.date)}
                            </td>
                            <td className="px-3 py-2 text-right font-mono text-slate-400">{formatQty(d.open)}</td>
                            <td className="px-3 py-2 text-right font-mono">{num(d.received, 'text-emerald-300', '+')}</td>
                            <td className="px-3 py-2 text-right font-mono">
                              {num(d.issued, 'text-rose-300', '−')}
                              {d.loss > 0 && <div className="text-[10px] text-rose-300/70">สูญเสีย {formatQty(d.loss)}</div>}
                            </td>
                            <td className="px-3 py-2 text-right font-mono">{num(d.produced, 'text-purple-300', '+')}</td>
                            <td className="px-3 py-2 text-right font-mono">
                              {d.count === null ? <span className="text-slate-700">-</span> : <span className="text-sky-300">{formatQty(d.count)}</span>}
                            </td>
                            <td className={`px-3 py-2 text-right font-mono font-semibold ${d.close < 0 ? 'text-rose-400' : 'text-slate-100'}`}>{formatQty(d.close)}</td>
                          </tr>
                          {isOpen && (
                            <tr className="bg-slate-950/40">
                              <td colSpan={7} className="px-3 pb-2.5 pt-1">
                                {d.count !== null && (d.received || d.issued || d.produced) ? (
                                  <p className="text-[10px] text-amber-300/90 mb-1">
                                    วันนี้มียอดนับ — คงเหลือสิ้นวัน = ยอดนับล่าสุด รายการอื่นของวันเดียวกันไม่ถูกรวม (กติกาเดียวกับหน้าคงเหลือ)
                                  </p>
                                ) : null}
                                <table className="w-full text-xs">
                                  <tbody>
                                    {d.events.map((e, i) => (
                                      <tr key={i} className="border-t border-slate-800/50 first:border-0">
                                        <td className={`py-1 pr-3 whitespace-nowrap ${KIND[e.kind]?.[1] || 'text-slate-400'}`}>{KIND[e.kind]?.[0] || e.kind}</td>
                                        <td className="py-1 pr-3 font-mono text-slate-400 whitespace-nowrap">{e.doc_no || '-'}</td>
                                        <td className="py-1 pr-3 text-slate-500">{e.ref || ''}</td>
                                        <td className="py-1 pr-3 text-right font-mono text-slate-200 whitespace-nowrap">
                                          {formatQty(e.qty)} {unit}
                                          {Number(e.loss_qty) > 0 && <span className="text-rose-300/70"> (สูญเสีย {formatQty(e.loss_qty)})</span>}
                                        </td>
                                        <td className="py-1 text-right text-slate-600 whitespace-nowrap">{String(e.at || '').slice(11, 16)}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="text-[10px] text-slate-500">
                กดวันที่เพื่อดูเอกสารของวันนั้น · รับเข้า = รับเข้าที่ครัวกรอก + รับของจากใบเบิกคลังกลาง · เบิกใช้รวมของสูญเสียแล้ว ·
                วันที่มียอดนับ คงเหลือสิ้นวันใช้ยอดนับล่าสุดของวันนั้น
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
