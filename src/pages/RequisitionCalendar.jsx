import React, { useState, useEffect, useMemo } from 'react';
import { 
  Calendar as CalendarIcon, 
  ChevronLeft, 
  ChevronRight, 
  Filter, 
  Building2, 
  Search, 
  Clock, 
  CheckCircle2, 
  FileText, 
  Layers, 
  List, 
  Grid, 
  RefreshCw, 
  CalendarCheck,
  Package,
  ArrowRight,
  Sparkles,
  Database,
  Truck,
  PackageCheck
} from 'lucide-react';
import { fetchRequisitions, BRANCH_MAP, formatDocNoDisplay, fetchReceivedStatus } from '../services/requisitionService';
import RequisitionDetailModal from '../components/RequisitionDetailModal';

const THAI_MONTHS = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'
];

const WEEKDAYS = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];

// Format a Date using its LOCAL year/month/day (not UTC) as "YYYY-MM-DD".
// Date#toISOString() converts to UTC first, which shifts the date back a day for
// timezones ahead of UTC (Thailand is UTC+7) — e.g. local Aug 1 00:00 becomes
// "2026-07-31" after toISOString(), silently mismatching deldate strings from the API
// (which are formatted server-side, no timezone conversion) and hiding real requisitions.
const toLocalDateStr = (date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

export default function RequisitionCalendar({ selectedBranch = 'all', onBranchChange }) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [dateType, setDateType] = useState('deldate');
  const [branchFilter, setBranchFilter] = useState(selectedBranch);
  const [searchQuery, setSearchQuery] = useState('');

  const [selectedDateStr, setSelectedDateStr] = useState(toLocalDateStr(new Date()));
  const [requisitions, setRequisitions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedReqModal, setSelectedReqModal] = useState(null);
  const [receivedStatusMap, setReceivedStatusMap] = useState({}); // docNo -> { branch, itemCount, hasEdit, lastRecordedAt } — from สาขา's "รับของ" sheet

  useEffect(() => {
    setBranchFilter(selectedBranch);
  }, [selectedBranch]);

  // Fetch which requisitions the branch has already received (not branch-filtered — same sheet for all branches)
  useEffect(() => {
    let isMounted = true;
    fetchReceivedStatus()
      .then(map => { if (isMounted) setReceivedStatusMap(map); })
      .catch(err => console.warn("Failed to load branch receiving status:", err));
    return () => { isMounted = false; };
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const year = currentDate.getFullYear();
      const month = currentDate.getMonth();
      const start = toLocalDateStr(new Date(year, month - 1, 20));
      const end = toLocalDateStr(new Date(year, month + 1, 10));

      const data = await fetchRequisitions({
        branch: branchFilter,
        startDate: start,
        endDate: end,
        dateType: dateType
      });
      setRequisitions(data);
    } catch (err) {
      console.error("Failed to load requisitions:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [currentDate, branchFilter, dateType]);

  const calendarDays = useMemo(() => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();

    const firstDayOfMonth = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const daysInPrevMonth = new Date(year, month, 0).getDate();

    const days = [];

    for (let i = firstDayOfMonth - 1; i >= 0; i--) {
      const dayNum = daysInPrevMonth - i;
      const dateStr = toLocalDateStr(new Date(year, month - 1, dayNum));
      days.push({ dateStr, dayNum, isCurrentMonth: false });
    }

    for (let dayNum = 1; dayNum <= daysInMonth; dayNum++) {
      const dateStr = toLocalDateStr(new Date(year, month, dayNum));
      days.push({ dateStr, dayNum, isCurrentMonth: true });
    }

    const targetLength = days.length > 35 ? 42 : 35;
    const remaining = targetLength - days.length;
    for (let dayNum = 1; dayNum <= remaining; dayNum++) {
      const dateStr = toLocalDateStr(new Date(year, month + 1, dayNum));
      days.push({ dateStr, dayNum, isCurrentMonth: false });
    }

    return days;
  }, [currentDate]);

  const reqsByDate = useMemo(() => {
    const map = {};
    requisitions.forEach(req => {
      const targetDate = dateType === 'deldate' 
        ? (req.deldate || req.docDate) 
        : req.orderDate;

      if (!targetDate) return;

      const docDisplay = formatDocNoDisplay(req.invNo || req.no, req.branchCode);

      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const matchesNo = docDisplay.toLowerCase().includes(q);
        const matchesBranch = String(req.branchName || '').toLowerCase().includes(q);
        if (!matchesNo && !matchesBranch) return;
      }

      if (!map[targetDate]) map[targetDate] = [];
      map[targetDate].push({
        ...req,
        displayNo: docDisplay
      });
    });
    return map;
  }, [requisitions, dateType, searchQuery]);

  const todayStr = toLocalDateStr(new Date());
  const selectedDayReqs = reqsByDate[selectedDateStr] || [];

  const handlePrevMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
  };

  const handleNextMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
  };

  const handleToday = () => {
    const now = new Date();
    setCurrentDate(now);
    setSelectedDateStr(toLocalDateStr(now));
  };

  const totalMonthOrders = Object.values(reqsByDate).flat().length;
  const pendingCount = Object.values(reqsByDate).flat().filter(r => !r.received && r.status !== 'รับของแล้ว').length;
  const completedCount = Object.values(reqsByDate).flat().filter(r => r.received || r.status === 'รับของแล้ว').length;

  const formatSelectedDateHeader = (dStr) => {
    if (!dStr) return '';
    const parts = dStr.split('-');
    if (parts.length < 3) return dStr;
    const y = parseInt(parts[0]) + 543;
    const m = THAI_MONTHS[parseInt(parts[1]) - 1];
    const d = parseInt(parts[2]);
    return `${d} ${m} ${y}`;
  };

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="glass-panel rounded-2xl p-5 border border-slate-800 bg-gradient-to-r from-slate-900 via-slate-900 to-amber-950/30 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold text-amber-400 mb-1">
            <Database className="w-4 h-4 text-amber-400" />
            <span>ข้อมูลจากตาราง myfbdata.orderd</span>
          </div>
          <h1 className="text-xl md:text-2xl font-bold text-slate-100 flex items-center gap-2">
            <span>ปฏิทินใบเบิกสินค้า (แสดงเลขที่ใบเบิกแบบสั้น เช่น CRM-3451)</span>
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            แสดงจำนวนใบเบิกตรงตาม <strong className="text-amber-300">วันที่กำหนดส่งสินค้า (Ord_DelDate)</strong>
          </p>
        </div>

        {/* Quick Stats Bar */}
        <div className="flex items-center gap-3">
          <div className="px-3.5 py-2 rounded-xl bg-slate-950/60 border border-slate-800 flex items-center gap-2">
            <Package className="w-4 h-4 text-amber-400" />
            <div>
              <p className="text-[10px] text-slate-400">ใบเบิกทั้งหมด</p>
              <p className="text-sm font-bold text-slate-200">{totalMonthOrders} ใบ</p>
            </div>
          </div>
          <div className="px-3.5 py-2 rounded-xl bg-slate-950/60 border border-slate-800 flex items-center gap-2">
            <Clock className="w-4 h-4 text-amber-400" />
            <div>
              <p className="text-[10px] text-slate-400">รอรับของ</p>
              <p className="text-sm font-bold text-amber-400">{pendingCount} ใบ</p>
            </div>
          </div>
          <div className="px-3.5 py-2 rounded-xl bg-slate-950/60 border border-slate-800 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <div>
              <p className="text-[10px] text-slate-400">รับของแล้ว</p>
              <p className="text-sm font-bold text-emerald-400">{completedCount} ใบ</p>
            </div>
          </div>
        </div>
      </div>

      {/* Control Toolbar */}
      <div className="glass-card rounded-2xl p-4 flex flex-wrap items-center justify-between gap-4">
        
        {/* Month Navigator */}
        <div className="flex items-center gap-2">
          <button
            onClick={handlePrevMonth}
            className="p-2 rounded-xl bg-slate-950 border border-slate-800 text-slate-300 hover:text-amber-400 hover:border-amber-500/40 transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-base font-bold text-slate-100 min-w-36 text-center font-mono">
            {THAI_MONTHS[currentDate.getMonth()]} {currentDate.getFullYear() + 543}
          </span>
          <button
            onClick={handleNextMonth}
            className="p-2 rounded-xl bg-slate-950 border border-slate-800 text-slate-300 hover:text-amber-400 hover:border-amber-500/40 transition-colors"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
          <button
            onClick={handleToday}
            className="px-3 py-1.5 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/30 text-xs font-semibold hover:bg-amber-500/20 transition-colors ml-1"
          >
            วันนี้
          </button>
        </div>

        {/* Date Basis Toggle */}
        <div className="flex items-center bg-slate-950 p-1 rounded-xl border border-slate-800">
          <button
            onClick={() => setDateType('deldate')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
              dateType === 'deldate'
                ? 'bg-amber-500 text-slate-950 shadow-md'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Truck className="w-3.5 h-3.5" />
            <span>วันที่กำหนดส่ง (Ord_DelDate)</span>
          </button>
          <button
            onClick={() => setDateType('orderDate')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
              dateType === 'orderDate'
                ? 'bg-amber-500 text-slate-950 shadow-md'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <CalendarIcon className="w-3.5 h-3.5" />
            <span>วันที่สั่งเบิก (Ord_OrdDate)</span>
          </button>
        </div>

        {/* Search Input */}
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="ค้นหาเลขที่ใบเบิก (เช่น CRM-3451)..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-amber-500 w-52 sm:w-64"
            />
          </div>
          <button
            onClick={loadData}
            className="p-2 rounded-xl bg-slate-950 border border-slate-800 text-slate-400 hover:text-amber-400 transition-colors"
            title="รีเฟรชข้อมูล"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-amber-400' : ''}`} />
          </button>
        </div>

      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Tier 1: Compact Calendar (7 Columns) */}
        <div className="lg:col-span-7 glass-panel rounded-2xl p-4 border border-slate-800 shadow-xl space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-slate-800/80">
            <h2 className="text-xs font-bold text-slate-300 flex items-center gap-2">
              <CalendarIcon className="w-4 h-4 text-amber-400" />
              <span>ปฏิทินวันที่กำหนดส่งสินค้า (กดเลือกวันเพื่อดูรายการ)</span>
            </h2>
            <span className="text-[11px] text-amber-400/90 font-mono">Ord_DelDate</span>
          </div>

          {/* Weekdays */}
          <div className="grid grid-cols-7 gap-1 text-center">
            {WEEKDAYS.map((w, idx) => (
              <div 
                key={w} 
                className={`py-1.5 text-[11px] font-bold rounded-lg ${
                  idx === 0 || idx === 6 ? 'text-amber-400 bg-amber-500/5' : 'text-slate-400 bg-slate-900/60'
                }`}
              >
                {w}
              </div>
            ))}
          </div>

          {/* Days Cells */}
          <div className="grid grid-cols-7 gap-1.5">
            {calendarDays.map((cell, idx) => {
              const dateReqs = reqsByDate[cell.dateStr] || [];
              const isToday = cell.dateStr === todayStr;
              const isSelected = cell.dateStr === selectedDateStr;
              const count = dateReqs.length;

              const pendingInCell = dateReqs.filter(r => !r.received && r.status !== 'รับของแล้ว').length;
              const receivedInCell = dateReqs.filter(r => r.received || r.status === 'รับของแล้ว').length;

              return (
                <button
                  key={idx}
                  onClick={() => setSelectedDateStr(cell.dateStr)}
                  className={`h-16 md:h-18 p-1.5 rounded-xl flex flex-col justify-between items-center transition-all border text-center cursor-pointer relative ${
                    isSelected
                      ? 'bg-amber-500 text-slate-950 border-amber-400 shadow-lg shadow-amber-500/25 scale-[1.03] z-10 font-bold'
                      : !cell.isCurrentMonth
                      ? 'bg-slate-950/20 border-slate-900/50 opacity-30 text-slate-600'
                      : isToday
                      ? 'bg-amber-950/30 border-amber-500/60 text-slate-100 hover:bg-amber-900/40'
                      : 'bg-slate-900/60 border-slate-800/80 text-slate-300 hover:bg-slate-800/60 hover:border-slate-700'
                  }`}
                >
                  {/* Day Number */}
                  <span className={`text-xs font-mono ${isSelected ? 'font-bold text-slate-950' : isToday ? 'text-amber-400 font-bold' : ''}`}>
                    {cell.dayNum}
                  </span>

                  {/* Requisition Count Pill Badge */}
                  {count > 0 ? (
                    <div className={`px-2 py-0.5 rounded-full text-[10px] font-bold flex items-center gap-1 shadow-sm ${
                      isSelected
                        ? 'bg-slate-950 text-amber-400 border border-amber-400/40'
                        : 'bg-slate-950/90 text-amber-400 border border-amber-500/30'
                    }`}>
                      <span>{count} ใบ</span>
                      {!isSelected && (
                        <div className="flex items-center gap-0.5">
                          {pendingInCell > 0 && <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />}
                          {receivedInCell > 0 && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />}
                        </div>
                      )}
                    </div>
                  ) : (
                    <span className={`text-[10px] ${isSelected ? 'text-slate-800' : 'text-slate-700'}`}>-</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Tier 2: Daily Requisition List Panel */}
        <div className="lg:col-span-5 glass-panel rounded-2xl p-5 border border-slate-800 shadow-xl flex flex-col justify-between min-h-[400px]">
          <div>
            {/* Panel Header */}
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div>
                <p className="text-[11px] text-amber-400 font-semibold flex items-center gap-1">
                  <Truck className="w-3.5 h-3.5" /> ใบเบิกกำหนดส่งวันที่ (Ord_DelDate)
                </p>
                <h3 className="text-base font-bold text-slate-100 font-mono mt-0.5">
                  {formatSelectedDateHeader(selectedDateStr)}
                </h3>
              </div>

              <span className="px-3 py-1 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/30 font-bold text-xs">
                {selectedDayReqs.length} ใบเบิก
              </span>
            </div>

            {/* List of Requisitions for Selected Day */}
            <div className="mt-4 space-y-2.5 max-h-[460px] overflow-y-auto pr-1">
              {selectedDayReqs.length === 0 ? (
                <div className="py-12 text-center text-slate-500 space-y-2">
                  <Package className="w-8 h-8 mx-auto text-slate-700 stroke-1" />
                  <p className="text-xs">ไม่มีรายการใบเบิกสินค้ากำหนดส่งในวันที่เลือก</p>
                  <p className="text-[11px] text-slate-600">ลองคลิกเลือกวันที่อื่นในปฏิทิน</p>
                </div>
              ) : (
                selectedDayReqs.map((req, idx) => {
                  const isReceived = req.received || req.status === 'รับของแล้ว';
                  const itemCount = req.itemCount || (req.items ? req.items.length : 0);
                  const displayNo = req.displayNo || formatDocNoDisplay(req.invNo || req.no);

                  return (
                    <div
                      key={idx}
                      onClick={() => setSelectedReqModal({ ...req, displayNo })}
                      className={`p-3.5 rounded-xl border transition-all hover:scale-[1.01] cursor-pointer group flex items-center justify-between gap-3 ${
                        isReceived
                          ? 'bg-slate-900/80 border-emerald-500/30 hover:border-emerald-500/60'
                          : 'bg-slate-900/80 border-amber-500/30 hover:border-amber-500/60'
                      }`}
                    >
                      <div className="space-y-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-sm text-slate-100 group-hover:text-amber-400 transition-colors">
                            {displayNo}
                          </span>
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                            isReceived
                              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                              : 'bg-amber-500/10 text-amber-400 border border-amber-500/30'
                          }`}>
                            {isReceived ? 'รับของแล้ว' : 'รอรับของ'}
                          </span>
                          {req.dataFetched && (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-sky-500/10 text-sky-400 border border-sky-500/30">
                              ดึงข้อมูลแล้ว
                            </span>
                          )}
                          {receivedStatusMap[displayNo] && (
                            <span
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                                receivedStatusMap[displayNo].hasEdit
                                  ? 'bg-amber-500/10 text-amber-400 border border-amber-500/30'
                                  : 'bg-teal-500/10 text-teal-400 border border-teal-500/30'
                              }`}
                              title={`บันทึกล่าสุด: ${receivedStatusMap[displayNo].lastRecordedAt || '-'}`}
                            >
                              <PackageCheck className="w-3 h-3" />
                              สาขารับของแล้ว
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-3 text-xs text-slate-400">
                          <span className="text-amber-300 font-medium">{req.branchName || 'สาขา'}</span>
                          <span>•</span>
                          <span>{itemCount} รายการ</span>
                          <span>•</span>
                          <span className="text-slate-400">สั่งเบิก: {req.orderDate || '-'}</span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <button className="p-2 rounded-lg bg-amber-500/10 text-amber-400 group-hover:bg-amber-500 group-hover:text-slate-950 transition-colors">
                          <ArrowRight className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div className="pt-3 border-t border-slate-800 text-[11px] text-slate-500 text-center">
            💡 กดเลือกใบเบิกเพื่อกางดู **รายการสินค้าขอเบิกแบบละเอียด**
          </div>
        </div>

      </div>

      {/* Tier 3: Modal Detail Popup */}
      {selectedReqModal && (
        <RequisitionDetailModal
          requisition={selectedReqModal}
          onClose={() => setSelectedReqModal(null)}
        />
      )}
    </div>
  );
}
