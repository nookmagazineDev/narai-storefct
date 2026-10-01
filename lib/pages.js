// หน้าทั้งหมดของแอป + สิทธิ์ที่แต่ละ API ต้องการ — ใช้ร่วมกันทั้งหน้าเว็บ (เมนู/กันหน้า) และ server.js (กัน API)
//
// page key เก็บลง dbo.storefct_user_page ของ office-server — ห้ามเปลี่ยนชื่อ key ที่ใช้อยู่แล้ว
// (เปลี่ยน = ทุกคนเสียสิทธิ์หน้านั้น) เพิ่มหน้าใหม่ = เพิ่มแถวที่นี่ แล้วติ๊กสิทธิ์ในหน้าจัดการผู้ใช้
//
// สิทธิ์มีสองระดับ: view (เห็นเมนู เปิดหน้าได้) · edit (บันทึก/ส่ง/ลบได้ — มี edit ต้องมี view เสมอ)
// แอดมินใช้ได้ทุกหน้าทุกระดับ และเป็นคนเดียวที่เข้าหน้าจัดการผู้ใช้ได้

export const PAGE_GROUPS = [
  {
    key: 'store',
    label: 'คลังสินค้า',
    pages: [
      { key: 'overview', label: 'ภาพรวมระบบ', path: '/' },
      { key: 'requisition-calendar', label: 'ปฏิทินใบเบิกสินค้า', path: '/requisition-calendar' },
      { key: 'stock-total', label: 'สรุปสต๊อกรวม', path: '/stock-total', viewOnly: true },
      { key: 'fulfillment', label: 'จัดของ', path: '/fulfillment' },
      { key: 'status-check', label: 'ตรวจสอบสถานะ', path: '/status-check' },
      { key: 'delivery-summary', label: 'สรุปส่งของ', path: '/delivery-summary', viewOnly: true },
    ],
  },
  {
    key: 'kitchen',
    label: 'ครัวกลาง',
    pages: [
      { key: 'kitchen-plan', label: 'แพลนผลิต', path: '/kitchen/plan' },
      { key: 'kitchen-status', label: 'สถานะการผลิต', path: '/kitchen/status' },
      { key: 'kitchen-orders', label: 'รายการที่สาขาเบิก', path: '/kitchen/orders' },
      { key: 'kitchen-issue', label: 'เบิกวัตถุดิบ', path: '/kitchen/issue' },
      { key: 'kitchen-balance', label: 'วัตถุดิบคงเหลือ', path: '/kitchen/balance' },
      { key: 'kitchen-report', label: 'ดูรายงานการผลิต', path: '/kitchen/report' },
      { key: 'kitchen-menus', label: 'เมนูครัวกลาง', path: '/kitchen/menus' },
    ],
  },
];

export const PAGES = PAGE_GROUPS.flatMap((g) => g.pages.map((p) => ({ ...p, group: g.key })));
export const PAGE_KEYS = new Set(PAGES.map((p) => p.key));
const groupKeys = (g) => PAGE_GROUPS.find((x) => x.key === g).pages.map((p) => p.key);
export const STORE_PAGES = groupKeys('store');
export const KITCHEN_PAGES = groupKeys('kitchen');

/** หน้าที่ตรงกับ path (ยาวสุดที่ตรงก่อน) — null = ไม่ใช่หน้าที่คุมสิทธิ์ */
export function pageOfPath(pathname) {
  const hit = PAGES
    .filter((p) => (p.path === '/' ? pathname === '/' : pathname === p.path || pathname.startsWith(`${p.path}/`)))
    .sort((a, b) => b.path.length - a.path.length)[0];
  return hit || null;
}

/** ชุดสำเร็จในป๊อปอัพแก้สิทธิ์ — กดแล้วติ๊กให้ทั้งชุด (แก้ต่อทีละช่องได้) */
export const PRESETS = [
  { key: 'store', label: 'โกดัง', pages: Object.fromEntries(STORE_PAGES.map((k) => [k, 'edit'])) },
  { key: 'kitchen-lead', label: 'หัวหน้าครัว', pages: Object.fromEntries(KITCHEN_PAGES.map((k) => [k, 'edit'])) },
  {
    key: 'kitchen-staff',
    label: 'พนักงานครัว',
    pages: { 'kitchen-status': 'edit', 'kitchen-issue': 'edit', 'kitchen-balance': 'view', 'kitchen-plan': 'view' },
  },
  { key: 'viewer', label: 'ดูอย่างเดียว', pages: Object.fromEntries(PAGES.map((p) => [p.key, 'view'])) },
];

/**
 * ระดับสิทธิ์ของผู้ใช้ต่อหน้า — 'edit' | 'view' | null
 * @param {{ isAdmin?: boolean, pages?: Record<string, 'edit'|'view'> } | null} user
 */
export function accessOf(user, pageKey) {
  if (!user) return null;
  if (user.isAdmin) return 'edit';
  return user.pages?.[pageKey] || null;
}

