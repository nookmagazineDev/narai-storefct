// ตัวดึงทะเบียนสาขาจากทะเบียนแม่ (แดชบอร์ดออฟฟิศ naraipizzeria)
//
// ทะเบียนสาขาเคยมีอยู่สามชุดในสามโปรเจค แล้วก็หลุดกันจริง — ที่ชัดที่สุดคือสาขา HPS
// ที่ไฟล์นี้เคยแมปเป็น outlet 902 ส่วนอีกสองระบบใช้ 109 แปลว่ามีฝั่งหนึ่งอ่านผิดร้านมาตลอด
// ตอนนี้ทะเบียนแม่อยู่ที่เดียว แก้จากหน้าเว็บ แล้วทุกระบบดึงไปใช้
// เหตุผลและแผนเต็มอยู่ใน naraipizzeria/docs/branch-hub.md
//
//   เบราว์เซอร์ -> /api/branches (แอปนี้) -> naraipizzeria /api/branch-feed -> SQL Server
//
// ตั้งค่าใน .env:
//   BRANCH_HUB_BASE   URL ของแดชบอร์ดออฟฟิศ เช่น https://naraipizzeria.vercel.app
//   BRANCH_FEED_KEY   ต้องตรงกับที่ตั้งไว้ฝั่งนั้น
// ไม่ตั้งทั้งคู่ = ไม่ดึง ใช้ตาราง BRANCH_MAP ที่ฝังไว้ใน lib/branches.js ต่อไปเหมือนเดิม
//
// ⭐ เส้นนี้ห้ามทำให้หน้าเว็บพัง — ทะเบียนสาขาคุม dropdown เลือกสาขาของทุกหน้า
//    ดึงไม่ได้ด้วยเหตุใดก็ตาม = ใช้ของเดิมต่อ แล้วแนบเหตุผลกลับไปเป็นหมายเหตุ
//    ไม่ใช่ตอบ error ทิ้งหน้าเว็บให้เลือกสาขาไม่ได้
import { BRANCH_MAP, applyHubBranches } from './branches.js';

// รันบน Vercel แบบ serverless — instance ถูกใช้ซ้ำระหว่าง request แต่ไม่ได้อยู่ยาว
// ตั้งเวลาไว้รีเฟรชเป็นระยะจึงพึ่งไม่ได้ ใช้แคชแบบ "หมดอายุแล้วค่อยดึงใหม่ตอนมีคนถาม" แทน
const TTL_MS = 5 * 60 * 1000;
// ดึงไม่ได้แล้วใช้ของเดิม — แคชสั้นกว่า จะได้กลับไปลองใหม่เร็ว ๆ ไม่ต้องรอครบ 5 นาที
const FAIL_TTL_MS = 30 * 1000;
// ทะเบียนสาขาเป็นตารางเล็กมาก ตอบไม่ทัน 8 วิ = ไปไม่ถึงอยู่ดี อย่าให้หน้าเว็บค้างรอ
const TIMEOUT_MS = 8000;

const g = globalThis;
g.__branchHub = g.__branchHub || { at: 0, ttl: 0, source: 'fallback', version: '', warning: '' };

const env = (k) => String(process.env[k] || '').trim();

/** ตั้งค่าครบไหม — อ่านตอนเรียกใช้ ไม่ใช่ตอน import (server.js parse .env หลังโมดูลรัน) */
export const hubConfigured = () => Boolean(env('BRANCH_HUB_BASE') && env('BRANCH_FEED_KEY'));

/** รูปแบบที่หน้าเว็บใช้ — แปลงจาก BRANCH_MAP ที่ (อาจ) ถูกเติมจากทะเบียนแล้ว */
const listFromMap = () =>
  Object.entries(BRANCH_MAP)
    .filter(([code]) => code !== 'all')
    .map(([code, info]) => ({ code: code.toUpperCase(), name: info.name, outletId: Number(info.id) || null }))
    .sort((a, b) => (a.outletId || 0) - (b.outletId || 0));

