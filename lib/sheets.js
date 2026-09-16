// ตัวอ่าน Google Sheet ผ่าน endpoint สาธารณะ gviz ที่ใช้ร่วมกันทั้งแอป
//
// gviz ตอบกลับมาเป็น JavaScript ครอบ JSON ไว้ (google.visualization.Query.setResponse({...});)
// จึงต้องตัดหัวตัดท้ายก่อน parse เสมอ — ไม่ใช่ JSON ตรงๆ

// สเปรดชีตหลักของงานสโตร์ (แท็บ จัดของ / รับของ / ดึงข้อมูลใบเบิก / ยกเลิกใบเบิก / ยอดคงเหลือไอเทม)
export const STORE_SHEET_ID = '1bxohT8wK4ySAJgqGHEg9JHp0KJJKG7SVUEhJksBgBSI';

export const SHEET_GID = {
  fulfillment: '0',            // จัดของ
  receiving: '1358423318',     // รับของ
  itemBalance: '656669133',    // ยอดคงเหลือไอเทม
};

// แท็บที่ถูกสร้างขึ้นตอนใช้งานจริง (Apps Script insertSheet) จึงไม่รู้ gid ล่วงหน้า
// ต้องอ้างด้วยชื่อผ่านพารามิเตอร์ `sheet=` แทน
export const SHEET_NAME = {
  fetched: 'ดึงข้อมูลใบเบิก',
  cancelled: 'ยกเลิกใบเบิก',
};

/**
 * ดึงแถวทั้งหมดของแท็บหนึ่งจากสเปรดชีต
 * @param {{ gid?: string, sheet?: string, spreadsheetId?: string }} target
 * @returns {Promise<Array>} แถวรูปแบบ gviz ({ c: [cell, ...] })
 */
export async function fetchSheetRows({ gid, sheet, spreadsheetId = STORE_SHEET_ID }) {
  const selector = gid !== undefined ? `gid=${gid}` : `sheet=${encodeURIComponent(sheet)}`;
  const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:json&${selector}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('โหลดข้อมูลจาก Google Sheet ไม่สำเร็จ');
  const text = await res.text();
  const a = text.indexOf('{');
  const b = text.lastIndexOf('}');
  if (a === -1 || b === -1) throw new Error('รูปแบบข้อมูลจาก Google Sheet ไม่ถูกต้อง');
  const json = JSON.parse(text.substring(a, b + 1));
  return json.table.rows || [];
}

/**
 * แปลงข้อความ CSV เป็นตาราง — รองรับ field ที่ครอบด้วย " และมี , หรือขึ้นบรรทัดใหม่ข้างใน
 * ("" ข้างในหมายถึงอัญประกาศตัวเดียว ตามมาตรฐาน CSV)
 */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/**
 * ดึงแถวของแท็บหนึ่งผ่าน "export CSV" แทน gviz
 *
 * ทำไมต้องมีทางนี้: gviz คืนกลับมาเฉพาะแถวที่ผ่าน "ตัวกรอง" ที่เปิดค้างไว้ในชีท ถ้าใครเผลอ
 * เปิดตัวกรองทิ้งไว้ ตัวย้ายข้อมูลจะได้แถวมาไม่ครบโดยไม่มีอะไรฟ้องเลย — ทีม Narai-branch
 * เจอของจริงมาแล้วตอนย้ายชีท 'ข้อมูลนับสตอค': gviz ให้มา 6,112 แถว ทั้งที่ของจริง 70,785 แถว
 * (ดู docs/stock-sql-migration.md ของโปรเจกต์นั้น) ส่วน export CSV ไม่สนใจตัวกรอง
 *
 * คืนค่าเป็นรูปแบบเดียวกับ gviz ({ c: [{ v }, ...] }) ตัวแกะข้อมูลฝั่งเรียกจึงใช้ร่วมกันได้
 * ทั้งสองทาง ต่างกันแค่ค่าที่ได้เป็นสตริงล้วน (cellYmd/cellDateTime/cellNum รับสตริงอยู่แล้ว)
 *
 * ต่างจาก gviz ตรงที่ CSV ส่งแถวหัวตารางมาด้วย จึงต้องตัดทิ้งเอง — ตัดเฉพาะเมื่อแถวแรก
 * "หน้าตาเหมือนหัวตาราง" ไม่ตัดดื้อๆ เพราะถ้าแท็บไหนไม่มีหัวตาราง ข้อมูลจริงจะหายไปหนึ่งแถว
 */
