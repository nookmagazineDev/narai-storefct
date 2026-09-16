// ข้อมูลงานสโตร์ (จัดของ / รับของ / ดึงข้อมูลใบเบิก / ยกเลิกใบเบิก) บน SQL Server
//
// ตารางอยู่ที่ `InventoryNarai` ที่ออฟฟิศ เข้าถึงผ่าน office-server เท่านั้น เพราะไฟร์วอลล์
// เปิดพอร์ต 1433 ให้เฉพาะ IP ในไทย — ดู lib/officeServer.js และ docs/office-server.md
//
// ทำไมมาอยู่ที่นี่แทน MySQL: ชีท 'รับของ' เขียนโดยแอป Narai-branch ซึ่งอยู่บน SQL Server อยู่แล้ว
// การมาอยู่ที่เดียวกันทำให้สองแอปอ่านเขียนตารางเดียวกันตรงๆ ไม่ต้องมีสะพานซิงก์ชีทค้างถาวร
// ข้อแลกที่ยอมรับแล้ว: ถ้าเครื่องที่ออฟฟิศดับ โกดังจะบันทึกจัดของไม่ได้ (เดิมเขียนลงชีทได้)
//
// ---------------------------------------------------------------------------
// สวิตช์ STORE_SOURCE — ตัวนี้สำคัญ อย่าเปิดก่อนเวลา
// ---------------------------------------------------------------------------
//   'sheet' (ค่าเริ่มต้น) = อ่าน/เขียน Google Sheet เหมือนเดิมทุกประการ
//   'sql'                = อ่าน/เขียน SQL Server ผ่าน office-server
//
// ค่าเริ่มต้นเป็น 'sheet' เพราะ action ฝั่ง office-server อยู่คนละ repo (Narai-branch) และต้อง
// ถูก deploy ขึ้นเครื่องที่ออฟฟิศก่อน ถ้าสลับมา 'sql' ตั้งแต่ยังไม่ deploy หน้าเว็บจะพังทันที
//
// ลำดับที่ถูกต้อง:
//   1. รัน docs/schema-store-sqlserver.sql บนเครื่องที่ออฟฟิศ
//   2. apply แพตช์ office-server (เพิ่ม action) แล้ว Restart-Service NaraiUsageAPI
//   3. ย้ายข้อมูลเก่าจากชีทเข้าตาราง
//   4. ตั้ง STORE_SOURCE=sql บน Vercel แล้ว redeploy

import { callOffice } from './officeServer.js';

/** 'sheet' (เดิม) หรือ 'sql' (SQL Server ผ่าน office-server) — อ่าน env ตอนเรียก ไม่ใช่ตอน import */
export const storeSource = () => (process.env.STORE_SOURCE === 'sql' ? 'sql' : 'sheet');

/** true เมื่อสลับมาใช้ SQL Server แล้ว */
export const isSqlSource = () => storeSource() === 'sql';

/**
 * normalize รหัสสินค้า: ตัด quote นำหน้าที่ชีทใส่มา, ตัด .0 ท้าย, ตัด 0 นำหน้า
 * ชีทแต่ละใบเขียนรหัสไม่ตรงกัน ('00123' / '123' / 123.0) ถ้าเทียบตรงๆ จะจับคู่ไม่เจอ
 * กติกาเดียวกับ normCode ของโปรเจกต์ Narai-branch เพื่อให้ item_key ตรงกันข้ามระบบ
 */
export const normCode = (code) =>
  String(code === null || code === undefined ? '' : code)
    .replace(/^'/, '')
    .trim()
    .replace(/\.0+$/, '')
    .replace(/^0+/, '')
    .trim();

/** เวลาไทยตอนนี้ 'YYYY-MM-DD HH:mm:ss' — Vercel รันเป็น UTC จึงแปลงโซนเวลาเองเสมอ */
export function bangkokNowSql() {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Bangkok' });
}

/**
 * แยกเลขที่ใบเบิกที่หน้าเว็บใช้ ('CRM-3451' หรือ 'REQ-3451') เป็นรหัสสาขากับเลขใบ
 * คืน ordNo = null ถ้าไม่มีส่วนตัวเลข (จะได้ไม่เขียนเลข 0 มั่วลงฐาน)
 */
export function splitDocNo(docNo) {
  const str = String(docNo || '').trim().toUpperCase();
  const m = str.match(/^([A-Z]*)-?(\d+)$/);
  if (!m) return { branchCode: '', ordNo: null };
  return { branchCode: m[1] === 'REQ' ? '' : m[1], ordNo: Number(m[2]) };
}

const ymdOrNull = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : null);

