// ตัวเรียก office-server ที่ออฟฟิศ — ทางเดียวที่แอปนี้เข้าถึง SQL Server ได้
//
// ทำไมต้องอ้อม: ข้อมูลนับสต๊อกอยู่บน SQL Server (`InventoryNarai`) ที่ออฟฟิศ ซึ่งเปิดพอร์ต 1433
// ให้เฉพาะ IP ในไทย ฟังก์ชันบน Vercel วิ่งมาจากต่างประเทศจึงต่อตรงไม่ได้ ส่วนเครื่องที่ออฟฟิศ
// ต่อผ่าน localhost ได้อยู่แล้ว และ Vercel เรียกเครื่องนั้นที่พอร์ต 8787 ได้อยู่แล้ว
//
//   เบราว์เซอร์ -> /api/stock_count_summary (แอปนี้) -> office-server :8787/schedule -> SQL Server
//
// เส้นทางเดียวกับที่โปรเจกต์ Narai-branch ใช้อยู่ทุกวัน (api/stockcount.js ของฝั่งนั้น)
// ตรรกะ SQL ทั้งหมดอยู่ที่ office-server/stock.js ของ repo นั้น ที่นี่เป็นแค่ฝั่งเรียก

const DEFAULT_BASE = 'http://storenarai.dyndns.tv:8787';

/**
 * อ่าน env ตอนเรียกใช้ ไม่ใช่ตอน import โมดูล — server.js parse ไฟล์ .env ในตัวมันเอง
 * ซึ่งเกิดหลังจาก ES module รัน body ของโมดูลที่ import ไปแล้ว (เหตุผลเดียวกับ lib/db.js)
 */
export const officeBase = () => process.env.USAGE_API_BASE || DEFAULT_BASE;

/** แปลง error ของ fetch เป็นข้อความไทยที่บอกสาเหตุได้จริง แทนข้อความดิบภาษาอังกฤษ */
function describeError(err, aborted) {
  if (aborted) return 'เซิร์ฟเวอร์ที่ออฟฟิศไม่ตอบกลับภายในเวลาที่กำหนด (เน็ตออฟฟิศช้า หรือเครื่องกำลังทำงานหนัก)';
  const code = err?.cause?.code || err?.code || '';
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return 'หาที่อยู่เซิร์ฟเวอร์ที่ออฟฟิศไม่เจอ (dyndns อาจยังไม่อัปเดต IP ใหม่)';
  }
  if (code === 'ECONNREFUSED' || code === 'EHOSTUNREACH') {
    return 'เซิร์ฟเวอร์ที่ออฟฟิศไม่รับการเชื่อมต่อ — เครื่อง IT-Narai อาจปิดอยู่ หรือ NaraiUsageAPI ไม่ได้รันอยู่';
  }
  if (code === 'ECONNRESET' || code === 'EPIPE') {
    return 'การเชื่อมต่อเซิร์ฟเวอร์ที่ออฟฟิศหลุดกลางคัน กรุณาลองใหม่อีกครั้ง';
  }
  return err?.message || 'ติดต่อเซิร์ฟเวอร์ที่ออฟฟิศไม่สำเร็จ';
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * error ที่ "ลองใหม่ก็ได้ผลเดิม" — ปลายทางรับคำขอแล้วและตอบมาชัดเจนว่าไม่สำเร็จ
 * (ไม่ผ่าน token, ไม่รู้จัก action, query พัง) ต่างจากปัญหาเครือข่ายที่ลองใหม่แล้วมีโอกาสติด
 */
class DefiniteError extends Error {}

/**
 * เรียก action หนึ่งของ office-server แล้วคืน `data` ที่มันตอบกลับมา
 *
 * ลองใหม่ได้เฉพาะ action ที่เป็นการอ่านล้วน (ตอนนี้แอปนี้เรียกแต่การอ่าน) — คำสั่งเขียน
 * ห้ามลองใหม่อัตโนมัติ เพราะคำสั่งอาจถึงปลายทางแล้วแต่คำตอบหายกลางทาง
 *
 * `_user` เป็นตัวแทนของ endpoint นี้เอง ตั้งสาขาเป็น all เพราะ getStockTotal รวมทุกสาขาอยู่แล้ว
 * และไม่เคยมีการตรวจสิทธิ์รายสาขาตรงนี้มาก่อนตั้งแต่ยังอ่านจากชีท
 *
 * @throws {Error} ข้อความไทยบอกสาเหตุ เมื่อต่อไม่ได้หรือปลายทางตอบว่าไม่สำเร็จ
 */
export async function callOffice(action, payload = {}, { timeoutMs = 20000, retries = 1 } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  // office-server จะบังคับตรวจ header นี้ก็ต่อเมื่อฝั่งนั้นตั้ง API_TOKEN ไว้
  if (process.env.USAGE_API_TOKEN) headers['x-api-token'] = process.env.USAGE_API_TOKEN;

  const body = JSON.stringify({
    action,
    ...payload,
    _user: { username: 'storefct-api', branch: 'all' },
  });

  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${officeBase()}/schedule`, {
        method: 'POST',
        headers,
        body,
        signal: controller.signal,
      });

      if (res.status === 401) {
        throw new DefiniteError('เซิร์ฟเวอร์ที่ออฟฟิศปฏิเสธการเชื่อมต่อ (ต้องตั้ง USAGE_API_TOKEN ให้ตรงกับ API_TOKEN ของเครื่องนั้น)');
      }
      // 5xx = พลาดชั่วคราว (เช่นกำลังอุ่น cache อยู่) ลองใหม่ได้
      if (res.status >= 500 && attempt < retries) {
        lastError = new Error(`เซิร์ฟเวอร์ที่ออฟฟิศตอบผิดพลาด (HTTP ${res.status})`);
      } else {
        const json = await res.json().catch(() => null);
        if (!json) throw new DefiniteError(`เซิร์ฟเวอร์ที่ออฟฟิศตอบกลับมาไม่ใช่ JSON (HTTP ${res.status})`);
        if (json.status !== 'success') throw new DefiniteError(json.message || `เรียก ${action} ไม่สำเร็จ (HTTP ${res.status})`);
        return json.data;
      }
    } catch (err) {
      // ปลายทางตอบมาแล้วว่าไม่สำเร็จ ลองใหม่ก็ได้ผลเดิม — โยนออกไปเลย
      if (err instanceof DefiniteError) throw err;
      lastError = new Error(describeError(err, err.name === 'AbortError'));
    } finally {
      clearTimeout(timer);
    }
    if (attempt < retries) await sleep(1000);
  }
  throw lastError || new Error('ติดต่อเซิร์ฟเวอร์ที่ออฟฟิศไม่สำเร็จ');
}
