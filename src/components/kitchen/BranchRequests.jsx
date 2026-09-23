import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Store, Loader2, RefreshCw, ChevronDown, ChevronRight, Plus, Users, AlertTriangle } from 'lucide-react';
import { todayYmd, shiftYmd, formatThaiDate, formatQty } from '../../services/kitchenService';

/**
 * ยอดที่สาขาสั่งเบิกของที่ครัวกลางผลิต (รหัส 10xxxxx / 010xxxx)
 *
 * อ่านจากใบเบิกที่สาขากดส่งในหน้านับสต๊อกของ Narai-branch (myfbdata.orderd) ตรง ๆ
 * ครัวจึงเห็นยอดตั้งแต่สาขากดส่ง ไม่ต้องรอสโตร์ดึงใบไปจัด
 */
export async function fetchBranchRequests(from, to) {
  let res;
  try {
    res = await fetch(`/api/kitchen_branch_requests?from=${from}&to=${to}`);
  } catch {
    throw new Error('ต่อเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจสอบการเชื่อมต่อแล้วลองใหม่');
  }
  const json = await res.json().catch(() => null);
  if (!res.ok || json?.status !== 'success') {
    throw new Error(json?.message || `โหลดยอดเบิกของสาขาไม่ได้ (HTTP ${res.status})`);
  }
  return json;
}

/**
 * @param {object} props
 * @param {Array} props.orders คำสั่งผลิตที่โหลดอยู่ในหน้า ใช้ขึ้นป้าย "สั่งผลิตแล้ว"
 * @param {(item: object, from: string) => void} props.onOrder กดสั่งผลิตรายการเดียว
 * @param {(rows: Array, from: string, to: string) => void} props.onOrderAll กดสร้างคำสั่งผลิตทุกรายการ
 * @param {(count: number|null) => void} [props.onLoaded] แจ้งจำนวนรายการที่โหลดได้ (null = โหลดไม่สำเร็จ)
 */
