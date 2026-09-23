// เมนู + สูตร (BOM) จาก QC/RD ของ naraipizzeria — ตัวเรียก API ฝั่งหน้าเว็บ
// ใช้ร่วมกันระหว่างหน้าสูตรการผลิต (ดึงสูตรตั้งต้น) กับหน้าผลิตตามสูตร (ดู lib/qcrdMenu.js)

// ตารางครัวเก็บจำนวนเป็น DECIMAL(18,3) — ต่ำกว่านี้ปัดแล้วเป็น 0 ซึ่งบันทึกไม่ได้ (CHECK qty > 0)
export const MIN_QTY = 0.001;
export const round3 = (n) => Math.round(n * 1000) / 1000;

/**
 * แปลงยอดตามสูตร QC/RD (หน่วยเล็ก เช่น กรัม) เป็นหน่วยสต๊อก (เช่น กก.)
 * converter = หน่วยเล็กต่อ 1 หน่วยสต๊อก (ฝั่งเซิร์ฟเวอร์เติมค่าเริ่มต้น 1000 ให้แล้วถ้าชีทว่าง)
 */
export const toStockQty = (qtySmall, converter) =>
  (Number(qtySmall) > 0 && Number(converter) > 0 ? round3(Number(qtySmall) / Number(converter)) : 0);

async function getJson(url) {
  let res;
  try {
    res = await fetch(url);
  } catch {
    throw new Error('ต่อเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจสอบการเชื่อมต่อแล้วลองใหม่');
  }
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.success) throw new Error(json?.error || `เกิดข้อผิดพลาด (HTTP ${res.status})`);
  return json;
}

/** รายชื่อเมนูทั้งหมด — { menus, loadedAt } */
export const fetchQcrdMenus = (refresh = false) =>
  getJson(`/api/qcrd_menus${refresh ? '?refresh=1' : ''}`);

/** สูตรของเมนูหนึ่งตัว — { menu, lines } (qty ของ lines เป็นหน่วยเล็กตามชีท) */
export const fetchQcrdRecipe = (code) =>
  getJson(`/api/qcrd_recipe?code=${encodeURIComponent(code)}`);