async function fetchFeed() {
  const base = env('BRANCH_HUB_BASE').replace(/\/+$/, '');
  const res = await fetch(`${base}/api/branch-feed`, {
    cache: 'no-store',
    headers: { 'x-branch-key': env('BRANCH_FEED_KEY') },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); }
  catch {
    throw new Error(`ทะเบียนสาขาตอบไม่ใช่ JSON (HTTP ${res.status}) — ตรวจว่า BRANCH_HUB_BASE ชี้ถูกที่ไหม`);
  }
  if (res.status === 401) throw new Error('BRANCH_FEED_KEY ไม่ตรงกับฝั่งแดชบอร์ดออฟฟิศ');
  if (res.status === 503) throw new Error(json.message || 'ฝั่งแดชบอร์ดออฟฟิศยังไม่ได้เปิดเส้นจ่ายทะเบียนสาขา');
  if (!res.ok || json.status !== 'success') throw new Error(json.message || `ทะเบียนสาขาตอบ HTTP ${res.status}`);
  if (!Array.isArray(json.data) || json.data.length === 0) throw new Error('ทะเบียนสาขาที่ได้มาว่างเปล่า');

  // ฝั่งนั้นบอกเองว่ากำลังใช้รายชื่อสำรองอยู่ = ของที่ได้มาไม่ได้ดีกว่าของที่เรามี
  // เอามาทับแล้วจะกลายเป็นแช่ของเก่าไว้อีก 5 นาทีโดยไม่ได้อะไรเพิ่ม
  if (json.source === 'fallback') throw new Error('ฝั่งแดชบอร์ดออฟฟิศเองก็อ่านทะเบียนจากฐานไม่ได้อยู่');

  return json;
}

/**
 * ทะเบียนสาขาล่าสุด — { data, source, version, warning }
 * source: 'hub' = ของจริงจากทะเบียนแม่ · 'fallback' = ตารางที่ฝังไว้ในโค้ด
 */
export async function branchRegistry() {
  const c = g.__branchHub;
  if (c.at && Date.now() - c.at < c.ttl) {
    return { data: listFromMap(), source: c.source, version: c.version, warning: c.warning };
  }

  if (!hubConfigured()) {
    g.__branchHub = {
      at: Date.now(), ttl: FAIL_TTL_MS, source: 'fallback', version: '',
      warning: 'ยังไม่ได้ตั้ง BRANCH_HUB_BASE / BRANCH_FEED_KEY — ใช้รายชื่อสาขาที่ฝังไว้ในโค้ด',
    };
    return { data: listFromMap(), ...g.__branchHub };
  }

  try {
    const feed = await fetchFeed();
    const changed = applyHubBranches(feed.data, feed.aliases);
    if (changed) console.log(`✅ ทะเบียนสาขา: อัปเดตจากทะเบียนแม่ ${changed} รายการ (version ${feed.version})`);
    g.__branchHub = { at: Date.now(), ttl: TTL_MS, source: 'hub', version: feed.version || '', warning: '' };
  } catch (err) {
    console.error('ทะเบียนสาขา: ดึงจากทะเบียนแม่ไม่ได้ — ใช้รายชื่อที่มีอยู่ต่อ:', err.message);
    g.__branchHub = {
      at: Date.now(), ttl: FAIL_TTL_MS,
      // ดึงไม่ได้รอบนี้ แต่รอบก่อนเคยได้ = ของใน BRANCH_MAP ยังเป็นของจริงอยู่ อย่าบอกว่าเป็นของสำรอง
      source: c.source === 'hub' ? 'hub' : 'fallback',
      version: c.version || '',
      warning: `ดึงทะเบียนสาขาล่าสุดไม่ได้ (${err.message})`,
    };
  }

  const { source, version, warning } = g.__branchHub;
  return { data: listFromMap(), source, version, warning };
}
