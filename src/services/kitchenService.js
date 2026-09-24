// เมนูครัวกลาง — ตัวเรียก API ฝั่งหน้าเว็บ
//
// ทุก action วิ่งผ่าน route เดียวคือ POST /api/kitchen ซึ่งกรองชื่อ action ด้วย allowlist
// แล้วส่งต่อไป office-server ที่ออฟฟิศ (ดู lib/kitchenDb.js)

/**
 * เรียก action ของครัวกลาง
 * @param {string} action ชื่อคำสั่ง เช่น 'getKitchenRecipes'
 * @param {object} payload ข้อมูลที่ส่งไปกับคำสั่ง
 * @returns {Promise<object>} เนื้อคำตอบ (ไม่รวมฟิลด์ status)
 * @throws {Error} ข้อความไทยที่บอกสาเหตุ พร้อมส่งให้ toast แสดงได้เลย
 */
export async function kitchenCall(action, payload = {}) {
  let response;
  try {
    response = await fetch('/api/kitchen', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...payload }),
    });
  } catch (err) {
    // fetch โยน error เฉพาะตอนต่อไม่ติดจริงๆ (เน็ตหลุด, เซิร์ฟเวอร์ไม่ตอบ)
    throw new Error('ต่อเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจสอบการเชื่อมต่อแล้วลองใหม่');
  }

  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error(`เซิร์ฟเวอร์ตอบกลับผิดรูปแบบ (HTTP ${response.status})`);
  }

  if (!response.ok || result?.status !== 'success') {
    const msg = result?.message || `เกิดข้อผิดพลาด (HTTP ${response.status})`;
    // ข้อความดิบจาก SQL Server อ่านไม่รู้เรื่อง — เกิดเมื่อแก้/สร้างคำสั่งให้ชนใบเดิมของสินค้าเดียวกันวันเดียวกัน
    // (ฐานที่ยังไม่ได้รัน docs/migrate-kitchen-order-per-click.sql) — ติด code ไว้ให้ createManualOrder จับได้
    if (/UQ_kitchen_order_day/.test(msg)) {
      throw Object.assign(
        new Error('สินค้านี้มีคำสั่งผลิตในวันที่นี้อยู่แล้ว (ระบบให้มีได้วันละใบต่อสินค้า) — แก้จำนวนที่ใบเดิมด้วยปุ่มดินสอ หรือเลือกวันที่อื่น'),
        { code: 'DUP_ORDER_DAY' }
      );
    }
    throw new Error(msg);
  }
  const { status, ...data } = result;
  return data;
}

/* ------------------------------ ตัวช่วยเล็กๆ ที่หลายหน้าใช้ร่วมกัน ------------------------------ */

/** วันที่วันนี้แบบ YYYY-MM-DD ตามเวลาไทย — ใช้เป็นค่าตั้งต้นของช่องวันที่ทุกหน้า */
export function todayYmd() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** บวก/ลบวันจากสตริง YYYY-MM-DD โดยไม่ผ่าน new Date(str) ซึ่งตีความเป็น UTC แล้วเพี้ยนหนึ่งวัน */
export function shiftYmd(ymd, days) {
  const [y, m, d] = String(ymd).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/** วันที่แบบอ่านง่าย เช่น "17 ก.ย. 2026" (ปี ค.ศ. ไม่ใช่ พ.ศ.) */
export function formatThaiDate(value) {
  if (!value) return '-';
  const raw = String(value).slice(0, 10);
  const [y, m, d] = raw.split('-').map(Number);
  if (!y || !m || !d) return raw;
  const months = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
    'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  return `${d} ${months[m - 1]} ${y}`;
}

/**
 * วันเวลาที่ office-server ส่งมา (created_at / recorded_at) เป็นข้อความอ่านง่าย เช่น "24 ก.ย. 2026 14:30"
 *
 * คอลัมน์เป็น DATETIME2 เก็บเวลาไทยจาก SYSDATETIME() ไม่มีเขตเวลา แต่ไดรเวอร์ mssql ตีเป็น UTC
 * JSON จึงออกมาเป็น "2026-09-24T14:30:00.000Z" ซึ่งตัวเลขคือเวลาไทยอยู่แล้ว — อ่านตัวเลขตรง ๆ
 * ห้ามผ่าน new Date() ไม่งั้นเบราว์เซอร์ในไทยจะบวกเพิ่มอีก 7 ชั่วโมง
 */
export function formatStamp(value) {
  const m = String(value || '').match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})/);
  if (!m) return '-';
  return `${formatThaiDate(m[1])} ${m[2]}:${m[3]}`;
}

/** ตัวเลขแบบอ่านง่าย ตัดศูนย์ท้ายทศนิยมทิ้ง (12.500 -> 12.5, 3.000 -> 3) */
export function formatQty(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '-';
  return n.toLocaleString('en-US', { maximumFractionDigits: 3 });
}

/** สีประจำสถานะคำสั่งผลิต — ใช้ชุดเดียวกันทุกหน้าเพื่อให้จำสีได้ */
export const ORDER_STATUS_STYLE = {
  'รอผลิต': 'bg-slate-500/15 text-slate-300 border-slate-500/30',
  'กำลังผลิต': 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  'ผลิตเสร็จ': 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  'ยกเลิก': 'bg-rose-500/15 text-rose-300 border-rose-500/30',
};

