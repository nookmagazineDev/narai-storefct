import { apiCall } from './api';
import { getCategoryRank, formatCategoryLabel } from './categoryService';

const LOCAL_STORAGE_KEY = 'store_fulfillment_records';
const TARGET_SPREADSHEET_ID = '1bxohT8wK4ySAJgqGHEg9JHp0KJJKG7SVUEhJksBgBSI';
const TARGET_SHEET_NAME = 'จัดของ';

/**
 * Save fulfillment records locally to localStorage as backup
 */
export function saveLocalFulfillmentRecords(docNo, records) {
  try {
    const existing = getLocalFulfillmentRecords();
    existing[docNo] = {
      savedAt: new Date().toISOString(),
      items: records
    };
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(existing));
  } catch (e) {
    console.warn("Failed to save local fulfillment records", e);
  }
}

/**
 * Get saved local fulfillment records
 */
export function getLocalFulfillmentRecords(docNo = null) {
  try {
    const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
    const parsed = saved ? JSON.parse(saved) : {};
    if (docNo) {
      return parsed[docNo] || null;
    }
    return parsed;
  } catch (e) {
    return docNo ? null : {};
  }
}

/**
 * Submit fulfillment data to backend API and Google Sheet
 */
export async function saveFulfillmentData({ docNo, date, branch, items }) {
  const timestamp = new Date().toLocaleString('th-TH');

  // Format rows for Google Sheet tab "จัดของ"
  // Required columns: วันที่ | สาขา | รหัส | ชื่อ | จำนวนเบิก | จำนวนส่ง | เลขที่ใบเบิก | สถานะ | เวลาบันทึก
  const rowsToSave = items.map(it => ({
    date: date || new Date().toISOString().split('T')[0],
    branch: branch || 'สาขาหลัก',
    code: it.itemCode || it.itemId || '-',
    name: it.itemName || '-',
    reqQty: Number(it.qty) || 0,
    delQty: Number(it.delQty !== undefined ? it.delQty : it.qty) || 0,
    docNo: docNo || '-',
    status: it.status || 'ยืนยัน',
    timestamp: timestamp
  }));

  // 1. Save to local storage cache
  saveLocalFulfillmentRecords(docNo, rowsToSave);

  // 2. Post to Node.js backend proxy (/api/save_fulfillment)
  let backendSuccess = false;
  try {
    const res = await fetch('/api/save_fulfillment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        spreadsheetId: TARGET_SPREADSHEET_ID,
        sheetName: TARGET_SHEET_NAME,
        docNo,
        date,
        branch,
        items: rowsToSave
      })
    });
    if (res.ok) {
      backendSuccess = true;
    }
  } catch (err) {
    console.warn("Backend save_fulfillment call warning:", err);
  }

  // 3. Post to Google Apps Script API endpoint
  try {
    await apiCall('saveFulfillment', {
      spreadsheetId: TARGET_SPREADSHEET_ID,
      sheetName: TARGET_SHEET_NAME,
      docNo,
      rows: rowsToSave
    });
  } catch (err) {
    console.warn("Google Apps Script save warning (Fallback to local & server storage):", err);
  }

  return {
    success: true,
    count: rowsToSave.length,
    backendSuccess
  };
}

/**
 * Per-item requisitioned quantity summed across every branch/requisition (myfbdata.orderd)
 * whose delivery date falls within [startDate, endDate], plus each item's remaining balance
 * from the "ยอดคงเหลือไอเทม" sheet tab. Each item also carries a `breakdown` list of
 * { branch, docNo, date, qtySent } for drill-down.
 */
export async function fetchDeliverySummary({ startDate, endDate }) {
  const query = new URLSearchParams({ startDate, endDate });
  const response = await fetch(`/api/delivery_summary?${query.toString()}`);
  const json = await response.json();
  if (!response.ok || json.status !== 'success') {
    throw new Error(json.message || 'โหลดสรุปยอดส่งของไม่สำเร็จ');
  }
  return json.items || [];
}

