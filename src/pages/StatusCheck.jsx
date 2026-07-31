import React, { useState, useEffect, useMemo } from 'react';
import {
  BellRing,
  AlertTriangle,
  ShieldCheck,
  CheckCircle2,
  Clock,
  Search,
  RefreshCw,
  Loader2,
  ImageIcon,
  ArrowRight,
  Database,
  PackageCheck,
  FileText,
  CalendarDays,
  Download,
  FileSpreadsheet,
  X
} from 'lucide-react';
import toast from 'react-hot-toast';
import {
  fetchRequisitions,
  fetchRequisitionDetail,
  fetchReceivedStatus,
  fetchFetchedStatus,
  fetchPendingEditApprovals,
  fetchFulfillmentItemsDetail,
  approveReceivedEdit,
  markRequisitionFetched,
  formatDocNoDisplay
} from '../services/requisitionService';
import { exportPackingListExcel } from '../services/fulfillmentService';
import { getCategoryOrderMap } from '../services/categoryService';
import RequisitionDetailModal from '../components/RequisitionDetailModal';

// Local YYYY-MM-DD (not toISOString, which shifts to UTC and can land on the wrong day) — same
// convention as RequisitionCalendar's toLocalDateStr, needed since deldate strings from the API
// are formatted server-side with no timezone conversion.
const toLocalDateStr = (date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

// Picks a days-back/days-ahead window (relative to today) wide enough to guarantee the
// selected delivery date falls inside it — /api/pending_orders filters by that window, not by
// an explicit date range.
const computeFetchRange = (dateStr) => {
  if (!dateStr) return { days: 30, daysAhead: 30 };
  const target = new Date(`${dateStr}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.round((target - today) / 86400000);
  return diffDays >= 0
    ? { days: 30, daysAhead: Math.max(30, diffDays + 10) }
    : { days: Math.max(30, Math.abs(diffDays) + 10), daysAhead: 30 };
};

export default function StatusCheck({ selectedBranch = 'all' }) {
  const [loading, setLoading] = useState(false);
  const [requisitions, setRequisitions] = useState([]);
  const [receivedStatusMap, setReceivedStatusMap] = useState({});
  const [fetchedStatusMap, setFetchedStatusMap] = useState({});
  const [pendingApprovals, setPendingApprovals] = useState({ count: 0, docs: [] });
  const [approvingKey, setApprovingKey] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDate, setSelectedDate] = useState(''); // '' = no delivery-date filter (default ±30-day window)
  const [selectedReqModal, setSelectedReqModal] = useState(null);
  const [markingKey, setMarkingKey] = useState(null);
  const [localFetchedOverrides, setLocalFetchedOverrides] = useState({}); // displayNo -> true, optimistic right after marking
  const [exportingKey, setExportingKey] = useState(null);
  const [categoryOrderMap] = useState(() => getCategoryOrderMap());

  // Global status maps (received / fetched / pending-approvals) aren't scoped by delivery date
  // or branch — same Google Sheets for every branch — so they only need to (re)load on manual refresh.
  const loadStatusMaps = async () => {
    try {
      const [received, fetched, approvals] = await Promise.all([
        fetchReceivedStatus().catch(() => ({})),
        fetchFetchedStatus().catch(() => ({})),
        fetchPendingEditApprovals().catch(() => ({ count: 0, docs: [] }))
      ]);
      setReceivedStatusMap(received || {});
      setFetchedStatusMap(fetched || {});
      setPendingApprovals(approvals || { count: 0, docs: [] });
    } catch (err) {
      console.error("StatusCheck loadStatusMaps error:", err);
    }
  };

  const loadRequisitions = async () => {
    setLoading(true);
    try {
      const { days, daysAhead } = computeFetchRange(selectedDate);
      const reqs = await fetchRequisitions({ branch: selectedBranch || 'all', dateType: 'deldate', days, daysAhead });
      setRequisitions(reqs || []);
    } catch (err) {
      console.error("StatusCheck loadRequisitions error:", err);
      toast.error("โหลดข้อมูลใบเบิกไม่สำเร็จ (เชื่อมต่อฐานข้อมูลไม่ได้) กรุณาลองใหม่");
    } finally {
      setLoading(false);
    }
  };

  const loadAll = () => {
    loadStatusMaps();
    loadRequisitions();
  };

  useEffect(() => {
    loadStatusMaps();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadRequisitions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBranch, selectedDate]);

  // Mark a requisition as "ดึงข้อมูลแล้ว" right from this page's table — no need to go to the
  // Fulfillment page just to flip this flag.
  const handleMarkFetched = async (r, e) => {
    e.stopPropagation();
    if (!r.outletId || !r.rawNo) {
      toast.error("ไม่พบข้อมูลใบเบิกที่ตรงกับระบบ ไม่สามารถอัปเดตสถานะได้");
      return;
    }
    setMarkingKey(r.displayNo);
    try {
      await markRequisitionFetched({
        outletId: r.outletId,
        rawNo: r.rawNo,
        docNo: r.displayNo,
        branch: r.branchName,
        date: r.deldate || r.orderDate
      });
      setLocalFetchedOverrides(prev => ({ ...prev, [r.displayNo]: true }));
      toast.success(`อัปเดตสถานะ "ดึงข้อมูลแล้ว" สำหรับใบเบิก ${r.displayNo} เรียบร้อย`);
    } catch (err) {
      toast.error(err.message || 'อัปเดตสถานะไม่สำเร็จ');
    } finally {
      setMarkingKey(null);
    }
  };

  // Print/export "ใบจัดของ" (packing list) for a row without navigating to the Fulfillment page —
  // fetches the item detail on demand (this page only holds the header list), merges in already-
  // recorded packed quantities from the "จัดของ" sheet if any exist, then exports.
  const handleExportPackingList = async (r, e) => {
    e.stopPropagation();
    setExportingKey(r.displayNo);
    try {
      const detail = await fetchRequisitionDetail(r.no || r.rawNo, r.outletId || '');
      const rawItems = detail?.items || [];
      if (rawItems.length === 0) {
        toast.error(`ไม่พบรายการสินค้าของใบเบิก ${r.displayNo}`);
        return;
      }

      let sentByCode = {};
      try {
        sentByCode = await fetchFulfillmentItemsDetail(r.displayNo);
      } catch (err) {
        // No "จัดของ" record yet for this doc — export falls back to จำนวนเบิก below, which is fine.
      }

      const items = rawItems.map(it => {
        const code = String(it.itemCode || it.itemId || '').trim();
        const sent = sentByCode[code] || sentByCode[code.replace(/^0+/, '')];
        return {
          ...it,
          reqQty: it.qty,
          delQty: sent ? sent.qtySent : it.qty,
          status: sent ? sent.status : 'ยืนยัน'
        };
      });

      await exportPackingListExcel({
        docNo: r.displayNo,
        branchName: r.branchName,
        deldate: r.deldate,
        orderDate: r.orderDate,
        items,
        categoryOrderMap
      });
    } catch (err) {
      console.error("handleExportPackingList error:", err);
      toast.error(err.message || 'พิมพ์ใบจัดของไม่สำเร็จ');
    } finally {
      setExportingKey(null);
    }
  };

  // Warehouse quick-approves one branch-reported discrepancy directly from the notification list
  const handleQuickApprove = async (docNo, code) => {
    const key = `${docNo}|${code}`;
    setApprovingKey(key);
    try {
      await approveReceivedEdit({ docNo, code, approvedBy: 'โกดัง' });
      setPendingApprovals(prev => {
        const docs = prev.docs
          .map(d => (d.docNo !== docNo ? d : { ...d, items: d.items.filter(it => it.code !== code) }))
          .filter(d => d.items.length > 0);
        return { count: Math.max(0, prev.count - 1), docs };
      });
      toast.success(`อนุมัติรายการ ${code} ในใบเบิก ${docNo} เรียบร้อย`);
    } catch (err) {
      toast.error(err.message || 'อนุมัติไม่สำเร็จ');
    } finally {
      setApprovingKey(null);
    }
  };

  const openDoc = (docNo, branch) => {
    setSelectedReqModal({ no: docNo, invNo: docNo, displayNo: docNo, branchName: branch || 'สาขา' });
  };

  const rows = useMemo(() => {
    return requisitions
      .map(req => {
        const displayNo = formatDocNoDisplay(req.invNo || req.no, req.branchCode);
        const isReceived = req.received || req.status === 'รับของแล้ว';
        const receivedInfo = receivedStatusMap[displayNo];
        const isFetched = req.dataFetched || Boolean(fetchedStatusMap[displayNo]) || Boolean(localFetchedOverrides[displayNo]);
        return { ...req, displayNo, isReceived, hasEdit: Boolean(receivedInfo?.hasEdit), isFetched };
      })
      .filter(r => {
        if (selectedDate && r.deldate !== selectedDate) return false;
        if (!searchQuery) return true;
        const q = searchQuery.toLowerCase();
        return r.displayNo.toLowerCase().includes(q) || String(r.branchName || '').toLowerCase().includes(q);
      });
  }, [requisitions, receivedStatusMap, fetchedStatusMap, localFetchedOverrides, selectedDate, searchQuery]);

  const notFetchedCount = rows.filter(r => !r.isFetched).length;
  const notReceivedCount = rows.filter(r => !r.isReceived).length;

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="glass-panel rounded-2xl p-5 border border-slate-800 bg-gradient-to-r from-slate-900 via-slate-900 to-amber-950/30 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold text-amber-400 mb-1">
            <Database className="w-4 h-4 text-amber-400" />
            <span>สรุปสถานะใบเบิก & แจ้งเตือนรายการรออนุมัติ</span>
          </div>
          <h1 className="text-xl md:text-2xl font-bold text-slate-100 flex items-center gap-2">
            <BellRing className="w-5 h-5 text-amber-400" />
            <span>ตรวจสอบสถานะ</span>
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            ดูว่าใบเบิกไหนดึงข้อมูลแล้ว / รับของแล้ว และแจ้งเตือนทันทีเมื่อสาขามีการแก้ไขจำนวนตอนรับของ
          </p>
        </div>

        <button
          onClick={loadAll}
          className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-800 text-slate-300 hover:text-amber-400 transition-colors text-xs font-semibold self-start md:self-auto"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-amber-400' : ''}`} />
          รีเฟรชข้อมูล
        </button>
      </div>

      {/* Notification: Pending Edit Approvals */}
      <div className={`glass-panel rounded-2xl p-5 border shadow-xl ${
        pendingApprovals.count > 0 ? 'border-amber-500/40 bg-amber-950/10' : 'border-slate-800'
      }`}>
        <div className="flex items-center justify-between pb-3 border-b border-slate-800/80 mb-3">
          <h2 className="text-sm font-bold text-slate-100 flex items-center gap-2">
            <AlertTriangle className={`w-4 h-4 ${pendingApprovals.count > 0 ? 'text-amber-400' : 'text-slate-500'}`} />
            <span>ใบรับที่มีการแก้ไข รอโกดังอนุมัติ</span>
          </h2>
          <span className={`px-3 py-1 rounded-full text-xs font-bold border ${
            pendingApprovals.count > 0
              ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
              : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
          }`}>
            {pendingApprovals.count} รายการ
          </span>
        </div>

        {pendingApprovals.docs.length === 0 ? (
          <div className="py-8 text-center text-slate-500 space-y-2">
            <ShieldCheck className="w-8 h-8 mx-auto text-emerald-600 stroke-1" />
            <p className="text-xs">ไม่มีรายการแก้ไขที่รออนุมัติในขณะนี้</p>
          </div>
        ) : (
          <div className="space-y-3">
            {pendingApprovals.docs.map(doc => (
              <div key={doc.docNo} className="rounded-xl border border-amber-500/30 bg-slate-950/60 p-3.5 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <button
                    onClick={() => openDoc(doc.docNo, doc.branch)}
                    className="flex items-center gap-2 font-mono font-bold text-sm text-amber-400 hover:text-amber-300 transition-colors"
                  >
                    <FileText className="w-4 h-4" />
                    {doc.docNo}
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                  <span className="text-xs text-amber-300/90">{doc.branch || 'สาขา'} • {doc.items.length} รายการ</span>
                </div>
                <div className="space-y-2">
                  {doc.items.map(it => {
                    const key = `${doc.docNo}|${it.code}`;
                    return (
                      <div key={key} className="flex flex-col sm:flex-row sm:items-center gap-2.5 bg-slate-900/70 border border-slate-800 rounded-lg p-2.5">
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-slate-200 font-medium truncate">
                            <span className="font-mono text-amber-400">{it.code}</span> — {it.name || '-'}
                          </p>
                          <p className="text-[11px] text-slate-400 mt-0.5">
                            ส่ง {it.qtySent ?? '-'} • รับจริง <strong className="text-amber-400">{it.qtyReceived ?? '-'}</strong>
                            {it.note ? ` • เหตุผล: ${it.note}` : ''}
                          </p>
                          {it.photoUrl && (
                            <a
                              href={it.photoUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-[11px] text-sky-400 hover:text-sky-300 underline mt-1"
                            >
                              <ImageIcon className="w-3 h-3" /> ดูรูปที่แนบ
                            </a>
                          )}
                        </div>
                        <button
                          onClick={() => handleQuickApprove(doc.docNo, it.code)}
                          disabled={approvingKey === key}
                          className="shrink-0 flex items-center justify-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-amber-500 text-slate-950 hover:bg-amber-400 disabled:opacity-50 transition-colors"
                        >
                          {approvingKey === key ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />}
                          อนุมัติ
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Overall Status Table */}
      <div className="glass-panel rounded-2xl p-5 border border-slate-800 shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800/80 mb-3">
          <h2 className="text-sm font-bold text-slate-100 flex items-center gap-2">
            <PackageCheck className="w-4 h-4 text-amber-400" />
            <span>สถานะใบเบิกทั้งหมด{selectedDate ? '' : ' (± 30 วัน)'}</span>
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] px-2.5 py-1 rounded-full bg-sky-500/10 text-sky-400 border border-sky-500/30">
              ยังไม่ดึงข้อมูล: {notFetchedCount}
            </span>
            <span className="text-[11px] px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/30">
              รอรับของ: {notReceivedCount}
            </span>
            <div className="relative">
              <CalendarDays className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="date"
                value={selectedDate}
                onChange={e => setSelectedDate(e.target.value)}
                title="กรองตามวันที่กำหนดส่ง (Ord_DelDate)"
                className="bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-amber-500"
              />
              {selectedDate && (
                <button
                  onClick={() => setSelectedDate('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                  title="ล้างตัวกรองวันที่"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <button
              onClick={() => setSelectedDate(toLocalDateStr(new Date()))}
              className="px-2.5 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-[11px] font-semibold text-slate-400 hover:text-amber-400 hover:border-amber-500/40 transition-colors"
            >
              วันนี้
            </button>
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="ค้นหาเลขที่ใบเบิก/สาขา..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-amber-500 w-52"
              />
            </div>
          </div>
        </div>

        <div className="overflow-x-auto rounded-xl border border-slate-800">
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="bg-slate-900/90 text-slate-400 font-semibold border-b border-slate-800">
              <tr>
                <th className="px-3 py-2.5">เลขที่ใบเบิก</th>
                <th className="px-3 py-2.5">สาขา</th>
                <th className="px-3 py-2.5">กำหนดส่ง</th>
                <th className="px-3 py-2.5 text-center">ดึงข้อมูล</th>
                <th className="px-3 py-2.5 text-center">รับของ</th>
                <th className="px-3 py-2.5 text-center">แก้ไข</th>
                <th className="px-3 py-2.5 text-center">ใบจัดของ</th>
                <th className="px-3 py-2.5 text-center w-12"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {loading ? (
                <tr>
                  <td colSpan="8" className="px-4 py-8 text-center text-slate-500">
                    <Loader2 className="w-5 h-5 animate-spin mx-auto text-amber-400" />
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan="8" className="px-4 py-8 text-center text-slate-500">ไม่พบรายการ</td>
                </tr>
              ) : (
                rows.map((r, idx) => (
                  <tr
                    key={idx}
                    onClick={() => openDoc(r.displayNo, r.branchName)}
                    className="hover:bg-slate-800/40 cursor-pointer transition-colors"
                  >
                    <td className="px-3 py-2.5 font-mono font-bold text-slate-100">{r.displayNo}</td>
                    <td className="px-3 py-2.5 text-amber-300">{r.branchName || '-'}</td>
                    <td className="px-3 py-2.5 text-slate-400">{r.deldate || '-'}</td>
                    <td className="px-3 py-2.5 text-center">
                      {r.isFetched ? (
                        <span className="inline-flex items-center gap-1 text-sky-400">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                        </span>
                      ) : (
                        <button
                          onClick={(e) => handleMarkFetched(r, e)}
                          disabled={markingKey === r.displayNo}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold bg-sky-500/10 text-sky-400 border border-sky-500/30 hover:bg-sky-500/20 disabled:opacity-50 transition-colors"
                          title="บันทึกสถานะดึงข้อมูลแล้ว"
                        >
                          {markingKey === r.displayNo ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <Download className="w-3 h-3" />
                          )}
                          ดึงข้อมูล
                        </button>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      {r.isReceived ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 mx-auto" />
                      ) : (
                        <Clock className="w-3.5 h-3.5 text-amber-400 mx-auto" />
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      {r.hasEdit ? (
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-500 mx-auto" />
                      ) : (
                        <span className="text-slate-600">-</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <button
                        onClick={(e) => handleExportPackingList(r, e)}
                        disabled={exportingKey === r.displayNo}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/20 disabled:opacity-50 transition-colors"
                        title="พิมพ์ใบจัดของเป็นไฟล์ Excel (เรียงตามหมวดหมู่ ไม่มีราคา/มูลค่า)"
                      >
                        {exportingKey === r.displayNo ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <FileSpreadsheet className="w-3 h-3" />
                        )}
                        พิมพ์
                      </button>
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

      {selectedReqModal && (
        <RequisitionDetailModal
          requisition={selectedReqModal}
          onClose={() => setSelectedReqModal(null)}
        />
      )}
    </div>
  );
}
