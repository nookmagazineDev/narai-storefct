#!/usr/bin/env node
// ย้ายข้อมูลเก่าจาก Google Sheets เข้า SQL Server (InventoryNarai) ผ่าน office-server
//
// ใช้ครั้งเดียวตอนเปลี่ยนระบบ — หลังรัน docs/schema-store-sqlserver.sql และ deploy แพตช์
// office-server แล้ว แต่ก่อนจะตั้ง STORE_SOURCE=sql
//
// รันซ้ำได้ตลอด ไม่เกิดแถวซ้ำ เพราะฝั่ง SQL ทำ MERGE ตามคีย์
//
// วิธีรัน:
//   node scripts/import-store-sql.mjs                 ย้ายทุกแท็บ
//   node scripts/import-store-sql.mjs รับของ           เลือกเฉพาะบางแท็บ
//   node scripts/import-store-sql.mjs --dry-run       อ่านชีทมานับให้ดู ไม่ส่งอะไรไป
//
// ⚠️ ถ้าจำนวน "อ่านจากชีท" น้อยกว่าที่เห็นในชีทจริง แปลว่ามีตัวกรองเปิดค้างไว้ — gviz คืนเฉพาะ
// แถวที่ผ่านตัวกรองโดยไม่ฟ้องอะไรเลย ให้รันใหม่ด้วย --csv ซึ่งอ่านผ่าน export CSV แทน
//
//   node scripts/import-store-sql.mjs --csv
//   node scripts/import-store-sql.mjs --csv --gid-fetched=<เลข> --gid-cancelled=<เลข>
//
// สองแท็บหลังถูกสร้างโดย Apps Script ตอนใช้งานจริง จึงไม่รู้ gid ล่วงหน้า ต้องเปิดแท็บนั้น
// ในเบราว์เซอร์แล้วคัดเลขท้าย URL มาใส่เอง ถ้าจะใช้โหมด CSV กับมัน

import fs from 'fs';

// ต้อง parse .env ก่อน import โมดูลที่ใช้ค่าพวกนี้ (server.js ทำเองตอนบูต สคริปต์นี้ไม่ได้ผ่าน)
try {
  if (fs.existsSync('.env')) {
    for (const line of fs.readFileSync('.env', 'utf8').split('\n')) {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (!match) continue;
      let value = match[2] || '';
      if (value.length > 0 && value.startsWith('"') && value.endsWith('"')) {
        value = value.substring(1, value.length - 1);
      }
      process.env[match[1]] = value.trim();
    }
  }
} catch (err) {
  console.warn('อ่านไฟล์ .env ไม่ได้:', err.message);
}

const { callOffice, officeBase } = await import('../lib/officeServer.js');
const { normCode, splitDocNo } = await import('../lib/storeDb.js');
const { fetchSheetRows, fetchSheetRowsCsv, cellStr, cellNum, cellYmd, cellDateTime, toSqlDateTime,
  SHEET_GID, SHEET_NAME } = await import('../lib/sheets.js');

const args = process.argv.slice(2);
const useCsv = args.includes('--csv');
const dryRun = args.includes('--dry-run');
const picked = args.filter((a) => !a.startsWith('--'));

const gidFlag = (name) => {
  const hit = args.find((a) => a.startsWith(`--gid-${name}=`));
  return hit ? hit.split('=')[1] : undefined;
};

const HEADER_HINTS = {
  fulfillment: ['เลขที่ใบเบิก', 'จำนวนเบิก', 'จำนวนส่ง'],
  receiving: ['เลขที่ใบเบิก', 'จำนวนที่รับจริง', 'วันที่รับ'],
  fetched: ['เลขที่ใบเบิก', 'เวลาบันทึก'],
  cancelled: ['เลขที่ใบเบิก', 'วันที่สั่ง', 'ผู้บันทึก'],
};

async function loadRows(part, { gid, sheet }) {
  if (!useCsv) return fetchSheetRows(gid !== undefined ? { gid } : { sheet });
  const csvGid = gid !== undefined ? gid : gidFlag(part);
  if (csvGid === undefined) {
    throw new Error(`โหมด CSV ต้องระบุ gid ของแท็บ "${sheet}" ด้วย เช่น --gid-${part}=123456789`);
  }
  return fetchSheetRowsCsv({ gid: csvGid, headerHints: HEADER_HINTS[part] || [] });
}

