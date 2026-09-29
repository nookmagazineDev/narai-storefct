// ล็อกอิน + สิทธิ์รายหน้า — ฝั่ง Vercel
//
// รหัสผ่านและสิทธิ์เก็บที่ office-server (office-server/storefct-auth.js ของ Narai-branch · InventoryNarai)
// ที่นี่ออก token ที่เซ็นด้วย AUTH_SECRET เก็บในคุกกี้ HttpOnly แล้วตรวจสิทธิ์ทุกคำขอ /api/*
// ด้วยตาราง lib/pages.js — ผู้ใช้แก้ token เองไม่ได้ (ต่างจากเว็บสาขาที่เชื่อ localStorage)
//
// อายุล็อกอิน 7 วันนับจากตอนล็อกอิน · สิทธิ์ใน token ต่ออายุจาก office-server ทุก 10 นาที
// แอดมินแก้สิทธิ์หรือปิดบัญชี = มีผลภายใน 10 นาที (เปิดหน้าเว็บใหม่ = มีผลทันที ผ่าน /api/auth/me)
//
// สวิตช์ AUTH_REQUIRED (env บน Vercel)
//   ไม่ตั้ง  = ยังไม่บังคับ ใครไม่ล็อกอินก็ใช้ได้เหมือนเดิม (ช่วงสร้างบัญชี) — แต่คนที่ล็อกอินแล้วถูกจำกัดตามสิทธิ์
//   '1'     = ต้องล็อกอินทุกคำขอ

import { createHmac, timingSafeEqual } from 'node:crypto';
import { callOffice } from './officeServer.js';
import { PAGE_KEYS, ruleOf, allowed } from './pages.js';

const COOKIE = 'sf_auth';
const LOGIN_DAYS = 7;
const REFRESH_MS = 10 * 60 * 1000;

export const authRequired = () => process.env.AUTH_REQUIRED === '1';
const secret = () => process.env.AUTH_SECRET || '';

const b64url = (buf) => Buffer.from(buf).toString('base64url');
const sign = (data) => createHmac('sha256', secret()).update(data).digest('base64url');

/** token = base64url(JSON) + '.' + HMAC — แบบเดียวกับ JWT แต่ไม่ต้องพึ่งไลบรารี */
function makeToken(payload) {
  const data = b64url(JSON.stringify(payload));
  return `${data}.${sign(data)}`;
}

function readToken(token) {
  if (!secret() || typeof token !== 'string') return null;
  const [data, sig] = token.split('.');
  if (!data || !sig) return null;
  const a = Buffer.from(sig);
  const b = Buffer.from(sign(data));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
    return p && p.exp > Date.now() ? p : null;
  } catch {
    return null;
  }
}

function cookieOf(req, name) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

function setCookie(res, value, maxAgeSec) {
  const secure = process.env.VERCEL ? '; Secure' : '';
  res.append('Set-Cookie', `${COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure}`);
}
const clearCookie = (res) => setCookie(res, '', 0);

/** ผู้ใช้จาก office-server -> รูปแบบที่ใช้ในแอป (pages เป็น map ของ key -> 'edit' | 'view') */
function toAppUser(u) {
  const pages = {};
  for (const p of u.pages || []) if (PAGE_KEYS.has(p.key)) pages[p.key] = p.edit ? 'edit' : 'view';
  return { username: u.username, name: u.name || '', isAdmin: Boolean(u.isAdmin), pages };
}

function issue(res, user, exp) {
  const payload = { u: user.username, n: user.name, a: user.isAdmin ? 1 : 0, p: user.pages, exp, chk: Date.now() };
  setCookie(res, makeToken(payload), Math.max(0, Math.floor((exp - Date.now()) / 1000)));
}

const fromPayload = (p) => ({ username: p.u, name: p.n || '', isAdmin: Boolean(p.a), pages: p.p || {} });

/**
 * ผู้ใช้ของคำขอนี้ (ต่ออายุสิทธิ์จาก office-server ถ้าเก่ากว่า 10 นาที หรือ force)
 * @returns {Promise<object|null>} null = ไม่ได้ล็อกอิน / token หมดอายุ / บัญชีถูกปิด
 */
async function currentUser(req, res, { force = false } = {}) {
  const payload = readToken(cookieOf(req, COOKIE));
  if (!payload) return null;
  if (!force && Date.now() - (payload.chk || 0) < REFRESH_MS) return fromPayload(payload);
  let fresh;
  try {
    fresh = (await callOffice('storefctGetUser', { username: payload.u }))?.user;
  } catch (err) {
    // ออฟฟิศติดต่อไม่ได้ชั่วคราว — ใช้สิทธิ์เดิมใน token ไปก่อน ดีกว่าเด้งทุกคนออกพร้อมกัน
    console.warn('auth: ต่ออายุสิทธิ์ไม่สำเร็จ ใช้สิทธิ์เดิมใน token —', err.message);
    return fromPayload(payload);
  }
  if (!fresh) {
    clearCookie(res);
    return null;
  }
  const user = toAppUser(fresh);
  issue(res, user, payload.exp);
  return user;
}

const PUBLIC = new Set(['/api/auth/login', '/api/auth/logout', '/api/auth/me']);

