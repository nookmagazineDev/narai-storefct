import { apiCall } from './api';

// Branch code mapping - showing exact database branch names (Str_Name) without invented labels
// ตัวแผนที่ย้ายไปอยู่ lib/branches.js แล้ว เพื่อให้สคริปต์ฝั่ง Node ใช้ร่วมได้
// re-export ไว้ที่นี่เพราะหลายหน้า import BRANCH_MAP จากไฟล์นี้อยู่
// import แล้วค่อย export ต่อ ไม่ใช่ `export ... from` ตรงๆ เพราะฟังก์ชันข้างล่างในไฟล์นี้
// ใช้ BRANCH_MAP ด้วย ซึ่ง re-export เฉยๆ จะไม่สร้างตัวแปรให้ใช้ในไฟล์
import { BRANCH_MAP } from '../../lib/branches';
export { BRANCH_MAP };

// Map Outlet ID to exact branch name
export const getBranchInfoByOutletId = (outletId, rawDbName = '') => {
  if (rawDbName) {
    return { key: String(outletId), name: rawDbName, code: rawDbName, id: String(outletId) };
  }
  const targetId = String(outletId);
  const found = Object.entries(BRANCH_MAP).find(([key, info]) => info.id === targetId);
  return found 
    ? { key: found[0], ...found[1] } 
    : { key: targetId, name: `สาขา ${targetId}`, code: `${targetId}`, id: targetId };
};

// Clean document number string to display e.g. "CRM-3451" (Strip REQ- prefix)
export const formatDocNoDisplay = (rawNo, branchCode = '') => {
  if (!rawNo) return '-';
  let str = String(rawNo).trim();
  if (str.toUpperCase().startsWith('REQ-')) {
    str = str.substring(4);
  }
  if (/^\d+$/.test(str) && branchCode && !str.toUpperCase().startsWith(branchCode.toUpperCase())) {
    return `${branchCode.toUpperCase()}-${str}`;
  }
  return str.toUpperCase();
};

/**
 * Fetch requisitions directly mapped from myfbdata.orderd & myfbdata.store
 */
export const fetchRequisitions = async ({ branch = 'all', startDate = '', endDate = '', dateType = 'deldate', days = '', daysAhead = '' }) => {
  try {
    const branchInfo = BRANCH_MAP[branch] || BRANCH_MAP['all'];
    const outletId = branchInfo.id;

    // Call API proxy querying myfbdata.orderd & myfbdata.store
    const query = new URLSearchParams({
      branch: branch,
      outletId: outletId,
      startDate: startDate,
      endDate: endDate
    });
    if (days) query.set('days', String(days));
    if (daysAhead) query.set('daysAhead', String(daysAhead));

    const response = await fetch(`/api/pending_orders?${query.toString()}`);
    if (response.ok) {
      const json = await response.json();
      if (json.status === 'success' && Array.isArray(json.all)) {
        return json.all.map(item => {
          const bInfo = getBranchInfoByOutletId(item.outletId || outletId, item.branchName);
          const cleanDocNo = formatDocNoDisplay(item.no || item.invNo, bInfo.code);
          return {
            ...item,
            invNo: cleanDocNo,
            no: cleanDocNo,
            rawNo: item.no, // raw numeric Ord_No, needed (with outletId) as the fetched-status key
            branchKey: bInfo.key,
            branchName: bInfo.name,
            branchCode: bInfo.code,
            deldate: item.deldate || item.Ord_DelDate || item.orderDate,
            orderDate: item.orderDate || item.Ord_OrdDate,
            items: item.items || []
          };
        });
      }
    }

    return [];
  } catch (err) {
    console.error("fetchRequisitions Error:", err);
    throw err;
  }
};

/**
 * Mark a requisition as "ดึงข้อมูลแล้ว" (data fetched) — a lightweight status flag
 * shown across the app (fulfillment page, requisition calendar), plus an audit log
 * row in the "ดึงข้อมูลใบเบิก" Google Sheet tab.
 */
export const markRequisitionFetched = async ({ outletId, rawNo, docNo, branch, date }) => {
  const response = await fetch('/api/mark_fetched', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ outletId, no: rawNo, docNo, branch, date })
  });
  const json = await response.json();
  if (!response.ok || json.status !== 'success') {
    throw new Error(json.message || 'บันทึกสถานะดึงข้อมูลไม่สำเร็จ');
  }
  return json;
};

/**
 * Fetch which requisitions the branch has already received/confirmed, from the "รับของ" sheet.
 * Returns a map keyed by the formatted docNo (e.g. "HRS-4907") -> { branch, itemCount, hasEdit, lastRecordedAt }.
 */
