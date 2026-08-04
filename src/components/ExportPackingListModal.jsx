import React, { useState, useEffect, useMemo } from 'react';
import {
  X,
  ArrowUp,
  ArrowDown,
  FileSpreadsheet,
  ListOrdered,
  Loader2,
  CheckSquare,
  Square,
  FileText,
  Sparkles
} from 'lucide-react';
import toast from 'react-hot-toast';
import { sortCategoryNames } from '../services/categoryService';
import { exportPackingListExcel } from '../services/fulfillmentService';

/**
 * Export options dialog for the "ใบจัดของ" Excel export on the Fulfillment page.
 * Lets the operator pick, per export:
 *   - which document to export when the view merges several requisitions (รวมทุกใบ / แยกทีละใบ)
 *   - all categories vs. a hand-picked subset (เลือกทุกหมวด / เลือกแยกหมวด)
 *   - the sequence categories appear in the file (up/down reorder)
 */
export default function ExportPackingListModal({ activeDocNo, activeRequisition, items, categoryOrderMap, onClose }) {
  // 'ALL' = every doc in the merged view combined; otherwise a single constituent docNo
  const [docScope, setDocScope] = useState('ALL');
  // 'ALL' = ทุกหมวด (export every category); 'CUSTOM' = เลือกแยกหมวด (checkbox subset)
  const [categoryMode, setCategoryMode] = useState('ALL');
  // Ordered list defining the export sequence; `checked` only matters in CUSTOM mode
  const [categoryList, setCategoryList] = useState([]);
  const [exporting, setExporting] = useState(false);

  const mergedDocs = activeRequisition?.mergedDocs || null;
  const hasMultipleDocs = Array.isArray(mergedDocs) && mergedDocs.length > 1;

  // Items narrowed to the chosen document (merged views tag each item with _sourceDocNo)
  const scopedItems = useMemo(() => {
    if (docScope === 'ALL') return items;
    return items.filter(it => (it._sourceDocNo || activeDocNo) === docScope);
  }, [items, docScope, activeDocNo]);

  // Rebuild the category list whenever the doc scope changes, preserving the order and
  // checked state the user already set for categories that remain present.
  useEffect(() => {
    const present = Array.from(new Set(scopedItems.map(it => it.category || 'อื่นๆ')));
    setCategoryList(prev => {
      const kept = prev.filter(c => present.includes(c.name));
      const keptNames = new Set(kept.map(c => c.name));
      const added = sortCategoryNames(present.filter(name => !keptNames.has(name)), categoryOrderMap)
        .map(name => ({ name, checked: true }));
      return [...kept, ...added];
    });
  }, [scopedItems, categoryOrderMap]);

  const countByCategory = useMemo(() => {
    const counts = {};
    scopedItems.forEach(it => {
      const cat = it.category || 'อื่นๆ';
      counts[cat] = (counts[cat] || 0) + 1;
    });
    return counts;
  }, [scopedItems]);

  const toggleCategory = (name) => {
    setCategoryList(prev => prev.map(c => c.name === name ? { ...c, checked: !c.checked } : c));
  };

  const setAllChecked = (checked) => {
    setCategoryList(prev => prev.map(c => ({ ...c, checked })));
  };

  const moveCategory = (index, delta) => {
    setCategoryList(prev => {
      const target = index + delta;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const selectedCount = categoryMode === 'ALL'
    ? categoryList.length
    : categoryList.filter(c => c.checked).length;
  const selectedItemCount = categoryMode === 'ALL'
    ? scopedItems.length
    : scopedItems.filter(it => categoryList.find(c => c.name === (it.category || 'อื่นๆ'))?.checked).length;

  const handleExport = async () => {
    const exportCategories = (categoryMode === 'ALL' ? categoryList : categoryList.filter(c => c.checked))
      .map(c => c.name);

    if (exportCategories.length === 0) {
      toast.error('กรุณาเลือกอย่างน้อย 1 หมวดหมู่ที่ต้องการ export');
      return;
    }
    if (scopedItems.length === 0) {
      toast.error('ไม่พบรายการสินค้าในใบเบิกที่เลือก');
      return;
    }

    setExporting(true);
    try {
      await exportPackingListExcel({
        docNo: docScope === 'ALL' ? activeDocNo : docScope,
        branchName: activeRequisition?.branchName,
        deldate: activeRequisition?.deldate,
        orderDate: activeRequisition?.orderDate,
        items: scopedItems,
        categoryOrderMap,
        selectedCategories: exportCategories
      });
      toast.success(`ส่งออกใบจัดของเป็น Excel เรียบร้อย (${exportCategories.length} หมวด, ${selectedItemCount} รายการ)`);
      onClose();
    } catch (err) {
      console.error('ExportPackingListModal export error:', err);
      toast.error(err.message || 'ส่งออกไฟล์ Excel ไม่สำเร็จ');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md animate-in fade-in duration-150">
      <div className="bg-slate-900 border border-slate-700/90 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col max-h-[88vh]">

        {/* Modal Header */}
        <div className="px-5 py-4 bg-slate-950/80 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-sky-500/10 text-sky-400 border border-sky-500/20">
              <FileSpreadsheet className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-100">ตัวเลือกการ Export ใบจัดของ (Excel)</h3>
              <p className="text-xs text-slate-400">เลือกใบเบิก หมวดหมู่ และลำดับหมวดก่อน-หลังที่จะแสดงในไฟล์</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-4 flex-1">

          {/* Doc scope — only shown when this view merged several requisitions into one list */}
          {hasMultipleDocs && (
            <div className="space-y-2">
              <p className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5 text-violet-400" />
                เลือกใบเบิกที่ต้องการ export ({mergedDocs.length} ใบในมุมมองนี้)
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setDocScope('ALL')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-colors ${
                    docScope === 'ALL'
                      ? 'bg-violet-500/15 text-violet-300 border-violet-500/40'
                      : 'bg-slate-950 text-slate-300 border-slate-700 hover:border-slate-600'
                  }`}
                >
                  รวมทุกใบ ({items.length} รายการ)
                </button>
                {mergedDocs.map(d => {
                  const count = items.filter(it => (it._sourceDocNo || activeDocNo) === d.docNo).length;
                  return (
                    <button
                      key={d.docNo}
                      type="button"
                      onClick={() => setDocScope(d.docNo)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-semibold border font-mono transition-colors ${
                        docScope === d.docNo
                          ? 'bg-violet-500/15 text-violet-300 border-violet-500/40'
                          : 'bg-slate-950 text-slate-300 border-slate-700 hover:border-slate-600'
                      }`}
                    >
                      {d.docNo} ({count} รายการ)
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Category mode: every category vs. hand-picked subset */}
          <div className="space-y-2">
            <p className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
              <ListOrdered className="w-3.5 h-3.5 text-amber-400" />
              หมวดหมู่ที่ต้องการ export
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setCategoryMode('ALL')}
                className={`px-3 py-2 rounded-xl text-xs font-semibold border transition-colors ${
                  categoryMode === 'ALL'
                    ? 'bg-amber-500/15 text-amber-300 border-amber-500/40'
                    : 'bg-slate-950 text-slate-300 border-slate-700 hover:border-slate-600'
                }`}
              >
                📦 เลือกทุกหมวด ({categoryList.length} หมวด)
              </button>
              <button
                type="button"
                onClick={() => setCategoryMode('CUSTOM')}
                className={`px-3 py-2 rounded-xl text-xs font-semibold border transition-colors ${
                  categoryMode === 'CUSTOM'
                    ? 'bg-amber-500/15 text-amber-300 border-amber-500/40'
                    : 'bg-slate-950 text-slate-300 border-slate-700 hover:border-slate-600'
                }`}
              >
                🏷️ เลือกแยกหมวด
              </button>
            </div>
          </div>

          <div className="p-3 rounded-xl bg-amber-500/5 border border-amber-500/20 text-xs text-amber-300 flex items-start gap-2">
            <Sparkles className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div>
              กดลูกศรขึ้น/ลงเพื่อจัดลำดับว่าหมวดไหนขึ้นก่อน-หลังในไฟล์ Excel
              {categoryMode === 'CUSTOM' && ' และติ๊กเลือกเฉพาะหมวดที่ต้องการ export'}
            </div>
          </div>

          {/* Select-all / clear shortcuts in custom mode */}
          {categoryMode === 'CUSTOM' && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setAllChecked(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-amber-400 border border-slate-700 text-xs font-semibold transition-colors"
              >
                <CheckSquare className="w-3.5 h-3.5" />
                <span>เลือกทั้งหมด</span>
              </button>
              <button
                type="button"
                onClick={() => setAllChecked(false)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-xs font-semibold transition-colors"
              >
                <Square className="w-3.5 h-3.5" />
                <span>ล้างทั้งหมด</span>
              </button>
            </div>
          )}

          {/* Ordered category list: checkbox (custom mode) + up/down reorder */}
          <div className="space-y-2">
            {categoryList.length === 0 ? (
              <div className="px-4 py-6 text-center text-xs text-slate-500 rounded-xl border border-dashed border-slate-800">
                ไม่พบหมวดหมู่ในใบเบิกที่เลือก
              </div>
            ) : (
              categoryList.map((cat, idx) => {
                const included = categoryMode === 'ALL' || cat.checked;
                return (
                  <div
                    key={cat.name}
                    className={`flex items-center justify-between p-2.5 rounded-xl border transition-all gap-3 ${
                      included
                        ? 'bg-slate-950/70 border-slate-800 hover:border-slate-700'
                        : 'bg-slate-950/30 border-slate-800/60 opacity-50'
                    }`}
                  >
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      {categoryMode === 'CUSTOM' && (
                        <input
                          type="checkbox"
                          checked={cat.checked}
                          onChange={() => toggleCategory(cat.name)}
                          className="accent-amber-500 w-4 h-4 shrink-0 cursor-pointer"
                        />
                      )}
                      <span className={`w-7 h-7 shrink-0 rounded-lg flex items-center justify-center font-mono font-bold text-xs border ${
                        included
                          ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                          : 'bg-slate-900 text-slate-500 border-slate-800'
                      }`}>
                        {idx + 1}
                      </span>
                      <span className="text-xs font-semibold text-slate-200 truncate">
                        🏷️ {cat.name}
                      </span>
                      <span className="text-[11px] text-slate-500 shrink-0">
                        {countByCategory[cat.name] || 0} รายการ
                      </span>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => moveCategory(idx, -1)}
                        disabled={idx === 0}
                        className="p-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-300 hover:text-amber-400 hover:border-amber-500/40 disabled:opacity-30 disabled:pointer-events-none transition-colors"
                        title="เลื่อนขึ้น (export ก่อน)"
                      >
                        <ArrowUp className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => moveCategory(idx, 1)}
                        disabled={idx === categoryList.length - 1}
                        className="p-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-300 hover:text-amber-400 hover:border-amber-500/40 disabled:opacity-30 disabled:pointer-events-none transition-colors"
                        title="เลื่อนลง (export ทีหลัง)"
                      >
                        <ArrowDown className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Modal Footer */}
        <div className="px-5 py-3.5 bg-slate-950/90 border-t border-slate-800 flex items-center justify-between gap-3">
          <p className="text-[11px] text-slate-400">
            จะ export <strong className="text-amber-400">{selectedCount}</strong> หมวด (<strong className="text-amber-400">{selectedItemCount}</strong> รายการ)
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 hover:bg-slate-700 text-xs font-semibold transition-colors"
            >
              ยกเลิก
            </button>
            <button
              onClick={handleExport}
              disabled={exporting || selectedCount === 0}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold text-xs shadow-lg shadow-sky-500/20 transition-all disabled:opacity-50 disabled:pointer-events-none"
            >
              {exporting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>กำลังสร้างไฟล์...</span>
                </>
              ) : (
                <>
                  <FileSpreadsheet className="w-4 h-4" />
                  <span>Export Excel</span>
                </>
              )}
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