export default function BranchRequests({ orders, onOrder, onOrderAll, onLoaded }) {
  const [from, setFrom] = useState(() => todayYmd());
  const [to, setTo] = useState(() => shiftYmd(todayYmd(), 1));
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(() => new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetchBranchRequests(from, to);
      setData(res);
      onLoaded?.((res.items || []).length);
    } catch (err) {
      setError(err.message);
      setData(null);
      onLoaded?.(null);
    } finally {
      setLoading(false);
    }
  }, [from, to, onLoaded]);

  useEffect(() => { load(); }, [load]);

  // สินค้าที่มีคำสั่งผลิต (ไม่นับที่ยกเลิก) ในช่วงวันเดียวกันแล้ว
  const orderedKeys = useMemo(() => {
    const s = new Set();
    for (const o of orders || []) {
      const d = String(o.produce_date).slice(0, 10);
      if (o.status !== 'ยกเลิก' && d >= from && d <= to) s.add(o.product_key);
    }
    return s;
  }, [orders, from, to]);

  const toggle = (key) => setOpen((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const items = data?.items || [];

  return (
    <section className="bg-slate-900/60 border border-slate-800 rounded-xl">
      <div className="flex flex-wrap items-end justify-between gap-3 px-4 py-3 border-b border-slate-800">
        <div>
          <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
            <Store className="w-4 h-4 text-emerald-400" />
            รายการที่สาขาสั่งเบิก
          </h2>
          <p className="text-[11px] text-slate-500 mt-0.5">
            จากใบเบิกที่สาขากดส่งในหน้านับสต๊อก · เฉพาะรหัส 7 หลักที่ขึ้นต้นด้วย 10 หรือ 010 · ตามวันส่งของ
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="block text-[11px] text-slate-500 mb-1">วันส่งตั้งแต่</label>
            <input
              type="date" value={from} onChange={(e) => setFrom(e.target.value)}
              className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-slate-100 focus:outline-none focus:border-emerald-500/60"
            />
          </div>
          <div>
            <label className="block text-[11px] text-slate-500 mb-1">ถึง</label>
            <input
              type="date" value={to} onChange={(e) => setTo(e.target.value)}
              className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-slate-100 focus:outline-none focus:border-emerald-500/60"
            />
          </div>
          <button
            onClick={load}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700"
          >
            <RefreshCw className="w-3.5 h-3.5" /> รีเฟรช
          </button>
          <button
            onClick={() => onOrderAll(items, from, to)}
            disabled={items.length === 0}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25 border border-emerald-500/30 disabled:opacity-40"
          >
            <Users className="w-3.5 h-3.5" /> สร้างคำสั่งผลิตทั้งหมด
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-10 text-slate-500 gap-2 text-sm">
          <Loader2 className="w-4 h-4 animate-spin text-emerald-400" /> กำลังโหลดใบเบิกของสาขา...
        </div>
      ) : error ? (
        <div className="py-8 px-4 text-center text-sm text-rose-300">{error}</div>
      ) : items.length === 0 ? (
        <div className="py-8 text-center text-sm text-slate-500">ไม่มีสาขาสั่งเบิกของครัวกลางในช่วงวันส่งนี้</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead className="text-slate-400 text-xs">
              <tr>
                <th className="text-left px-4 py-2 font-medium">สินค้า</th>
                <th className="text-right px-4 py-2 font-medium">รวมที่สาขาขอ</th>
                <th className="text-center px-4 py-2 font-medium">กี่สาขา</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => {
                const key = `${it.itemKey}|${it.unit}`;
                const expanded = open.has(key);
                return (
                  <React.Fragment key={key}>
                    <tr className="border-t border-slate-800/70 hover:bg-slate-800/30">
                      <td className="px-4 py-2.5">
                        <button onClick={() => toggle(key)} className="flex items-start gap-1.5 text-left">
                          {expanded
                            ? <ChevronDown className="w-3.5 h-3.5 mt-0.5 text-slate-500 shrink-0" />
                            : <ChevronRight className="w-3.5 h-3.5 mt-0.5 text-slate-500 shrink-0" />}
                          <span>
                            <span className="block text-slate-200">{it.itemName || '-'}</span>
                            <span className="block text-[11px] text-slate-500">{it.itemCode}</span>
                          </span>
                        </button>
                      </td>
                      <td className="px-4 py-2.5 text-right text-slate-100 font-medium whitespace-nowrap">
                        {formatQty(it.totalQty)} <span className="text-slate-500 font-normal">{it.unit}</span>
                      </td>
                      <td className="px-4 py-2.5 text-center text-slate-400">{it.branchCount}</td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap">
                        {orderedKeys.has(it.itemKey) && (
                          <span className="mr-2 text-[10px] px-1.5 py-0.5 rounded border bg-amber-500/10 text-amber-300 border-amber-500/30">
                            สั่งผลิตแล้ว
                          </span>
                        )}
                        <button
                          onClick={() => onOrder(it, from)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-[11px] bg-amber-500/15 text-amber-300 hover:bg-amber-500/25 border border-amber-500/30"
                        >
                          <Plus className="w-3 h-3" /> สั่งผลิต
                        </button>
                      </td>
                    </tr>
                    {expanded && it.lines.map((l, i) => (
                      <tr key={`${key}-${l.outletId}-${l.no}-${i}`} className="bg-slate-950/40 text-xs">
                        <td className="pl-10 pr-4 py-1.5 text-slate-400">
                          {l.branchCode}
                          {l.branchName && l.branchName !== l.branchCode ? <span className="text-slate-600"> · {l.branchName}</span> : null}
                          <span className="text-slate-600"> · ใบ {l.no}</span>
                        </td>
                        <td className="px-4 py-1.5 text-right text-slate-300">{formatQty(l.qty)} {it.unit}</td>
                        <td className="px-4 py-1.5 text-center text-slate-500" colSpan={2}>
                          ส่ง {formatThaiDate(l.deldate)}
                        </td>
                      </tr>
                    ))}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {data && (data.cancelledDocCount > 0 || !data.cancelledChecked) && (
        <div className="flex items-center gap-1.5 px-4 py-2 border-t border-slate-800 text-[11px] text-slate-500">
          {!data.cancelledChecked
            ? <><AlertTriangle className="w-3 h-3 text-amber-400" /> ตรวจรายการใบเบิกที่ยกเลิกไม่ได้ ยอดนี้อาจรวมใบที่ยกเลิกไปแล้ว</>
            : <>ไม่นับ {data.cancelledDocCount} ใบที่ถูกยกเลิกแล้ว</>}
        </div>
      )}
    </section>
  );
}
