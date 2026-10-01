import React, { useEffect } from 'react';
import { X } from 'lucide-react';

/** ป๊อปอัพของหน้าครัวกลาง — กดพื้นหลังหรือ Esc เพื่อปิด · z ซ้อนป๊อปอัพบนอีกอันได้ (เช่น z-50) */
export default function KitchenModal({ title, onClose, footer, children, z = 'z-40' }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className={`fixed inset-0 ${z} bg-black/70 flex items-start justify-center overflow-y-auto p-4`} onClick={onClose}>
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-2xl my-8 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-slate-800">
          <h2 className="font-semibold text-slate-100 text-sm">{title}</h2>
          <button onClick={onClose} className="p-1 text-slate-500 hover:text-slate-300"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5">{children}</div>
        {footer && <div className="px-5 pb-5">{footer}</div>}
      </div>
    </div>
  );
}