function sortItemsByCategory(items, categoryOrderMap) {
  return [...items].sort((a, b) => {
    const catA = a.category || 'อื่นๆ';
    const catB = b.category || 'อื่นๆ';
    if (catA !== catB) {
      const rankA = getCategoryRank(catA, categoryOrderMap);
      const rankB = getCategoryRank(catB, categoryOrderMap);
      if (rankA !== rankB) return rankA - rankB;
      return catA.localeCompare(catB, 'th');
    }
    return (a.itemName || '').localeCompare(b.itemName || '', 'th');
  });
}

/**
 * Export a requisition's items as a "ใบจัดของ" (packing list) Excel file — จำนวนเบิก (requested
 * qty) and category only, no price/value or already-packed columns, always sorted by category
 * first. Shared by the Fulfillment page (items already loaded) and the Status Check page (items
 * fetched on demand).
 *
 * `selectedCategories` (optional): ordered list of category names to export. When provided,
 * only items in those categories are included and categories appear in exactly that order
 * (numbered 1..N per the chosen sequence). When omitted, every item is exported sorted by the
 * global category order map — the original behavior.
 */
export async function exportPackingListExcel({ docNo, branchName, deldate, orderDate, items, categoryOrderMap, selectedCategories = null }) {
  // xlsx-js-style = SheetJS fork with the same API that can also write cell styles —
  // needed to shrink the item-name font and size the sheet to print within an A4 page.
  const mod = await import('xlsx-js-style');
  const XLSX = mod.default || mod;

  const useCustomSelection = Array.isArray(selectedCategories) && selectedCategories.length > 0;
  let sorted;
  let customRankMap = null;
  if (useCustomSelection) {
    customRankMap = new Map(selectedCategories.map((cat, idx) => [cat, idx]));
    sorted = items
      .filter(it => customRankMap.has(it.category || 'อื่นๆ'))
      .sort((a, b) => {
        const rankA = customRankMap.get(a.category || 'อื่นๆ');
        const rankB = customRankMap.get(b.category || 'อื่นๆ');
        if (rankA !== rankB) return rankA - rankB;
        return (a.itemName || '').localeCompare(b.itemName || '', 'th');
      });
  } else {
    sorted = sortItemsByCategory(items, categoryOrderMap);
  }

  const wsData = [
    ['ใบจัดของ (Packing List)'],
    [`เลขที่ใบเบิก: ${docNo}`, '', `สาขา: ${branchName || '-'}`],
    [`วันที่กำหนดส่ง: ${deldate || '-'}`, '', `วันที่สั่งเบิก: ${orderDate || '-'}`],
  ];
  if (useCustomSelection) {
    wsData.push([`หมวดหมู่ที่เลือก (${selectedCategories.length} หมวด): ${selectedCategories.join(', ')}`]);
  }
  wsData.push([]);
  const colHeaderRowIdx = wsData.length;
  wsData.push(['ลำดับ', 'รหัสสินค้า', 'ชื่อสินค้า', 'หมวดหมู่', 'จำนวนเบิก', 'หน่วย']);

  sorted.forEach((it, idx) => {
    const cat = it.category || 'อื่นๆ';
    const catLabel = useCustomSelection
      ? `${customRankMap.get(cat) + 1}. ${cat}`
      : formatCategoryLabel(cat, categoryOrderMap);
    const reqQty = Number(it.reqQty !== undefined ? it.reqQty : it.qty) || 0;
    wsData.push([
      idx + 1,
      it.itemCode || it.itemId || '',
      it.itemName || '',
      catLabel,
      reqQty,
      it.unit || ''
    ]);
  });

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(wsData);

  // Column widths chosen so the 6 columns total ~92 chars (~18.5 cm) — with narrow margins
  // the sheet prints on a single A4 portrait page width at 100% scale.
  ws['!cols'] = [
    { wch: 6 },   // ลำดับ
    { wch: 12 },  // รหัสสินค้า
    { wch: 38 },  // ชื่อสินค้า
    { wch: 18 },  // หมวดหมู่
    { wch: 10 },  // จำนวนเบิก
    { wch: 8 }    // หน่วย
  ];
  ws['!margins'] = { left: 0.25, right: 0.25, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 };

  const thin = { style: 'thin', color: { rgb: '999999' } };
  const border = { top: thin, bottom: thin, left: thin, right: thin };

  for (let r = 0; r < wsData.length; r++) {
    for (let c = 0; c < 6; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      if (!cell) continue;
      if (r === 0) {
        cell.s = { font: { bold: true, sz: 14 } };
      } else if (r < colHeaderRowIdx) {
        cell.s = { font: { sz: 10 } };
      } else if (r === colHeaderRowIdx) {
        cell.s = {
          font: { bold: true, sz: 10 },
          alignment: { horizontal: 'center', vertical: 'center' },
          fill: { fgColor: { rgb: 'E8E8E8' } },
          border
        };
      } else {
        // Item rows — item name (col 2) gets a smaller font and wraps so long Thai
        // names stay inside the A4-fitted column instead of widening the printout.
        const isName = c === 2;
        cell.s = {
          font: { sz: isName ? 9 : 10 },
          alignment: {
            vertical: 'center',
            wrapText: isName || c === 3,
            horizontal: (c === 0 || c === 4 || c === 5) ? 'center' : 'left'
          },
          border
        };
      }
    }
  }

  XLSX.utils.book_append_sheet(wb, ws, 'ใบจัดของ');
  XLSX.writeFile(wb, `ใบจัดของ_${docNo}.xlsx`);
}

