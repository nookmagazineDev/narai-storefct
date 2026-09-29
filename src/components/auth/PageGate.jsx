import React, { createContext, useContext } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Eye, Lock } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { PAGES } from '../../../lib/pages';

const ReadOnlyContext = createContext(false);

/** true = หน้านี้ผู้ใช้ดูได้อย่างเดียว — ใช้ซ่อนปุ่มบันทึกที่ไม่ได้ติด data-write */
export const useReadOnly = () => useContext(ReadOnlyContext);

/** หน้าแรกที่ผู้ใช้เปิดได้ — ใช้เป็นปลายทางของ "/" ที่ไม่มีสิทธิ์ และ path ที่ไม่รู้จัก */
export function firstAllowedPath(canView) {
  return PAGES.find((p) => canView(p.key))?.path || null;
}

/**
 * ครอบแต่ละหน้า: ไม่ได้ล็อกอิน (ตอนบังคับ) -> หน้าล็อกอิน · ไม่มีสิทธิ์ -> แจ้ง · ดูอย่างเดียว -> แถบบอก + ซ่อนปุ่มเขียน
 *
 * ซ่อนปุ่มด้วย CSS: ปุ่มที่บันทึก/ส่ง/ลบ ติด data-write ไว้ แล้ว [data-readonly] ซ่อนให้ทั้งหน้า (index.css)
 * ปุ่มที่หลุดรอดก็กดแล้วได้ 403 "ดูได้อย่างเดียว" จาก server อยู่ดี — ตัวกันจริงอยู่ที่ server
 */
export default function PageGate({ page, adminOnly = false, children }) {
  const auth = useAuth();
  const location = useLocation();
  if (auth.loading) return null;
  if (!auth.user && auth.required) {
    return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  }
  const allowed = adminOnly ? Boolean(auth.user?.isAdmin) : auth.canView(page);
  if (!allowed) {
    const home = firstAllowedPath(auth.canView);
    if (page === 'overview' && home && home !== '/') return <Navigate to={home} replace />;
    return (
      <div className="max-w-md mx-auto mt-24 text-center bg-slate-900/60 border border-slate-800 rounded-2xl p-8">
        <Lock className="w-8 h-8 text-slate-500 mx-auto mb-3" />
        <h2 className="text-slate-200 font-medium">ไม่มีสิทธิ์ใช้หน้านี้</h2>
        <p className="text-xs text-slate-500 mt-1.5">ติดต่อแอดมินเพื่อขอสิทธิ์ · เลือกหน้าอื่นจากเมนูด้านซ้าย</p>
      </div>
    );
  }
  const readOnly = !adminOnly && !auth.canEdit(page);
  return (
    <ReadOnlyContext.Provider value={readOnly}>
      {readOnly && (
        <div className="mb-4 flex items-center gap-2 px-3 py-2 rounded-lg bg-sky-500/10 border border-sky-500/25 text-sky-300 text-xs">
          <Eye className="w-3.5 h-3.5 shrink-0" /> ดูอย่างเดียว — บัญชีนี้บันทึก แก้ไข หรือส่งข้อมูลในหน้านี้ไม่ได้
        </div>
      )}
      <div data-readonly={readOnly ? '' : undefined}>{children}</div>
    </ReadOnlyContext.Provider>
  );
}
