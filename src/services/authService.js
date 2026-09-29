// ล็อกอิน/ผู้ใช้ — ฝั่งหน้าเว็บ (ฝั่ง server ดู lib/auth.js)
//
// token อยู่ในคุกกี้ HttpOnly ที่ server ตั้งให้ หน้าเว็บจึงไม่ต้องแนบอะไรเอง — fetch ไป /api/* ส่งคุกกี้ให้อัตโนมัติ

async function call(url, options = {}) {
  let res;
  try {
    res = await fetch(url, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      credentials: 'same-origin',
    });
  } catch {
    throw new Error('ต่อเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจสอบการเชื่อมต่อแล้วลองใหม่');
  }
  const json = await res.json().catch(() => null);
  if (!res.ok || json?.status !== 'success') {
    throw new Error(json?.message || `เกิดข้อผิดพลาด (HTTP ${res.status})`);
  }
  return json;
}

const post = (url, body) => call(url, { method: 'POST', body: JSON.stringify(body || {}) });

export const fetchMe = () => call('/api/auth/me');
export const loginRequest = (username, password) => post('/api/auth/login', { username, password });
export const logoutRequest = () => post('/api/auth/logout');
export const changePassword = (oldPassword, newPassword) => post('/api/auth/password', { oldPassword, newPassword });
export const fetchUsers = () => call('/api/auth/users').then((r) => r.users || []);
export const saveUser = (user) => post('/api/auth/users', user).then((r) => r.user);

/**
 * ดักคำตอบ 401 ของทุก /api/* — token หมดอายุหรือบัญชีถูกปิดกลางคัน ให้ AuthContext พาไปหน้าล็อกอิน
 * ดักที่ window.fetch ที่เดียว แทนการไล่แก้ service ทุกตัวที่เรียก fetch เอง
 */
export function installAuthInterceptor() {
  if (window.__authInterceptor) return;
  window.__authInterceptor = true;
  const original = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const res = await original(input, init);
    const url = typeof input === 'string' ? input : input?.url || '';
    if (res.status === 401 && /\/api\//.test(url) && !/\/api\/auth\//.test(url)) {
      window.dispatchEvent(new CustomEvent('auth:expired'));
    }
    return res;
  };
}
