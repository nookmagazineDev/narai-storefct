import React, { useState, useMemo, useEffect } from 'react';
import {
  BarChart3,
  Search,
  Download,
  DollarSign,
  Package,
  Layers,
  Building2,
  ChevronDown,
  ChevronRight,
  FileSpreadsheet,
  Info,
  Database,
  Filter,
  RefreshCw,
  TrendingUp,
  PieChart,
  ListOrdered,
  Loader2,
  Clock
} from 'lucide-react';
import toast from 'react-hot-toast';
import { BRANCH_MAP } from '../services/requisitionService';
import {
  getCategoryOrderMap,
  sortCategoryNames,
  getCategoryRank,
  formatCategoryLabel
} from '../services/categoryService';
import CategoryOrderModal from '../components/CategoryOrderModal';

export default function StockTotalList({ selectedBranch = 'all', onBranchChange }) {
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [expandedItemId, setExpandedItemId] = useState(null);
  const [activeBranchFilter, setActiveBranchFilter] = useState(selectedBranch);
  const [categoryOrderMap, setCategoryOrderMap] = useState(() => getCategoryOrderMap());
  const [showOrderModal, setShowOrderModal] = useState(false);

  // Live stock data: latest count per item per branch, from Google Sheet "ข้อมูลนับสตอค"
  const [rawItems, setRawItems] = useState([]);
  const [loadingStock, setLoadingStock] = useState(true);
  const [stockLoadedAt, setStockLoadedAt] = useState(null);
  const [sheetBranches, setSheetBranches] = useState([]);

  useEffect(() => {
    let isMounted = true;
    setLoadingStock(true);
    fetch('/api/stock_count_summary')
      .then(res => res.json())
      .then(json => {
        if (!isMounted) return;
        if (json.status === 'success') {
          setRawItems(json.items || []);
          setStockLoadedAt(json.loadedAt || null);
          setSheetBranches(json.branches || []);
        } else {
          toast.error(json.message || 'โหลดข้อมูลสต๊อกไม่สำเร็จ');
        }
      })
      .catch(err => {
        console.error("Failed to load stock count summary:", err);
        if (isMounted) toast.error('เชื่อมต่อข้อมูลสต๊อกจากชีทนับสต๊อกไม่สำเร็จ กรุณาลองใหม่');
      })
      .finally(() => {
        if (isMounted) setLoadingStock(false);
      });
    return () => { isMounted = false; };
  }, []);

  // Listen for category order updates
  React.useEffect(() => {
    const handleOrderChange = () => setCategoryOrderMap(getCategoryOrderMap());
    window.addEventListener('categoryOrderChanged', handleOrderChange);
    return () => window.removeEventListener('categoryOrderChanged', handleOrderChange);
  }, []);

  // All branches excluding 'all' — union of the known branch list plus any branch code
  // seen in the stock-count sheet that isn't registered yet, so nothing is silently dropped.
  const branchList = useMemo(() => {
    const known = Object.entries(BRANCH_MAP).filter(([k]) => k !== 'all');
    const knownKeys = new Set(known.map(([k]) => k));
    const extra = sheetBranches
      .filter(b => !knownKeys.has(b))
      .map(b => [b, { id: b, name: b.toUpperCase(), code: b.toUpperCase() }]);
    return [...known, ...extra];
  }, [sheetBranches]);

  // Master Stock Dataset with latest balances per branch (from live sheet data)
  const consolidatedStockData = useMemo(() => {
    return rawItems.map(item => {
      const id = item.code || item.name;
      // Calculate consolidated total balance across branches
      let totalQty = 0;
      if (activeBranchFilter === 'all') {
        totalQty = Object.values(item.balances).reduce((sum, q) => sum + (Number(q) || 0), 0);
      } else {
        totalQty = Number(item.balances[activeBranchFilter]) || 0;
      }

      const totalValue = totalQty * item.price;
      const activeBranchCount = Object.values(item.balances).filter(q => Number(q) > 0).length;

      return {
        ...item,
        id,
        totalQty,
        totalValue,
        activeBranchCount
      };
    });
  }, [rawItems, activeBranchFilter]);

  // Categories list for filter, sorted by custom sequence number
  const categories = useMemo(() => {
    const set = new Set(consolidatedStockData.map(i => i.category));
    return ['all', ...sortCategoryNames(Array.from(set), categoryOrderMap)];
  }, [consolidatedStockData, categoryOrderMap]);

  // Filter dataset by search term and category, sorted by category sequence number rank
  const filteredData = useMemo(() => {
    const filtered = consolidatedStockData.filter(item => {
      const matchesSearch = 
        item.name.toLowerCase().includes(search.toLowerCase()) ||
        item.id.toLowerCase().includes(search.toLowerCase());
      const matchesCat = selectedCategory === 'all' || item.category === selectedCategory;
      return matchesSearch && matchesCat;
    });

    return [...filtered].sort((a, b) => {
      const rankA = getCategoryRank(a.category, categoryOrderMap);
      const rankB = getCategoryRank(b.category, categoryOrderMap);
      if (rankA !== rankB) return rankA - rankB;
      return (a.id || '').localeCompare(b.id || '', 'th');
    });
  }, [consolidatedStockData, search, selectedCategory, categoryOrderMap]);

  // Consolidated Grand Totals
  const grandTotalValue = useMemo(() => {
    return filteredData.reduce((sum, item) => sum + item.totalValue, 0);
  }, [filteredData]);

  const grandTotalItems = useMemo(() => {
    return filteredData.reduce((sum, item) => sum + item.totalQty, 0);
  }, [filteredData]);

  // Export Consolidated Excel Report (xlsx library loaded on demand, only when exporting)
  const handleExportExcel = async () => {
    const XLSX = await import('xlsx');
    const headers = ['รหัสสินค้า', 'ชื่อสินค้า', 'หมวดหมู่', 'ยอดคงเหลือรวมทุกสาขา', 'หน่วย', 'ราคา/หน่วย (บาท)', 'มูลค่ารวม (บาท)'];
    
    // Add individual branch columns
    branchList.forEach(([bKey, info]) => {
      headers.push(`ยอดคงเหลือ (${info.code})`);
    });

    const rows = [
      ['รายงานสรุปยอดสต๊อกคงเหลือรวมทุกสาขา (Consolidated Stock Summary)'],
      [`ตัวกรองสาขา: ${BRANCH_MAP[activeBranchFilter]?.name || 'ทุกสาขา'}`, '', `วันที่ส่งออก: ${new Date().toLocaleDateString('th-TH')}`],
      [],
      headers
    ];

    filteredData.forEach(item => {
      const row = [
        item.id,
        item.name,
        item.category,
        item.totalQty,
        item.unit,
        item.price,
        item.totalValue
      ];

      // Add individual branch balances
      branchList.forEach(([bKey]) => {
        row.push(item.balances[bKey] || 0);
      });

      rows.push(row);
    });

    rows.push([]);
    rows.push(['รวมทั้งสิ้น', '', '', grandTotalItems, '', '', grandTotalValue]);

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, 'สต๊อกรวมทุกสาขา');
    XLSX.writeFile(wb, `สรุปสต๊อกรวมทุกสาขา_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  return (
    <div className="space-y-6">
      {/* Top Banner Header */}
      <div className="glass-panel rounded-2xl p-6 border border-slate-800 bg-gradient-to-r from-slate-900 via-slate-900 to-sky-950/30 flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold text-sky-400 mb-1">
            <Building2 className="w-4 h-4" />
            <span>CONSOLIDATED INVENTORY REPORT</span>
          </div>
          <h1 className="text-xl md:text-2xl font-bold text-slate-100 flex items-center gap-3">
            <span>สรุปสต๊อกรวมทุกสาขา</span>
            <span className="text-xs px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/30 font-normal">
              รวม {branchList.length} สาขา
            </span>
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            รวบรวม<strong className="text-amber-300 font-semibold">ข้อมูลล่าสุดของแต่ละไอเทมแต่ละสาขา</strong>จากชีท "ข้อมูลนับสตอค" มารวมกัน พร้อมรายละเอียดจำนวนสต๊อกแยกตามรายสาขา
          </p>
          <p className="text-[11px] text-slate-500 mt-1.5 flex items-center gap-1.5">
            <Clock className="w-3 h-3" />
            {loadingStock ? (
              <span className="flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> กำลังโหลดข้อมูลล่าสุดจาก Google Sheet...</span>
            ) : stockLoadedAt ? (
              <span>ข้อมูลล่าสุดโหลดเมื่อ: {new Date(stockLoadedAt).toLocaleString('th-TH')}</span>
            ) : (
              <span className="text-rose-400">โหลดข้อมูลไม่สำเร็จ</span>
            )}
          </p>
        </div>

        {/* Grand Total Value Widgets */}
        <div className="flex items-center gap-3 self-start md:self-auto">
          <div className="px-4 py-3 rounded-2xl bg-slate-950/80 border border-slate-800 flex items-center gap-3">
            <div className="p-2 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20">
              <Package className="w-5 h-5" />
            </div>
            <div>
              <p className="text-[10px] text-slate-400">จำนวนสต๊อกรวมทุกสาขา</p>
              <p className="text-base font-bold text-amber-400 font-mono">
                {grandTotalItems.toLocaleString()} <span className="text-xs font-normal text-slate-400">ชิ้น</span>
              </p>
            </div>
          </div>

          <div className="px-4 py-3 rounded-2xl bg-slate-950/80 border border-emerald-500/30 flex items-center gap-3">
            <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <DollarSign className="w-5 h-5" />
            </div>
            <div>
              <p className="text-[10px] text-slate-400">มูลค่าสต๊อกรวมสุทธิ</p>
              <p className="text-lg font-bold text-emerald-400 font-mono">
                ฿{grandTotalValue.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Control & Filter Toolbar */}
      <div className="glass-card rounded-2xl p-4 flex flex-wrap items-center justify-between gap-4">
        
        {/* Branch Filter Switcher */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400 flex items-center gap-1">
            <Building2 className="w-3.5 h-3.5 text-amber-400" /> มุมมองสาขา:
          </span>
          <select
            value={activeBranchFilter}
            onChange={(e) => {
              setActiveBranchFilter(e.target.value);
              if (onBranchChange) onBranchChange(e.target.value);
            }}
            className="bg-slate-950 border border-slate-700/80 text-amber-300 text-xs rounded-xl px-3 py-2 pr-8 focus:outline-none focus:border-amber-500 appearance-none font-semibold cursor-pointer"
          >
            <option value="all" className="bg-slate-900 text-amber-400 font-bold">
              🌐 รวมยอดคงเหลือทุกสาขา (Consolidated Summary)
            </option>
            {branchList.map(([key, info]) => (
              <option key={key} value={key} className="bg-slate-900 text-slate-200">
                {info.name}
              </option>
            ))}
          </select>
        </div>

        {/* Category & Search */}
        <div className="flex items-center gap-3 flex-1 max-w-xl justify-end">
          {/* Category Selector with sequence formatting */}
          <div className="flex items-center gap-1.5">
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="bg-slate-950 border border-slate-800 text-slate-300 text-xs rounded-xl px-3 py-2 focus:outline-none focus:border-amber-500 cursor-pointer font-semibold"
            >
              <option value="all">📦 ทุกหมวดหมู่สินค้า</option>
              {categories.filter(c => c !== 'all').map(cat => {
                const label = formatCategoryLabel(cat, categoryOrderMap);
                return (
                  <option key={cat} value={cat}>
                    🏷️ {label}
                  </option>
                );
              })}
            </select>

            <button
              onClick={() => setShowOrderModal(true)}
              className="p-2 rounded-xl bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/30 text-xs font-semibold transition-colors flex items-center gap-1 shrink-0"
              title="ตั้งค่าตัวเลขลำดับการแสดงผลหมวดหมู่"
            >
              <ListOrdered className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">จัดลำดับ</span>
            </button>
          </div>

          {/* Search Box */}
          <div className="relative flex-1 max-w-xs">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="ค้นหารหัส หรือ ชื่อสินค้า..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-amber-500"
            />
          </div>

          {/* Excel Export Button */}
          <button
            onClick={handleExportExcel}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 border border-emerald-500/30 text-xs font-semibold transition-colors"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            <span>Excel</span>
          </button>
        </div>

      </div>

      {/* Main Stock Table */}
      <div className="glass-panel rounded-2xl border border-slate-800 overflow-hidden shadow-2xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="bg-slate-900/90 text-slate-400 font-semibold border-b border-slate-800">
              <tr>
                <th className="px-3 py-3 text-center w-10"></th>
                <th className="px-4 py-3">รหัสสินค้า</th>
                <th className="px-4 py-3">ชื่อสินค้า / รายการ</th>
                <th className="px-4 py-3">หมวดหมู่</th>
                <th className="px-4 py-3 text-right text-amber-300 font-bold">
                  {activeBranchFilter === 'all' ? 'ยอดคงเหลือรวมทุกสาขา' : 'ยอดคงเหลือสาขา'}
                </th>
                <th className="px-3 py-3 text-center">หน่วย</th>
                <th className="px-4 py-3 text-right">ราคา/หน่วย</th>
                <th className="px-4 py-3 text-right font-bold text-emerald-400">มูลค่ารวมสุทธิ</th>
                <th className="px-4 py-3 text-center">สาขาที่มีสต๊อก</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {loadingStock ? (
                <tr>
                  <td colSpan="9" className="px-4 py-12 text-center text-slate-400">
                    <div className="flex items-center justify-center gap-2">
                      <Loader2 className="w-5 h-5 animate-spin text-amber-400" />
                      <span>กำลังโหลดข้อมูลสต๊อกจากชีท "ข้อมูลนับสตอค"... (ประมวลผลข้อมูลนับสต๊อกทุกสาขา)</span>
                    </div>
                  </td>
                </tr>
              ) : filteredData.length === 0 ? (
                <tr>
                  <td colSpan="9" className="px-4 py-12 text-center text-slate-500">
                    ไม่พบข้อมูลรายการสต๊อกตามเงื่อนไขที่เลือก
                  </td>
                </tr>
              ) : (
                filteredData.map(item => {
                  const isExpanded = expandedItemId === item.id;
                  return (
                    <React.Fragment key={item.id}>
                      <tr 
                        onClick={() => setExpandedItemId(isExpanded ? null : item.id)}
                        className={`hover:bg-slate-800/50 transition-colors cursor-pointer ${
                          isExpanded ? 'bg-amber-500/5 border-l-2 border-amber-500' : ''
                        }`}
                      >
                        <td className="px-3 py-3 text-center text-slate-500">
                          {isExpanded ? (
                            <ChevronDown className="w-4 h-4 text-amber-400" />
                          ) : (
                            <ChevronRight className="w-4 h-4 text-slate-500" />
                          )}
                        </td>
                        <td className="px-4 py-3 font-mono font-bold text-amber-400">{item.id}</td>
                        <td className="px-4 py-3 font-medium text-slate-100">{item.name}</td>
                        <td className="px-4 py-3 text-slate-400">{item.category}</td>
                        <td className="px-4 py-3 text-right font-mono font-bold text-amber-300 text-sm">
                          {item.totalQty.toLocaleString()}
                        </td>
                        <td className="px-3 py-3 text-center text-slate-400">{item.unit}</td>
                        <td className="px-4 py-3 text-right font-mono text-slate-300">
                          {item.price > 0 ? `฿${item.price.toFixed(2)}` : <span className="text-slate-600" title="ไม่พบราคาในระบบสำหรับสินค้านี้">-</span>}
                        </td>
                        <td className="px-4 py-3 text-right font-mono font-bold text-emerald-400 text-sm">
                          {item.price > 0 ? `฿${item.totalValue.toLocaleString('th-TH', { minimumFractionDigits: 2 })}` : <span className="text-slate-600">-</span>}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className="px-2.5 py-0.5 rounded-full bg-slate-800 text-amber-400 border border-amber-500/20 font-bold font-mono text-[11px]">
                            {item.activeBranchCount} / {branchList.length} สาขา
                          </span>
                        </td>
                      </tr>

                      {/* Expandable Row: Branch Breakdown */}
                      {isExpanded && (
                        <tr className="bg-slate-950/80 border-b border-slate-800">
                          <td colSpan="9" className="px-6 py-4">
                            <div className="space-y-3">
                              <div className="flex items-center justify-between text-xs font-bold text-amber-400">
                                <span className="flex items-center gap-1.5">
                                  <Building2 className="w-4 h-4" />
                                  รายละเอียดจำนวนคงเหลือแยกตามรายสาขา (Branch Breakdown)
                                </span>
                                <span className="text-slate-400 font-normal">
                                  สินค้า: <strong className="text-slate-200">{item.name}</strong> ({item.id})
                                </span>
                              </div>

                              <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-2">
                                {branchList.map(([bKey, info]) => {
                                  const qty = item.balances[bKey] || 0;
                                  const val = qty * item.price;
                                  return (
                                    <div 
                                      key={bKey}
                                      className={`p-2.5 rounded-xl border text-xs flex flex-col justify-between ${
                                        qty > 0 
                                          ? 'bg-slate-900 border-slate-800' 
                                          : 'bg-slate-950/50 border-slate-900 opacity-40'
                                      }`}
                                    >
                                      <div className="flex items-center justify-between">
                                        <span className="font-bold text-amber-400 font-mono">{info.code}</span>
                                        <span className={`text-[10px] ${qty > 0 ? 'text-emerald-400' : 'text-slate-600'}`}>
                                          {qty > 0 ? 'มีสต๊อก' : 'หมด'}
                                        </span>
                                      </div>
                                      <div className="mt-2 text-right">
                                        <p className="font-bold text-slate-100 text-sm font-mono">{qty.toLocaleString()}</p>
                                        <p className="text-[10px] text-slate-500 font-mono">฿{val.toLocaleString()}</p>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showOrderModal && (
        <CategoryOrderModal
          availableCategories={categories.filter(c => c !== 'all')}
          onClose={() => setShowOrderModal(false)}
          onSaved={(newMap) => setCategoryOrderMap(newMap)}
        />
      )}
    </div>
  );
}