/**
 * Export the "สรุปส่งของ" delivery summary as a 2-sheet Excel file:
 *   1. "สรุปรวม" — one row per item: code/name/unit/total sent across every branch/remaining balance.
 *   2. "แยกสาขา" — one pivot table per date (rows = items, columns = every branch that shipped
 *      anywhere in the range), stacked with a date heading above each table.
 * Always exports every item passed in (ignores any on-screen search filter — a summary export
 * should always cover everything for the selected date range).
 */
export async function exportDeliverySummaryExcel({ startDate, endDate, items }) {
  const XLSX = await import('xlsx');

  // Sheet 1: Overall summary
  const summaryData = [
    ['สรุปยอดส่งของ (Delivery Summary)'],
    [`ช่วงวันที่: ${startDate} ถึง ${endDate}`],
    [],
    ['รหัสสินค้า', 'ชื่อสินค้า', 'หน่วย', 'ยอดส่งรวมทุกสาขา', 'ยอดคงเหลือ']
  ];
  items.forEach(it => {
    summaryData.push([
      it.code,
      it.name || '',
      it.unit || '',
      Number(it.totalSent) || 0,
      it.remaining !== null && it.remaining !== undefined ? it.remaining : ''
    ]);
  });

  // Sheet 2: Per-date pivot — branches as columns, items as rows
  const allBranches = Array.from(new Set(
    items.flatMap(it => it.breakdown.map(b => b.branch))
  )).sort((a, b) => a.localeCompare(b, 'th'));

  const allDates = Array.from(new Set(
    items.flatMap(it => it.breakdown.map(b => b.date))
  )).sort();

  const branchData = [];
  allDates.forEach(date => {
    branchData.push([`วันที่ ${date}`]);
    branchData.push(['รหัสสินค้า', 'ชื่อสินค้า', ...allBranches]);

    const itemsForDate = items.filter(it => it.breakdown.some(b => b.date === date));
    itemsForDate.forEach(it => {
      const row = [it.code, it.name || ''];
      allBranches.forEach(branch => {
        const qty = it.breakdown
          .filter(b => b.date === date && b.branch === branch)
          .reduce((sum, b) => sum + (Number(b.qtySent) || 0), 0);
        row.push(qty || '');
      });
      branchData.push(row);
    });

    branchData.push([]); // blank separator row between dates
  });

  const wb = XLSX.utils.book_new();
  const ws1 = XLSX.utils.aoa_to_sheet(summaryData);
  const ws2 = XLSX.utils.aoa_to_sheet(branchData.length > 0 ? branchData : [['ไม่มีข้อมูล']]);
  XLSX.utils.book_append_sheet(wb, ws1, 'สรุปรวม');
  XLSX.utils.book_append_sheet(wb, ws2, 'แยกสาขา');
  XLSX.writeFile(wb, `สรุปส่งของ_${startDate}_ถึง_${endDate}.xlsx`);
}