// ---------------------------------------------------------------------------
// ฝั่งเขียน
//
// ต่างจากตอนที่ยังเป็น dual-write ลง MySQL: ตอนนี้ SQL Server คือที่เดียวที่เก็บข้อมูล
// การเขียนพลาดจึงต้อง "ดังพอให้รู้" ไม่ใช่กลืนไว้เงียบๆ แล้วบอกผู้ใช้ว่าบันทึกสำเร็จ
// ---------------------------------------------------------------------------

/**
 * บันทึกการจัดของ — หนึ่งแถวต่อหนึ่ง (ใบเบิก, สินค้า) ฝั่ง SQL ทำ MERGE ทับแถวเดิม
 * @throws {Error} ข้อความไทยบอกสาเหตุ เมื่อ office-server ติดต่อไม่ได้หรือเขียนไม่สำเร็จ
 */
export function writeFulfillment({ docNo, outletId, branch, date, items }) {
  const { ordNo } = splitDocNo(docNo);
  const recordedAt = bangkokNowSql();

  // กันรายการซ้ำรหัสเดียวกันในคำขอเดียว — แถวหลังสุดชนะ กติกาเดียวกับที่ฝั่งอ่านชีทใช้
  const byKey = new Map();
  for (const it of items || []) {
    const itemCode = String(it.itemCode || it.itemId || '').trim();
    const itemKey = normCode(itemCode);
    if (!itemKey) continue;
    byKey.set(itemKey, {
      itemKey,
      itemCode,
      itemName: String(it.itemName || '').trim().slice(0, 255),
      reqQty: Number(it.qty) || 0,
      delQty: Number(it.delQty !== undefined ? it.delQty : it.qty) || 0,
      status: String(it.status || 'ยืนยัน').trim().slice(0, 50),
      note: String(it.note || '').trim().slice(0, 500),
    });
  }

  return callOffice('saveFulfillment', {
    docNo: String(docNo).trim(),
    outletId: Number(outletId) || null,
    ordNo,
    branch: String(branch || '').trim(),
    delDate: ymdOrNull(date),
    recordedAt,
    items: [...byKey.values()],
  });
}

/**
 * บันทึกธง "ดึงข้อมูลแล้ว"
 *
 * คีย์คือ (outletId, ordNo) ไม่ใช่ docNo เพราะใบเบิกเลขเดียวกันมีได้หลายสาขา — ชีทเดิม
 * แยกสองใบนี้ออกจากกันไม่ได้มาตั้งแต่ต้น
 */
export function writeFetched({ outletId, no, docNo, branch, date }) {
  return callOffice('markFetched', {
    outletId: Number(outletId),
    ordNo: Number(no),
    docNo: String(docNo || '').trim(),
    branch: String(branch || '').trim(),
    delDate: ymdOrNull(date),
    fetchedAt: bangkokNowSql(),
  });
}

/** โกดังอนุมัติรายการที่สาขาแจ้งแก้ไข */
export function writeApproval({ docNo, code, approvedBy }) {
  return callOffice('approveReceivedEdit', {
    docNo: String(docNo).trim(),
    itemKey: normCode(code),
    approvedBy: String(approvedBy || 'โกดัง').trim().slice(0, 255),
    approvedAt: bangkokNowSql(),
  });
}

// ---------------------------------------------------------------------------
// ฝั่งอ่าน
//
// คืนรูปแบบเดียวกับที่ตัวอ่านชีทเดิมคืนเป๊ะ เพื่อให้ endpoint ใน server.js สลับแหล่งข้อมูล
// ได้โดยไม่ต้องแก้ตรรกะที่ใช้ผลลัพธ์ และย้อนกลับไป 'sheet' ได้ทันทีถ้ามีอะไรผิด
// ---------------------------------------------------------------------------

/** สถานะรับของรายใบ -> { [docNo]: { branch, itemCount, hasEdit, lastRecordedAt } } */
export async function readReceivedStatus() {
  const rows = await callOffice('getStoreReceivingStatus', {});
  const receivedDocNos = {};
  for (const r of rows || []) {
    const docNo = String(r.docNo || '').trim();
    if (!docNo) continue;
    receivedDocNos[docNo] = {
      branch: String(r.branch || '').trim(),
      itemCount: Number(r.itemCount) || 0,
      hasEdit: Boolean(r.hasEdit),
      lastRecordedAt: r.lastRecordedAt || '',
    };
  }
  return receivedDocNos;
}

