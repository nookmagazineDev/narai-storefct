import React, { useState, useEffect } from 'react';
import { 
  X, 
  ArrowUp, 
  ArrowDown, 
  RotateCcw, 
  Check, 
  ListOrdered, 
  Sparkles,
  Save,
  HelpCircle
} from 'lucide-react';
import { 
  getCategoryOrderMap, 
  saveCategoryOrderMap, 
  DEFAULT_CATEGORY_ORDER, 
  sortCategoryNames 
} from '../services/categoryService';

export default function CategoryOrderModal({ availableCategories = [], onClose, onSaved }) {
  const [orderMap, setOrderMap] = useState(() => getCategoryOrderMap());
  const [categoriesList, setCategoriesList] = useState([]);
  const [isSavedSuccess, setIsSavedSuccess] = useState(false);

  // Display categories available in current context (or fallback to known map)
  useEffect(() => {
    const listToDisplay = (availableCategories && availableCategories.length > 0)
      ? availableCategories
      : Object.keys(orderMap);

    const uniqueCategories = Array.from(new Set(listToDisplay));
    const sorted = sortCategoryNames(uniqueCategories, orderMap);
    setCategoriesList(sorted);
  }, [availableCategories]);

  // Update order map state when numbers change
  const handleNumberChange = (catName, newRankStr) => {
    const newRank = parseInt(newRankStr, 10);
    if (isNaN(newRank) || newRank < 1) return;
    
    const updated = { ...orderMap, [catName]: newRank };
    setOrderMap(updated);
    // Re-sort category list based on new numbers
    const sorted = sortCategoryNames(categoriesList, updated);
    setCategoriesList(sorted);
  };

  // Move item up in priority
  const handleMoveUp = (index) => {
    if (index <= 0) return;
    const newList = [...categoriesList];
    const temp = newList[index];
    newList[index] = newList[index - 1];
    newList[index - 1] = temp;

    // Reassign sequential numbers 1..N
    const updatedMap = { ...orderMap };
    newList.forEach((cat, idx) => {
      updatedMap[cat] = idx + 1;
    });

    setOrderMap(updatedMap);
    setCategoriesList(newList);
  };

  // Move item down in priority
  const handleMoveDown = (index) => {
    if (index >= categoriesList.length - 1) return;
    const newList = [...categoriesList];
    const temp = newList[index];
    newList[index] = newList[index + 1];
    newList[index + 1] = temp;

    // Reassign sequential numbers 1..N
    const updatedMap = { ...orderMap };
    newList.forEach((cat, idx) => {
      updatedMap[cat] = idx + 1;
    });

    setOrderMap(updatedMap);
    setCategoriesList(newList);
  };

  // Reset to default preset
  const handleResetDefault = () => {
    setOrderMap({ ...DEFAULT_CATEGORY_ORDER });
    const sorted = sortCategoryNames(categoriesList, DEFAULT_CATEGORY_ORDER);
    setCategoriesList(sorted);
  };

  // Save changes to localStorage and close
  const handleSave = () => {
    // Ensure all listed categories have a rank assigned
    const finalMap = { ...orderMap };
    categoriesList.forEach((cat, idx) => {
      if (!finalMap[cat]) finalMap[cat] = idx + 1;
    });

    saveCategoryOrderMap(finalMap);
    setIsSavedSuccess(true);
    if (onSaved) onSaved(finalMap);

    setTimeout(() => {
      onClose();
    }, 400);
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md animate-in fade-in duration-150">
      <div className="bg-slate-900 border border-slate-700/90 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        
        {/* Modal Header */}
        <div className="px-5 py-4 bg-slate-950/80 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20">
              <ListOrdered className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">
                <span>ตั้งค่าลำดับการแสดงผลหมวดหมู่</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 font-mono font-bold">
                  ตัวเลขลำดับ
                </span>
              </h3>
              <p className="text-xs text-slate-400">กำหนดตัวเลขเพื่อเลือกให้หมวดหมู่ไหนแสดงขึ้นก่อนในระบบ</p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-xl text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Content - Editable Sequence List */}
        <div className="p-5 overflow-y-auto space-y-3 flex-1">
          <div className="p-3 rounded-xl bg-amber-500/5 border border-amber-500/20 text-xs text-amber-300 flex items-start gap-2">
            <Sparkles className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <strong>คำแนะนำ:</strong> ป้อนตัวเลขลำดับ (เช่น 1, 2, 3...) หรือกดลูกศรขึ้น/ลง เพื่อจัดเรียงลำดับหมวดหมู่ที่คุณต้องการให้ปรากฏเป็นอันดับแรก
            </div>
          </div>

          <div className="space-y-2 mt-2">
            {categoriesList.map((cat, idx) => {
              const rank = orderMap[cat] !== undefined ? orderMap[cat] : idx + 1;
              return (
                <div 
                  key={cat}
                  className="flex items-center justify-between p-2.5 rounded-xl bg-slate-950/70 border border-slate-800 hover:border-slate-700 transition-all gap-3"
                >
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    {/* Sequence Number Input */}
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="text-xs text-slate-500 font-mono">ลำดับ:</span>
                      <input
                        type="number"
                        min="1"
                        max="99"
                        value={rank}
                        onChange={(e) => handleNumberChange(cat, e.target.value)}
                        className="w-14 bg-slate-900 border border-amber-500/40 rounded-lg px-2 py-1 text-center font-mono font-bold text-amber-400 text-sm focus:outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400"
                      />
                    </div>

                    <span className="text-xs font-semibold text-slate-200 truncate">
                      🏷️ {cat}
                    </span>
                  </div>

                  {/* Up / Down Action Controls */}
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => handleMoveUp(idx)}
                      disabled={idx === 0}
                      className="p-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-300 hover:text-amber-400 hover:border-amber-500/40 disabled:opacity-30 disabled:pointer-events-none transition-colors"
                      title="เลื่อนขึ้น"
                    >
                      <ArrowUp className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleMoveDown(idx)}
                      disabled={idx === categoriesList.length - 1}
                      className="p-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-300 hover:text-amber-400 hover:border-amber-500/40 disabled:opacity-30 disabled:pointer-events-none transition-colors"
                      title="เลื่อนลง"
                    >
                      <ArrowDown className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Modal Footer Controls */}
        <div className="px-5 py-3.5 bg-slate-950/90 border-t border-slate-800 flex items-center justify-between gap-3">
          <button
            onClick={handleResetDefault}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 text-slate-300 hover:bg-slate-700 text-xs font-medium transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5 text-slate-400" />
            <span>คืนค่าเริ่มต้น</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 hover:bg-slate-700 text-xs font-semibold transition-colors"
            >
              ยกเลิก
            </button>
            <button
              onClick={handleSave}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs shadow-lg shadow-amber-500/20 transition-all"
            >
              {isSavedSuccess ? (
                <>
                  <Check className="w-4 h-4" />
                  <span>บันทึกแล้ว!</span>
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  <span>บันทึกการเรียกลำดับ</span>
                </>
              )}
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
