// ทะเบียนสาขาฝั่งหน้าเว็บ — ดึงของจริงมาเติมทับตาราง BRANCH_MAP ที่ฝังไว้ในโค้ด
//
// เดิมรายชื่อสาขาของแอปนี้อยู่ใน lib/branches.js อย่างเดียว เปิดสาขาใหม่ทีต้องแก้โค้ด
// แล้ว deploy ตอนนี้ทะเบียนแม่อยู่ที่แดชบอร์ดออฟฟิศ (HR > จัดการสาขา) ที่เดียว
// เหตุผลและแผนเต็มอยู่ใน naraipizzeria/docs/branch-hub.md
//
//   หน้าเว็บ -> /api/branches (server.js) -> naraipizzeria /api/branch-feed
//
// ⚠️ ทำไมเติมทับ object เดิม ไม่ใช่ทำเป็น state ปกติ
//    หกไฟล์ import BRANCH_MAP ไปใช้ตรง ๆ แบบ synchronous (Object.entries(BRANCH_MAP))
//    การเปลี่ยนทั้งหมดเป็น async/context คือการรื้อหน้าจอทั้งแอปโดยไม่ได้อะไรเพิ่ม
//    ตัวที่ทำให้หน้าจอวาดใหม่หลังเติมค่าคือ state ใน useBranchRegistry() ข้างล่าง
//    จึงต้องเรียก hook นั้นที่ layout ซึ่งครอบทุกหน้าอยู่แล้ว
import { useEffect, useState } from 'react';
import { applyHubBranches } from '../../lib/branches';

/** ดึงครั้งเดียวต่อการโหลดหน้า — เปลี่ยนหน้าไปมาไม่ต้องยิงซ้ำ ทะเบียนสาขาแทบไม่เปลี่ยน */
let loaded = null;

function loadOnce() {
  if (!loaded) {
    loaded = fetch('/api/branches')
      .then((r) => r.json())
      .then((res) => {
        if (!res?.success || !Array.isArray(res.data)) throw new Error(res?.error || 'รูปแบบข้อมูลไม่ถูกต้อง');
        return {
          changed: applyHubBranches(res.data, res.aliases),
          source: res.source,
          warning: res.warning || '',
        };
      })
      .catch((err) => {
        // ยิงไม่ถึง = ใช้รายชื่อที่ฝังไว้ในโค้ดต่อ dropdown เลือกสาขาต้องไม่มีวันว่าง
        console.error('ทะเบียนสาขา: โหลดไม่ได้ — ใช้รายชื่อในโค้ดแทน:', err.message);
        return { changed: 0, source: 'fallback', warning: err.message };
      });
  }
  return loaded;
}

/**
 * เรียกที่ layout ครั้งเดียว — เติมทะเบียนแล้วสั่งวาดใหม่ถ้ามีอะไรเปลี่ยนจริง
 * @returns {{ source: string, warning: string }} ไว้ขึ้นหมายเหตุถ้าอยากโชว์
 */
export function useBranchRegistry() {
  const [state, setState] = useState({ source: '', warning: '' });

  useEffect(() => {
    let alive = true;
    loadOnce().then(({ source, warning }) => {
      // setState ทุกครั้งที่โหลดเสร็จ ไม่ใช่เฉพาะตอน changed > 0 — หน้าจอต้องวาดใหม่
      // อย่างน้อยหนึ่งรอบหลังเติมทะเบียน ไม่งั้นหน้าที่ render ไปก่อนแล้วจะค้างใช้ค่าเก่า
      if (alive) setState({ source, warning });
    });
    return () => { alive = false; };
  }, []);

  return state;
}