export async function fetchSheetRowsCsv({ gid, spreadsheetId = STORE_SHEET_ID, headerHints = [] }) {
  const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv&gid=${encodeURIComponent(gid)}`;
  const res = await fetch(url, { redirect: 'follow' });
  const text = await res.text();
  // ชีทที่ไม่ได้แชร์เป็น "ผู้ที่มีลิงก์" จะเด้งไปหน้าล็อกอินซึ่งเป็น HTML ไม่ใช่ CSV
  if (/^\s*</.test(text)) {
    throw new Error('ดึง CSV จาก Google Sheet ไม่ได้ — ตรวจว่าชีทตั้งแชร์เป็น "ผู้ที่มีลิงก์ • ผู้อ่าน" แล้ว');
  }
  const table = parseCsv(text);
  if (table.length === 0) return [];

  const first = table[0].map(v => String(v || '').trim());
  const looksLikeHeader = headerHints.length > 0 && headerHints.some(h => first.includes(h));
  const body = looksLikeHeader ? table.slice(1) : table;

  return body.map(cells => ({ c: cells.map(v => ({ v: v === '' ? null : v })) }));
}

/** ค่าข้อความของเซลล์ (ตัดช่องว่างหัวท้าย) — เซลล์ว่างคืนค่าว่าง */
export const cellStr = (cell) => (cell?.v === null || cell?.v === undefined ? '' : String(cell.v).trim());

/** ค่าตัวเลขของเซลล์ — อ่านไม่ออกคืน 0 */
export const cellNum = (cell) => Number(cell?.v) || 0;

/**
 * แปลงเซลล์วันที่เป็น 'YYYY-MM-DD'
 *
 * gviz คืนวันที่มาได้หลายรูปแบบขึ้นกับว่าคอลัมน์นั้นถูกตีความเป็น date จริงหรือเป็นข้อความ:
 * "Date(2026,8,16)" (เดือนเริ่มที่ 0), "2026-09-16", "16/09/2026" หรืออยู่ในค่า formatted (f)
 * เท่านั้น — รองรับทั้งหมด อ่านไม่ออกคืน null เพื่อให้ลงคอลัมน์ DATE ที่ยอม NULL ได้
 */
export function cellYmd(cell) {
  if (!cell) return null;
  const raw = cell.v === null || cell.v === undefined ? '' : String(cell.v).trim();

  let m = raw.match(/^Date\((\d+),(\d+),(\d+)/);
  if (m) return `${m[1]}-${String(Number(m[2]) + 1).padStart(2, '0')}-${String(Number(m[3])).padStart(2, '0')}`;

  m = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;

  // เผื่อกรณี gviz ตีความเป็น date แต่ v ว่าง — ใช้ค่า formatted (f) แทน
  const formatted = cell.f === null || cell.f === undefined ? '' : String(cell.f).trim();
  for (const s of [raw, formatted]) {
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  return null;
}

/**
 * แปลงเซลล์ "เวลาบันทึก" เป็น Date
 *
 * คอลัมน์นี้ถูกเขียนด้วย toLocaleString('th-TH') จากฝั่งเว็บ จึงได้ปี พ.ศ. มาเป็นสตริง
 * เช่น "16/9/2569 10:30:00" — ถ้าเจอปีเกิน 2400 ให้ลบ 543 กลับเป็น ค.ศ. ก่อนเก็บลงฐาน
 * ไม่งั้นค่าจะเกินช่วงที่คอลัมน์ DATETIME ของ MySQL รับได้ (สูงสุดปี 9999 ก็จริง แต่การ
 * เทียบวันที่กับข้อมูลอื่นจะเพี้ยนไป 543 ปีทั้งหมด)
 */
export function cellDateTime(cell) {
  if (!cell) return null;
  const raw = cell.v === null || cell.v === undefined ? '' : String(cell.v).trim();
  const formatted = cell.f === null || cell.f === undefined ? '' : String(cell.f).trim();
  return parseDateTimeString(raw) || parseDateTimeString(formatted);
}

/**
 * แปลง Date เป็นสตริง 'YYYY-MM-DD HH:mm:ss' ที่ฐานข้อมูลรับตรงๆ
 *
 * ส่งเป็นสตริงแทนที่จะส่ง object Date เพราะไดรเวอร์ฐานข้อมูลจะแปลงโซนเวลาให้ตามที่ connection
 * ตั้งไว้ ซึ่งบน Vercel (UTC) กับเครื่องที่ออฟฟิศ (ไทย) ให้ผลต่างกัน 7 ชั่วโมง
 * สตริงถูกส่งไปตามตัวอักษร ไม่มีการแปลงระหว่างทาง
 */
export function toSqlDateTime(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`;
}

/**
 * แปลงสตริงวันที่-เวลาเป็น Date — รองรับรูปแบบที่โผล่มาจริงในระบบนี้
 *   "Date(2026,8,16,10,30,0)"  gviz ตีความคอลัมน์เป็น date
 *   "16/9/2569 10:30:00"       toLocaleString('th-TH') จากหน้าเว็บ (ปี พ.ศ.)
 *   "16/09/2026 10:30:00"      Utilities.formatDate ของ Apps Script (ปี ค.ศ.)
 *   "2026-09-16T10:30:00"      ISO
 *
 * แยกออกมาจาก cellDateTime เพราะฝั่งที่เขียนลงฐานก็ต้องแปลงค่าที่ Apps Script ตอบกลับมา
 * ด้วยรูปแบบเดียวกัน ไม่ได้มาจากเซลล์ในชีท
 */
export function parseDateTimeString(value) {
  const s = String(value === null || value === undefined ? '' : value).trim();
  if (!s) return null;

  let m = s.match(/^Date\((\d+),(\d+),(\d+)(?:,(\d+),(\d+),(\d+))?/);
  if (m) {
    return new Date(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4] || 0), Number(m[5] || 0), Number(m[6] || 0));
  }

  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:,?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    let year = Number(m[3]);
    if (year > 2400) year -= 543; // ปี พ.ศ. — เก็บลงฐานเป็น ค.ศ. เสมอ
    return new Date(year, Number(m[2]) - 1, Number(m[1]), Number(m[4] || 0), Number(m[5] || 0), Number(m[6] || 0));
  }

  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] || 0), Number(m[5] || 0), Number(m[6] || 0));
  }
  return null;
}
