// ทะเบียนเมนู + สูตร (BOM) ของ QC/RD — ของโปรเจค naraipizzeria อ่านอย่างเดียว
//
// หน้าสูตรการผลิตของครัวกลางใช้เป็นฐานตั้งต้น: เลือกเมนูจาก QC/RD แล้วได้ทั้งชื่อและสูตร
// มาเติมในฟอร์มสูตรของครัว ไม่ต้องพิมพ์วัตถุดิบใหม่ทีละบรรทัด
//
// อ่านจากชีทต้นทุนเมนูเล่มเดียวกับที่ naraipizzeria อ่าน (naraipizzeria/lib/qcrdSheet.js)
// ผ่าน export CSV ตรง ๆ ไม่ได้ผ่าน /api/qcrd ของฝั่งนั้น เพราะเส้นนั้นอยู่หลังล็อกอินของคน
// และชีทนี้แชร์แบบ "ผู้ที่มีลิงก์" อยู่แล้ว (naraipizzeria เองก็อ่านแบบนี้โดยไม่มีกุญแจ)
//
// ⚠️ ถ้าวันหนึ่ง naraipizzeria ตั้ง QCRD_SOURCE=sql แล้วเลิกเขียนลงชีท ของที่นี่จะค้าง
//    ตอนนั้นต้องเปลี่ยนมาอ่านจาก dbo.qcrd_menu / dbo.qcrd_bom (ฐาน InventoryNarai เดียวกับครัว)
//
// ตำแหน่งคอลัมน์ต้องตรงกับ naraipizzeria/pages/api/qcrd.js — ฝั่งนั้นแก้ ที่นี่ต้องแก้ตาม
import { parseCsv } from './sheets.js';

const env = (k) => String(process.env[k] || '').trim();
const sheetId = () => env('QCRD_SHEET_ID') || '1v8WRTaUiEqjtRXzX2g2i5Z8p9FAUvQ37gkdZC8TzhWw';
const GIDS = { menu: '0', BOM: '419926693', item: '302875824', menucodegroup: '1491689317' };

// ตัวแปลงหน่วยเมื่อไม่ได้ระบุ — ตรงกับ DEFAULT_CONVERTER ของ naraipizzeria (ที่คิดต้นทุนด้วยค่านี้)
export const DEFAULT_CONVERTER = 1000;

// ชีทเมนูห้าพันกว่าแถว BOM ใหญ่กว่านั้นอีก — โหลดครั้งเดียวแล้วแคชไว้ เหมือน lib/branchHub.js
const TTL_MS = 5 * 60 * 1000;
const TIMEOUT_MS = 20000;
const TRUTHY = /^(y|yes|true|1|ใช่)$/i;

const g = globalThis;
g.__qcrdMenu = g.__qcrdMenu || { at: 0, data: null, pending: null };

const str = (v) => (v === null || v === undefined ? '' : String(v).trim());
const num = (v) => {
  const n = parseFloat(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
};

/** กติกาเดียวกับ item_key ของ stock_item / normCode ของ office-server (ตัด .0 ท้าย, 0 นำหน้า, ตัวพิมพ์เล็ก) */
export const normCode = (v) => str(v).replace(/\.0+$/, '').replace(/^0+/, '').toLowerCase();

async function fetchTab(name) {
  const url = `https://docs.google.com/spreadsheets/d/${sheetId()}/export?format=csv&gid=${GIDS[name]}`;
  const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`อ่านชีท QC/RD แท็บ ${name} ไม่ได้ (HTTP ${res.status})`);
  const text = await res.text();
  if (/^\s*</.test(text)) {
    throw new Error('อ่านชีท QC/RD ไม่ได้ — ชีทไม่ได้แชร์เป็น "ผู้ที่มีลิงก์ • ผู้อ่าน" แล้ว');
  }
  return parseCsv(text);
}

/** คอลัมน์ "ปริมาณที่ได้ / หน่วยที่ได้" — หาจากหัวตารางตั้งแต่ G (เหมือน findYieldCols ของ naraipizzeria) */
function yieldCols(header = []) {
  const at = (re, dflt) => {
    const i = header.findIndex((h, idx) => idx >= 6 && re.test(str(h)));
    return i >= 0 ? i : dflt;
  };
  return [at(/ปริมาณ|yield/i, 6), at(/หน่วย|unit/i, 7)];
}

