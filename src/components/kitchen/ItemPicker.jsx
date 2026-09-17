import React, { useMemo, useRef, useState, useEffect } from 'react';
import { Search, X } from 'lucide-react';

/**
 * ช่องเลือกสินค้า/วัตถุดิบแบบพิมพ์ค้น
 *
 * รายการสินค้ามีหลักพัน จึงกรองในเบราว์เซอร์ (โหลดมาครั้งเดียวตอนเปิดหน้า) และตัดผลลัพธ์
 * ที่แสดงไว้ 50 รายการ — เกินกว่านั้นคนไม่ได้ไล่อ่านอยู่แล้ว แต่ DOM หนักขึ้นจริง
 *
 * @param {object} props
 * @param {Array<{item_key: string, item_code: string, item_name: string, unit?: string}>} props.items
 * @param {(item: object) => void} props.onSelect เรียกเมื่อเลือกสินค้าหนึ่งรายการ
 * @param {string} [props.placeholder]
 * @param {Set<string>} [props.excludeKeys] รหัสที่เลือกไปแล้ว จะไม่ขึ้นในผลค้นหาซ้ำ
 */
export default function ItemPicker({ items, onSelect, placeholder = 'พิมพ์ชื่อหรือรหัสสินค้า...', excludeKeys }) {
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);

  // ปิดรายการเมื่อคลิกนอกกล่อง — ไม่งั้นรายการค้างทับเนื้อหาข้างล่างจนกดอะไรไม่ได้
  useEffect(() => {
    const onClickOutside = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const matches = useMemo(() => {
    const q = term.trim().toLowerCase();
    if (!q) return [];
    const out = [];
    for (const it of items || []) {
      if (excludeKeys && excludeKeys.has(it.item_key)) continue;
      const name = String(it.item_name || '').toLowerCase();
      const code = String(it.item_code || '').toLowerCase();
      if (name.includes(q) || code.includes(q)) {
        out.push(it);
        if (out.length >= 50) break;
      }
    }
    return out;
  }, [items, term, excludeKeys]);

  const pick = (item) => {
    onSelect(item);
    setTerm('');
    setOpen(false);
  };

  return (
    <div className="relative" ref={boxRef}>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
        <input
          type="text"
          value={term}
          onChange={(e) => { setTerm(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-9 pr-9 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-amber-500/60"
        />
        {term && (
          <button
            type="button"
            onClick={() => { setTerm(''); setOpen(false); }}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-500 hover:text-slate-300"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {open && term.trim() && (
        <div className="absolute z-20 mt-1 w-full max-h-72 overflow-y-auto bg-slate-900 border border-slate-700 rounded-lg shadow-xl shadow-black/40">
          {matches.length === 0 ? (
            <div className="px-3 py-3 text-xs text-slate-500">ไม่พบสินค้าที่ตรงกับ "{term}"</div>
          ) : (
            matches.map((it) => (
              <button
                key={it.item_key}
                type="button"
                onClick={() => pick(it)}
                className="w-full text-left px-3 py-2 hover:bg-slate-800 border-b border-slate-800/60 last:border-b-0"
              >
                <div className="text-sm text-slate-200">{it.item_name}</div>
                <div className="text-[11px] text-slate-500">
                  {it.item_code}
                  {it.unit ? ` · ${it.unit}` : ''}
                  {it.store_cat ? ` · ${it.store_cat}` : ''}
                </div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
