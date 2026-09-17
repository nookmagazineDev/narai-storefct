import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { PackageMinus, Plus, Loader2, Save, Trash2, RefreshCw, Wand2, X } from 'lucide-react';
import {
  kitchenCall, todayYmd, shiftYmd, formatThaiDate, formatQty,
} from '../../services/kitchenService';
import ItemPicker from '../../components/kitchen/ItemPicker';

/**
 * เบิกวัตถุดิบ
 *
 * ครัวกลางเบิกของจากสต๊อกตัวเองไปใช้ผลิต — คนละเรื่องกับใบเบิกที่สาขาขอจากโกดัง
 * ถ้าเลือกคำสั่งผลิตไว้ ปุ่ม "คำนวณตามสูตร" จะเติมรายการและจำนวนให้ตามสัดส่วน
 * (จำนวนสั่งผลิต ÷ yield ของสูตร) แล้วครัวแก้ตัวเลขทับได้ก่อนบันทึก
 */
export default function MaterialIssue() {
  const [dateFrom, setDateFrom] = useState(() => shiftYmd(todayYmd(), -7));
  const [dateTo, setDateTo] = useState(() => todayYmd());
  const [issues, setIssues] = useState([]);
  const [orders, setOrders] = useState([]);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [draft, setDraft] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await kitchenCall('getMaterialIssues', { dateFrom, dateTo });
      setIssues(res.issues || []);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const today = todayYmd();
    Promise.all([
      kitchenCall('getKitchenItems'),
      // คำสั่งผลิตที่ยังทำอยู่ ให้เลือกผูกกับใบเบิก — ไม่ต้องย้อนไกล ใบเก่าเบิกไปแล้ว
      kitchenCall('getProductionOrders', { dateFrom: shiftYmd(today, -14), dateTo: shiftYmd(today, 14) }),
    ])
      .then(([itemRes, orderRes]) => {
        setItems(itemRes.items || []);
        setOrders((orderRes.orders || []).filter((o) => o.status !== 'ยกเลิก'));
      })
      .catch((err) => toast.error(err.message));
  }, []);

  /** ใบเบิกถูกเก็บแบนหนึ่งแถวต่อหนึ่งรายการ — จับกลุ่มกลับเป็นใบเพื่อแสดง */
  const grouped = useMemo(() => {
    const byDoc = new Map();
    for (const row of issues) {
      if (!byDoc.has(row.doc_no)) {
        byDoc.set(row.doc_no, {
          docNo: row.doc_no,
          issueDate: row.issue_date,
          orderDocNo: row.order_doc_no,
          orderProductName: row.order_product_name,
          recorder: row.recorder,
          rows: [],
        });
      }
      byDoc.get(row.doc_no).rows.push(row);
    }
    return [...byDoc.values()];
  }, [issues]);

  const openNew = () => setDraft({
    issueDate: todayYmd(), orderId: '', lines: [],
  });

  const fillFromRecipe = async () => {
    if (!draft.orderId) { toast.error('เลือกคำสั่งผลิตก่อน'); return; }
    setBusy(true);
    try {
      const res = await kitchenCall('getOrderMaterials', { orderId: Number(draft.orderId) });
      if (!res.materials || res.materials.length === 0) {
        toast.error(res.message || 'สินค้านี้ยังไม่มีสูตรการผลิต');
        return;
      }
      setDraft({
        ...draft,
        lines: res.materials.map((m) => ({
          itemKey: m.itemKey, code: m.itemCode, name: m.itemName,
          qty: String(m.requiredQty), unit: m.unit || '',
        })),
      });
      toast.success(`เติมวัตถุดิบตามสูตรแล้ว ${res.materials.length} รายการ`);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    const lines = draft.lines.filter((l) => Number(l.qty) > 0);
    if (lines.length === 0) { toast.error('ใส่วัตถุดิบอย่างน้อยหนึ่งรายการ'); return; }
    setBusy(true);
    try {
      const res = await kitchenCall('saveMaterialIssue', {
        issueDate: draft.issueDate,
        orderId: draft.orderId ? Number(draft.orderId) : undefined,
        items: lines.map((l) => ({
          itemKey: l.itemKey, code: l.code, name: l.name,
          qty: Number(l.qty), unit: l.unit,
        })),
      });
      toast.success(res.message);
      setDraft(null);
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const usedKeys = useMemo(
    () => new Set((draft?.lines || []).map((l) => l.itemKey)),
    [draft]
  );

  return (
    <div className="p-4 md:p-6 space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2">
            <PackageMinus className="w-5 h-5 text-rose-400" />
            เบิกวัตถุดิบ
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            ครัวกลางเบิกของจากสต๊อกตัวเองไปใช้ผลิต · ยอดที่เบิกจะถูกหักออกจากหน้าวัตถุดิบคงเหลือ
          </p>
        </div>
        <button
          onClick={openNew}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold bg-rose-500 text-slate-950 hover:bg-rose-400"
        >
          <Plus className="w-3.5 h-3.5" /> เบิกวัตถุดิบใหม่
        </button>
      </header>

      <div className="flex flex-wrap items-end gap-3 bg-slate-900/60 border border-slate-800 rounded-xl p-4">
        <div>
          <label className="block text-[11px] text-slate-500 mb-1">ตั้งแต่วันที่</label>
          <input
            type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
            className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-slate-100 focus:outline-none focus:border-rose-500/60"
          />
        </div>
        <div>
          <label className="block text-[11px] text-slate-500 mb-1">ถึงวันที่</label>
          <input
            type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
            className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-slate-100 focus:outline-none focus:border-rose-500/60"
          />
        </div>
        <button
          onClick={load}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700"
        >
          <RefreshCw className="w-3.5 h-3.5" /> รีเฟรช
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-slate-500 gap-2">
          <Loader2 className="w-5 h-5 animate-spin text-rose-400" /> กำลังโหลดใบเบิก...
        </div>
      ) : grouped.length === 0 ? (
        <div className="py-20 text-center text-slate-500 text-sm">ไม่มีใบเบิกวัตถุดิบในช่วงวันที่นี้</div>
      ) : (
        <div className="space-y-3">
          {grouped.map((doc) => (
            <div key={doc.docNo} className="bg-slate-900/60 border border-slate-800 rounded-xl overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 bg-slate-900/80 border-b border-slate-800">
                <div className="flex items-center gap-3">
                  <span className="font-mono text-xs text-rose-300">{doc.docNo}</span>
                  <span className="text-xs text-slate-400">{formatThaiDate(doc.issueDate)}</span>
                  {doc.orderDocNo && (
                    <span className="text-[11px] px-2 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30">
                      ผลิต: {doc.orderDocNo} · {doc.orderProductName}
                    </span>
                  )}
                </div>
                <span className="text-[11px] text-slate-500">
                  {doc.rows.length} รายการ · {doc.recorder || '-'}
                </span>
              </div>
              <table className="w-full text-sm">
                <tbody>
                  {doc.rows.map((row) => (
                    <tr key={row.issue_id} className="border-t border-slate-800/50">
                      <td className="px-4 py-2">
                        <span className="text-slate-200">{row.item_name}</span>
                        <span className="text-[11px] text-slate-500 ml-2">{row.item_code}</span>
                      </td>
                      <td className="px-4 py-2 text-right text-slate-300 w-32">
                        {formatQty(row.qty)} <span className="text-slate-500 text-xs">{row.unit || ''}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}

      {draft && (
        <div className="fixed inset-0 z-40 bg-black/70 flex items-start justify-center overflow-y-auto p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-2xl my-8 shadow-2xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
              <h2 className="font-semibold text-slate-100">เบิกวัตถุดิบใหม่</h2>
              <button onClick={() => setDraft(null)} className="p-1 text-slate-500 hover:text-slate-300">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-400 mb-1.5">วันที่เบิก</label>
                  <input
                    type="date" value={draft.issueDate}
                    onChange={(e) => setDraft({ ...draft, issueDate: e.target.value })}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-rose-500/60"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1.5">เบิกเพื่อผลิต (ไม่บังคับ)</label>
                  <select
                    value={draft.orderId}
                    onChange={(e) => setDraft({ ...draft, orderId: e.target.value })}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-rose-500/60"
                  >
                    <option value="">— ไม่ผูกกับคำสั่งผลิต —</option>
                    {orders.map((o) => (
                      <option key={o.order_id} value={o.order_id}>
                        {o.doc_no} · {o.product_name} ({formatQty(o.order_qty)})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {draft.orderId && (
                <button
                  onClick={fillFromRecipe}
                  disabled={busy}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs bg-purple-500/15 text-purple-300 hover:bg-purple-500/25 border border-purple-500/30 disabled:opacity-50"
                >
                  {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
                  คำนวณวัตถุดิบตามสูตร
                </button>
              )}

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs text-slate-400">รายการที่เบิก</label>
                  <span className="text-[11px] text-slate-500">{draft.lines.length} รายการ</span>
                </div>
                <ItemPicker
                  items={items}
                  excludeKeys={usedKeys}
                  placeholder="เพิ่มวัตถุดิบ..."
                  onSelect={(it) => setDraft({
                    ...draft,
                    lines: [...draft.lines, {
                      itemKey: it.item_key, code: it.item_code, name: it.item_name,
                      qty: '', unit: it.unit || '',
                    }],
                  })}
                />

                {draft.lines.length > 0 && (
                  <div className="mt-3 space-y-1.5 max-h-72 overflow-y-auto">
                    {draft.lines.map((l, idx) => (
                      <div key={l.itemKey} className="flex items-center gap-2 bg-slate-800/40 border border-slate-800 rounded-lg px-3 py-2">
                        <div className="flex-1 min-w-0">
                          <div className="text-sm text-slate-200 truncate">{l.name}</div>
                          <div className="text-[11px] text-slate-500">{l.code}</div>
                        </div>
                        <input
                          type="number" step="0.001" min="0" value={l.qty}
                          onChange={(e) => {
                            const next = [...draft.lines];
                            next[idx] = { ...next[idx], qty: e.target.value };
                            setDraft({ ...draft, lines: next });
                          }}
                          placeholder="จำนวน"
                          className="w-24 bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-sm text-right text-slate-100 placeholder-slate-600 focus:outline-none focus:border-rose-500/60"
                        />
                        <span className="w-14 text-[11px] text-slate-500 text-center">{l.unit || '-'}</span>
                        <button
                          onClick={() => setDraft({ ...draft, lines: draft.lines.filter((_, i) => i !== idx) })}
                          className="p-1.5 text-slate-500 hover:text-rose-300"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-slate-800">
              <button onClick={() => setDraft(null)} className="px-4 py-2 rounded-lg text-xs text-slate-300 hover:bg-slate-800">
                ยกเลิก
              </button>
              <button
                onClick={save}
                disabled={busy}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-rose-500 text-slate-950 hover:bg-rose-400 disabled:opacity-50"
              >
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                บันทึกใบเบิก
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