export const canView = (user, pageKey) => Boolean(accessOf(user, pageKey));
export const canEdit = (user, pageKey) => accessOf(user, pageKey) === 'edit';

/* ------------------------------------------------------------------------------------------
   สิทธิ์ของ API — server.js ตรวจทุกคำขอด้วยตารางนี้ (กันคนเรียก API ตรงข้ามการซ่อนปุ่ม)
   รูปแบบ: { pages: [...], edit: boolean } = ต้องมีสิทธิ์ (edit หรือ view) ในหน้าใดหน้าหนึ่งของรายการ
   GET อ่านข้อมูลทั่วไปของกลุ่มให้ทุกหน้าในกลุ่ม — หน้าในกลุ่มเดียวกันใช้ข้อมูลชุดเดียวกันอยู่แล้ว
------------------------------------------------------------------------------------------ */

const STORE_WRITE_PAGES = ['requisition-calendar', 'fulfillment', 'status-check'];

const ROUTE_RULES = {
  'GET /api/branches': 'any',
  'GET /api/pending_orders': { pages: STORE_PAGES },
  'GET /api/stock_count_summary': { pages: STORE_PAGES },
  'GET /api/received_status': { pages: STORE_PAGES },
  'GET /api/fetched_status': { pages: STORE_PAGES },
  'GET /api/cancelled_status': { pages: STORE_PAGES },
  'GET /api/delivery_summary': { pages: STORE_PAGES },
  'GET /api/fulfillment_items_detail': { pages: STORE_PAGES },
  'GET /api/received_items_detail': { pages: STORE_PAGES },
  'GET /api/pending_edit_approvals': { pages: STORE_PAGES },
  'POST /api/approve_received_edit': { pages: STORE_WRITE_PAGES, edit: true },
  'POST /api/save_fulfillment': { pages: STORE_WRITE_PAGES, edit: true },
  'POST /api/mark_fetched': { pages: STORE_WRITE_PAGES, edit: true },
  'GET /api/qcrd_menus': { pages: KITCHEN_PAGES },
  'GET /api/qcrd_recipe': { pages: KITCHEN_PAGES },
  'GET /api/kitchen_branch_requests': { pages: KITCHEN_PAGES },
  'GET /api/kitchen_requisition': { pages: KITCHEN_PAGES },
  'POST /api/kitchen_requisition': { pages: ['kitchen-issue'], edit: true },
};

// คำสั่งเขียนของ /api/kitchen -> หน้าที่ใช้คำสั่งนั้น (ต้อง edit หน้าใดหน้าหนึ่ง) · คำสั่งอ่านใช้ได้ทุกหน้าครัว
const RUN_FORM = ['kitchen-status', 'kitchen-orders', 'kitchen-plan']; // RecipeRunForm อยู่ในหน้าเหล่านี้
const KITCHEN_WRITE = {
  saveKitchenRecipe: ['kitchen-plan'],
  deleteKitchenRecipe: ['kitchen-plan'],
  saveProductionPlan: ['kitchen-plan'],
  deleteProductionPlan: ['kitchen-plan'],
  saveDatedPlans: ['kitchen-plan'],
  deleteDatedPlan: ['kitchen-plan'],
  createOrdersFromPlan: ['kitchen-plan'],
  createOrderFromPlanDay: ['kitchen-plan'],
  createOrdersFromDemand: ['kitchen-orders', 'kitchen-status'],
  saveProductionOrder: RUN_FORM,
  updateProductionOrderStatus: RUN_FORM,
  saveProductionRun: RUN_FORM,
  deleteProductionRun: ['kitchen-report'],
  saveMaterialIssue: ['kitchen-issue', ...RUN_FORM],
  saveMaterialReceipt: ['kitchen-issue'],
  saveKitchenCount: ['kitchen-balance'],
  saveKitchenCounts: ['kitchen-balance'],
  setKitchenMenuHidden: ['kitchen-menus'],
};

/**
 * สิทธิ์ที่คำขอหนึ่งต้องการ
 * @returns {'any' | 'admin' | { pages: string[], edit?: boolean } | null} null = API ที่ไม่รู้จัก (ให้แอดมินเท่านั้น)
 */
export function ruleOf(method, path, body) {
  if (path === '/api/kitchen' && method === 'POST') {
    const w = KITCHEN_WRITE[body?.action];
    return w ? { pages: w, edit: true } : { pages: KITCHEN_PAGES };
  }
  return ROUTE_RULES[`${method} ${path}`] || null;
}

/** ผู้ใช้ผ่านกติกานี้ไหม */
export function allowed(user, rule) {
  if (!user) return false;
  if (user.isAdmin) return true;
  if (rule === 'any') return true;
  if (!rule || rule === 'admin') return false;
  return rule.pages.some((k) => (rule.edit ? canEdit(user, k) : canView(user, k)));
}