export const fetchReceivedStatus = async () => {
  const response = await fetch('/api/received_status');
  const json = await response.json();
  if (!response.ok || json.status !== 'success') {
    throw new Error(json.message || 'โหลดสถานะรับของไม่สำเร็จ');
  }
  return json.receivedDocNos || {};
};

/**
 * Per-item "จำนวนส่ง" (qty actually packed) for one requisition, from the "จัดของ" sheet.
 * Returns a map keyed by item code -> { qtySent, status, recordedAt }.
 */
export const fetchFulfillmentItemsDetail = async (docNo) => {
  const response = await fetch(`/api/fulfillment_items_detail?docNo=${encodeURIComponent(docNo)}`);
  const json = await response.json();
  if (!response.ok || json.status !== 'success') {
    throw new Error(json.message || 'โหลดข้อมูลจำนวนที่ส่งไม่สำเร็จ');
  }
  return json.items || {};
};

/**
 * Per-item "จำนวนที่สาขารับจริง" + edit reason/photo/approval, from the "รับของ" sheet.
 * Returns a map keyed by item code -> { qtyReceived, status, note, photoUrl, approvedBy, approvedAt, ... }.
 */
export const fetchReceivedItemsDetail = async (docNo) => {
  const response = await fetch(`/api/received_items_detail?docNo=${encodeURIComponent(docNo)}`);
  const json = await response.json();
  if (!response.ok || json.status !== 'success') {
    throw new Error(json.message || 'โหลดข้อมูลการรับของไม่สำเร็จ');
  }
  return json.items || {};
};

/**
 * Which requisitions have been marked "ดึงข้อมูลแล้ว" (data fetched), read back from the
 * "ดึงข้อมูลใบเบิก" Google Sheet tab — the durable source of truth (mark_fetched's local-file
 * cache does not survive across serverless invocations, so relying on it alone silently loses
 * the fetched flag in production).
 * Returns a map keyed by the formatted docNo (e.g. "HRS-4907") -> { branch, date, fetchedAt }.
 */
export const fetchFetchedStatus = async () => {
  const response = await fetch('/api/fetched_status');
  const json = await response.json();
  if (!response.ok || json.status !== 'success') {
    throw new Error(json.message || 'โหลดสถานะดึงข้อมูลไม่สำเร็จ');
  }
  return json.fetchedDocNos || {};
};

/**
 * All branch-reported receiving discrepancies not yet approved by the warehouse, grouped by
 * docNo. Powers the "ตรวจสอบสถานะ" menu's notification badge/list.
 */
export const fetchPendingEditApprovals = async () => {
  const response = await fetch('/api/pending_edit_approvals');
  const json = await response.json();
  if (!response.ok || json.status !== 'success') {
    throw new Error(json.message || 'โหลดรายการรออนุมัติไม่สำเร็จ');
  }
  return { count: json.count || 0, docs: json.docs || [] };
};

/**
 * Which requisitions have been cancelled ("ยกใบเบิก"), read from the "ยกเลิกใบเบิก" Google Sheet
 * tab. Returns a map keyed by the formatted docNo (e.g. "CRM-3450") ->
 * { branch, deldate, itemCount, recorder, cancelledAt }.
 */
export const fetchCancelledStatus = async () => {
  const response = await fetch('/api/cancelled_status');
  const json = await response.json();
  if (!response.ok || json.status !== 'success') {
    throw new Error(json.message || 'โหลดสถานะยกเลิกใบเบิกไม่สำเร็จ');
  }
  return json.cancelledDocNos || {};
};

/**
 * Warehouse approves one branch-reported receiving discrepancy.
 */
export const approveReceivedEdit = async ({ docNo, code, approvedBy }) => {
  const response = await fetch('/api/approve_received_edit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ docNo, code, approvedBy })
  });
  const json = await response.json();
  if (!response.ok || json.status !== 'success') {
    throw new Error(json.message || 'อนุมัติไม่สำเร็จ');
  }
  return json;
};

/**
 * Fetch detailed line items for a specific requisition from myfbdata.orderd & myfbdata.item
 */
export const fetchRequisitionDetail = async (orderNo, outletId = '') => {
  try {
    if (!orderNo) throw new Error("ไม่ระบุเลขที่ใบเบิก");

    const cleanNo = String(orderNo).replace(/[^0-9]/g, '');
    const response = await fetch(`/api/pending_orders?no=${cleanNo || orderNo}&outletId=${outletId}`);
    if (response.ok) {
      const json = await response.json();
      if (json.status === 'success') {
        return json;
      }
    }

    throw new Error("ไม่พบรายละเอียดใบเบิกเลขที่ " + orderNo);
  } catch (err) {
    console.error("fetchRequisitionDetail Error:", err);
    throw err;
  }
};
