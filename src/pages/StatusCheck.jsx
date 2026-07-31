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
  FileText
} from 'lucide-react';
import toast from 'react-hot-toast';
import {
  fetchRequisitions,
  fetchReceivedStatus,
  fetchFetchedStatus,
  fetchPendingEditApprovals,
  approveReceivedEdit,
  formatDocNoDisplay
} from '../services/requisitionService';
import RequisitionDetailModal from '../components/RequisitionDetailModal';

export default function StatusCheck({ selectedBranch = 'all' }) {
  const [loading, setLoading] = useState(false);
  const [requisitions, setRequisitions] = useState([]);
  const [receivedStatusMap, setReceivedStatusMap] = useState({});
  const [fetchedStatusMap, setFetchedStatusMap] = useState({});
  const [pendingApprovals, setPendingApprovals] = useState({ count: 0, docs: [] });
  const [approvingKey, setApprovingKey] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedReqModal, setSelectedReqModal] = useState(null);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [reqs, received, fetched, approvals] = await Promise.all([
        fetchRequisitions({ branch: selectedBranch || 'all', dateType: 'deldate', days: 30, daysAhead: 30 }),
        fetchReceivedStatus().catch(() => ({})),
        fetchFetchedStatus().catch(() => ({})),
        fetchPendingEditApprovals().catch(() => ({ count: 0, docs: [] }))
      ]);
      setRequisitions(reqs || []);
      setReceivedStatusMap(received || {});
      setFetchedStatusMap(fetched || {});
      setPendingApprovals(approvals || { count: 0, docs: [] });
    } catch (err) {
      console.error("StatusCheck loadAll error:", err);
      toast.error("โหลดข้อมูลสถานะไม่สำเร็จ (เชื่อมต่อฐานข้อมูลไม่ได้) กรุณาลองใหม่");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBranch]);

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
        const isFetched = req.dataFetched || Boolean(fetchedStatusMap[displayNo]);
        return { ...req, displayNo, isReceived, hasEdit: Boolean(receivedInfo?.hasEdit), isFetched };
      })
      .filter(r => {
        if (!searchQuery) return true;
        const q = searchQuery.toLowerCase();
        return r.displayNo.toLowerCase().includes(q) || String(r.branchName || '').toLowerCase().includes(q);
      });
  }, [requisitions, receivedStatusMap, fetchedStatusMap, searchQuery]);

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
            <span>สถานะใบเบิกทั้งหมด (± 30 วัน)</span>
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] px-2.5 py-1 rounded-full bg-sky-500/10 text-sky-400 border border-sky-500/30">
              ยังไม่ดึงข้อมูล: {notFetchedCount}
            </span>
            <span className="text-[11px] px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/30">
              รอรับของ: {notReceivedCount}
            </span>
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
                <th className="px-3 py-2.5 text-center w-12"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {loading ? (
                <tr>
                  <td colSpan="7" className="px-4 py-8 text-center text-slate-500">
                    <Loader2 className="w-5 h-5 animate-spin mx-auto text-amber-400" />
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan="7" className="px-4 py-8 text-center text-slate-500">ไม่พบรายการ</td>
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
                        <CheckCircle2 className="w-3.5 h-3.5 text-sky-400 mx-auto" />
                      ) : (
                        <span className="text-slate-600">-</span>
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