async function loadFresh() {
  const [menuRows, bomRows, itemRows, groupRows] = await Promise.all(
    ['menu', 'BOM', 'item', 'menucodegroup'].map(fetchTab)
  );

  const groupName = new Map();
  for (const r of groupRows.slice(1)) if (str(r[0])) groupName.set(str(r[0]), str(r[1]));

  // วัตถุดิบ: B=ชื่อ D=หน่วยซื้อ I=ตัวแปลง Q=หน่วยใช้ในสูตร
  const items = new Map();
  for (const r of itemRows.slice(1)) {
    const key = normCode(r[0]);
    if (!key || items.has(key)) continue;
    items.set(key, { name: str(r[1]), unit: str(r[3]), converter: num(r[8]), useUnit: str(r[16]) });
  }

  const bom = new Map();
  for (const r of bomRows.slice(1)) {
    const code = str(r[0]);
    if (!code) continue;
    if (!bom.has(code)) bom.set(code, []);
    bom.get(code).push({
      seq: num(r[2]),
      itemCode: str(r[3]),
      itemName: str(r[4]),
      qty: num(r[5]),          // ยอดใช้ต่อ 1 สูตร (หน่วยเล็ก)
      converter: num(r[7]),    // หน่วยเล็กต่อ 1 หน่วยซื้อ
      tag: str(r[18]),
      noDeduct: TRUTHY.test(str(r[19])),
    });
  }

  const [yCol, yUnitCol] = yieldCols(menuRows[0]);
  const menus = menuRows.slice(1)
    .filter((r) => str(r[0]))
    .map((r) => ({
      code: str(r[0]),
      key: normCode(r[0]),
      name: str(r[1]),
      groupName: groupName.get(str(r[2])) || '',
      status: str(r[5]) || 'ใช้งาน',
      yieldQty: num(r[yCol]),
      yieldUnit: str(r[yUnitCol]),
      lineCount: bom.get(str(r[0]))?.length || 0,
    }));

  return { menus, bom, items, loadedAt: new Date().toISOString() };
}

/** ข้อมูลทั้งชุด (แคช 5 นาที) — คำขอที่มาพร้อมกันรอรอบโหลดเดียวกัน ไม่ยิงชีทซ้อน */
async function load({ refresh = false } = {}) {
  const c = g.__qcrdMenu;
  if (!refresh && c.data && Date.now() - c.at < TTL_MS) return c.data;
  if (!c.pending) {
    c.pending = loadFresh()
      .then((data) => { g.__qcrdMenu = { at: Date.now(), data, pending: null }; return data; })
      .catch((err) => { c.pending = null; throw err; });
  }
  return c.pending;
}

/** รายชื่อเมนูทั้งหมด (ไม่มีบรรทัดสูตร ให้หน้าเว็บค้นเร็ว) */
export async function qcrdMenuList(opts) {
  const { menus, loadedAt } = await load(opts);
  return { menus, loadedAt };
}

/**
 * สูตรของเมนูหนึ่งตัว — qty คงเป็นหน่วยเล็กตามชีท การแปลงเป็นหน่วยสต๊อกทำที่หน้าเว็บ
 * เพราะคนต้องเห็นทั้งสองตัวเลขก่อนกดใช้ (converter ผิดในชีท = ตัวเลขเพี้ยนเป็นพันเท่า)
 */
export async function qcrdMenuRecipe(code) {
  const { menus, bom, items } = await load();
  const menu = menus.find((m) => m.code === str(code)) || menus.find((m) => m.key === normCode(code));
  if (!menu) return null;
  const lines = (bom.get(menu.code) || []).map((l) => {
    const itemKey = normCode(l.itemCode);
    const it = items.get(itemKey);
    return {
      ...l,
      itemKey,
      itemName: l.itemName || it?.name || '',
      converter: l.converter || it?.converter || DEFAULT_CONVERTER,
      useUnit: it?.useUnit || '',
      purchaseUnit: it?.unit || '',
    };
  });
  return { menu, lines };
}
