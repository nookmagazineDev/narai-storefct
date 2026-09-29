// ช่วงวันที่ลัดของเมนูครัวกลาง (วันนี้ / พรุ่งนี้ / สัปดาห์นี้ / เดือนนี้ …) — ใช้กับ components/kitchen/DateQuick.jsx
// วันที่เป็นสตริง YYYY-MM-DD เวลาไทย คิดด้วย UTC ล้วน ไม่ผ่านเขตเวลาของเครื่อง

import { shiftYmd } from './kitchenService';

export const QUICK_LABEL = {
  yesterday: 'เมื่อวาน',
  today: 'วันนี้',
  tomorrow: 'พรุ่งนี้',
  week: 'สัปดาห์นี้',
  month: 'เดือนนี้',
  lastMonth: 'เดือนที่แล้ว',
};

/**
 * ช่วงวันที่ [from, to] ของปุ่มลัด
 * สัปดาห์นี้ = จันทร์–อาทิตย์ · เดือนนี้ = วันที่ 1–สิ้นเดือน (เต็มช่วง เพราะหลายหน้าต้องดูวันข้างหน้าด้วย)
 */
export function quickRange(kind, today) {
  const [y, m, d] = today.split('-').map(Number);
  const iso = (dt) => dt.toISOString().slice(0, 10);
  switch (kind) {
    case 'yesterday': { const x = shiftYmd(today, -1); return [x, x]; }
    case 'tomorrow': { const x = shiftYmd(today, 1); return [x, x]; }
    case 'week': {
      const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = อาทิตย์
      const mon = shiftYmd(today, -((wd + 6) % 7));
      return [mon, shiftYmd(mon, 6)];
    }
    case 'month': return [iso(new Date(Date.UTC(y, m - 1, 1))), iso(new Date(Date.UTC(y, m, 0)))];
    case 'lastMonth': return [iso(new Date(Date.UTC(y, m - 2, 1))), iso(new Date(Date.UTC(y, m - 1, 0)))];
    default: return [today, today];
  }
}
