import React, { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { ClipboardList, Plus, Trash2, Loader2, Check, X } from 'lucide-react';
import { kitchenCall, todayYmd, formatQty, formatThaiDate } from '../../services/kitchenService';
import { requisitionApi } from './PlanRequisition';

/**
 * รายการที่เบิกได้จากปุ่มนี้ — ของที่ไม่ได้มาจากสูตร (เบิกตามแพลนคำนวณให้ไม่ได้) แต่ครัวต้องเบิกประจำ
 * เพิ่ม/ลดรหัสได้ที่นี่ที่เดียว · ชื่อ/หน่วย/ราคาอ่านจากทะเบียนสินค้า (getKitchenItems)
 */
export const EXTRA_ITEM_CODES = ['11000265', '11000187', '11000188'];

const normKey = (v) => String(v ?? '').trim().replace(/\.0+$/, '').replace(/^0+/, '').toLowerCase();
const byDate = (rows) => rows.reduce((m, r) => ((m[r.date] ||= []).push(r), m), {});

/**
 * ปุ่ม "เบิกสินค้าแพลน/เบิกเพิ่มเติม" ของหน้าเบิกวัตถุดิบ — หน้าตาตามป๊อปอัพ "สั่งสินค้าแพลน/สั่งเพิ่มเติม"
 * ของ Narai-branch: ใส่จำนวนของแต่ละรหัส + วันที่รับ → เพิ่มลงตะกร้า (สะสมได้หลายวัน)
 * → ตรวจสอบก่อนส่ง → ส่งใบเบิกไปคลังกลาง แยกใบตามวันที่รับ (POST /api/kitchen_requisition ตัวเดียวกับเบิกตามแพลน)
 * วันที่รับไม่มีค่าเริ่มต้นและล้างทุกครั้งที่เพิ่มลงตะกร้า — ให้เลือกใหม่ทุกครั้ง
 */
export default function ExtraRequisition({ onClose }) {
  const [items, setItems] = useState(null); // Map normKey -> stock_item
  const [qty, setQty] = useState({}); // code -> ยอดที่กรอก
  const [date, setDate] = useState('');
  const [cart, setCart] = useState([]); // { key, code, name, unit, price, qty, date }
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [results, setResults] = useState({}); // date -> { ok, no, message }

  useEffect(() => {
    kitchenCall('getKitchenItems', { includeInactive: true })
      .then((res) => setItems(new Map((res.items || []).map((it) => [normKey(it.item_key), it]))))
      .catch((err) => { setItems(new Map()); toast.error(`โหลดทะเบียนสินค้าไม่ได้: ${err.message}`); });
  }, []);

  const list = useMemo(() => EXTRA_ITEM_CODES.map((code) => {
    const it = items?.get(normKey(code));
    return { code, name: it?.item_name || '', unit: it?.unit || '', price: Number(it?.price) || 0, found: Boolean(it) };
  }), [items]);

  const picked = list.filter((r) => r.found && Number(qty[r.code]) > 0);
  const groups = byDate(cart);
  const dates = Object.keys(groups).sort();
  const pending = dates.filter((d) => !results[d]?.ok);
  const busy = sending;

  const add = () => {
    if (picked.length === 0) { toast.error('ใส่จำนวนอย่างน้อยหนึ่งรายการ'); return; }
    if (!date) { toast.error('เลือกวันที่รับ'); return; }
    if (date < todayYmd()) { toast.error('วันที่รับย้อนหลังไม่ได้'); return; }
    if (results[date]?.ok) { toast.error('วันที่รับนี้ส่งใบเบิกไปแล้ว — เลือกวันอื่น'); return; }
    setCart((prev) => [...prev, ...picked.map((r) => ({
      key: `${date}-${r.code}-${Date.now()}-${Math.random()}`, ...r, qty: Number(qty[r.code]), date,
    }))]);
    setQty({});
    setDate(''); // เลือกวันที่ใหม่ทุกครั้ง
  };

  const remove = (key) => setCart((prev) => prev.filter((r) => r.key !== key));

  // ส่งทีละวัน — วันไหนส่งแล้วไม่ส่งซ้ำ พลาดวันไหนกดส่งซ้ำได้เฉพาะวันที่เหลือ
  const send = async () => {
    setSending(true);
    const next = { ...results };
    for (const d of pending) {
      // รหัสเดียวกันวันเดียวกันรวมเป็นบรรทัดเดียว
      const merged = new Map();
      for (const r of groups[d]) {
        const m = merged.get(r.code) || { itemCode: r.code, itemName: r.name, unit: r.unit, price: r.price, qty: 0 };
        m.qty += r.qty;
        merged.set(r.code, m);
      }
      try {
        const res = await requisitionApi('POST', '', { deldate: d, items: [...merged.values()] });
        next[d] = { ok: true, no: res.orderNo };
      } catch (err) {
        next[d] = { ok: false, message: err.message };
      }
      setResults({ ...next });
    }
    setSending(false);
    const okCount = pending.filter((d) => next[d]?.ok).length;
    if (okCount === pending.length) toast.success(`ส่งใบเบิกแล้ว ${okCount} ใบ`);
    else toast.error(`ส่งได้ ${okCount} จาก ${pending.length} ใบ — ดูข้อความในกลุ่มที่ไม่สำเร็จ`, { duration: 8000 });
  };

  const allSent = dates.length > 0 && pending.length === 0;
  const close = () => { if (!busy) onClose(); };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-start justify-center overflow-y-auto p-4" onClick={close}>
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-2xl my-8 shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 bg-teal-600 text-white flex items-start justify-between gap-3">
          <div>
            <h2 className="font-bold flex items-center gap-2"><ClipboardList className="w-5 h-5" /> เบิกสินค้าแพลน/เบิกเพิ่มเติม</h2>
            <p className="text-[11px] text-teal-100 mt-0.5">ครัวกลาง (FCT) • ส่งใบเบิกไปคลังกลาง แยกใบตามวันที่รับ</p>
          </div>
          <button onClick={close} className="p-1 text-teal-100 hover:text-white"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-5 space-y-4 text-xs">
          {confirming && !allSent && (
            <div className="bg-amber-500/10 border border-amber-500/40 rounded-xl px-4 py-3 text-amber-200">
              <p className="font-bold text-sm">🔎 ตรวจสอบรายการก่อนส่งจริง</p>
              <p className="mt-0.5">รวม {cart.length} รายการ • {pending.length} ใบเบิก (แยกตามวันที่รับ) — กด "ย้อนกลับแก้ไข" ถ้าต้องการปรับ หรือ "ยืนยันส่งจริง"</p>
            </div>
          )}

          {!confirming && (
            <div className="bg-teal-500/5 border border-teal-500/25 rounded-xl p-3 space-y-2">
              <p className="text-[11px] text-slate-400">ใส่จำนวนที่ต้องการเบิก (ไม่ใส่ = ไม่เบิก)</p>
              {items === null ? (
                <div className="flex items-center gap-2 py-4 justify-center text-slate-500"><Loader2 className="w-3.5 h-3.5 animate-spin" /> กำลังโหลดรายการ...</div>
              ) : list.map((r) => (
                <div key={r.code} className={`grid grid-cols-[5.5rem_1fr_auto_6rem] items-center gap-2.5 px-3 py-2 rounded-lg bg-slate-950/60 border ${
                  Number(qty[r.code]) > 0 ? 'border-teal-500/50' : 'border-slate-800'}`}>
                  <span className="font-mono font-semibold text-teal-300">{r.code}</span>
                  <span className={r.found ? 'text-slate-200' : 'text-rose-300'}>{r.found ? r.name : 'ไม่พบรหัสนี้ในทะเบียนสินค้า'}</span>
                  <span className="text-slate-500">{r.unit}</span>
                  <input type="number" inputMode="decimal" min="0" step="any" placeholder="0" disabled={!r.found}
                    value={qty[r.code] ?? ''} onChange={(e) => setQty((p) => ({ ...p, [r.code]: e.target.value }))}
                    className="bg-slate-950 border border-slate-700 rounded-md px-2 py-1.5 text-right font-mono text-sm text-slate-100 focus:outline-none focus:border-teal-500/60 disabled:opacity-40" />
                </div>
              ))}
              <div className="flex flex-wrap items-end gap-2.5 pt-1">
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">วันที่รับ</label>
                  <input type="date" value={date} min={todayYmd()} onChange={(e) => setDate(e.target.value)}
                    className="bg-slate-950 border border-slate-700 rounded-md px-2.5 py-1.5 text-sm text-slate-100 focus:outline-none focus:border-teal-500/60" />
                </div>
                <button onClick={add} disabled={picked.length === 0 || !date}
                  className="flex-1 min-w-40 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-teal-600 text-white font-semibold hover:bg-teal-500 disabled:opacity-40">
                  <Plus className="w-4 h-4" /> เพิ่มลงตะกร้า{picked.length > 0 && ` (${picked.length} รายการ)`}
                </button>
              </div>
            </div>
          )}

          <div>
            <p className="font-semibold text-slate-300 mb-2">
              รายการในตะกร้า ({cart.length}){dates.length > 1 && ` • ${dates.length} วันที่รับ → จะแยกเป็น ${dates.length} ใบเบิก`}
            </p>
            {cart.length === 0 ? (
              <div className="py-8 text-center text-slate-500 bg-slate-950/40 border border-slate-800 rounded-xl">
                ยังไม่มีรายการ — ใส่จำนวนและวันที่รับด้านบน แล้วกด "เพิ่มลงตะกร้า"
              </div>
            ) : (
              <div className="space-y-2">
                {dates.map((d) => {
                  const res = results[d];
                  return (
                    <div key={d} className="border border-slate-800 rounded-xl overflow-hidden">
                      <div className="px-3 py-1.5 bg-teal-500/10 border-b border-teal-500/20 font-semibold text-teal-300 flex items-center justify-between">
                        <span>รับวันที่ {formatThaiDate(d)} • {groups[d].length} รายการ</span>
                        {res && (res.ok
                          ? <span className="text-emerald-300">✓ ส่งแล้ว เลขที่ {res.no}</span>
                          : <span className="text-rose-300">✕ ส่งไม่สำเร็จ</span>)}
                      </div>
                      <table className="w-full">
                        <tbody className="divide-y divide-slate-800">
                          {groups[d].map((r) => (
                            <tr key={r.key}>
                              <td className="px-3 py-1.5 font-mono text-slate-500 w-24">{r.code}</td>
                              <td className="px-3 py-1.5 text-slate-200">{r.name}</td>
                              <td className="px-3 py-1.5 text-slate-500">{r.unit}</td>
                              <td className="px-3 py-1.5 text-right font-mono font-semibold text-teal-300">{formatQty(r.qty)}</td>
                              {!confirming && !res?.ok && (
                                <td className="px-2 py-1.5 text-right w-8">
                                  <button onClick={() => remove(r.key)} className="text-slate-500 hover:text-rose-300"><Trash2 className="w-3.5 h-3.5" /></button>
                                </td>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {res && !res.ok && (
                        <div className="px-3 py-1.5 bg-rose-500/10 text-rose-300 border-t border-rose-500/20 whitespace-pre-line">{res.message}</div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="px-5 py-3 border-t border-slate-800 flex justify-end gap-2 text-sm">
          {allSent ? (
            <button onClick={onClose} className="px-5 py-2 rounded-xl font-semibold bg-teal-600 text-white hover:bg-teal-500">เสร็จแล้ว</button>
          ) : confirming ? (
            <>
              <button onClick={() => setConfirming(false)} disabled={busy}
                className="px-4 py-2 rounded-xl border border-slate-700 text-slate-300 hover:bg-slate-800 disabled:opacity-50">← ย้อนกลับแก้ไข</button>
              <button data-write onClick={send} disabled={busy || pending.length === 0}
                className="px-5 py-2 rounded-xl font-semibold bg-emerald-500 text-slate-950 hover:bg-emerald-400 disabled:opacity-50 flex items-center gap-2">
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                {busy ? 'กำลังส่ง…' : `ยืนยันส่งจริง (${pending.length} ใบ)`}
              </button>
            </>
          ) : (
            <>
              <button onClick={close} className="px-4 py-2 rounded-xl border border-slate-700 text-slate-300 hover:bg-slate-800">ปิด</button>
              <button onClick={() => setConfirming(true)} disabled={cart.length === 0}
                className="px-5 py-2 rounded-xl font-semibold bg-teal-600 text-white hover:bg-teal-500 disabled:opacity-50 flex items-center gap-2">
                <ClipboardList className="w-4 h-4" /> ตรวจสอบก่อนส่ง ({pending.length} ใบ)
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