/** ใบเบิกที่ดึงข้อมูลแล้ว -> { [docNo]: {...} } และ { [outletId|ordNo]: {...} } */
export async function readFetchedStatus() {
  const rows = await callOffice('getStoreFetchedLog', {});
  const byDocNo = {};
  const byOrder = {};
  for (const r of rows || []) {
    const entry = {
      branch: String(r.branch || '').trim(),
      date: r.delDate || '',
      fetchedAt: r.fetchedAt || '',
    };
    const docNo = String(r.docNo || '').trim();
    if (docNo) byDocNo[docNo] = entry;
    if (r.outletId !== null && r.outletId !== undefined && r.ordNo !== null && r.ordNo !== undefined) {
      byOrder[`${r.outletId}|${r.ordNo}`] = { ...entry, docNo, outletId: r.outletId, no: r.ordNo };
    }
  }
  return { byDocNo, byOrder };
}

/** ใบเบิกที่ถูกยกเลิก -> { [docNo]: {...} } */
export async function readCancelledStatus() {
  const rows = await callOffice('getStoreCancelledDocs', {});
  const cancelledDocNos = {};
  for (const r of rows || []) {
    const docNo = String(r.docNo || '').trim();
    if (!docNo) continue;
    cancelledDocNos[docNo] = {
      branch: String(r.branch || '').trim(),
      deldate: r.delDate || '',
      itemCount: Number(r.itemCount) || 0,
      recorder: String(r.recorder || '').trim(),
      cancelledAt: r.cancelledAt || '',
    };
  }
  return cancelledDocNos;
}

/** จำนวนที่จัดส่งจริงรายไอเทมของใบเดียว -> { [itemCode]: { delQty, status, note } } */
export async function readFulfillmentDetail(docNo) {
  const rows = await callOffice('getStoreFulfillmentDetail', { docNo: String(docNo).trim() });
  const byCode = {};
  for (const r of rows || []) {
    const code = String(r.itemCode || r.itemKey || '').trim();
    if (!code) continue;
    byCode[code] = {
      code,
      delQty: Number(r.delQty) || 0,
      status: String(r.status || '').trim(),
      note: String(r.note || '').trim(),
    };
  }
  return byCode;
}

/** รายละเอียดการรับของของใบเดียว -> { [itemCode]: {...} } */
export async function readReceivedDetail(docNo) {
  const rows = await callOffice('getStoreReceivingDetail', { docNo: String(docNo).trim() });
  const byCode = {};
  for (const r of rows || []) {
    const code = String(r.itemCode || r.itemKey || '').trim();
    if (!code) continue;
    byCode[code] = {
      code,
      qtyReceived: Number(r.qtyReceived) || 0,
      status: String(r.status || '').trim(),
      note: String(r.note || '').trim(),
      photoUrl: String(r.photoUrl || '').trim(),
      recorder: String(r.recorder || '').trim(),
      recordedAt: r.recordedAt || '',
      approvedBy: String(r.approvedBy || '').trim(),
      approvedAt: r.approvedAt || '',
    };
  }
  return byCode;
}

/**
 * รายการแก้ไขที่สาขาแจ้งแล้วโกดังยังไม่อนุมัติ จัดกลุ่มตามใบเบิก
 *
 * ชื่อฟิลด์ต้องตรงกับที่ตัวอ่านชีทเดิมคืนเป๊ะ (qtySent / qtyReceived / photoUrl ...) เพราะ
 * หน้า "ตรวจสอบสถานะ" อ่านชื่อพวกนี้ตรงๆ — สลับแหล่งข้อมูลแล้วหน้าเว็บต้องไม่รู้สึกอะไรเลย
 */
export async function readPendingEditApprovals() {
  const rows = await callOffice('getStorePendingEditApprovals', {});

  const byDocNo = {};
  let count = 0;
  for (const r of rows || []) {
    const docNo = String(r.docNo || '').trim();
    const code = String(r.itemCode || r.itemKey || '').trim();
    if (!docNo || !code) continue;
    const branch = String(r.branch || '').trim();
    if (!byDocNo[docNo]) byDocNo[docNo] = { docNo, branch, items: [] };
    byDocNo[docNo].items.push({
      docNo,
      branch,
      code,
      name: String(r.itemName || '').trim(),
      qtyRequested: Number(r.reqQty) || 0,
      qtySent: Number(r.delQty) || 0,
      qtyReceived: Number(r.qtyReceived) || 0,
      status: String(r.status || '').trim(),
      note: String(r.note || '').trim(),
      photoUrl: String(r.photoUrl || '').trim(),
      recorder: String(r.recorder || '').trim(),
      recordedAt: r.recordedAt || '',
      approvedBy: String(r.approvedBy || '').trim(),
    });
    count++;
  }

  // เรียงใบที่มีรายการค้างเยอะสุดขึ้นก่อน เหมือนทางชีท
  const docs = Object.values(byDocNo).sort((a, b) => b.items.length - a.items.length);
  return { count, docCount: docs.length, docs };
}
