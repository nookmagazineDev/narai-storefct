import { apiCall } from './api';

// Branch code mapping - showing exact database branch names (Str_Name) without invented labels
export const BRANCH_MAP = {
  'all': { id: 'ALL', name: 'ทุกสาขา', code: 'ALL' },
  'sjp': { id: '7', name: 'SJP', code: 'SJP' },
  'crm': { id: '12', name: 'CRM', code: 'CRM' },
  'xcm': { id: '19', name: 'XCM', code: 'XCM' },
  'slr': { id: '37', name: 'SLR', code: 'SLR' },
  'sum': { id: '51', name: 'SUM', code: 'SUM' },
  'sts': { id: '55', name: 'STS', code: 'STS' },
  'xum': { id: '59', name: 'XUM', code: 'XUM' },
  'scs': { id: '61', name: 'SCS', code: 'SCS' },
  'smp': { id: '63', name: 'SMP', code: 'SMP' },
  'xsb': { id: '67', name: 'XSB', code: 'XSB' },
  'xhh': { id: '72', name: 'XHH', code: 'XHH' },
  'hrs': { id: '78', name: 'HRS', code: 'HRS' },
  'clk': { id: '79', name: 'CLK', code: 'CLK' },
  'p90': { id: '80', name: 'P90', code: 'P90' },
  'zbw': { id: '400', name: 'ZBW', code: 'ZBW' },
  'zpt': { id: '401', name: 'ZPT', code: 'ZPT' },
  'npt': { id: '500', name: 'NPT', code: 'NPT' },
  'wrm': { id: '501', name: 'WRM', code: 'WRM' },
  'wmt': { id: '503', name: 'WMT', code: 'WMT' },
  'hps': { id: '902', name: 'HPS', code: 'HPS' },
  'ipr': { id: '904', name: 'IPR', code: 'IPR' },
  'zk3': { id: '906', name: 'ZK3', code: 'ZK3' }
};

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
