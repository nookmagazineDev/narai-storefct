// pool MySQL ที่ใช้ร่วมกันทั้งแอป — ต่อไปที่เซิร์ฟเวอร์เดียวกับระบบ POS (inventory.dyndns.tv)
//
// pool ตัวนี้ต่อเข้า myfbdata (ฐานของระบบ POS) ซึ่งแอปนี้อ่านอย่างเดียว — ไม่เคยเขียน
// ข้อมูลที่แอปสร้างเองอยู่บน SQL Server ที่ออฟฟิศ ไม่ได้อยู่ที่นี่ (ดู lib/storeDb.js)
//
// ทำไมต้องตั้งค่า keepalive/idle เอง:
// Vercel จะ "แช่แข็ง" ฟังก์ชันไว้ระหว่างที่ไม่มีคนเรียก แต่ pool ที่ค้างใน memory ยังถือ socket
// เดิมอยู่ พอถูกปลุกอีกที socket นั้นมักถูก router/NAT ฝั่งปลายทางตัดทิ้งไปแล้ว ใช้ครั้งถัดไป
// จะได้ ECONNRESET (อาการคือ "เข้าครั้งแรกพัง กดซ้ำอีกทีติด") จึงต้องปิด connection ที่ว่าง
// ทิ้งเร็วๆ + เปิด TCP keepalive — กติกาเดียวกับ lib/mysql.js ของโปรเจกต์ Narai-branch

import mysql from 'mysql2/promise';

let pool;

export function getPool() {
  if (!pool) {
    const required = ['MYSQL_HOST', 'MYSQL_USER', 'MYSQL_PASSWORD', 'MYSQL_DATABASE'];
    const missing = required.filter(k => !process.env[k]);
    if (missing.length > 0) {
      throw new Error(`Missing required database environment variables: ${missing.join(', ')}. Set them in .env (local) or your hosting provider's environment settings.`);
    }
    pool = mysql.createPool({
      host: process.env.MYSQL_HOST,
      port: Number(process.env.MYSQL_PORT) || 3306,
      user: process.env.MYSQL_USER,
      password: process.env.MYSQL_PASSWORD,
      database: process.env.MYSQL_DATABASE,
      waitForConnections: true,
      connectionLimit: 10,
      connectTimeout: 15000,
      // กัน socket ค้างตายระหว่างที่ฟังก์ชันถูกแช่แข็ง
      enableKeepAlive: true,
      keepAliveInitialDelay: 10000,
      maxIdle: 2,
      idleTimeout: 30000,
    });
  }
  return pool;
}

// error ที่แปลว่า "การเชื่อมต่อเดิมใช้ไม่ได้แล้ว" — ลองใหม่ด้วย connection ใหม่มักผ่าน
const RECOVERABLE = new Set([
  'PROTOCOL_CONNECTION_LOST',
  'ECONNRESET',
  'EPIPE',
  'ETIMEDOUT',
  'ER_CLIENT_INTERACTION_TIMEOUT',
]);

const isRecoverable = (err) =>
  RECOVERABLE.has(err?.code) || /closed state|connection is in closed/i.test(err?.message || '');

/**
 * query สำหรับการ "อ่าน" — ลองใหม่หนึ่งครั้งถ้า connection เก่าตายไปแล้ว
 *
 * ห้ามใช้กับ INSERT/UPDATE เพราะอาจเขียนซ้ำ (คำสั่งอาจถึงเซิร์ฟเวอร์แล้วแต่ตอบกลับไม่ทัน)
 * ฝั่งเขียนใช้ getPool().query() ตรงๆ แล้วปล่อยให้ error เด้งขึ้นไปแทน
 */
export async function queryRead(sql, params) {
  try {
    const [rows] = await getPool().query(sql, params);
    return rows;
  } catch (err) {
    if (!isRecoverable(err)) throw err;
    console.warn('MySQL: connection เก่าใช้ไม่ได้ กำลังลองใหม่ —', err.code || err.message);
    const [rows] = await getPool().query(sql, params);
    return rows;
  }
}
