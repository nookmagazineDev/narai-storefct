// ใบเบิกวัตถุดิบของครัวกลางไปคลังกลาง — แท็บ "เบิกตามแพลน" ของหน้าเบิกวัตถุดิบ
//
// ครัวกลางเป็นสาขาหนึ่งในระบบ POS (outlet 950 · ฐาน myfbdatafct) ใบเบิกจึงเข้าที่เดียวกับปุ่ม
// "สั่งของ" ของสาขา: myfbdata.orderd + invoice ประเภท TRF ส่งถึงคลังกลาง สโตร์เห็นในหน้าจัดของ
// เหมือนใบเบิกของสาขาทุกอย่าง
//
// ไม่เขียน orderd เอง แต่ส่งต่อไป /api/insert_order ของ Narai-branch ตัวเดียวกับที่สาขาใช้
//   - การหา itemId, ออกเลขใบจาก config.Cfg_LstOrdID, LOCK TABLES กันเลขชนกับเครื่อง POS
//     อยู่ที่นั่นที่เดียว ก๊อปมาไว้สองที่เมื่อไหร่ วันหนึ่งจะแก้ที่หนึ่งแล้วลืมอีกที่
//   - pool MySQL ของแอปนี้ใช้อ่านอย่างเดียว (lib/db.js)
//
//   เบราว์เซอร์ -> POST /api/kitchen_requisition (แอปนี้) -> narai-branch /api/insert_order -> MySQL

const env = (k) => String(process.env[k] || '').trim();

/** ที่อยู่เว็บ Narai-branch — อ่านตอนเรียก ไม่ใช่ตอน import (server.js โหลด .env ทีหลัง) */
export const naraiBranchBase = () => (env('NARAI_BRANCH_BASE') || 'https://narai-branch.vercel.app').replace(/\/+$/, '');
export const kitchenOutletId = () => Number(env('KITCHEN_OUTLET_ID')) || 950;
export const kitchenBranchCode = () => env('KITCHEN_BRANCH_CODE') || 'fct';

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/**
 * ส่งใบเบิกหนึ่งใบ — ไม่ลองซ้ำอัตโนมัติ: คำขออาจถึงปลายทางแล้วแต่คำตอบหายกลางทาง
 * ยิงซ้ำจะได้ใบเบิกซ้ำอีกใบ ให้คนดูรายการ "ส่งไปแล้ว" แล้วตัดสินใจเอง
 *
 * @param {{ deldate: string, items: Array<{ itemCode, itemName, qty, unit, price }> }} body
 * @returns {Promise<object>} คำตอบของ insert_order ({ orderNo, count, ... })
 */
export async function sendKitchenRequisition({ deldate, items }) {
  if (!YMD.test(String(deldate || ''))) {
    throw Object.assign(new Error('วันที่ต้องการของไม่ถูกต้อง'), { status: 400 });
  }
  const clean = (Array.isArray(items) ? items : [])
    .map((it) => ({
      itemCode: String(it.itemCode ?? '').trim(),
      itemName: String(it.itemName ?? '').trim().slice(0, 100),
      qty: Number(it.qty) || 0,
      unit: String(it.unit ?? '').trim().slice(0, 20),
      price: Number(it.price) || 0,
    }))
    .filter((it) => it.itemCode && it.qty > 0);
  if (clean.length === 0) {
    throw Object.assign(new Error('ไม่มีรายการที่ขอเบิก'), { status: 400 });
  }

  const url = `${naraiBranchBase()}/api/insert_order`;
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        outletId: kitchenOutletId(),
        branch: kitchenBranchCode(),
        deldate,
        items: clean,
      }),
      // insert_order ของ Narai-branch อ่านทะเบียนผ่านเครื่องออฟฟิศก่อนเขียน ใช้เวลาได้ถึงราว 30 วินาที
      signal: AbortSignal.timeout(55000),
    });
  } catch (err) {
    throw new Error(`ส่งใบเบิกไป Narai-branch (${naraiBranchBase()}) ไม่ได้: ${err.message} — ตรวจที่หน้าจัดของก่อนกดส่งซ้ำ เผื่อใบเข้าไปแล้ว`);
  }
  const json = await res.json().catch(() => null);
  if (!json) throw new Error(`Narai-branch ตอบกลับไม่ใช่ JSON (HTTP ${res.status})`);
  if (json.status !== 'success') {
    const missing = Array.isArray(json.missing) && json.missing.length ? ` (${json.missing.slice(0, 5).join(', ')})` : '';
    throw Object.assign(new Error((json.message || `ส่งใบเบิกไม่สำเร็จ (HTTP ${res.status})`) + missing),
      { status: res.status === 400 ? 400 : 502 });
  }
  return json;
}

/**
 * ยอดรับจริงของใบเบิกครัวกลาง — ใบที่คลังจ่ายแล้ว (myfbdata.trans ประเภท TRF/RCV ถึง outlet ครัว)
 *
 * ใช้ /api/withdrawals ของ Narai-branch ตัวเดียวกับปุ่ม "โหลดต้นทุนจากใบเบิก" ของหน้าต้นทุน
 * และปุ่ม "ใบเบิก" ของหน้านับสต๊อก — ตัวเลขจึงตรงกับที่สองหน้านั้นเห็นเสมอ
 * trans จับกลุ่มตาม Trn_InvNo ซึ่งเป็นเลขเดียวกับ Ord_No ของใบที่สั่ง (ตรวจกับใบจริงแล้ว)
 *
 * @param {{ docNos: number[], from: string, to: string }} p  ช่วง Trn_DocDate (วันที่คลังจ่าย) ที่จะค้น
 * @returns {Promise<Array<{ invNo, docDate, items: Array<{ itemCode, itemName, qty, unit, unitPrice, amount }> }>>}
 *   เฉพาะใบที่เลขตรงกับ docNos
 */
export async function fetchKitchenReceived({ docNos, from, to }) {
  const wanted = new Set((docNos || []).map((n) => String(Number(n))));
  if (wanted.size === 0) return [];
  const qs = new URLSearchParams({
    branch: kitchenBranchCode(), outletId: String(kitchenOutletId()), startDate: from, endDate: to,
  });
  const url = `${naraiBranchBase()}/api/withdrawals?${qs}`;
  let res;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(30000) });
  } catch (err) {
    throw new Error(`ดึงยอดรับจริงจาก Narai-branch ไม่ได้: ${err.message}`);
  }
  const json = await res.json().catch(() => null);
  if (!json || json.status !== 'success') {
    throw new Error(json?.message || `ดึงยอดรับจริงจาก Narai-branch ไม่ได้ (HTTP ${res.status})`);
  }
  return (json.data || []).filter((d) => wanted.has(String(Number(d.invNo))));
}
