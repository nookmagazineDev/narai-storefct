#!/usr/bin/env node
// ย้ายข้อมูลจาก Google Sheets เข้า MySQL (ฐาน narai_store)
//
// ใช้สองจังหวะ:
//   1. ครั้งแรกหลังรัน docs/schema-store.sql — ย้ายของเก่าทั้งหมดขึ้นมา
//   2. ระหว่างที่ยัง dual-write อยู่ — ตามเก็บสิ่งที่ "ระบบอื่น" เขียนลงชีท
//      (หน้ารับของของแอป Narai-branch และตัวที่ log ใบยกเลิก) ซึ่งแอปนี้ไม่ได้เป็นคนเขียน
//
// รันซ้ำได้ตลอด ไม่เกิดแถวซ้ำ เพราะทุกตารางมี unique key และใช้ UPSERT
//
// วิธีรัน (ต้องมี .env ที่มี MYSQL_* ครบ):
//   node scripts/sync-store-db.mjs           ย้ายทุกแท็บ
//   node scripts/sync-store-db.mjs --check   ไม่เขียนอะไร แค่นับแถวสองฝั่งมาเทียบกัน
//   node scripts/sync-store-db.mjs รับของ    เลือกเฉพาะบางแท็บ

import fs from 'fs';

// ต้อง parse .env ก่อน import โมดูลที่ใช้ค่าพวกนี้ — server.js ทำเองตอนบูต แต่สคริปต์ตัวนี้
// ไม่ได้ผ่าน server.js จึงต้องทำซ้ำตรงนี้ (โหลดด้วย await import ข้างล่างหลังตั้งค่าเสร็จ)
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

const { getPool } = await import('../lib/db.js');
const { syncFulfillment, syncReceiving, syncFetched, syncCancelled, countRows } =
  await import('../lib/storeDb.js');

const JOBS = {
  'จัดของ': syncFulfillment,
  'รับของ': syncReceiving,
  'ดึงข้อมูลใบเบิก': syncFetched,
  'ยกเลิกใบเบิก': syncCancelled,
};

const args = process.argv.slice(2);
const checkOnly = args.includes('--check');
const picked = args.filter(a => !a.startsWith('--'));

async function main() {
  if (checkOnly) {
    console.log('จำนวนแถวใน MySQL ตอนนี้:');
    for (const [table, n] of Object.entries(await countRows())) {
      console.log(`  ${table.padEnd(14)} ${n.toLocaleString()} แถว`);
    }
    return;
  }

  const selected = picked.length > 0 ? picked : Object.keys(JOBS);
  const unknown = selected.filter(name => !JOBS[name]);
  if (unknown.length > 0) {
    console.error(`ไม่รู้จักแท็บ: ${unknown.join(', ')}`);
    console.error(`เลือกได้จาก: ${Object.keys(JOBS).join(', ')}`);
    process.exitCode = 1;
    return;
  }

  let failed = 0;
  for (const name of selected) {
    process.stdout.write(`กำลังย้าย "${name}" ... `);
    try {
      const result = await JOBS[name]();
      const parts = [`อ่านจากชีท ${result.sheetRows} แถว`, `เขียนลงฐาน ${result.upserted} แถว`];
      if (result.skipped) parts.push(`ข้าม ${result.skipped} แถว (จับคู่สาขาไม่ได้)`);
      if (result.note) parts.push(result.note);
      console.log(`✅ ${parts.join(' · ')}`);
    } catch (err) {
      failed++;
      console.log(`❌ ${err.message}`);
    }
  }

  console.log('\nจำนวนแถวใน MySQL หลังย้าย:');
  for (const [table, n] of Object.entries(await countRows())) {
    console.log(`  ${table.padEnd(14)} ${n.toLocaleString()} แถว`);
  }

  if (failed > 0) process.exitCode = 1;
}

try {
  await main();
} catch (err) {
  console.error('ล้มเหลว:', err.message);
  process.exitCode = 1;
} finally {
  // pool ค้าง event loop ไว้ ถ้าไม่ปิดสคริปต์จะไม่จบเอง
  await getPool().end().catch(() => {});
}
