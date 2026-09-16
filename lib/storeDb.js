// ตารางงานสโตร์บน MySQL (ฐาน narai_store) — ตัวเขียนและตัวซิงก์จากชีท
//
// สถานะตอนนี้: dual-write เฟสแรก
//   ทุกครั้งที่หน้าเว็บบันทึกอะไร จะเขียนลงทั้ง Google Sheet (ของเดิม) และ MySQL (ของใหม่)
//   ส่วน "ฝั่งอ่าน" ยังอ่านจากชีทเหมือนเดิมทุกจุด ยังไม่แตะ
//
// ตั้งใจให้เป็นแบบนี้เพื่อให้ย้อนกลับได้ทันทีถ้ามีอะไรผิด: ปิดตัวแปร STORE_DB_WRITE แล้วระบบ
// กลับไปทำงานเหมือนก่อนหน้านี้ทุกประการ เพราะไม่มีใครอ่านจาก MySQL เลย และการเขียนฝั่ง MySQL
// ที่ล้มเหลวจะไม่ทำให้คำขอของผู้ใช้พัง (best-effort — log ไว้เฉยๆ)
//
// จะสลับฝั่งอ่านมาที่ MySQL ได้ก็ต่อเมื่อเทียบข้อมูลสองฝั่งแล้วตรงกัน (ดู scripts/sync-store-db.mjs)
//
// เปิดใช้งาน:
//   1. รัน docs/schema-store.sql ครั้งเดียว
//   2. รัน `node scripts/sync-store-db.mjs` เพื่อย้ายข้อมูลเก่าจากชีทเข้า MySQL
//   3. ตั้ง STORE_DB_WRITE=1 ใน .env (local) หรือ Environment Variables ของ Vercel

import { getPool, queryRead, t } from './db.js';
import { fetchSheetRows, cellStr, cellNum, cellYmd, cellDateTime, parseDateTimeString, SHEET_GID, SHEET_NAME } from './sheets.js';

/**
 * เปิด/ปิดการเขียนลง MySQL
 *
 * ค่าตั้งต้นคือ "ปิด" โดยตั้งใจ — โค้ดชุดนี้ถูก deploy ขึ้นไปได้โดยไม่เปลี่ยนพฤติกรรมอะไรเลย
 * จนกว่าจะรันสคีมาเสร็จแล้วค่อยมาเปิดสวิตช์ ถ้าเปิดไว้ตั้งแต่แรกโดยที่ยังไม่มีตาราง จะได้
 * error "table doesn't exist" ทุกครั้งที่มีคนกดบันทึก
 */
export const isWriteEnabled = () => process.env.STORE_DB_WRITE === '1';

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

/** เวลาไทยตอนนี้ในรูปแบบที่ MySQL รับตรงๆ — Vercel รันเป็น UTC จึงแปลงโซนเวลาเองเสมอ */
export function bangkokNowSql() {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Bangkok' }); // 'YYYY-MM-DD HH:mm:ss'
}

/**
 * แปลง Date เป็นสตริง 'YYYY-MM-DD HH:mm:ss'
 *
 * ส่งเป็นสตริงแทนที่จะส่ง object Date เข้าไปตรงๆ เพราะ mysql2 จะแปลงโซนเวลาให้ตาม timezone
 * ของ connection ซึ่งบน Vercel (UTC) กับเครื่องที่ออฟฟิศ (ไทย) ให้ผลต่างกัน 7 ชั่วโมง
 * สตริงถูกส่งไปตามตัวอักษร ไม่มีการแปลงระหว่างทาง
 */
