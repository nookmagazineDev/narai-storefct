import React, { useState, useEffect, useMemo } from 'react';
import {
  Truck,
  Database,
  Search,
  RefreshCw,
  Loader2,
  CalendarDays,
  X,
  ArrowRight,
  PackageCheck,
  AlertTriangle
} from 'lucide-react';
import toast from 'react-hot-toast';
import { fetchDeliverySummary } from '../services/fulfillmentService';

// Local YYYY-MM-DD (not toISOString, which converts to UTC and can shift a day for timezones
// ahead of UTC like Thailand) — same convention as the other pages in this app.
const toLocalDateStr = (date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

export default function DeliverySummary() {
  const [startDate, setStartDate] = useState(toLocalDateStr(new Date()));
  const [endDate, setEndDate] = useState(toLocalDateStr(new Date()));
  const [activePreset, setActivePreset] = useState('today');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [drilldownItem, setDrilldownItem] = useState(null);

  const loadSummary = async (start, end) => {
    setLoading(true);
    try {
      const data = await fetchDeliverySummary({ startDate: start, endDate: end });
      setItems(data);
    } catch (err) {
      console.error("loadSummary error:", err);
      toast.error(err.message || "โหลดสรุปยอดส่งของไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSummary(startDate, endDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handlePreset = (preset) => {
    const now = new Date();
    let start, end;
    if (preset === 'today') {
      start = end = now;
    } else if (preset === 'week') {
      const dow = now.getDay(); // 0 = Sunday
      start = new Date(now); start.setDate(now.getDate() - dow);
      end = new Date(now); end.setDate(now.getDate() + (6 - dow));
    } else if (preset === 'month') {
      start = new Date(now.getFullYear(), now.getMonth(), 1);
      end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    } else {
      return;
    }
    const startStr = toLocalDateStr(start);
    const endStr = toLocalDateStr(end);
    setStartDate(startStr);
    setEndDate(endStr);
    setActivePreset(preset);
    loadSummary(startStr, endStr);
  };

  const handleCustomRangeApply = () => {
    if (!startDate || !endDate) {
      toast.error("กรุณาเลือกวันที่เริ่มต้นและสิ้นสุด");
      return;
    }
    if (startDate > endDate) {
      toast.error("วันที่เริ่มต้นต้องมาก่อนวันที่สิ้นสุด");
      return;
    }
    setActivePreset(null);
    loadSummary(startDate, endDate);
  };

  const filteredItems = useMemo(() => {
    if (!searchQuery) return items;
    const q = searchQuery.toLowerCase();
    return items.filter(it =>
      String(it.code || '').toLowerCase().includes(q) ||
      String(it.name || '').toLowerCase().includes(q)
    );
  }, [items, searchQuery]);

  const totalSentAll = filteredItems.reduce((sum, it) => sum + (Number(it.totalSent) || 0), 0);

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="glass-panel rounded-2xl p-5 border border-slate-800 bg-gradient-to-r from-slate-900 via-slate-900 to-amber-950/30 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold text-amber-400 mb-1">
            <Database className="w-4 h-4 text-amber-400" />
            <span>รวมจากใบเบิกทุกสาขา (myfbdata.orderd) + "ยอดคงเหลือไอเทม"</span>
          </div>
          <h1 className="text-xl md:text-2xl font-bold text-slate-100 flex items-center gap-2">
            <Truck className="w-5 h-5 text-amber-400" />
            <span>สรุปส่งของ</span>
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            ยอดส่งของแต่ละไอเทมรวมทุกสาขา เทียบกับยอดคงเหลือ — กดที่ยอดส่งเพื่อดูรายละเอียดว่าสาขาไหนเบิกวันไหนบ้าง
          </p>
        </div>

        <button
          onClick={() => loadSummary(startDate, endDate)}
          className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-800 text-slate-300 hover:text-amber-400 transition-colors text-xs font-semibold self-start md:self-auto"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-amber-400' : ''}`} />
          รีเฟรชข้อมูล
        </button>
      </div>

      {/* Date Range Controls */}
      <div className="glass-card rounded-2xl p-4 flex flex-wrap items-end gap-3">
        <div className="flex items-center gap-2">
          {[
            { key: 'today', label: 'วันนี้' },
            { key: 'week', label: 'สัปดาห์นี้' },
            { key: 'month', label: 'เดือนนี้' }
          ].map(preset => (
            <button
              key={preset.key}
              onClick={() => handlePreset(preset.key)}
              disabled={loading}
              className={`px-3.5 py-2 rounded-xl text-xs font-semibold transition-colors disabled:opacity-50 ${
                activePreset === preset.key
                  ? 'bg-amber-500 text-slate-950'
                  : 'bg-slate-950 text-slate-300 border border-slate-800 hover:bg-slate-800'
              }`}
            >
              {preset.label}
            </button>
          ))}
        </div>

        <div className="w-px h-8 bg-slate-800 hidden sm:block" />

        <div className="space-y-1">
          <label className="text-[11px] text-slate-400 block font-medium">วันที่เริ่มต้น</label>
          <div className="relative">
            <CalendarDays className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="date"
              value={startDate}
              onChange={(e) => { setStartDate(e.target.value); setActivePreset(null); }}
              className="bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-amber-500"
            />
          </div>
        </div>
        <div className="space-y-1">
          <label className="text-[11px] text-slate-400 block font-medium">ถึงวันที่</label>
          <div className="relative">
            <CalendarDays className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="date"
              value={endDate}
              onChange={(e) => { setEndDate(e.target.value); setActivePreset(null); }}
              className="bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-amber-500"
            />
          </div>
        </div>
        <button
          onClick={handleCustomRangeApply}
          disabled={loading}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold transition-colors disabled:opacity-50"
        >
          <Search className="w-3.5 h-3.5" />
          <span>ค้นหาตามช่วงวันที่</span>
        </button>

        <div className="flex-1" />

        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="ค้นหารหัส/ชื่อสินค้า..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-amber-500 w-52"
          />
        </div>
      </div>

      {/* Summary Table */}
      <div className="glass-panel rounded-2xl p-5 border border-slate-800 shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800/80 mb-3">
          <h2 className="text-sm font-bold text-slate-100 flex items-center gap-2">
            <PackageCheck className="w-4 h-4 text-amber-400" />
            <span>สรุปยอดส่งของ ({startDate} ถึง {endDate})</span>
          </h2>
          <span className="text-[11px] px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/30">
            {filteredItems.length} รายการ • ยอดส่งรวม {totalSentAll.toLocaleString()}
          </span>
        </div>

        <div className="overflow-x-auto rounded-xl border border-slate-800">
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="bg-slate-900/90 text-slate-400 font-semibold border-b border-slate-800">
              <tr>
                <th className="px-3 py-2.5">รหัสสินค้า</th>
                <th className="px-4 py-2.5">ชื่อสินค้า</th>
                <th className="px-3 py-2.5 text-center">หน่วย</th>
                <th className="px-3 py-2.5 text-right">ยอดส่งรวมทุกสาขา</th>
                <th className="px-3 py-2.5 text-right">ยอดคงเหลือ</th>
                <th className="px-3 py-2.5 text-center w-12"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {loading ? (
                <tr>
                  <td colSpan="6" className="px-4 py-8 text-center text-slate-500">
                    <Loader2 className="w-5 h-5 animate-spin mx-auto text-amber-400" />
                  </td>
                </tr>
              ) : filteredItems.length === 0 ? (
                <tr>
                  <td colSpan="6" className="px-4 py-8 text-center text-slate-500">
                    ไม่พบข้อมูลยอดส่งของในช่วงวันที่เลือก
                  </td>
                </tr>
              ) : (
                filteredItems.map((it, idx) => (
                  <tr
                    key={it.code || idx}
                    onClick={() => setDrilldownItem(it)}
                    className="hover:bg-slate-800/40 cursor-pointer transition-colors"
                  >
                    <td className="px-3 py-2.5 font-mono font-bold text-amber-400">{it.code}</td>
                    <td className="px-4 py-2.5 text-slate-100">{it.name || '-'}</td>
                    <td className="px-3 py-2.5 text-center text-slate-400">{it.unit || '-'}</td>
                    <td className="px-3 py-2.5 text-right font-mono font-bold text-emerald-400">
                      {Number(it.totalSent).toLocaleString()}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono">
                      {it.remaining !== null && it.remaining !== undefined ? (
                        <span className="text-sky-400">{Number(it.remaining).toLocaleString()}</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-slate-600" title="ยังไม่มีข้อมูลในชีทยอดคงเหลือไอเทม">
                          <AlertTriangle className="w-3 h-3" /> -
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <ArrowRight className="w-3.5 h-3.5 text-slate-500" />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Drill-down Modal: which branch requisitioned how much, on which date */}
      {drilldownItem && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md"
          onClick={() => setDrilldownItem(null)}
        >
          <div
            className="bg-slate-900 border border-slate-700/80 rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-4 bg-slate-950/70 border-b border-slate-800 flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-slate-100">
                  <span className="font-mono text-amber-400">{drilldownItem.code}</span> — {drilldownItem.name || '-'}
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  ยอดส่งรวม {Number(drilldownItem.totalSent).toLocaleString()} {drilldownItem.unit || ''} จาก {drilldownItem.breakdown.length} รายการ
                </p>
              </div>
              <button
                onClick={() => setDrilldownItem(null)}
                className="p-1.5 rounded-xl text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto">
              <table className="w-full text-left text-xs text-slate-300">
                <thead className="bg-slate-950/60 text-slate-400 font-semibold border-b border-slate-800 sticky top-0">
                  <tr>
                    <th className="px-4 py-2.5">วันที่</th>
                    <th className="px-4 py-2.5">สาขา</th>
                    <th className="px-4 py-2.5">เลขที่ใบเบิก</th>
                    <th className="px-4 py-2.5 text-right">จำนวนที่ส่ง</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {drilldownItem.breakdown
                    .slice()
                    .sort((a, b) => (a.date || '').localeCompare(b.date || ''))
                    .map((row, idx) => (
                      <tr key={idx} className="hover:bg-slate-800/40">
                        <td className="px-4 py-2.5 text-slate-400">{row.date || '-'}</td>
                        <td className="px-4 py-2.5 text-amber-300 font-medium">{row.branch || '-'}</td>
                        <td className="px-4 py-2.5 font-mono text-slate-200">{row.docNo || '-'}</td>
                        <td className="px-4 py-2.5 text-right font-mono font-bold text-emerald-400">
                          {Number(row.qtySent).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
