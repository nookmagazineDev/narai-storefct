// แผนที่รหัสสาขา <-> outlet_id ของระบบ POS
//
// เดิมอยู่ใน src/services/requisitionService.js ซึ่งเป็นไฟล์ของฝั่งหน้าเว็บ ย้ายมาที่นี่เพื่อให้
// สคริปต์ที่รันบน Node (scripts/import-store-sql.mjs) ใช้ได้ด้วยโดยไม่ต้องลาก apiCall
// กับโค้ดหน้าเว็บทั้งก้อนตามมา — requisitionService.js re-export ต่อให้ ของเดิมจึงไม่ต้องแก้
//
// ค่าพวกนี้คือ Ord_StrID / Str_ID ฝั่ง myfbdata ซึ่งเป็นฐานของผู้ขายระบบ POS เราไม่ได้ตั้งเอง
// ถ้ามีสาขาใหม่ ต้องมาเติมที่นี่

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

/**
 * รหัสสาขาที่หมายถึงร้านเดียวกัน แต่ละระบบตั้งชื่อไว้ไม่ตรงกัน
 * ตัวอย่างที่มีจริง: เว็บล็อกอินด้วย zjp แต่ชีท/POS เขียนว่า SJP (ทั้งคู่คือ outlet 7)
 * กติกาเดียวกับ branchGroup() ใน office-server/hr-session.js ของโปรเจกต์ Narai-branch
 */
const ALIASES = {
  zjp: 'sjp',
};

/**
 * หา outlet_id จากชื่อ/รหัสสาขา — คืน null ถ้าไม่รู้จัก
 *
 * คืน null แทนที่จะเดา เพราะ outlet_id ผิดแปลว่าข้อมูลไปโผล่ผิดสาขา ซึ่งเงียบและหายาก
 * ฝั่งที่เรียกต้องนับและรายงานจำนวนที่จับคู่ไม่ได้ให้คนเห็น
 *
 * @param {string} branch เช่น 'CRM', 'crm', 'zjp'
 * @returns {number|null}
 */
export function outletIdForBranch(branch) {
  const key = String(branch || '').trim().toLowerCase();
  if (!key || key === 'all') return null;
  const info = BRANCH_MAP[ALIASES[key] || key];
  const id = Number(info?.id);
  return Number.isFinite(id) ? id : null;
}