/** ตัวกันทุก /api/* — ติด req.user ไว้ให้ route ใช้ (ชื่อผู้บันทึก ฯลฯ) */
export async function authMiddleware(req, res, next) {
  const path = req.path;
  if (!path.startsWith('/api/') || PUBLIC.has(path)) return next();
  try {
    const user = await currentUser(req, res);
    req.user = user;
    if (!user) {
      if (!authRequired()) return next();
      return res.status(401).json({ status: 'error', code: 'AUTH', message: 'กรุณาเข้าสู่ระบบ' });
    }
    if (path.startsWith('/api/auth/')) return next(); // route ของ auth ตรวจกันเอง
    const rule = ruleOf(req.method, path, req.body);
    if (!allowed(user, rule)) {
      const edit = rule && rule !== 'any' && rule !== 'admin' && rule.edit;
      return res.status(403).json({
        status: 'error',
        code: 'FORBIDDEN',
        message: edit ? 'บัญชีนี้ดูได้อย่างเดียว บันทึกหรือแก้ไขไม่ได้' : 'บัญชีนี้ไม่มีสิทธิ์ใช้ข้อมูลส่วนนี้',
      });
    }
    return next();
  } catch (err) {
    return next(err);
  }
}

const fail = (res, err, status = 400) => res.status(status).json({ status: 'error', message: err.message || String(err) });

/** ชื่อที่ใช้เป็น "ผู้บันทึก" ของคำขอ — ว่าง = ไม่ได้ล็อกอิน */
export const actorName = (req) => req.user?.name || req.user?.username || '';

/** route ของ auth ทั้งหมด */
export function registerAuthRoutes(app) {
  app.post('/api/auth/login', async (req, res) => {
    if (!secret()) return fail(res, new Error('ยังไม่ได้ตั้ง AUTH_SECRET บน Vercel — ตั้งแล้ว redeploy ก่อนล็อกอิน'), 500);
    const { username, password } = req.body || {};
    try {
      const data = await callOffice('storefctLogin', { username, password }, { retries: 0 });
      const user = toAppUser(data.user);
      issue(res, user, Date.now() + LOGIN_DAYS * 24 * 3600 * 1000);
      return res.json({ status: 'success', user, firstPassword: Boolean(data.firstPassword) });
    } catch (err) {
      return fail(res, err);
    }
  });

  app.post('/api/auth/logout', (req, res) => {
    clearCookie(res);
    res.json({ status: 'success' });
  });

  // หน้าเว็บเรียกตอนเปิดทุกครั้ง — ดึงสิทธิ์ล่าสุดเสมอ (แอดมินแก้สิทธิ์แล้วรีเฟรชหน้า = เห็นผลทันที)
  app.get('/api/auth/me', async (req, res) => {
    try {
      const user = await currentUser(req, res, { force: true });
      res.json({ status: 'success', user, required: authRequired(), configured: Boolean(secret()) });
    } catch (err) {
      fail(res, err, 500);
    }
  });

  app.post('/api/auth/password', async (req, res) => {
    if (!req.user) return res.status(401).json({ status: 'error', code: 'AUTH', message: 'กรุณาเข้าสู่ระบบ' });
    const { oldPassword, newPassword } = req.body || {};
    try {
      const data = await callOffice('storefctChangePassword',
        { username: req.user.username, oldPassword, newPassword }, { retries: 0 });
      res.json({ status: 'success', message: data?.message || 'เปลี่ยนรหัสผ่านแล้ว' });
    } catch (err) {
      fail(res, err);
    }
  });

  const adminOnly = (req, res) => {
    if (req.user?.isAdmin) return true;
    res.status(403).json({ status: 'error', code: 'FORBIDDEN', message: 'เฉพาะแอดมินเท่านั้น' });
    return false;
  };

  app.get('/api/auth/users', async (req, res) => {
    if (!adminOnly(req, res)) return;
    try {
      const data = await callOffice('storefctListUsers', {});
      res.json({ status: 'success', users: data.users || [] });
    } catch (err) {
      fail(res, err, 500);
    }
  });

  app.post('/api/auth/users', async (req, res) => {
    if (!adminOnly(req, res)) return;
    const b = req.body || {};
    if (b.username === req.user.username && (b.isActive === false || b.isAdmin === false)) {
      return fail(res, new Error('ปิดบัญชีหรือถอดสิทธิ์แอดมินของตัวเองไม่ได้ — ให้แอดมินคนอื่นทำแทน'));
    }
    const pages = Object.entries(b.pages || {})
      .filter(([k, v]) => PAGE_KEYS.has(k) && (v === 'view' || v === 'edit'))
      .map(([key, v]) => ({ key, edit: v === 'edit' }));
    try {
      const data = await callOffice('storefctSaveUser', {
        username: b.username,
        name: b.name,
        isAdmin: Boolean(b.isAdmin),
        isActive: b.isActive !== false,
        isNew: Boolean(b.isNew),
        password: b.password || undefined,
        pages,
      }, { retries: 0 });
      res.json({ status: 'success', user: data.user });
    } catch (err) {
      fail(res, err);
    }
  });
}