export function toSqlDateTime(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`;
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

// รอการเขียน MySQL ได้นานสุดเท่าไหร่ก่อนจะปล่อยให้คำขอของผู้ใช้เดินต่อ
//
// ตั้งไว้ต่ำกว่า connectTimeout ของ pool (15 วินาที) โดยตั้งใจ: ก่อนหน้านี้การกดบันทึกไม่ได้
// พึ่งฐานข้อมูลเลย ถ้าเครื่องที่ออฟฟิศดับแล้วปล่อยให้รอจนครบ คนกดบันทึกจะค้างหน้าจอ 15 วินาที
// ทั้งที่ชีทเขียนสำเร็จไปแล้ว — คำสั่งที่ยังค้างอยู่ปล่อยให้วิ่งต่อได้ ไม่เสียหาย เพราะเป็น
// UPSERT ที่เขียนซ้ำแล้วได้ผลเหมือนเดิม
const WRITE_TIMEOUT_MS = 8000;

/** ครอบการเขียน MySQL ให้ล้ม/ช้าแล้วไม่ทำให้คำขอของผู้ใช้พัง — ใช้กับ dual-write ทุกจุด */
async function bestEffort(label, fn) {
  if (!isWriteEnabled()) return { skipped: true };
  try {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`เกิน ${WRITE_TIMEOUT_MS} ms`)), WRITE_TIMEOUT_MS);
    });
    try {
      return await Promise.race([fn(), timeout]);
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    console.warn(`MySQL dual-write (${label}) ไม่สำเร็จ — ชีทยังเป็นตัวหลักอยู่:`, err.message);
    return { error: err.message };
  }
}

// ---------------------------------------------------------------------------
// จัดของ
// ---------------------------------------------------------------------------

const FULFILLMENT_COLS = [
  'doc_no', 'outlet_id', 'ord_no', 'branch', 'del_date',
  'item_key', 'item_code', 'item_name', 'req_qty', 'del_qty',
  'status', 'note', 'recorded_at', 'source',
];

/**
 * UPSERT แถวจัดของเป็นชุด
 *
 * ชีทเป็น log ต่อท้ายแล้วให้ฝั่งอ่าน "เอาแถวหลังสุดชนะ" ตารางนี้เก็บผลของกติกานั้นไว้เลย
 * บันทึกซ้ำใบเดิม = ทับแถวเดิม จึงย้ายข้อมูลจากชีทซ้ำกี่รอบก็ไม่เกิดแถวซ้ำ
 */
async function upsertFulfillmentRows(rows) {
  if (rows.length === 0) return { affected: 0 };
  const placeholders = rows.map(() => `(${FULFILLMENT_COLS.map(() => '?').join(',')})`).join(',');
  const values = rows.flatMap(r => FULFILLMENT_COLS.map(c => r[c]));
  const [result] = await getPool().query(
    `INSERT INTO ${t('fulfillment')} (${FULFILLMENT_COLS.map(c => `\`${c}\``).join(',')})
     VALUES ${placeholders}
     ON DUPLICATE KEY UPDATE
       outlet_id   = COALESCE(VALUES(outlet_id), outlet_id),
       ord_no      = COALESCE(VALUES(ord_no), ord_no),
       branch      = VALUES(branch),
       del_date    = COALESCE(VALUES(del_date), del_date),
       item_code   = VALUES(item_code),
       item_name   = VALUES(item_name),
       req_qty     = VALUES(req_qty),
       del_qty     = VALUES(del_qty),
       status      = VALUES(status),
       note        = VALUES(note),
       recorded_at = COALESCE(VALUES(recorded_at), recorded_at),
       source      = VALUES(source)`,
    values
  );
  return { affected: result.affectedRows };
}

/**
 * บันทึกการจัดของลง MySQL (คู่ขนานกับการเขียนชีทใน POST /api/save_fulfillment)
 * @param {{docNo:string, outletId?:number, branch?:string, date?:string, items:Array}} payload
 */
export function writeFulfillment({ docNo, outletId, branch, date, items }) {
  return bestEffort('จัดของ', async () => {
    const { ordNo } = splitDocNo(docNo);
    const recordedAt = bangkokNowSql();

    // กันรายการซ้ำรหัสเดียวกันในคำขอเดียว — MySQL จะ error ถ้า VALUES ชุดเดียวมีคีย์ซ้ำกันเอง
    // (แถวหลังสุดชนะ กติกาเดียวกับที่ฝั่งอ่านชีทใช้)
    const byKey = new Map();
    for (const it of items) {
      const itemCode = String(it.itemCode || it.itemId || '').trim();
      const itemKey = normCode(itemCode);
      if (!itemKey) continue;
      byKey.set(itemKey, {
        doc_no: String(docNo).trim(),
        outlet_id: Number(outletId) || null,
        ord_no: ordNo,
        branch: String(branch || '').trim(),
        del_date: /^\d{4}-\d{2}-\d{2}$/.test(String(date || '')) ? date : null,
        item_key: itemKey,
        item_code: itemCode,
        item_name: String(it.itemName || '').trim().slice(0, 255),
        req_qty: Number(it.qty) || 0,
        del_qty: Number(it.delQty !== undefined ? it.delQty : it.qty) || 0,
        status: String(it.status || 'ยืนยัน').trim().slice(0, 50),
        note: String(it.note || '').trim().slice(0, 500),
        recorded_at: recordedAt,
        source: 'app',
      });
    }
    return upsertFulfillmentRows([...byKey.values()]);
  });
}

// ---------------------------------------------------------------------------
// ดึงข้อมูลใบเบิกแล้ว
// ---------------------------------------------------------------------------

/**
 * บันทึกธง "ดึงข้อมูลแล้ว" ลง MySQL
 *
 * ตารางนี้มาแทน fetched_status.json ที่เขียนไม่ติดบน Vercel (ไฟล์ระบบอ่านอย่างเดียว) — ซึ่ง
 * เป็นเหตุผลเดียวกับที่ต้องไป log ลงชีทตั้งแต่แรก ต่างกันตรงที่ MySQL อ่านกลับมาได้ทันที
 * ไม่ต้องรอ cache 15 นาทีเหมือนชีท
 */
export function writeFetched({ outletId, no, docNo, branch, date }) {
  return bestEffort('ดึงข้อมูลใบเบิก', async () => {
    const [result] = await getPool().query(
      `INSERT INTO ${t('fetched_log')} (outlet_id, ord_no, doc_no, branch, del_date, fetched_at, source)
       VALUES (?, ?, ?, ?, ?, ?, 'app')
       ON DUPLICATE KEY UPDATE
         doc_no     = VALUES(doc_no),
         branch     = VALUES(branch),
         del_date   = COALESCE(VALUES(del_date), del_date),
         fetched_at = VALUES(fetched_at),
         source     = VALUES(source)`,
      [
        Number(outletId),
        Number(no),
        String(docNo || '').trim(),
        String(branch || '').trim(),
        /^\d{4}-\d{2}-\d{2}$/.test(String(date || '')) ? date : null,
        bangkokNowSql(),
      ]
    );
    return { affected: result.affectedRows };
  });
}

// ---------------------------------------------------------------------------
// รับของ — อนุมัติรายการที่สาขาแจ้งแก้ไข
// ---------------------------------------------------------------------------

/**
 * บันทึกการอนุมัติลง MySQL (คู่ขนานกับ approveReceivedEdit ของ Apps Script)
 *
 * แถวในตาราง receiving มาจากการซิงก์ชีทเท่านั้นตราบใดที่แอป Narai-branch ยังเขียนชีทอยู่
 * ถ้ายังซิงก์ไม่ถึงแถวนั้น UPDATE จะไม่โดนอะไรเลย (affected = 0) ซึ่งไม่ถือว่าผิดพลาด —
 * รอบซิงก์ถัดไปจะดึงค่าอนุมัติจากชีทมาเองอยู่แล้ว เพราะ Apps Script เขียนคอลัมน์ N/O ให้
 */
export function writeApproval({ docNo, code, approvedBy, approvedAt }) {
  return bestEffort('อนุมัติรับของ', async () => {
    const [result] = await getPool().query(
      `UPDATE ${t('receiving')}
          SET approved_by = ?, approved_at = ?
        WHERE doc_no = ? AND item_key = ?`,
      [
        String(approvedBy || 'โกดัง').trim().slice(0, 100),
        // Apps Script ตอบกลับมาเป็น 'dd/MM/yyyy HH:mm:ss' ซึ่ง MySQL อ่านไม่ออก ต้องแปลงก่อน
        toSqlDateTime(parseDateTimeString(approvedAt)) || bangkokNowSql(),
        String(docNo).trim(),
        normCode(code),
      ]
    );
    return { affected: result.affectedRows };
  });
}

// ---------------------------------------------------------------------------
// ซิงก์ชีท -> MySQL
//
// ใช้สองจังหวะ: ย้ายข้อมูลเก่าครั้งแรก และตามเก็บสิ่งที่ระบบอื่นเขียนลงชีทระหว่างที่ยัง
// ไม่ได้ย้ายตาม (หน้ารับของของ Narai-branch และตัวที่ log ใบยกเลิก)
// ---------------------------------------------------------------------------

/** ซิงก์แท็บ "จัดของ" — ใช้ตอนย้ายข้อมูลเก่าครั้งแรกเท่านั้น ของใหม่เขียนตรงอยู่แล้ว */
export async function syncFulfillment() {
  const rows = await fetchSheetRows({ gid: SHEET_GID.fulfillment });
  // A วันที่ B สาขา C รหัส D ชื่อ E จำนวนเบิก F จำนวนส่ง G เลขที่ใบเบิก H สถานะ I เวลาบันทึก J หมายเหตุ
  const byKey = new Map(); // แถวหลังสุดของ (ใบเบิก, สินค้า) ชนะ — ตรงกับกติกาที่ฝั่งอ่านชีทใช้
  for (const row of rows) {
    const c = row.c || [];
    const docNo = cellStr(c[6]);
    const itemKey = normCode(cellStr(c[2]));
    if (!docNo || !itemKey) continue;
    const { ordNo } = splitDocNo(docNo);
    byKey.set(`${docNo}|${itemKey}`, {
      doc_no: docNo,
      outlet_id: null, // ชีทไม่ได้เก็บรหัสสาขาที่เป็นตัวเลขไว้ — เติมทีหลังได้จาก ord_no + branch
      ord_no: ordNo,
      branch: cellStr(c[1]),
      del_date: cellYmd(c[0]),
      item_key: itemKey,
      item_code: cellStr(c[2]).replace(/^'/, ''),
      item_name: cellStr(c[3]).slice(0, 255),
      req_qty: cellNum(c[4]),
      del_qty: cellNum(c[5]),
      status: cellStr(c[7]).slice(0, 50),
      note: cellStr(c[9]).slice(0, 500),
      // ไม่ใส่เวลาปัจจุบันแทนเมื่ออ่านไม่ออก — แถวเก่าจะได้ไม่ดูเหมือนเพิ่งบันทึกเมื่อกี้
      recorded_at: toSqlDateTime(cellDateTime(c[8])),
      source: 'sheet',
    });
  }
  const list = [...byKey.values()];
  // แบ่งเป็นก้อนละ 500 แถว — คำสั่ง INSERT ก้อนเดียวที่ยาวเกิน max_allowed_packet จะถูกปฏิเสธ
  for (let i = 0; i < list.length; i += 500) {
    await upsertFulfillmentRows(list.slice(i, i + 500));
  }
  return { sheetRows: rows.length, upserted: list.length };
}

const RECEIVING_COLS = [
  'doc_no', 'branch', 'receive_date', 'item_key', 'item_code', 'item_name',
  'req_qty', 'del_qty', 'qty_received', 'status', 'note', 'photo_url',
  'recorder', 'recorded_at', 'approved_by', 'approved_at', 'source',
];

/** ซิงก์แท็บ "รับของ" (เขียนโดยแอป Narai-branch) */
export async function syncReceiving() {
  const rows = await fetchSheetRows({ gid: SHEET_GID.receiving });
  // A วันที่รับ B สาขา C เลขที่ใบเบิก D รหัส E ชื่อ F จำนวนเบิก G จำนวนส่ง H จำนวนที่รับจริง
  // I สถานะ J หมายเหตุ K รูปภาพ L ผู้บันทึก M เวลาบันทึก N อนุมัติจากโกดัง O เวลาอนุมัติ
  const byKey = new Map();
  for (const row of rows) {
    const c = row.c || [];
    const docNo = cellStr(c[2]);
    const itemKey = normCode(cellStr(c[3]));
    if (!docNo || !itemKey) continue;
    byKey.set(`${docNo}|${itemKey}`, {
      doc_no: docNo,
      branch: cellStr(c[1]),
      receive_date: cellYmd(c[0]),
      item_key: itemKey,
      item_code: cellStr(c[3]).replace(/^'/, ''),
      item_name: cellStr(c[4]).slice(0, 255),
      req_qty: cellNum(c[5]),
      del_qty: cellNum(c[6]),
      qty_received: cellNum(c[7]),
      status: cellStr(c[8]).slice(0, 50),
      note: cellStr(c[9]).slice(0, 500),
      photo_url: cellStr(c[10]).slice(0, 500),
      recorder: cellStr(c[11]).slice(0, 100),
      recorded_at: toSqlDateTime(cellDateTime(c[12])),
      approved_by: cellStr(c[13]).slice(0, 100),
      approved_at: toSqlDateTime(cellDateTime(c[14])),
      source: 'sheet',
    });
  }
  const list = [...byKey.values()];
  for (let i = 0; i < list.length; i += 500) {
    const chunk = list.slice(i, i + 500);
    const placeholders = chunk.map(() => `(${RECEIVING_COLS.map(() => '?').join(',')})`).join(',');
    const values = chunk.flatMap(r => RECEIVING_COLS.map(col => r[col]));
    await getPool().query(
      `INSERT INTO ${t('receiving')} (${RECEIVING_COLS.map(col => `\`${col}\``).join(',')})
       VALUES ${placeholders}
       ON DUPLICATE KEY UPDATE
         branch       = VALUES(branch),
         receive_date = COALESCE(VALUES(receive_date), receive_date),
         item_code    = VALUES(item_code),
         item_name    = VALUES(item_name),
         req_qty      = VALUES(req_qty),
         del_qty      = VALUES(del_qty),
         qty_received = VALUES(qty_received),
         status       = VALUES(status),
         note         = VALUES(note),
         photo_url    = VALUES(photo_url),
         recorder     = VALUES(recorder),
         recorded_at  = COALESCE(VALUES(recorded_at), recorded_at),
         /* การอนุมัติอาจถูกบันทึกลง MySQL ไปก่อนแล้วโดยที่ชีทยังตามมาไม่ทัน (dual-write)
            จึงไม่ยอมให้ค่าว่างจากชีทมาลบของที่มีอยู่แล้วทิ้ง */
         approved_by  = IF(VALUES(approved_by) = '', approved_by, VALUES(approved_by)),
         approved_at  = COALESCE(VALUES(approved_at), approved_at),
         source       = VALUES(source)`,
      values
    );
  }
  return { sheetRows: rows.length, upserted: list.length };
}

/** ซิงก์แท็บ "ดึงข้อมูลใบเบิก" — ใช้ตอนย้ายข้อมูลเก่าครั้งแรก */
export async function syncFetched() {
  let rows;
  try {
    rows = await fetchSheetRows({ sheet: SHEET_NAME.fetched });
  } catch (err) {
    return { sheetRows: 0, upserted: 0, note: 'ยังไม่มีแท็บนี้ในชีท' };
  }
  // A วันที่ B สาขา C เลขที่ใบเบิก D เวลาบันทึก
  //
  // ชีทไม่มีรหัสสาขาที่เป็นตัวเลข แต่คีย์ของตารางคือ (outlet_id, ord_no) จึงต้องหา outlet_id
  // จาก myfbdata.orderd โดยใช้เลขใบ + ชื่อสาขา ใบไหนจับคู่ไม่ได้จะถูกข้ามและรายงานกลับไป
  const wanted = [];
  for (const row of rows) {
    const c = row.c || [];
    const docNo = cellStr(c[2]);
    const { ordNo } = splitDocNo(docNo);
    if (!ordNo) continue;
    wanted.push({
      docNo,
      ordNo,
      branch: cellStr(c[1]),
      delDate: cellYmd(c[0]),
      fetchedAt: toSqlDateTime(cellDateTime(c[3])),
    });
  }
  if (wanted.length === 0) return { sheetRows: rows.length, upserted: 0, skipped: 0 };

  // orderd มี 2.2 ล้านแถว — ถาม IN (...) ก้อนเดียวที่ยาวเป็นพันเลขทำให้ query planner เลือก
  // full scan ได้ง่าย แบ่งเป็นก้อนละ 200 แล้วรวมผลเองเร็วกว่าและกิน memory ฝั่งเซิร์ฟเวอร์น้อยกว่า
  const ordNos = [...new Set(wanted.map(w => w.ordNo))];
  const owners = [];
  for (let i = 0; i < ordNos.length; i += 200) {
    const chunk = await queryRead(
      `SELECT DISTINCT o.Ord_No AS ordNo, o.Ord_StrID AS outletId, s.Str_Name AS branchName
         FROM orderd o
         LEFT JOIN store s ON o.Ord_StrID = s.Str_ID
        WHERE o.Ord_No IN (?)`,
      [ordNos.slice(i, i + 200)]
    );
    owners.push(...chunk);
  }

  // เลขใบเบิกซ้ำกันได้ข้ามสาขา จึงต้องเทียบชื่อสาขาด้วย ยกเว้นกรณีที่เลขนั้นมีสาขาเดียว
  const byOrdNo = new Map();
  for (const o of owners) {
    const list = byOrdNo.get(Number(o.ordNo)) || [];
    list.push(o);
    byOrdNo.set(Number(o.ordNo), list);
  }

  const resolved = [];
  let skipped = 0;
  for (const w of wanted) {
    const candidates = byOrdNo.get(w.ordNo) || [];
    const branchUpper = w.branch.toUpperCase();
    const match = candidates.length === 1
      ? candidates[0]
      : candidates.find(c => String(c.branchName || '').trim().toUpperCase() === branchUpper);
    if (!match) { skipped++; continue; }
    resolved.push([Number(match.outletId), w.ordNo, w.docNo, w.branch, w.delDate, w.fetchedAt, 'sheet']);
  }

  for (let i = 0; i < resolved.length; i += 500) {
    const chunk = resolved.slice(i, i + 500);
    await getPool().query(
      `INSERT INTO ${t('fetched_log')} (outlet_id, ord_no, doc_no, branch, del_date, fetched_at, source)
       VALUES ${chunk.map(() => '(?,?,?,?,?,?,?)').join(',')}
       ON DUPLICATE KEY UPDATE
         doc_no     = VALUES(doc_no),
         branch     = VALUES(branch),
         del_date   = COALESCE(VALUES(del_date), del_date),
         fetched_at = COALESCE(VALUES(fetched_at), fetched_at)`,
      chunk.flat()
    );
  }
  return { sheetRows: rows.length, upserted: resolved.length, skipped };
}

/** ซิงก์แท็บ "ยกเลิกใบเบิก" (มีระบบภายนอกเป็นคนเขียน) */
export async function syncCancelled() {
  let rows;
  try {
    rows = await fetchSheetRows({ sheet: SHEET_NAME.cancelled });
  } catch (err) {
    return { sheetRows: 0, upserted: 0, note: 'ยังไม่มีแท็บนี้ในชีท' };
  }
  // A วันที่สั่ง B สาขา C เลขที่ใบเบิก D วันที่รับ E จำนวนรายการ F ผู้บันทึก G เวลาที่ยกเลิก
  //
  // คอลัมน์ C เก็บเฉพาะตัวเลข ต้องประกอบกับชื่อสาขาเป็น 'CRM-3451' ให้ตรงกับรูปแบบที่หน้าเว็บ
  // ใช้ — กติกาเดียวกับ loadCancelledStatus() ใน server.js
  const byDoc = new Map();
  for (const row of rows) {
    const c = row.c || [];
    const branch = cellStr(c[1]);
    const rawNo = c[2]?.v;
    if (rawNo === null || rawNo === undefined || rawNo === '') continue;
    const docNo = `${branch.toUpperCase()}-${Math.round(Number(rawNo))}`;
    byDoc.set(docNo, [
      docNo,
      branch,
      cellYmd(c[0]),
      cellYmd(c[3]),
      cellNum(c[4]),
      cellStr(c[5]).slice(0, 100),
      toSqlDateTime(cellDateTime(c[6])),
      'sheet',
    ]);
  }
  const list = [...byDoc.values()];
  for (let i = 0; i < list.length; i += 500) {
    const chunk = list.slice(i, i + 500);
    await getPool().query(
      `INSERT INTO ${t('cancelled_doc')} (doc_no, branch, order_date, del_date, item_count, recorder, cancelled_at, source)
       VALUES ${chunk.map(() => '(?,?,?,?,?,?,?,?)').join(',')}
       ON DUPLICATE KEY UPDATE
         branch       = VALUES(branch),
         order_date   = COALESCE(VALUES(order_date), order_date),
         del_date     = COALESCE(VALUES(del_date), del_date),
         item_count   = VALUES(item_count),
         recorder     = VALUES(recorder),
         cancelled_at = COALESCE(VALUES(cancelled_at), cancelled_at)`,
      chunk.flat()
    );
  }
  return { sheetRows: rows.length, upserted: list.length };
}

/** ซิงก์ทุกแท็บ — ตัวที่ล้มไม่ทำให้ตัวอื่นหยุด จะได้เห็นภาพรวมครบในรอบเดียว */
export async function syncAll() {
  const jobs = [
    ['จัดของ', syncFulfillment],
    ['รับของ', syncReceiving],
    ['ดึงข้อมูลใบเบิก', syncFetched],
    ['ยกเลิกใบเบิก', syncCancelled],
  ];
  const result = {};
  for (const [label, fn] of jobs) {
    try {
      result[label] = await fn();
    } catch (err) {
      result[label] = { error: err.message };
    }
  }
  return result;
}

/** นับแถวในแต่ละตาราง — ใช้เทียบกับจำนวนในชีทว่าย้ายครบไหม */
export async function countRows() {
  const tables = ['fulfillment', 'receiving', 'fetched_log', 'cancelled_doc'];
  const out = {};
  for (const table of tables) {
    const rows = await queryRead(`SELECT COUNT(*) AS n FROM ${t(table)}`);
    out[table] = Number(rows[0]?.n) || 0;
  }
  return out;
}