/** ที่มาของคำสั่งผลิต — ป้ายสั้นๆ ให้รู้ว่าใบนี้ใครสั่ง */
export const ORDER_SOURCE_LABEL = {
  manual: 'กรอกเอง',
  demand: 'ยอดสาขา',
  plan: 'ตามแผน',
};

export const WEEKDAY_LABEL = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];

/* ------------------------------ ออกคำสั่งผลิตแบบกรอกเอง ------------------------------ */

const sameKey = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

/**
 * ออกคำสั่งผลิตแบบกรอกเอง (source = manual) — กดสั่งแต่ละครั้งได้ใบแยกกันเสมอ
 * (สินค้าเดิมวันเดิมก็แยกใบ แยกกันด้วยเลขใบและเวลาที่สั่ง created_at)
 *
 * ต้องรัน docs/migrate-kitchen-order-per-click.sql บนฐานก่อน — ฐานที่ยังไม่ได้รันยังมี UQ_kitchen_order_day
 * ซึ่งให้มีคำสั่งกรอกเองได้ใบเดียวต่อสินค้าต่อวัน ถ้าชนข้อนั้น ถอยไปถามว่าจะเพิ่มเข้าใบเดิมแทน
 * (ใบเดิมที่ยกเลิกไปแล้วยังกินที่อยู่ จึงถามว่าจะนำกลับมาใช้) — ตอบไม่ = ไม่ทำอะไร
 *
 * @param {{produceDate: string, productKey: string, productCode: string, productName: string,
 *          orderQty: number, unit?: string, note?: string}} order
 * @returns {Promise<{orderId: number, docNo: string, merged: boolean, orderQty: number} | null>}
 *   null = คนกดไม่รับการรวมใบ
 */
export async function createManualOrder(order) {
  try {
    const created = await kitchenCall('saveProductionOrder', order);
    return { orderId: created.orderId, docNo: created.docNo, merged: false, orderQty: order.orderQty };
  } catch (err) {
    // INSERT อยู่ใน transaction ของ office-server ชนแล้วไม่มีอะไรค้าง ถอยไปรวมใบได้ปลอดภัย
    if (err.code !== 'DUP_ORDER_DAY') throw err;
    return mergeIntoExistingOrder(order);
  }
}

/** ฐานยังไม่รองรับใบซ้ำวันเดียวกัน — ถามว่าจะเพิ่มเข้าใบเดิม (หรือนำใบที่ยกเลิกกลับมาใช้) ไหม */
async function mergeIntoExistingOrder(order) {
  const { produceDate, productKey, orderQty } = order;
  const res = await kitchenCall('getProductionOrders', { dateFrom: produceDate, dateTo: produceDate });
  const existing = (res.orders || []).find((o) => o.source === 'manual'
    && String(o.produce_date).slice(0, 10) === produceDate
    && sameKey(o.product_key, productKey));

  if (!existing) {
    // ชนข้อจำกัดแต่หาใบเดิมไม่เจอ (เช่นวันที่ของใบถูกแก้ระหว่างนั้น) — บอกตามจริง ไม่เดา
    throw new Error('สินค้านี้มีคำสั่งผลิตในวันที่นี้อยู่แล้ว แต่หาใบเดิมไม่เจอ — รีเฟรชหน้ารายการสั่งผลิตแล้วลองใหม่');
  }

  const unit = existing.unit || order.unit || '';
  if (existing.status === 'ยกเลิก') {
    const ok = window.confirm(
      `วันที่ ${formatThaiDate(produceDate)} เคยมีคำสั่งผลิต ${existing.doc_no} ของ "${existing.product_name}" ที่ยกเลิกไปแล้ว\n`
      + 'ฐานข้อมูลยังแยกใบของสินค้าเดียวกันในวันเดียวกันไม่ได้ (ยังไม่ได้รัน migrate-kitchen-order-per-click.sql)\n\n'
      + `นำใบ ${existing.doc_no} กลับมาใช้ใหม่ เป็นจำนวน ${formatQty(orderQty)} ${unit} ใช่ไหม?`);
    if (!ok) return null;
    // saveProductionOrder แก้ใบที่ยกเลิกแล้วไม่ได้ — ต้องปลดสถานะก่อน
    await kitchenCall('updateProductionOrderStatus', { orderId: existing.order_id, status: 'รอผลิต' });
    await kitchenCall('saveProductionOrder', { ...order, orderId: existing.order_id });
    return { orderId: existing.order_id, docNo: existing.doc_no, merged: true, orderQty };
  }

  const total = Math.round((Number(existing.order_qty) + Number(orderQty)) * 1000) / 1000;
  const ok = window.confirm(
    `วันที่ ${formatThaiDate(produceDate)} มีคำสั่งผลิต ${existing.doc_no} ของ "${existing.product_name}" อยู่แล้ว`
    + ` (สั่ง ${formatQty(existing.order_qty)} ${unit} · ${existing.status})\n`
    + 'ฐานข้อมูลยังแยกใบของสินค้าเดียวกันในวันเดียวกันไม่ได้ (ยังไม่ได้รัน migrate-kitchen-order-per-click.sql)\n\n'
    + `เพิ่ม ${formatQty(orderQty)} เข้าใบเดิม เป็น ${formatQty(total)} ${unit} ใช่ไหม?`);
  if (!ok) return null;
  await kitchenCall('saveProductionOrder', {
    ...order,
    orderId: existing.order_id,
    orderQty: total,
    unit,
    note: existing.note || order.note,
  });
  return { orderId: existing.order_id, docNo: existing.doc_no, merged: true, orderQty: total };
}
