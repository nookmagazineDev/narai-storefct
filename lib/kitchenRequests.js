// ยอดที่สาขาสั่งเบิก "ของที่ครัวกลางผลิต" — หน้ารายการสั่งผลิตใช้ดูว่าต้องทำอะไรเท่าไหร่
//
// แหล่งข้อมูลคือ myfbdata.orderd บน MySQL ของ POS ตารางเดียวกับที่ปุ่ม "สั่งของ" ในหน้านับสต๊อก
// ของ Narai-branch เขียนลงไป (api/insert_order.js: Ord_ReqType = 'TRF') ไม่ใช่ store_fulfillment
// บน SQL Server ซึ่งมีของก็ต่อเมื่อสโตร์ดึงใบเบิกไปจัดแล้ว — ครัวต้องเห็นยอดตั้งแต่สาขากดส่ง
//
// ไฟล์นี้เป็นตรรกะล้วน (ไม่แตะฐาน) ส่วน SQL อยู่ที่ /api/kitchen_branch_requests ใน server.js

/** ประเภทใบของใบเบิกสาขา — ต้องตรงกับ REQ_TYPE ใน Narai-branch/api/insert_order.js */
export const REQ_TYPE = 'TRF';

/** กติกาเดียวกับ item_key ของ stock_item (ตัด .0 ท้าย, 0 นำหน้า, ตัวพิมพ์เล็ก) */
export const normCode = (v) => String(v ?? '').trim().replace(/\.0+$/, '').replace(/^0+/, '').toLowerCase();

/**
 * รหัสสินค้าของครัวกลาง: เลข 7 หลักขึ้นต้นด้วย 10 (1000077) หรือ 7 หลักขึ้นต้นด้วย 010 (0100077)
 * รับแบบที่มี 0 เติมหน้า 10xxxxx มาด้วย (01000077) เพราะบางแหล่งเขียนรหัสเดียวกันแบบนั้น
 * (ดู naraipizzeria/components/QcRdMenu.jsx — RcpDtls เขียน '01000077' ส่วนชีท item เขียน '1000077')
 */
export function isKitchenItemCode(code) {
  const c = String(code ?? '').trim().replace(/\.0+$/, '');
  return /^0*10\d{5}$/.test(c) || /^010\d{4}$/.test(c);
}

/**
 * รวมแถว orderd เป็นรายการต่อสินค้า พร้อมรายละเอียดรายสาขา
 * @param {Array<{outletId, branchCode, branchName, no, deldate, orderDate, itemCode, itemName, qty, unit}>} rows
 *   แถวที่ถอดรหัสภาษาไทยแล้ว
 * @param {(outletId: number, no: number) => boolean} [isCancelled] ใบที่ยกเลิกไปแล้วไม่นับ
 */
export function groupRequests(rows, isCancelled = () => false) {
  const byItem = new Map();
  const cancelledDocs = new Set();

  for (const r of rows) {
    if (!isKitchenItemCode(r.itemCode)) continue;
    const qty = Number(r.qty) || 0;
    if (qty <= 0) continue;
    if (isCancelled(r.outletId, r.no)) { cancelledDocs.add(`${r.outletId}-${r.no}`); continue; }

    const itemKey = normCode(r.itemCode);
    // หน่วยต่างกันบวกกันไม่ได้ (ถุง + กก.) แยกเป็นคนละแถว
    const unit = String(r.unit || '').trim();
    const key = `${itemKey}|${unit}`;
    if (!byItem.has(key)) {
      byItem.set(key, {
        itemKey, itemCode: String(r.itemCode).trim(), itemName: r.itemName, unit,
        totalQty: 0, branches: new Set(), lines: [],
      });
    }
    const g = byItem.get(key);
    g.totalQty += qty;
    g.branches.add(r.outletId);
    if (!g.itemName && r.itemName) g.itemName = r.itemName;
    g.lines.push({
      outletId: r.outletId, branchCode: r.branchCode, branchName: r.branchName,
      no: r.no, deldate: r.deldate, orderDate: r.orderDate, qty,
    });
  }

  const items = [...byItem.values()]
    .map(({ branches, ...g }) => ({
      ...g,
      totalQty: Math.round(g.totalQty * 1000) / 1000,
      branchCount: branches.size,
      lines: g.lines.sort((a, b) => a.deldate.localeCompare(b.deldate)
        || String(a.branchCode).localeCompare(String(b.branchCode))),
    }))
    .sort((a, b) => a.itemCode.localeCompare(b.itemCode));

  return { items, cancelledDocCount: cancelledDocs.size };
}
