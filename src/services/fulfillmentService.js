import { apiCall } from './api';

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
