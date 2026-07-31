import React, { useState, useEffect, useMemo } from 'react';
import {
  X,
  FileText,
  Calendar,
  Building2,
  User,
  Printer,
  Download,
  PackageCheck,
  Clock,
  Hash,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Loader2,
  FileSpreadsheet,
  Filter,
  Layers,
  ListOrdered,
  ImageIcon,
  ShieldCheck
} from 'lucide-react';
import toast from 'react-hot-toast';
import {
  fetchRequisitionDetail,
  formatDocNoDisplay,
  fetchFulfillmentItemsDetail,
  fetchReceivedItemsDetail,
  approveReceivedEdit
} from '../services/requisitionService';
import {
  getCategoryOrderMap,
  sortCategoryNames,
  getCategoryRank,
  formatCategoryLabel,
  isVegetableOnlyItems
} from '../services/categoryService';
import CategoryOrderModal from './CategoryOrderModal';

export default function RequisitionDetailModal({ requisition, onClose }) {
  const [loading, setLoading] = useState(false);
  const [details, setDetails] = useState(requisition);
  const [selectedCategory, setSelectedCategory] = useState('ALL');
  const [categoryOrderMap, setCategoryOrderMap] = useState(() => getCategoryOrderMap());
  const [showOrderModal, setShowOrderModal] = useState(false);

  // จำนวนที่ส่งจริง (จากชีท "จัดของ") และจำนวน/สาเหตุที่สาขารับจริง (จากชีท "รับของ") — คีย์ด้วยรหัสสินค้า
  const [fulfillmentByCode, setFulfillmentByCode] = useState({});
  const [receivedByCode, setReceivedByCode] = useState({});
  const [approvingCode, setApprovingCode] = useState(null);
  const [justApproved, setJustApproved] = useState({}); // code -> true, สะท้อนผลทันทีหลังกดอนุมัติสำเร็จ

  // Listen for category order updates
  useEffect(() => {
    const handleOrderChange = () => {
      setCategoryOrderMap(getCategoryOrderMap());
    };
    window.addEventListener('categoryOrderChanged', handleOrderChange);
    return () => window.removeEventListener('categoryOrderChanged', handleOrderChange);
  }, []);

  // Merged entries (same-branch, same-day, non-vegetable requisitions combined by the Calendar
  // page) already carry their combined item list — skip re-fetching by a single docNo, which
  // would overwrite the merge with just one constituent document's items.
  useEffect(() => {
    if (requisition?.isMerged) {
      setDetails(requisition);
      return;
    }
    if (requisition?.no || requisition?.invNo) {
      // Prefer rawNo (the real numeric Ord_No) when available — branch codes like "P90" or "ZK3"
      // contain digits, and fetchRequisitionDetail strips non-digit chars from a plain docNo
      // string, so a formatted "P90-4913" would otherwise corrupt into the wrong order "904913".
      const docNo = requisition.rawNo ?? (requisition.no || requisition.invNo);
      setLoading(true);
      fetchRequisitionDetail(docNo, requisition.outletId)
        .then(res => {
          if (res && res.items) {
            setDetails(prev => ({
              ...prev,
              items: res.items
            }));
          }
        })
        .catch(err => {
          console.warn("Could not fetch extra item details:", err);
        })
        .finally(() => setLoading(false));
    }
  }, [requisition]);

  // Cross-reference จำนวนที่ส่งจริง (ชีท "จัดของ") และจำนวน/สาเหตุที่สาขารับ (ชีท "รับของ") ต่อรายการ.
  // For a merged entry, do this per constituent docNo and combine the maps (item codes normally
  // don't repeat across the source documents, so a later doc's entry simply adding in is fine).
  useEffect(() => {
    if (!requisition) return;

    setJustApproved({});

    const docNos = requisition.isMerged && Array.isArray(requisition.mergedFromDocs) && requisition.mergedFromDocs.length > 0
      ? requisition.mergedFromDocs
      : [requisition.displayNo || formatDocNoDisplay(requisition.invNo || requisition.no, requisition.branchCode)];

    Promise.all(docNos.filter(d => d && d !== '-').map(d => fetchFulfillmentItemsDetail(d).catch(err => {
      console.warn("Could not fetch fulfillment (จัดของ) detail:", d, err);
      return {};
    })))
      .then(maps => setFulfillmentByCode(Object.assign({}, ...maps)));

    // Tag each entry with the docNo it actually came from, so approving an edit on a merged
    // view writes back to the right underlying document (the "รับของ" sheet is keyed per real docNo).
    Promise.all(docNos.filter(d => d && d !== '-').map(d =>
      fetchReceivedItemsDetail(d)
        .then(map => ({ docNo: d, map }))
        .catch(err => {
          console.warn("Could not fetch received (รับของ) detail:", d, err);
          return { docNo: d, map: {} };
        })
    ))
      .then(results => {
        const merged = {};
        results.forEach(({ docNo, map }) => {
          Object.entries(map || {}).forEach(([code, val]) => {
            merged[code] = { ...val, _sourceDocNo: docNo };
          });
        });
        setReceivedByCode(merged);
      });
  }, [requisition]);

  // คลังกดอนุมัติรายการที่สาขาแจ้งว่าแก้ไขจำนวนตอนรับของ (สถานะ "แก้ไข" ในชีท "รับของ")
  // On a merged view, approve against the item's actual source document, not the combined label.
  const handleApproveEdit = async (code) => {
    const docNo = receivedByCode[code]?._sourceDocNo
      || requisition.displayNo
      || formatDocNoDisplay(requisition.invNo || requisition.no, requisition.branchCode);
    setApprovingCode(code);
    try {
      await approveReceivedEdit({ docNo, code, approvedBy: 'โกดัง' });
      setJustApproved(prev => ({ ...prev, [code]: true }));
      toast.success('อนุมัติรายการเรียบร้อยแล้ว');
    } catch (err) {
      toast.error(err.message || 'อนุมัติไม่สำเร็จ');
    } finally {
      setApprovingCode(null);
    }
  };

  if (!requisition) return null;

  const req = details || requisition;
  const rawItems = req.items || [];

  // Merge in "จำนวนที่ส่ง" (ชีท จัดของ) และ "จำนวนที่สาขารับ" + เหตุผล/รูปที่แนบ (ชีท รับของ) ต่อรายการ
  const enrichedItems = useMemo(() => {
    return rawItems.map(it => {
      const code = String(it.itemCode || it.itemId || '').trim();
      const cleanCode = code.replace(/^0+/, '');
      const sent = fulfillmentByCode[code] || fulfillmentByCode[cleanCode];
      const received = receivedByCode[code] || receivedByCode[cleanCode];
      return {
        ...it,
        qtySent: sent ? sent.qtySent : null,
        qtyReceived: received ? received.qtyReceived : null,
        receiveStatus: received ? received.status : null,
        receiveNote: received ? received.note : '',
        receivePhotoUrl: received ? received.photoUrl : '',
        receiveApprovedBy: received ? received.approvedBy : '',
        receiveApprovedAt: received ? received.approvedAt : ''
      };
    });
  }, [rawItems, fulfillmentByCode, receivedByCode]);

  // Extract unique categories from items (Col N from Google Sheet) sorted by sequence number
  const availableCategories = useMemo(() => {
    const set = new Set();
    enrichedItems.forEach(it => {
      if (it.category) set.add(it.category);
    });
    return sortCategoryNames(Array.from(set), categoryOrderMap);
  }, [enrichedItems, categoryOrderMap]);

  // Sort enrichedItems by Category Sequence Rank first, then itemCode/itemName
  const sortedItems = useMemo(() => {
    return [...enrichedItems].sort((a, b) => {
      const catA = a.category || 'อื่นๆ';
      const catB = b.category || 'อื่นๆ';
      const rankA = getCategoryRank(catA, categoryOrderMap);
      const rankB = getCategoryRank(catB, categoryOrderMap);
      if (rankA !== rankB) return rankA - rankB;
      return (a.itemCode || '').localeCompare(b.itemCode || '', 'th');
    });
  }, [enrichedItems, categoryOrderMap]);

  // Filter items by selected category
  const filteredItems = useMemo(() => {
    if (selectedCategory === 'ALL') return sortedItems;
    return sortedItems.filter(it => (it.category || 'อื่นๆ') === selectedCategory);
  }, [sortedItems, selectedCategory]);

  const totalQty = filteredItems.reduce((sum, i) => sum + (Number(i.qty) || 0), 0);
  const totalAmt = filteredItems.reduce((sum, i) => sum + (Number(i.amount || (i.qty * i.unitPrice)) || 0), 0);

  // Format docNo as e.g. CRM-3451
  const rawDocNo = req.displayNo || formatDocNoDisplay(req.invNo || req.no, req.branchCode);
  const isVeg = useMemo(() => isVegetableOnlyItems(rawItems), [rawItems]);
  const displayDocNo = isVeg ? `${rawDocNo} (ผัก)` : rawDocNo;

  const handlePrint = () => {
    window.print();
  };

  // Export Excel with items sorted and grouped by Category (xlsx loaded on demand)
  const handleExportExcel = async () => {
    const XLSX = await import('xlsx');
    const wsData = [
      ['รายละเอียดใบเบิกสินค้า (Store Requisition Document)'],
      [`เลขที่ใบเบิก: ${displayDocNo}`, '', `สาขา: ${req.branchName || '-'}`],
      [`วันที่สั่งเบิก: ${req.orderDate || '-'}`, '', `วันที่กำหนดส่ง (Ord_DelDate): ${req.deldate || req.docDate || '-'}`],
      [`ผู้สั่งเบิก: ${req.requester || '-'}`, '', `สถานะ: ${req.status || '-'}`],
      [`หมวดหมู่ที่เลือก: ${selectedCategory === 'ALL' ? 'ทุกหมวดหมู่' : selectedCategory}`],
      [],
      ['ลำดับ', 'รหัสสินค้า', 'รายการสินค้า', 'หมวดหมู่สโตร์ (Col N)', 'จำนวน', 'หน่วย', 'ราคา/หน่วย (บาท)', 'มูลค่ารวม (บาท)']
    ];

    // Always export sorted by Category sequence rank
    filteredItems.forEach((it, idx) => {
      const catLabel = formatCategoryLabel(it.category || 'อื่นๆ', categoryOrderMap);
      wsData.push([
        idx + 1,
        it.itemCode || it.itemId || '',
        it.itemName || '',
        catLabel,
        Number(it.qty) || 0,
        it.unit || '',
        Number(it.unitPrice) || 0,
        Number(it.amount || (it.qty * it.unitPrice)) || 0
      ]);
    });

    wsData.push([]);
    wsData.push(['', '', 'รวมทั้งสิ้น', '', totalQty, '', '', totalAmt]);

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    XLSX.utils.book_append_sheet(wb, ws, 'รายละเอียดใบเบิก');
    XLSX.writeFile(wb, `ใบเบิก_${rawDocNo}.xlsx`);
  };

  return (
    <>
      {/* Screen Modal Dialog (Hidden when printing) */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-200 print:hidden">
        <div className="bg-slate-900 border border-slate-700/80 rounded-2xl w-full max-w-5xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden">
          
          {/* Modal Header */}
          <div className="px-6 py-4 bg-slate-950/70 border-b border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20">
                <FileText className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
                  <span>ใบเบิกสินค้า</span>
                  <span className="text-sm px-2.5 py-0.5 rounded-full bg-slate-800 text-amber-400 border border-amber-500/30 font-mono font-bold">
                    {displayDocNo}
                  </span>
                </h2>
                <p className="text-xs text-slate-400">รายละเอียดรายการสินค้าขอเบิกแยกตามหมวดสโตร์ (Google Sheet Col N)</p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handleExportExcel}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 border border-emerald-500/30 text-xs font-semibold transition-colors"
              >
                <FileSpreadsheet className="w-4 h-4" />
                <span>ส่งออก Excel</span>
              </button>
              <button
                onClick={handlePrint}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 text-slate-200 hover:bg-slate-700 border border-slate-700 text-xs font-medium transition-colors"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>พิมพ์ / PDF</span>
              </button>
              <button
                onClick={onClose}
                className="p-1.5 rounded-xl text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors ml-2"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Modal Web Body */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
          
          {/* Status & Document Key Info */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 p-4 rounded-xl bg-slate-950/60 border border-slate-800/80">
            <div>
              <p className="text-[11px] text-slate-400 flex items-center gap-1">
                <Building2 className="w-3 h-3 text-amber-400" /> สาขาที่เบิก
              </p>
              <p className="text-sm font-semibold text-slate-200 mt-0.5">{req.branchName || 'สาขาหลัก'}</p>
            </div>
            <div>
              <p className="text-[11px] text-slate-400 flex items-center gap-1">
                <Calendar className="w-3 h-3 text-sky-400" /> วันที่กำหนดส่ง (Ord_DelDate)
              </p>
              <p className="text-sm font-bold text-sky-400 mt-0.5">{req.deldate || req.docDate || '-'}</p>
            </div>
            <div>
              <p className="text-[11px] text-slate-400 flex items-center gap-1">
                <Clock className="w-3 h-3 text-amber-400" /> วันที่สั่งเบิก (Ord_OrdDate)
              </p>
              <p className="text-sm font-medium text-slate-300 mt-0.5">{req.orderDate || '-'}</p>
            </div>
            <div>
              <p className="text-[11px] text-slate-400">สถานะการรับของ (Ord_Rcv)</p>
              <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold mt-1 ${
                req.received || req.status === 'รับของแล้ว'
                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                  : 'bg-amber-500/10 text-amber-400 border border-amber-500/30'
              }`}>
                {req.received || req.status === 'รับของแล้ว' ? (
                  <><CheckCircle2 className="w-3.5 h-3.5" /> รับของแล้ว</>
                ) : (
                  <><Clock className="w-3.5 h-3.5" /> รอรับของ</>
                )}
              </span>
            </div>
          </div>

          {/* Category Selector Bar & Header */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-950/70 p-3 rounded-xl border border-slate-800">
              <div className="flex items-center gap-2">
                <PackageCheck className="w-4 h-4 text-amber-500" />
                <h3 className="text-sm font-bold text-slate-200">
                  รายการสินค้าขอเบิก ({filteredItems.length} / {rawItems.length} รายการ)
                </h3>
                {loading && (
                  <span className="text-xs text-amber-400 flex items-center gap-1 animate-pulse ml-2">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" /> กำลังโหลด...
                  </span>
                )}
              </div>

              {/* Category Dropdown Filter & Priority Button */}
              <div className="flex items-center gap-2 no-print">
                <span className="text-xs text-slate-400 flex items-center gap-1">
                  <Filter className="w-3.5 h-3.5 text-amber-400" /> เลือกหมวดหมู่:
                </span>
                <select
                  value={selectedCategory}
                  onChange={(e) => setSelectedCategory(e.target.value)}
                  className="bg-slate-800 text-slate-100 text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-700 focus:outline-none focus:border-amber-500 transition-colors cursor-pointer"
                >
                  <option value="ALL">📦 ทุกหมวดหมู่ ({rawItems.length})</option>
                  {availableCategories.map(cat => {
                    const count = rawItems.filter(i => (i.category || 'อื่นๆ') === cat).length;
                    const label = formatCategoryLabel(cat, categoryOrderMap);
                    return (
                      <option key={cat} value={cat}>
                        🏷️ {label} ({count})
                      </option>
                    );
                  })}
                </select>

                <button
                  onClick={() => setShowOrderModal(true)}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/30 text-xs font-semibold transition-colors"
                  title="ตั้งค่าตัวเลขลำดับการแสดงผลหมวดหมู่"
                >
                  <ListOrdered className="w-3.5 h-3.5" />
                  <span>จัดลำดับ</span>
                </button>
              </div>
            </div>

            {/* Line Items Table */}
            <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950/40">
              <table className="w-full text-left text-xs text-slate-300">
                <thead className="bg-slate-900/90 text-slate-400 font-semibold border-b border-slate-800">
                  <tr>
                    <th className="px-3 py-2.5 text-center w-12">#</th>
                    <th className="px-3 py-2.5">รหัสสินค้า</th>
                    <th className="px-4 py-2.5">ชื่อสินค้า / รายการ</th>
                    <th className="px-3 py-2.5">หมวดหมู่สโตร์</th>
                    <th className="px-3 py-2.5 text-right">จำนวนเบิก</th>
                    <th className="px-3 py-2.5 text-right text-sky-400 bg-sky-500/5">จำนวนที่ส่ง</th>
                    <th className="px-3 py-2.5 text-right text-teal-400 bg-teal-500/5">จำนวนที่สาขารับ</th>
                    <th className="px-3 py-2.5 text-center">หน่วย</th>
                    <th className="px-3 py-2.5 text-right">ราคา/หน่วย</th>
                    <th className="px-4 py-2.5 text-right">รวมมูลค่า</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {filteredItems.length === 0 ? (
                    <tr>
                      <td colSpan="10" className="px-4 py-8 text-center text-slate-500">
                        ไม่พบรายการสินค้าในหมวดหมู่นี้
                      </td>
                    </tr>
                  ) : (
                    (() => {
                      let lastCat = null;
                      return filteredItems.map((it, idx) => {
                        const qty = Number(it.qty) || 0;
                        const price = Number(it.unitPrice) || 0;
                        const amt = Number(it.amount || (qty * price)) || 0;
                        const currentCat = it.category || 'อื่นๆ';
                        const catLabel = formatCategoryLabel(currentCat, categoryOrderMap);
                        const isNewCategoryHeader = selectedCategory === 'ALL' && currentCat !== lastCat;
                        if (isNewCategoryHeader) {
                          lastCat = currentCat;
                        }

                        const catCount = filteredItems.filter(i => (i.category || 'อื่นๆ') === currentCat).length;

                        const code = String(it.itemCode || it.itemId || '').trim();
                        const hasEditPending = it.receiveStatus === 'แก้ไข' && !it.receiveApprovedAt && !justApproved[code];
                        const isApproved = Boolean(it.receiveApprovedAt) || justApproved[code];

                        return (
                          <React.Fragment key={idx}>
                            {isNewCategoryHeader && (
                              <tr className="bg-slate-900/90 border-t border-b border-amber-500/30 print:bg-slate-100">
                                <td colSpan="10" className="px-4 py-2 bg-slate-950/70 border-l-4 border-amber-500">
                                  <div className="flex items-center justify-between">
                                    <span className="font-bold text-amber-400 font-mono text-xs flex items-center gap-1.5 print:text-black">
                                      📦 {catLabel}
                                    </span>
                                    <span className="text-[11px] text-slate-400 font-normal print:text-black">
                                      {catCount} รายการ
                                    </span>
                                  </div>
                                </td>
                              </tr>
                            )}
                            <tr className={`hover:bg-slate-800/40 transition-colors ${hasEditPending ? 'bg-amber-500/5' : ''}`}>
                              <td className="px-3 py-2.5 text-center font-mono text-slate-500">{idx + 1}</td>
                              <td className="px-3 py-2.5 font-mono text-amber-400 font-medium">
                                <span className="inline-flex items-center gap-1.5">
                                  {code || '-'}
                                  {hasEditPending && <AlertTriangle className="w-3.5 h-3.5 text-amber-500" title="สาขาแก้ไขจำนวนตอนรับของ รอโกดังอนุมัติ" />}
                                </span>
                              </td>
                              <td className="px-4 py-2.5 text-slate-100 font-medium">{it.itemName || '-'}</td>
                              <td className="px-3 py-2.5">
                                <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-slate-800 text-amber-400 border border-slate-700 font-mono">
                                  {catLabel}
                                </span>
                              </td>
                              <td className="px-3 py-2.5 text-right font-bold text-amber-300">{qty.toLocaleString()}</td>
                              <td className="px-3 py-2.5 text-right font-mono text-sky-300 bg-sky-500/5">
                                {it.qtySent !== null && it.qtySent !== undefined ? it.qtySent.toLocaleString() : <span className="text-slate-600">-</span>}
                              </td>
                              <td className={`px-3 py-2.5 text-right font-mono bg-teal-500/5 ${hasEditPending ? 'text-amber-400 font-bold' : 'text-teal-300'}`}>
                                {it.qtyReceived !== null && it.qtyReceived !== undefined ? it.qtyReceived.toLocaleString() : <span className="text-slate-600">-</span>}
                              </td>
                              <td className="px-3 py-2.5 text-center text-slate-400">{it.unit || '-'}</td>
                              <td className="px-3 py-2.5 text-right font-mono text-slate-300">฿{price.toFixed(2)}</td>
                              <td className="px-4 py-2.5 text-right font-mono font-bold text-emerald-400">฿{amt.toFixed(2)}</td>
                            </tr>
                            {hasEditPending && (
                              <tr className="bg-amber-500/5 no-print">
                                <td colSpan="10" className="px-4 pb-3 pt-0">
                                  <div className="flex flex-col sm:flex-row sm:items-center gap-3 bg-slate-950/80 border border-amber-500/40 rounded-xl p-3">
                                    <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0" />
                                    <div className="flex-1 min-w-0 space-y-1">
                                      <p className="text-xs text-amber-300 font-semibold">
                                        สาขาแจ้งรับของไม่ตรง — ส่ง {it.qtySent ?? '-'} รับจริง {it.qtyReceived ?? '-'}
                                      </p>
                                      {it.receiveNote && (
                                        <p className="text-xs text-slate-300">เหตุผล: {it.receiveNote}</p>
                                      )}
                                      {it.receivePhotoUrl && (
                                        <a
                                          href={it.receivePhotoUrl}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="inline-flex items-center gap-1 text-xs text-sky-400 hover:text-sky-300 underline"
                                        >
                                          <ImageIcon className="w-3.5 h-3.5" /> ดูรูปที่แนบ
                                        </a>
                                      )}
                                    </div>
                                    <button
                                      onClick={() => handleApproveEdit(code)}
                                      disabled={approvingCode === code}
                                      className="shrink-0 flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-amber-500 text-slate-950 hover:bg-amber-400 disabled:opacity-50"
                                    >
                                      {approvingCode === code ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />}
                                      ยืนยันอนุมัติ
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            )}
                            {isApproved && it.receiveStatus === 'แก้ไข' && (
                              <tr className="bg-emerald-500/5 no-print">
                                <td colSpan="10" className="px-4 pb-2 pt-0">
                                  <p className="text-[11px] text-emerald-400 flex items-center gap-1.5 pl-1">
                                    <CheckCircle2 className="w-3.5 h-3.5" />
                                    โกดังอนุมัติรายการนี้แล้ว{it.receiveApprovedAt ? ` เมื่อ ${it.receiveApprovedAt}` : ''}
                                  </p>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      });
                    })()
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Modal Footer Summary */}
        <div className="px-6 py-4 bg-slate-950/80 border-t border-slate-800 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-6 text-xs text-slate-400">
            <div>
              <span>หมวดหมู่ที่เลือก: </span>
              <strong className="text-amber-400 font-semibold">{selectedCategory === 'ALL' ? 'ทุกหมวดหมู่' : selectedCategory}</strong>
            </div>
            <div>
              <span>รายการทั้งหมด: </span>
              <strong className="text-slate-200">{filteredItems.length}</strong> รายการ
            </div>
            <div>
              <span>จำนวนชิ้นรวม: </span>
              <strong className="text-amber-400">{totalQty.toLocaleString()}</strong> ชิ้น
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-400">รวมมูลค่าทั้งสิ้น:</span>
            <span className="text-lg font-bold text-emerald-400 font-mono">
              ฿{totalAmt.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
            </span>
          </div>
        </div>

      </div>
    </div>

    {/* Dedicated Printable Requisition Voucher Layout (Active exclusively during print) */}
    <div className="hidden print:block font-sans text-black p-4 w-full bg-white leading-normal">
        {/* Paper Document Header */}
        <div className="border-b-2 border-black pb-3 mb-4">
          <div className="flex justify-between items-start">
            <div>
              <h1 className="text-xl font-bold text-black tracking-tight">ใบเบิกสินค้า (Store Requisition Voucher)</h1>
              <p className="text-sm font-bold text-black mt-1">
                เลขที่ใบเบิก: <span className="font-mono text-base font-bold">{displayDocNo}</span>
              </p>
            </div>
            <div className="text-right text-xs text-black leading-relaxed">
              <p><strong>สาขาที่เบิก:</strong> {req.branchName || 'สาขาหลัก'}</p>
              <p><strong>วันที่สั่งเบิก:</strong> {req.orderDate || '-'}</p>
              <p><strong>วันที่กำหนดส่ง:</strong> {req.deldate || req.docDate || '-'}</p>
              <p><strong>สถานะการรับของ:</strong> {req.received || req.status === 'รับของแล้ว' ? 'รับของแล้ว' : 'รอรับของ'}</p>
              <p className="text-[10px] text-gray-500 mt-1">วันที่พิมพ์: {new Date().toLocaleDateString('th-TH')} {new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}</p>
            </div>
          </div>
        </div>

        {/* Clean Items Table */}
        <table className="w-full text-left text-xs border-collapse border border-black mb-4">
          <thead>
            <tr className="bg-gray-100 border-b border-black text-black font-bold">
              <th className="p-2 text-center border border-black w-10">#</th>
              <th className="p-2 border border-black whitespace-nowrap">รหัสสินค้า</th>
              <th className="p-2 border border-black">ชื่อสินค้า / รายการ</th>
              <th className="p-2 border border-black whitespace-nowrap">หมวดหมู่</th>
              <th className="p-2 text-right border border-black whitespace-nowrap">จำนวนเบิก</th>
              <th className="p-2 text-center border border-black w-14">หน่วย</th>
              <th className="p-2 text-right border border-black whitespace-nowrap">ราคา/หน่วย</th>
              <th className="p-2 text-right border border-black whitespace-nowrap">รวมมูลค่า</th>
            </tr>
          </thead>
          <tbody>
            {(() => {
              let lastCat = null;
              return filteredItems.map((it, idx) => {
                const qty = Number(it.qty) || 0;
                const price = Number(it.unitPrice) || 0;
                const amt = Number(it.amount || (qty * price)) || 0;
                const currentCat = it.category || 'อื่นๆ';
                const catLabel = formatCategoryLabel(currentCat, categoryOrderMap);
                const isNewCatHeader = selectedCategory === 'ALL' && currentCat !== lastCat;
                if (isNewCatHeader) {
                  lastCat = currentCat;
                }
                const catCount = filteredItems.filter(i => (i.category || 'อื่นๆ') === currentCat).length;

                return (
                  <React.Fragment key={`print-${idx}`}>
                    {isNewCatHeader && (
                      <tr className="bg-gray-200 border-t-2 border-b border-black font-bold text-black">
                        <td colSpan="8" className="p-2 bg-gray-200 border border-black text-xs font-bold">
                          📦 {catLabel} ({catCount} รายการ)
                        </td>
                      </tr>
                    )}
                    <tr className="border-b border-gray-300">
                      <td className="p-2 text-center border border-gray-300 font-mono text-[11px]">{idx + 1}</td>
                      <td className="p-2 border border-gray-300 font-mono font-bold whitespace-nowrap">{it.itemCode || it.itemId || '-'}</td>
                      <td className="p-2 border border-gray-300 font-medium">{it.itemName || '-'}</td>
                      <td className="p-2 border border-gray-300 whitespace-nowrap">{catLabel}</td>
                      <td className="p-2 text-right border border-gray-300 font-bold">{qty.toLocaleString()}</td>
                      <td className="p-2 text-center border border-gray-300">{it.unit || '-'}</td>
                      <td className="p-2 text-right border border-gray-300 font-mono">฿{price.toFixed(2)}</td>
                      <td className="p-2 text-right border border-gray-300 font-mono font-bold">฿{amt.toFixed(2)}</td>
                    </tr>
                  </React.Fragment>
                );
              });
            })()}
          </tbody>
          <tfoot>
            <tr className="bg-gray-100 font-bold border-t-2 border-black text-xs">
              <td colSpan="4" className="p-2 border border-black text-right">รวมทั้งสิ้น ({filteredItems.length} รายการ):</td>
              <td className="p-2 border border-black text-right font-bold">{totalQty.toLocaleString()}</td>
              <td className="p-2 border border-black text-center">-</td>
              <td className="p-2 border border-black text-right">-</td>
              <td className="p-2 border border-black text-right font-mono font-bold">฿{totalAmt.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</td>
            </tr>
          </tfoot>
        </table>

        {/* Paper Signatures */}
        <div className="mt-8 pt-4 grid grid-cols-3 gap-6 text-center text-xs border-t border-gray-300">
          <div>
            <p className="font-semibold mb-6">ผู้สั่งเบิกสินค้า</p>
            <p>ลงชื่อ ...........................................................</p>
            <p className="text-[11px] text-gray-600 mt-1">(...........................................................)</p>
            <p className="text-[10px] text-gray-500 mt-1">วันที่ ...../...../..........</p>
          </div>
          <div>
            <p className="font-semibold mb-6">ผู้จัด / จ่ายสินค้า</p>
            <p>ลงชื่อ ...........................................................</p>
            <p className="text-[11px] text-gray-600 mt-1">(...........................................................)</p>
            <p className="text-[10px] text-gray-500 mt-1">วันที่ ...../...../..........</p>
          </div>
          <div>
            <p className="font-semibold mb-6">ผู้ตรวจสอบ / รับสินค้า</p>
            <p>ลงชื่อ ...........................................................</p>
            <p className="text-[11px] text-gray-600 mt-1">(...........................................................)</p>
            <p className="text-[10px] text-gray-500 mt-1">วันที่ ...../...../..........</p>
          </div>
        </div>
      </div>

      {showOrderModal && (
        <CategoryOrderModal
          availableCategories={availableCategories}
          onClose={() => setShowOrderModal(false)}
          onSaved={(newMap) => setCategoryOrderMap(newMap)}
        />
      )}
    </>
  );
}
