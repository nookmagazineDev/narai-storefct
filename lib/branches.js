// แผนที่รหัสสาขา <-> outlet_id ของระบบ POS
//
// เดิมอยู่ใน src/services/requisitionService.js ซึ่งเป็นไฟล์ของฝั่งหน้าเว็บ ย้ายมาที่นี่เพื่อให้
// สคริปต์ที่รันบน Node (scripts/import-store-sql.mjs) ใช้ได้ด้วยโดยไม่ต้องลาก apiCall
// กับโค้ดหน้าเว็บทั้งก้อนตามมา — requisitionService.js re-export ต่อให้ ของเดิมจึงไม่ต้องแก้
//
// ค่าพวกนี้คือ Ord_StrID / Str_ID ฝั่ง myfbdata ซึ่งเป็นฐานของผู้ขายระบบ POS เราไม่ได้ตั้งเอง
//
// ⭐ ไม่ต้องมาเติมที่นี่แล้วเมื่อมีสาขาใหม่
//    ทะเบียนสาขาย้ายไปอยู่ที่เดียวกลางแล้ว (แดชบอร์ดออฟฟิศ > HR > จัดการสาขา)
//    ตารางข้างล่างถูก "เติมทับ" ด้วยทะเบียนจริงตอนเปิดหน้า ผ่าน applyHubBranches()
//    ที่ src/services/branchService.js เรียกให้ — เหตุผลและแผนเต็มอยู่ใน
//    naraipizzeria/docs/branch-hub.md
//
//    ที่เหลือไว้เพราะยังต้องเป็นค่าตั้งต้น: ดึงทะเบียนไม่ได้ (เน็ตหลุด / ยังไม่ได้ตั้ง
//    BRANCH_HUB_BASE) แล้วตารางนี้ว่าง = ทั้งแอปเลือกสาขาไม่ได้เลย ซึ่งแย่กว่าใช้ของเก่า
//
// ⚠️ ตั้งใจให้เป็น object ที่เปลี่ยนค่าได้ ไม่ใช่ค่าคงที่ — หลายหน้า import ไปใช้ตรง ๆ
//    แบบ synchronous (Object.entries(BRANCH_MAP)) การเปลี่ยนเป็น async ทั้งหมด
//    คือการรื้อหกไฟล์โดยไม่ได้อะไรเพิ่ม ตัวที่ทำให้หน้าจอวาดใหม่หลังเติมค่าคือ
//    state ใน useBranchRegistry() ไม่ใช่การแก้ object นี้
//
// ⚠️ เติมได้อย่างเดียว ไม่ลบ — สาขาที่หลุดออกจากทะเบียนต้องยังแปลรหัสได้อยู่
//    ไม่งั้นใบเบิกเก่าของสาขานั้นจะหาไม่เจอ

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
 * เติมตารางข้างบนด้วยทะเบียนสาขาจริง — เรียกจาก src/services/branchService.js (ฝั่งหน้าเว็บ)
 * และ lib/branchHub.js (ฝั่งเซิร์ฟเวอร์)
 *
 * ข้อมูลที่เข้ามาเป็นของจากระบบอื่น จึงคัดเฉพาะแถวที่ใช้ได้จริงทีละแถว
 * แถวไหนไม่มีรหัสหรือไม่มีเลข outlet ก็ข้ามไป ไม่ใช่ทิ้งทั้งชุด — ทะเบียนที่กรอกยังไม่ครบ
 * (สาขาใหม่ที่ยังไม่ได้เลข POS มา) เป็นเรื่องปกติ ไม่ใช่ข้อมูลเสีย
 *
 * @returns {number} จำนวนรายการที่เปลี่ยนไปจริง (0 = ของที่ได้มาตรงกับที่มีอยู่แล้ว)
 */
export function applyHubBranches(list, aliases) {
  let changed = 0;

  for (const b of list || []) {
    const code = String(b?.code || '').trim().toLowerCase();
    const id = Number(b?.outletId);
    if (!code || !Number.isFinite(id) || id <= 0) continue;
    // 'all' ไม่ใช่สาขา แต่เป็นตัวเลือก "ทุกสาขา" ของ dropdown — ทับเมื่อไหร่ตัวกรองพัง
    if (code === 'all') continue;

    const prev = BRANCH_MAP[code];
    // ชื่อที่โชว์: ใช้ชื่อไทยถ้ากรอกไว้ ไม่งั้นใช้รหัสตัวพิมพ์ใหญ่แบบเดิม
    const name = String(b?.name || '').trim() || code.toUpperCase();
    if (prev?.id === String(id) && prev?.name === name) continue;

    BRANCH_MAP[code] = { id: String(id), name, code: code.toUpperCase() };
    changed++;
  }

  for (const [alias, target] of Object.entries(aliases || {})) {
    const a = String(alias).trim().toLowerCase();
    const t = String(target).trim().toLowerCase();
    if (!a || !t || a === t || ALIASES[a] === t) continue;
    ALIASES[a] = t;
    changed++;
  }

  return changed;
}

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