// ---------------------------------------------------------------------------
// ตัวแกะแต่ละแท็บ -> แถวที่ตรงกับคอลัมน์ฝั่ง SQL
// แถวหลังสุดของคีย์เดียวกันชนะ (กติกาเดียวกับที่ฝั่งอ่านชีทใช้มาตลอด)
// ---------------------------------------------------------------------------

const PARTS = {
  'จัดของ': {
    part: 'fulfillment',
    target: 'fulfillment',
    source: { gid: SHEET_GID.fulfillment },
    // A วันที่ B สาขา C รหัส D ชื่อ E จำนวนเบิก F จำนวนส่ง G เลขที่ใบเบิก H สถานะ I เวลาบันทึก J หมายเหตุ
    parse(c) {
      const docNo = cellStr(c[6]);
      const itemKey = normCode(cellStr(c[2]));
      if (!docNo || !itemKey) return null;
      const { ordNo } = splitDocNo(docNo);
      return [`${docNo}|${itemKey}`, {
        doc_no: docNo,
        outlet_id: null, // ชีทไม่ได้เก็บรหัสสาขาที่เป็นตัวเลข เติมทีหลังได้จาก ord_no + branch
        ord_no: ordNo,
        branch: cellStr(c[1]),
        del_date: cellYmd(c[0]),
        item_key: itemKey,
        item_code: cellStr(c[2]).replace(/^'/, ''),
        item_name: cellStr(c[3]).slice(0, 255),
        req_qty: cellNum(c[4]),
        del_qty: cellNum(c[5]),
        status: cellStr(c[7]).slice(0, 50),
        note: cellStr(c[9]).slice(0, 500),
        // ไม่ใส่เวลาปัจจุบันแทนเมื่ออ่านไม่ออก — แถวเก่าจะได้ไม่ดูเหมือนเพิ่งบันทึกเมื่อกี้
        recorded_at: toSqlDateTime(cellDateTime(c[8])),
      }];
    },
  },

  'รับของ': {
    part: 'receiving',
    target: 'receiving',
    source: { gid: SHEET_GID.receiving },
    // A วันที่รับ B สาขา C เลขที่ใบเบิก D รหัส E ชื่อ F จำนวนเบิก G จำนวนส่ง H จำนวนที่รับจริง
    // I สถานะ J หมายเหตุ K รูปภาพ L ผู้บันทึก M เวลาบันทึก N อนุมัติจากโกดัง O เวลาอนุมัติ
    parse(c) {
      const docNo = cellStr(c[2]);
      const itemKey = normCode(cellStr(c[3]));
      if (!docNo || !itemKey) return null;
      return [`${docNo}|${itemKey}`, {
        doc_no: docNo,
        branch: cellStr(c[1]),
        receive_date: cellYmd(c[0]),
        item_key: itemKey,
        item_code: cellStr(c[3]).replace(/^'/, ''),
        item_name: cellStr(c[4]).slice(0, 255),
        req_qty: cellNum(c[5]),
        del_qty: cellNum(c[6]),
        qty_received: cellNum(c[7]),
        status: cellStr(c[8]).slice(0, 50),
        note: cellStr(c[9]).slice(0, 500),
        photo_url: cellStr(c[10]).slice(0, 500),
        recorder: cellStr(c[11]).slice(0, 255),
        recorded_at: toSqlDateTime(cellDateTime(c[12])),
        approved_by: cellStr(c[13]).slice(0, 255),
        approved_at: toSqlDateTime(cellDateTime(c[14])),
      }];
    },
  },

  'ดึงข้อมูลใบเบิก': {
    part: 'fetched',
    target: 'fetched',
    source: { sheet: SHEET_NAME.fetched },
    // A วันที่ B สาขา C เลขที่ใบเบิก D เวลาบันทึก
    //
    // คีย์ฝั่ง SQL คือ (outlet_id, ord_no) แต่ชีทไม่มี outlet_id — แถวที่หา outlet_id ไม่เจอจะถูก
    // ข้ามและรายงานจำนวนกลับไป ไม่ใช่เดาสาขาให้
    parse(c) {
      const docNo = cellStr(c[2]);
      const { ordNo } = splitDocNo(docNo);
      if (!ordNo) return null;
      return [`${docNo}`, {
        outlet_id: undefined, // เติมทีหลังจาก myfbdata.orderd
        ord_no: ordNo,
        doc_no: docNo,
        branch: cellStr(c[1]),
        del_date: cellYmd(c[0]),
        fetched_at: toSqlDateTime(cellDateTime(c[3])),
      }];
    },
    needsOutletId: true,
  },

  'ยกเลิกใบเบิก': {
    part: 'cancelled',
    target: 'cancelled',
    source: { sheet: SHEET_NAME.cancelled },
    // A วันที่สั่ง B สาขา C เลขที่ใบเบิก D วันที่รับ E จำนวนรายการ F ผู้บันทึก G เวลาที่ยกเลิก
    //
    // คอลัมน์ C เก็บเฉพาะตัวเลข ต้องประกอบกับชื่อสาขาเป็น 'CRM-3451' ให้ตรงกับที่หน้าเว็บใช้
    parse(c) {
      const branch = cellStr(c[1]);
      const rawNo = Number(c[2]?.v);
      // ไม่มีสาขาหรือเลขไม่ใช่ตัวเลข = ประกอบ doc_no ไม่ได้ ข้ามไปเลย ดีกว่าเขียน
      // 'SJP-NaN' หรือ '-3451' ลงตารางแล้วไปเจอทีหลังตอนหน้าเว็บอ่านไม่ตรง
      if (!branch || !Number.isFinite(rawNo)) return null;
      const docNo = `${branch.toUpperCase()}-${Math.round(rawNo)}`;
      return [docNo, {
        doc_no: docNo,
        branch,
        order_date: cellYmd(c[0]),
        del_date: cellYmd(c[3]),
        item_count: cellNum(c[4]),
        recorder: cellStr(c[5]).slice(0, 255),
        cancelled_at: toSqlDateTime(cellDateTime(c[6])),
      }];
    },
  },
};

/**
 * เติม outlet_id ให้แถว "ดึงข้อมูลใบเบิก" โดยหาจาก myfbdata.orderd
 * เลขใบเบิกซ้ำกันได้ข้ามสาขา จึงต้องเทียบชื่อสาขาด้วย ยกเว้นกรณีที่เลขนั้นมีสาขาเดียว
 */
async function resolveOutletIds(rows) {
  const { queryRead } = await import('../lib/db.js');
  const ordNos = [...new Set(rows.map((r) => r.ord_no))];
  const owners = [];
  for (let i = 0; i < ordNos.length; i += 200) {
    const chunk = await queryRead(
      `SELECT DISTINCT o.Ord_No AS ordNo, o.Ord_StrID AS outletId, s.Str_Name AS branchName
         FROM orderd o LEFT JOIN store s ON o.Ord_StrID = s.Str_ID
        WHERE o.Ord_No IN (?)`,
      [ordNos.slice(i, i + 200)]
    );
    owners.push(...chunk);
  }

  const byOrdNo = new Map();
  for (const o of owners) {
    const list = byOrdNo.get(Number(o.ordNo)) || [];
    list.push(o);
    byOrdNo.set(Number(o.ordNo), list);
  }

  const resolved = [];
  let skipped = 0;
  for (const r of rows) {
    const candidates = byOrdNo.get(r.ord_no) || [];
    const wanted = String(r.branch || '').toUpperCase();
    const match = candidates.length === 1
      ? candidates[0]
      : candidates.find((c) => String(c.branchName || '').trim().toUpperCase() === wanted);
    if (!match) { skipped++; continue; }
    resolved.push({ ...r, outlet_id: Number(match.outletId) });
  }
  return { resolved, skipped };
}

async function run(name) {
  const spec = PARTS[name];
  process.stdout.write(`"${name}" ... `);

  let sheetRows;
  try {
    sheetRows = await loadRows(spec.part, spec.source);
  } catch (err) {
    console.log(`❌ อ่านชีทไม่ได้ — ${err.message}`);
    return false;
  }

  // แยกให้เห็นว่าแถวที่หายไปคือ "ซ้ำ" (ปลอดภัย แถวหลังชนะ กติกาเดียวกับฝั่งอ่านชีท)
  // หรือ "แกะไม่ได้" (ไม่มีเลขที่ใบเบิก/รหัสสินค้า) ซึ่งอาจแปลว่าคอลัมน์เลื่อน
  const byKey = new Map();
  let unparsed = 0;
  let duplicates = 0;
  const unparsedSamples = [];
  for (const row of sheetRows) {
    const parsed = spec.parse(row.c || []);
    if (!parsed) {
      unparsed++;
      // เก็บตัวอย่างไว้โชว์ จะได้รู้ว่าเป็นแถวว่างจริง หรือคอลัมน์เลื่อนจนแกะไม่ออก
      if (unparsedSamples.length < 3) {
        unparsedSamples.push((row.c || []).map((cell) => cell?.v ?? '').join(' | '));
      }
      continue;
    }
    if (byKey.has(parsed[0])) duplicates++;
    byKey.set(parsed[0], parsed[1]);
  }
  let rows = [...byKey.values()];
  let skipped = 0;

  const breakdown = [
    duplicates ? `ซ้ำ ${duplicates}` : '',
    unparsed ? `แกะไม่ได้ ${unparsed}` : '',
  ].filter(Boolean).join(' · ');

  if (spec.needsOutletId && rows.length > 0) {
    try {
      const out = await resolveOutletIds(rows);
      rows = out.resolved;
      skipped = out.skipped;
    } catch (err) {
      console.log(`❌ หา outlet_id จาก MySQL ไม่ได้ — ${err.message}`);
      return false;
    }
  }

  if (dryRun) {
    console.log(`อ่านจากชีท ${sheetRows.length} แถว · จะส่ง ${rows.length} แถว` +
      (breakdown ? ` · ${breakdown}` : '') +
      (skipped ? ` · จับคู่สาขาไม่ได้ ${skipped}` : '') + ' (--dry-run ไม่ได้ส่งจริง)');
    for (const sample of unparsedSamples) console.log(`      แกะไม่ได้: ${sample}`);
    return true;
  }

  // ส่งเป็นก้อน — ฝั่ง office-server จำกัดไว้ 1000 แถวต่อครั้ง และก้อนเล็กกว่าทำให้เห็นว่า
  // พังตรงไหนถ้าพัง แทนที่จะล้มทั้งชุด
  let imported = 0;
  for (let i = 0; i < rows.length; i += 500) {
    try {
      const res = await callOffice('importStoreRows', { target: spec.target, rows: rows.slice(i, i + 500) });
      imported += Number(res?.imported) || 0;
    } catch (err) {
      console.log(`❌ ส่งก้อนที่ ${Math.floor(i / 500) + 1} ไม่สำเร็จ — ${err.message}`);
      return false;
    }
  }

  console.log(`✅ อ่านจากชีท ${sheetRows.length} แถว · เขียนลง SQL ${imported} แถว` +
    (breakdown ? ` · ${breakdown}` : '') +
    (skipped ? ` · จับคู่สาขาไม่ได้ ${skipped}` : ''));
  return true;
}

async function main() {
  const selected = picked.length > 0 ? picked : Object.keys(PARTS);
  const unknown = selected.filter((n) => !PARTS[n]);
  if (unknown.length > 0) {
    console.error(`ไม่รู้จักแท็บ: ${unknown.join(', ')}`);
    console.error(`เลือกได้จาก: ${Object.keys(PARTS).join(', ')}`);
    process.exitCode = 1;
    return;
  }

  console.log(`ปลายทาง: ${officeBase()} (SQL Server / InventoryNarai)`);
  console.log(`ช่องทางอ่านชีท: ${useCsv ? 'export CSV (ไม่สนใจตัวกรอง)' : 'gviz'}\n`);

  let failed = 0;
  for (const name of selected) {
    if (!(await run(name))) failed++;
  }

  if (!useCsv) {
    console.log('\n⚠️  ตัวเลข "อ่านจากชีท" มาจาก gviz ซึ่งนับเฉพาะแถวที่ผ่านตัวกรองที่เปิดค้างไว้');
    console.log('   เทียบกับจำนวนแถวในชีทจริงก่อน ถ้าน้อยกว่าให้รันซ้ำด้วย --csv');
  }

  if (failed > 0) process.exitCode = 1;
}

try {
  await main();
} catch (err) {
  console.error('ล้มเหลว:', err.message);
  process.exitCode = 1;
} finally {
  // pool MySQL (ใช้เฉพาะตอนหา outlet_id) ค้าง event loop ไว้ ถ้าไม่ปิดสคริปต์จะไม่จบเอง
  try {
    const { getPool } = await import('../lib/db.js');
    await getPool().end();
  } catch {
    // ไม่เคยเปิด pool เลยก็ไม่มีอะไรต้องปิด
  }
}
