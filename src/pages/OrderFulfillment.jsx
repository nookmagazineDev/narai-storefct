import React, { useState, useEffect, useMemo } from 'react';
import {
  CheckSquare,
  Search,
  PackageCheck,
  FileText,
  Calendar,
  Building2,
  Check,
  Edit3,
  XCircle,
  Save,
  Loader2,
  RotateCcw,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Filter,
  ListOrdered,
  FileSpreadsheet
} from 'lucide-react';
import toast from 'react-hot-toast';
import { fetchRequisitions, fetchRequisitionDetail, formatDocNoDisplay, markRequisitionFetched, fetchReceivedStatus } from '../services/requisitionService';
import { getCategoryOrderMap, sortCategoryNames, formatCategoryLabel } from '../services/categoryService';
import { saveFulfillmentData, getLocalFulfillmentRecords } from '../services/fulfillmentService';

export default function OrderFulfillment({ selectedBranch }) {
  const [docSearchInput, setDocSearchInput] = useState('');
  const [pendingOrders, setPendingOrders] = useState([]);
  const [loadingOrders, setLoadingOrders] = useState(false);
  
  const [activeDocNo, setActiveDocNo] = useState(null);
  const [activeRequisition, setActiveRequisition] = useState(null);
  const [items, setItems] = useState([]);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [saving, setSaving] = useState(false);
  const [markingFetched, setMarkingFetched] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState('ALL');
  const [receivedStatusMap, setReceivedStatusMap] = useState({}); // docNo -> { branch, itemCount, hasEdit, lastRecordedAt } — from สาขา's "รับของ" sheet

  const [categoryOrderMap, setCategoryOrderMap] = useState(() => getCategoryOrderMap());

  // Listen for category sequence order changes
  useEffect(() => {
    const handleOrderChange = () => setCategoryOrderMap(getCategoryOrderMap());
    window.addEventListener('categoryOrderChanged', handleOrderChange);
    return () => window.removeEventListener('categoryOrderChanged', handleOrderChange);
  }, []);

  // Fetch pending requisitions for dropdown quick selection
  useEffect(() => {
    let isMounted = true;
    setLoadingOrders(true);
    fetchRequisitions({ branch: selectedBranch || 'all', dateType: 'deldate', days: 30, daysAhead: 30 })
      .then(res => {
        if (isMounted) setPendingOrders(res || []);
      })
      .catch(err => {
        console.warn("Failed to load pending requisitions for fulfillment selector:", err);
        if (isMounted) toast.error("โหลดรายการใบเบิกที่รอดำเนินการไม่สำเร็จ (เชื่อมต่อฐานข้อมูลไม่ได้) กรุณาลองใหม่");
      })
      .finally(() => {
        if (isMounted) setLoadingOrders(false);
      });
    return () => { isMounted = false; };
  }, [selectedBranch]);

  // Fetch which requisitions the branch has already received (not branch-filtered — same sheet for all branches)
  useEffect(() => {
    let isMounted = true;
    fetchReceivedStatus()
      .then(map => { if (isMounted) setReceivedStatusMap(map); })
      .catch(err => console.warn("Failed to load branch receiving status:", err));
    return () => { isMounted = false; };
  }, []);

  // Load requisition detail when activeDocNo changes
  const loadRequisitionByNo = async (targetNo) => {
    if (!targetNo) return;
    const cleanNoStr = String(targetNo).trim();
    if (!cleanNoStr) return;
    const digitsOnly = cleanNoStr.replace(/[^0-9]/g, '');

    // Find matching header info BEFORE fetching, so we can scope the query by branch (outletId)
    // and avoid picking up another branch's requisition that happens to share the same number.
    const matchedHeader = pendingOrders.find(p =>
      String(p.invNo).toUpperCase() === cleanNoStr.toUpperCase() ||
      String(p.no).toUpperCase() === cleanNoStr.toUpperCase() ||
      (digitsOnly && String(p.no).replace(/[^0-9]/g, '') === digitsOnly)
    );

    setLoadingDetail(true);
    try {
      const data = await fetchRequisitionDetail(cleanNoStr, matchedHeader?.outletId || '');
      const finalDocNo = formatDocNoDisplay(data.no || cleanNoStr, matchedHeader?.branchCode || '');
      setActiveDocNo(finalDocNo);

      setActiveRequisition({
        docNo: finalDocNo,
        branchName: matchedHeader?.branchName || 'สาขาหลัก',
        orderDate: matchedHeader?.orderDate || new Date().toISOString().split('T')[0],
        deldate: matchedHeader?.deldate || new Date().toISOString().split('T')[0],
        status: matchedHeader?.status || 'รอจัดส่ง',
        outletId: matchedHeader?.outletId || null,
        rawNo: matchedHeader?.rawNo || null,
        dataFetched: matchedHeader?.dataFetched || false,
        fetchedAt: matchedHeader?.fetchedAt || null
      });

      // Check if we already have local saved fulfillment records for this docNo
      const savedRecord = getLocalFulfillmentRecords(finalDocNo);
      const savedMap = {};
      if (savedRecord && Array.isArray(savedRecord.items)) {
        savedRecord.items.forEach(it => {
          savedMap[it.code] = it;
        });
      }

      // Format items with fulfillment state (qty, delQty, status)
      const mappedItems = (data.items || []).map(it => {
        const reqQty = Number(it.qty) || 0;
        const code = it.itemCode || it.itemId;
        const prev = savedMap[code];

        const initialDelQty = prev !== undefined ? Number(prev.delQty) : reqQty;
        const initialStatus = prev !== undefined ? prev.status : 'ยืนยัน';

        return {
          ...it,
          reqQty: reqQty,
          delQty: initialDelQty,
          status: initialStatus // 'ยืนยัน' | 'แก้ไข' | 'ไม่ได้จัดส่ง'
        };
      });

      setItems(mappedItems);
      toast.success(`โหลดข้อมูลใบเบิกเลขที่ ${finalDocNo} สำเร็จ (${mappedItems.length} รายการ)`);
    } catch (err) {
      console.error("loadRequisitionByNo error:", err);
      toast.error(err.message || `ไม่พบใบเบิกเลขที่ ${targetNo}`);
    } finally {
      setLoadingDetail(false);
    }
  };

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    if (!docSearchInput.trim()) {
      toast.error("กรุณากรอกเลขที่ใบเบิกที่ต้องการค้นหา");
      return;
    }
    loadRequisitionByNo(docSearchInput);
  };

  // Update fulfillment quantity for a specific item
  const handleQuantityChange = (index, newQtyVal) => {
    const parsedQty = parseFloat(newQtyVal);
    const finalQty = isNaN(parsedQty) || parsedQty < 0 ? 0 : parsedQty;

    setItems(prevItems => {
      const next = [...prevItems];
      const target = next[index];
      const reqQty = target.reqQty || 0;

      let newStatus = target.status;
      if (finalQty === 0) {
        newStatus = 'ไม่ได้จัดส่ง';
      } else if (finalQty !== reqQty) {
        newStatus = 'แก้ไข';
      } else {
        newStatus = 'ยืนยัน';
      }

      next[index] = {
        ...target,
        delQty: finalQty,
        status: newStatus
      };
      return next;
    });
  };

  // Quick Action Button per Item
  const handleItemAction = (index, actionType) => {
    setItems(prevItems => {
      const next = [...prevItems];
      const target = next[index];
      const reqQty = target.reqQty || 0;

      if (actionType === 'CONFIRM') {
        next[index] = { ...target, delQty: reqQty, status: 'ยืนยัน' };
      } else if (actionType === 'EDIT') {
        next[index] = { ...target, status: 'แก้ไข' };
      } else if (actionType === 'CANCEL') {
        next[index] = { ...target, delQty: 0, status: 'ไม่ได้จัดส่ง' };
      }
      return next;
    });
  };

  // Batch Action: Confirm All Items
  const handleConfirmAll = () => {
    setItems(prevItems => 
      prevItems.map(it => ({
        ...it,
        delQty: it.reqQty,
        status: 'ยืนยัน'
      }))
    );
    toast.success("ตั้งค่าทุกรายการเป็น 'ยืนยันจัดส่งครบ' เรียบร้อย");
  };

  // Batch Action: Cancel All Items
  const handleCancelAll = () => {
    setItems(prevItems => 
      prevItems.map(it => ({
        ...it,
        delQty: 0,
        status: 'ไม่ได้จัดส่ง'
      }))
    );
    toast.error("ตั้งค่าทุกรายการเป็น 'ไม่ได้จัดส่ง' เรียบร้อย");
  };

  // Mark the active requisition as "ดึงข้อมูลแล้ว" — updates status shown everywhere
  // (this page's dropdown, and the Requisition Calendar list) and logs the event
  // to the "ดึงข้อมูลใบเบิก" sheet tab.
  const handleMarkFetched = async () => {
    if (!activeRequisition?.outletId || !activeRequisition?.rawNo) {
      toast.error("ไม่พบข้อมูลใบเบิกที่ตรงกับระบบ ไม่สามารถอัปเดตสถานะได้");
      return;
    }

    setMarkingFetched(true);
    try {
      const result = await markRequisitionFetched({
        outletId: activeRequisition.outletId,
        rawNo: activeRequisition.rawNo,
        docNo: activeDocNo,
        branch: activeRequisition.branchName,
        date: activeRequisition.deldate || activeRequisition.orderDate
      });

      // Optimistically reflect the new status on this screen right away
      setActiveRequisition(prev => prev ? { ...prev, dataFetched: true, fetchedAt: result.fetchedAt } : prev);
      setPendingOrders(prev => prev.map(p =>
        (p.outletId === activeRequisition.outletId && p.rawNo === activeRequisition.rawNo)
          ? { ...p, dataFetched: true, fetchedAt: result.fetchedAt }
          : p
      ));

      toast.success(`อัปเดตสถานะ "ดึงข้อมูลแล้ว" สำหรับใบเบิก ${activeDocNo} เรียบร้อย`);
    } catch (err) {
      console.error("handleMarkFetched error:", err);
      toast.error(err.message || "อัปเดตสถานะไม่สำเร็จ");
    } finally {
      setMarkingFetched(false);
    }
  };

  // Save Fulfillment Data to Google Sheet
  const handleSaveToGoogleSheet = async () => {
    if (!activeDocNo || items.length === 0) {
      toast.error("กรุณาดึงข้อมูลใบเบิกก่อนทำการบันทึก");
      return;
    }

    setSaving(true);
    const toastId = toast.loading("กำลังบันทึกข้อมูลการจัดของลง Google Sheet (ชีท: จัดของ)...");

    try {
      const result = await saveFulfillmentData({
        docNo: activeDocNo,
        date: activeRequisition?.deldate || activeRequisition?.orderDate || new Date().toISOString().split('T')[0],
        branch: activeRequisition?.branchName || 'สาขาหลัก',
        items: items
      });

      toast.success(`บันทึกข้อมูลการจัดของเรียบร้อยแล้ว (${result.count} รายการ)`, { id: toastId, duration: 4000 });
    } catch (err) {
      console.error("handleSaveToGoogleSheet error:", err);
      toast.error(err.message || "เกิดข้อผิดพลาดในการบันทึกข้อมูล", { id: toastId });
    } finally {
      setSaving(false);
    }
  };

  // Extract available categories & sort items by custom category sequence rank
  const availableCategories = useMemo(() => {
    const setCat = new Set(items.map(i => i.category || 'อื่นๆ'));
    return Array.from(setCat);
  }, [items]);

  const sortByCategoryThenName = (list) => {
    return [...list].sort((a, b) => {
      const catA = a.category || 'อื่นๆ';
      const catB = b.category || 'อื่นๆ';
      if (catA !== catB) {
        const sortedCats = sortCategoryNames([catA, catB], categoryOrderMap);
        return sortedCats[0] === catA ? -1 : 1;
      }
      return (a.itemName || '').localeCompare(b.itemName || '', 'th');
    });
  };

  const sortedItems = useMemo(() => {
    let filtered = items;
    if (selectedCategory !== 'ALL') {
      filtered = items.filter(i => (i.category || 'อื่นๆ') === selectedCategory);
    }
    return sortByCategoryThenName(filtered);
  }, [items, selectedCategory, categoryOrderMap]);

  // Export the full item list (ignores the on-screen category filter — a picking list should
  // always cover everything) as an Excel "ใบจัดของ" — qty/category only, no price/value columns.
  const handleExportPackingList = async () => {
    if (!activeDocNo || items.length === 0) {
      toast.error("กรุณาดึงข้อมูลใบเบิกก่อนพิมพ์ใบจัดของ");
      return;
    }

    const XLSX = await import('xlsx');
    const exportItems = sortByCategoryThenName(items);

    const wsData = [
      ['ใบจัดของ (Packing List)'],
      [`เลขที่ใบเบิก: ${activeDocNo}`, '', `สาขา: ${activeRequisition?.branchName || '-'}`],
      [`วันที่กำหนดส่ง: ${activeRequisition?.deldate || '-'}`, '', `วันที่สั่งเบิก: ${activeRequisition?.orderDate || '-'}`],
      [],
      ['ลำดับ', 'รหัสสินค้า', 'ชื่อสินค้า', 'หมวดหมู่', 'จำนวนเบิก', 'จำนวนส่งจริง', 'หน่วย', 'สถานะการจัด']
    ];

    exportItems.forEach((it, idx) => {
      const catLabel = formatCategoryLabel(it.category || 'อื่นๆ', categoryOrderMap);
      wsData.push([
        idx + 1,
        it.itemCode || it.itemId || '',
        it.itemName || '',
        catLabel,
        Number(it.reqQty) || 0,
        Number(it.delQty) || 0,
        it.unit || '',
        it.status || ''
      ]);
    });

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    XLSX.utils.book_append_sheet(wb, ws, 'ใบจัดของ');
    XLSX.writeFile(wb, `ใบจัดของ_${activeDocNo}.xlsx`);
  };

  // Statistics
  const confirmedCount = items.filter(i => i.status === 'ยืนยัน').length;
  const editedCount = items.filter(i => i.status === 'แก้ไข').length;
  const cancelledCount = items.filter(i => i.status === 'ไม่ได้จัดส่ง').length;

  return (
    <div className="space-y-6 pb-24 font-['Prompt',sans-serif]">
      {/* Top Banner Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-6 rounded-2xl bg-gradient-to-r from-slate-900 via-slate-900/90 to-slate-950 border border-slate-800 shadow-xl">
        <div className="flex items-center gap-4">
          <div className="p-3.5 rounded-2xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shadow-inner">
            <CheckSquare className="w-7 h-7 stroke-[2.2]" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-100 flex items-center gap-3">
              <span>จัดของตามใบเบิกสินค้า (Order Fulfillment)</span>
              <span className="text-xs px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-semibold border border-emerald-500/30">
                ชีท: จัดของ
              </span>
            </h1>
            <p className="text-xs text-slate-400 mt-1">
              กรอกเลขที่ใบเบิก ตรวจสอบและแก้ไขจำนวนจัดส่งจริง แล้วกดยืนยันบันทึกข้อมูลเข้า Google Sheet
            </p>
          </div>
        </div>

        {/* Link to view Google Sheet */}
        <a
          href="https://docs.google.com/spreadsheets/d/1bxohT8wK4ySAJgqGHEg9JHp0KJJKG7SVUEhJksBgBSI/edit?gid=0#gid=0"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-emerald-400 border border-emerald-500/30 text-xs font-semibold transition-colors shrink-0"
        >
          <ExternalLink className="w-4 h-4" />
          <span>เปิด Google Sheet (จัดของ)</span>
        </a>
      </div>

      {/* Document Lookup & Selector Bar */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Form 1: Direct Doc Number Input Search */}
        <form onSubmit={handleSearchSubmit} className="md:col-span-2 p-4 rounded-xl bg-slate-900 border border-slate-800 flex flex-col sm:flex-row items-center gap-3">
          <div className="flex-1 w-full relative">
            <input
              type="text"
              placeholder="กรอกเลขที่ใบเบิก (เช่น XUM-5499 หรือ 5499)..."
              value={docSearchInput}
              onChange={(e) => setDocSearchInput(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 text-slate-100 text-sm rounded-xl pl-10 pr-4 py-2.5 focus:outline-none focus:border-amber-500 transition-colors font-medium placeholder-slate-500"
            />
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          </div>
          <button
            type="submit"
            disabled={loadingDetail}
            className="w-full sm:w-auto flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-sm transition-all shadow-md shadow-amber-500/20 shrink-0 disabled:opacity-50"
          >
            {loadingDetail ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Search className="w-4 h-4" />
            )}
            <span>ดึงข้อมูลใบเบิก</span>
          </button>
        </form>

        {/* Dropdown Quick Select: Pending Requisitions */}
        <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 flex items-center gap-3">
          <div className="w-full space-y-1">
            <label className="text-[11px] text-slate-400 block font-medium">หรือเลือกจากใบเบิกที่รอดำเนินการ:</label>
            <select
              disabled={loadingOrders}
              onChange={(e) => {
                if (e.target.value) loadRequisitionByNo(e.target.value);
              }}
              className="w-full bg-slate-950 border border-slate-700 text-amber-300 text-xs rounded-xl px-3 py-2 focus:outline-none focus:border-amber-500 font-medium cursor-pointer"
            >
              <option value="">
                {loadingOrders
                  ? '-- กำลังโหลดรายการใบเบิก... --'
                  : pendingOrders.length === 0
                  ? '-- ไม่พบใบเบิกที่รอดำเนินการ (ลองเปลี่ยนสาขา หรือกดโหลดใหม่) --'
                  : `-- เลือกใบเบิกในระบบ (${pendingOrders.length} ใบ) --`}
              </option>
              {pendingOrders.map(p => (
                <option key={p.no} value={p.no}>
                  {p.dataFetched ? '✅ ' : ''}{receivedStatusMap[p.invNo] ? '📦 ' : ''}{p.invNo || p.no} ({p.branchName}) - {p.itemCount} รายการ - รับของ: {p.deldate || '-'}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Main Order Content Area */}
      {loadingDetail ? (
        <div className="p-12 rounded-2xl bg-slate-900 border border-slate-800 text-center space-y-3">
          <Loader2 className="w-8 h-8 text-amber-500 animate-spin mx-auto" />
          <p className="text-sm font-semibold text-slate-300">กำลังดึงข้อมูลรายการสินค้าเบิก...</p>
        </div>
      ) : !activeDocNo ? (
        <div className="p-12 rounded-2xl bg-slate-900/60 border border-dashed border-slate-800 text-center space-y-3">
          <FileText className="w-12 h-12 text-slate-600 mx-auto" />
          <h3 className="text-base font-bold text-slate-300">ยังไม่ได้เลือกใบเบิก</h3>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            โปรดกรอกเลขที่ใบเบิกในช่องค้นหาด้านบน หรือเลือกใบเบิกจากรายการรอดำเนินการเพื่อเริ่มจัดของ
          </p>
        </div>
      ) : (
        <div className="space-y-4 animate-in fade-in duration-200">
          
          {/* Active Requisition Document Info Banner */}
          <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-4">
              <div className="flex items-center gap-3">
                <div className="px-3 py-1.5 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20 font-mono font-bold text-base">
                  {activeDocNo}
                </div>
                <div>
                  <h2 className="text-base font-bold text-slate-100 flex items-center gap-2">
                    <span>{activeRequisition?.branchName || 'สาขาหลัก'}</span>
                  </h2>
                  <p className="text-xs text-slate-400">
                    กำหนดส่ง: <span className="text-sky-400 font-semibold">{activeRequisition?.deldate || '-'}</span> | สั่งเมื่อ: <span className="text-slate-300">{activeRequisition?.orderDate || '-'}</span>
                  </p>
                </div>

                {/* Mark as "ดึงข้อมูลแล้ว" status */}
                {activeRequisition?.dataFetched ? (
                  <span className="px-3 py-1.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 font-semibold text-xs flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>ดึงข้อมูลแล้ว</span>
                  </span>
                ) : (
                  <button
                    onClick={handleMarkFetched}
                    disabled={markingFetched}
                    className="px-3 py-1.5 rounded-xl bg-sky-500/10 hover:bg-sky-500/20 border border-sky-500/30 text-sky-400 font-semibold text-xs flex items-center gap-1.5 transition-colors disabled:opacity-50"
                  >
                    {markingFetched ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ExternalLink className="w-3.5 h-3.5" />}
                    <span>ดึงข้อมูล</span>
                  </button>
                )}

                {/* Branch receiving status, from the "รับของ" sheet (สาขา's "รับสินค้า" page) */}
                {receivedStatusMap[activeDocNo] && (
                  <span
                    className={`px-3 py-1.5 rounded-xl border font-semibold text-xs flex items-center gap-1.5 ${
                      receivedStatusMap[activeDocNo].hasEdit
                        ? 'bg-amber-500/10 border-amber-500/30 text-amber-400'
                        : 'bg-sky-500/10 border-sky-500/30 text-sky-400'
                    }`}
                    title={`บันทึกล่าสุด: ${receivedStatusMap[activeDocNo].lastRecordedAt || '-'}`}
                  >
                    <PackageCheck className="w-3.5 h-3.5" />
                    <span>
                      สาขารับของแล้ว{receivedStatusMap[activeDocNo].hasEdit ? ' (มีรายการแก้ไข)' : ''}
                    </span>
                  </span>
                )}
              </div>

              {/* Status Counters */}
              <div className="flex items-center gap-3 text-xs">
                <div className="px-3 py-1.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 font-semibold flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>ยืนยันแล้ว: {confirmedCount}</span>
                </div>
                <div className="px-3 py-1.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-400 font-semibold flex items-center gap-1.5">
                  <Edit3 className="w-4 h-4" />
                  <span>แก้ไขจำนวน: {editedCount}</span>
                </div>
                <div className="px-3 py-1.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-400 font-semibold flex items-center gap-1.5">
                  <XCircle className="w-4 h-4" />
                  <span>ไม่ได้ส่ง: {cancelledCount}</span>
                </div>
              </div>
            </div>

            {/* Quick Batch Controls & Category Filter */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400 flex items-center gap-1">
                  <Filter className="w-3.5 h-3.5 text-amber-400" /> กรองหมวดหมู่:
                </span>
                <select
                  value={selectedCategory}
                  onChange={(e) => setSelectedCategory(e.target.value)}
                  className="bg-slate-950 border border-slate-700 text-slate-100 text-xs font-semibold px-3 py-1.5 rounded-lg focus:outline-none focus:border-amber-500 cursor-pointer"
                >
                  <option value="ALL">📦 ทุกหมวดหมู่ ({items.length})</option>
                  {availableCategories.map(cat => {
                    const count = items.filter(i => (i.category || 'อื่นๆ') === cat).length;
                    const label = formatCategoryLabel(cat, categoryOrderMap);
                    return (
                      <option key={cat} value={cat}>
                        🏷️ {label} ({count})
                      </option>
                    );
                  })}
                </select>
              </div>

              {/* Batch Action Buttons */}
              <div className="flex items-center gap-2">
                <button
                  onClick={handleConfirmAll}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-xs font-semibold transition-colors"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>ยืนยันทั้งหมดตามเบิก</span>
                </button>
                <button
                  onClick={handleCancelAll}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 text-xs font-semibold transition-colors"
                >
                  <XCircle className="w-3.5 h-3.5" />
                  <span>ตั้งค่าไม่ได้จัดส่งทั้งหมด</span>
                </button>
                <button
                  onClick={handleExportPackingList}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-sky-500/10 hover:bg-sky-500/20 text-sky-400 border border-sky-500/30 text-xs font-semibold transition-colors"
                  title="ส่งออกใบจัดของเป็นไฟล์ Excel (เรียงตามหมวดหมู่ ไม่มีราคา/มูลค่า)"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5" />
                  <span>พิมพ์ใบจัดของ (Excel)</span>
                </button>
              </div>
            </div>
          </div>

          {/* Line Items Packing Table */}
          <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 shadow-xl">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-300">
                <thead className="bg-slate-950/80 text-slate-400 font-semibold border-b border-slate-800">
                  <tr>
                    <th className="px-3 py-3 text-center w-10">#</th>
                    <th className="px-3 py-3">รหัสสินค้า</th>
                    <th className="px-4 py-3">ชื่อสินค้า / รายการ</th>
                    <th className="px-3 py-3">หมวดหมู่</th>
                    <th className="px-3 py-3 text-right">จำนวนเบิก</th>
                    <th className="px-4 py-3 text-center w-36">จำนวนส่งจริง</th>
                    <th className="px-3 py-3 text-center w-28">สถานะการจัด</th>
                    <th className="px-4 py-3 text-center w-48">การจัดการ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {sortedItems.length === 0 ? (
                    <tr>
                      <td colSpan="8" className="px-4 py-8 text-center text-slate-500">
                        ไม่พบรายการสินค้าในหมวดหมู่นี้
                      </td>
                    </tr>
                  ) : (
                    (() => {
                      let lastCat = null;
                      return sortedItems.map((it, idx) => {
                        const currentCat = it.category || 'อื่นๆ';
                        const catLabel = formatCategoryLabel(currentCat, categoryOrderMap);
                        const isNewCatHeader = selectedCategory === 'ALL' && currentCat !== lastCat;
                        if (isNewCatHeader) {
                          lastCat = currentCat;
                        }
                        const catCount = sortedItems.filter(i => (i.category || 'อื่นๆ') === currentCat).length;

                        // Find original index in `items` array for updates
                        const originalIndex = items.findIndex(orig => (orig.itemCode || orig.itemId) === (it.itemCode || it.itemId));

                        return (
                          <React.Fragment key={it.itemCode || idx}>
                            {isNewCatHeader && (
                              <tr className="bg-slate-950/90 border-t border-b border-amber-500/30">
                                <td colSpan="8" className="px-4 py-2 bg-slate-950/70 border-l-4 border-amber-500">
                                  <div className="flex items-center justify-between">
                                    <span className="font-bold text-amber-400 font-mono text-xs flex items-center gap-1.5">
                                      📦 {catLabel}
                                    </span>
                                    <span className="text-[11px] text-slate-400 font-normal">
                                      {catCount} รายการ
                                    </span>
                                  </div>
                                </td>
                              </tr>
                            )}
                            <tr className={`hover:bg-slate-800/40 transition-colors ${
                              it.status === 'ไม่ได้จัดส่ง' 
                                ? 'bg-rose-950/10' 
                                : it.status === 'แก้ไข' 
                                ? 'bg-amber-950/10' 
                                : ''
                            }`}>
                              <td className="px-3 py-3 text-center font-mono text-slate-500">{idx + 1}</td>
                              <td className="px-3 py-3 font-mono text-amber-400 font-medium">{it.itemCode || it.itemId || '-'}</td>
                              <td className="px-4 py-3 text-slate-100 font-medium">{it.itemName || '-'}</td>
                              <td className="px-3 py-3 text-slate-400 text-[11px]">{catLabel}</td>
                              <td className="px-3 py-3 text-right font-bold text-slate-300">{it.reqQty} <span className="text-[10px] text-slate-500 font-normal">{it.unit || ''}</span></td>
                              
                              {/* Quantity Delivered Input */}
                              <td className="px-4 py-2.5 text-center">
                                <div className="flex items-center justify-center gap-1">
                                  <input
                                    type="number"
                                    min="0"
                                    step="any"
                                    value={it.delQty}
                                    onChange={(e) => handleQuantityChange(originalIndex, e.target.value)}
                                    className={`w-24 bg-slate-950 border text-center font-mono font-bold text-sm rounded-xl py-1.5 px-2 focus:outline-none transition-all ${
                                      it.status === 'ไม่ได้จัดส่ง'
                                        ? 'border-rose-500/50 text-rose-400'
                                        : it.status === 'แก้ไข'
                                        ? 'border-amber-500/60 text-amber-300 ring-1 ring-amber-500/40'
                                        : 'border-emerald-500/40 text-emerald-400'
                                    }`}
                                  />
                                </div>
                              </td>

                              {/* Status Badge */}
                              <td className="px-3 py-3 text-center">
                                <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold ${
                                  it.status === 'ไม่ได้จัดส่ง'
                                    ? 'bg-rose-500/10 text-rose-400 border border-rose-500/30'
                                    : it.status === 'แก้ไข'
                                    ? 'bg-amber-500/10 text-amber-400 border border-amber-500/30'
                                    : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                                }`}>
                                  {it.status === 'ไม่ได้จัดส่ง' && <XCircle className="w-3 h-3" />}
                                  {it.status === 'แก้ไข' && <Edit3 className="w-3 h-3" />}
                                  {it.status === 'ยืนยัน' && <CheckCircle2 className="w-3 h-3" />}
                                  <span>{it.status}</span>
                                </span>
                              </td>

                              {/* Per-item Action Controls */}
                              <td className="px-4 py-2.5 text-center">
                                <div className="flex items-center justify-center gap-1.5">
                                  <button
                                    onClick={() => handleItemAction(originalIndex, 'CONFIRM')}
                                    className="p-1.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 transition-colors"
                                    title="ยืนยันจัดครบตามสั่ง"
                                  >
                                    <Check className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    onClick={() => handleItemAction(originalIndex, 'EDIT')}
                                    className="p-1.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/30 transition-colors"
                                    title="แก้ไขจำนวนส่ง"
                                  >
                                    <Edit3 className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    onClick={() => handleItemAction(originalIndex, 'CANCEL')}
                                    className="p-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 transition-colors"
                                    title="ไม่ได้จัดส่ง (จำนวนเป็น 0)"
                                  >
                                    <XCircle className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          </React.Fragment>
                        );
                      });
                    })()
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Sticky Bottom Action Bar to Save to Google Sheet */}
          <div className="sticky bottom-4 z-20 p-4 rounded-2xl bg-slate-900/95 backdrop-blur-xl border border-slate-800 shadow-2xl flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3 text-xs text-slate-300">
              <div className="p-2 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20">
                <FileText className="w-4 h-4" />
              </div>
              <div>
                <p className="font-bold text-slate-200">พร้อมบันทึกเข้า Google Sheet (ชีท: จัดของ)</p>
                <p className="text-[11px] text-slate-400">
                  จำนวนทั้งหมด: <strong className="text-amber-400">{items.length}</strong> รายการ | ยืนยัน: <strong className="text-emerald-400">{confirmedCount}</strong> | แก้ไข: <strong className="text-amber-400">{editedCount}</strong> | ไม่ได้จัดส่ง: <strong className="text-rose-400">{cancelledCount}</strong>
                </p>
              </div>
            </div>

            <button
              onClick={handleSaveToGoogleSheet}
              disabled={saving || items.length === 0}
              className="flex items-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-slate-950 font-bold text-sm shadow-lg shadow-emerald-500/20 transition-all disabled:opacity-50 disabled:pointer-events-none cursor-pointer"
            >
              {saving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>กำลังบันทึกข้อมูล...</span>
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  <span>บันทึกข้อมูลการจัดของเข้า Google Sheet (ชีท: จัดของ)</span>
                </>
              )}
            </button>
          </div>

        </div>
      )}
    </div>
  );
}
