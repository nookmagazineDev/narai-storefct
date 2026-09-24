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
 * ของที่ครัวกลางผลิต = ชื่อมี "FC" (เช่น FCผักโขมผัดสำเร็จ) ไม่สนตัวพิมพ์เล็กใหญ่
 * ใช้ที่เดียวกันทั้งแผงรายการที่สาขาเบิก (ชื่อสินค้าในใบเบิก) และหน้าสั่งผลิต (ชื่อเมนู QC/RD)
 * (เดิมกรองด้วยรหัส 7 หลักขึ้นต้น 10 / 010)
 */
export function isKitchenItemName(name) {
  return /FC/i.test(String(name ?? ''));
}

/**
 * รวมแถว orderd เป็นรายการต่อสินค้า พร้อมรายละเอียดรายสาขา
 * @param {Array<{outletId, branchCode, branchName, no, deldate, orderDate, itemCode, itemName, masterName?, qty, unit}>} rows
 *   แถวที่ถอดรหัสภาษาไทยแล้ว
 * @param {(outletId: number, no: number) => boolean} [isCancelled] ใบที่ยกเลิกไปแล้วไม่นับ
 */
export function groupRequests(rows, isCancelled = () => false) {
  const byItem = new Map();
  const cancelledDocs = new Set();

  for (const r of rows) {
    // ชื่อในใบเบิกหรือชื่อในทะเบียนสินค้า มี FC อย่างใดอย่างหนึ่งก็นับ
    if (!isKitchenItemName(r.itemName) && !isKitchenItemName(r.masterName)) continue;
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
