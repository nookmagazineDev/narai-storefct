import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import {
  ClipboardList, Plus, Loader2, Save, X, RefreshCw, CalendarClock,
  Users, Factory, Trash2, CheckCircle2, Pencil,
} from 'lucide-react';
import {
  kitchenCall, todayYmd, shiftYmd, formatThaiDate, formatQty,
  ORDER_STATUS_STYLE, ORDER_SOURCE_LABEL, WEEKDAY_LABEL,
} from '../../services/kitchenService';
import ItemPicker from '../../components/kitchen/ItemPicker';

const STATUSES = ['รอผลิต', 'กำลังผลิต', 'ผลิตเสร็จ', 'ยกเลิก'];

/**
 * รายการสั่งผลิต
 *
 * คำสั่งผลิตเกิดได้สามทาง ซึ่งเก็บไว้ในคอลัมน์ source เพื่อให้ตอบได้เสมอว่า "ใครสั่ง":
 *   กรอกเอง   — ครัวกลางเลือกสินค้าและใส่จำนวนในหน้านี้
 *   ยอดสาขา  — รวมยอดที่สาขาเบิกของวันส่งหนึ่ง เฉพาะสินค้าที่มีสูตร
 *   ตามแผน    — สร้างจากแผนประจำรอบ (รายวัน/รายสัปดาห์) ที่ตั้งไว้
 */
export default function ProductionOrders() {
  const [dateFrom, setDateFrom] = useState(() => shiftYmd(todayYmd(), -7));
  const [dateTo, setDateTo] = useState(() => shiftYmd(todayYmd(), 7));
  const [statusFilter, setStatusFilter] = useState('');
  const [orders, setOrders] = useState([]);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [orderDraft, setOrderDraft] = useState(null);
  const [runDraft, setRunDraft] = useState(null);
  const [demand, setDemand] = useState(null);
  const [plansOpen, setPlansOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await kitchenCall('getProductionOrders', {
        dateFrom, dateTo, status: statusFilter || undefined,
      });
      setOrders(res.orders || []);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo, statusFilter]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    kitchenCall('getKitchenItems')
      .then((res) => setItems(res.items || []))
      .catch((err) => toast.error(err.message));
  }, []);

  const changeStatus = async (order, status) => {
    try {
      const res = await kitchenCall('updateProductionOrderStatus', { orderId: order.order_id, status });
      toast.success(res.message);
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const saveOrder = async () => {
    if (!orderDraft.productKey) { toast.error('เลือกสินค้าที่จะผลิตก่อน'); return; }
    if (Number(orderDraft.orderQty) <= 0) { toast.error('ใส่จำนวนที่จะผลิต'); return; }
    setBusy(true);
    try {
      const res = await kitchenCall('saveProductionOrder', {
        orderId: orderDraft.orderId || undefined,
        produceDate: orderDraft.produceDate,
        productKey: orderDraft.productKey,
        productCode: orderDraft.productCode,
        productName: orderDraft.productName,
        orderQty: Number(orderDraft.orderQty),
        unit: orderDraft.unit,
        note: orderDraft.note,
      });
      toast.success(res.message);
      setOrderDraft(null);
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const saveRun = async () => {
    if (Number(runDraft.qtyProduced) <= 0) { toast.error('ใส่จำนวนที่ผลิตได้'); return; }
    setBusy(true);
    try {
      const res = await kitchenCall('saveProductionRun', {
        orderId: runDraft.orderId,
        produceDate: runDraft.produceDate,
        qtyProduced: Number(runDraft.qtyProduced),
        qtyWaste: Number(runDraft.qtyWaste || 0),
        note: runDraft.note,
      });
      toast.success(res.message);
      setRunDraft(null);
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const openDemand = async (delDate) => {
    setBusy(true);
    try {
      const res = await kitchenCall('getBranchDemand', { delDate });
      if ((res.demand || []).length === 0) {
        toast('ไม่มียอดสาขาที่ตรงกับสูตรของครัวกลางในวันนั้น', { icon: 'ℹ️' });
        setBusy(false);
        return;
      }
      setDemand({
        delDate,
        produceDate: delDate,
        rows: res.demand.map((d) => ({ ...d, order_qty: String(d.requested_qty) })),
      });
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const createFromDemand = async () => {
    setBusy(true);
    try {
      const res = await kitchenCall('createOrdersFromDemand', {
        produceDate: demand.produceDate,
        items: demand.rows.map((r) => ({
          productKey: r.product_key,
          productCode: r.product_code,
          productName: r.product_name,
          orderQty: Number(r.order_qty),
          unit: r.unit,
        })),
      });
      toast.success(res.message);
      setDemand(null);
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const createFromPlan = async () => {
    const produceDate = window.prompt('สร้างคำสั่งผลิตตามแผน สำหรับวันที่ (YYYY-MM-DD)', todayYmd());
    if (!produceDate) return;
    setBusy(true);
    try {
      const res = await kitchenCall('createOrdersFromPlan', { produceDate });
      toast.success(res.message);
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-4 md:p-6 space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2">
            <ClipboardList className="w-5 h-5 text-amber-400" />
            รายการสั่งผลิต
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            สั่งผลิตได้สามทาง: กรอกเอง · รวมยอดที่สาขาเบิก · ตามแผนประจำรอบ
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setPlansOpen(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700"
          >
            <CalendarClock className="w-3.5 h-3.5" /> แผนประจำรอบ
          </button>
          <button
            onClick={createFromPlan}
            disabled={busy}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs bg-sky-500/15 text-sky-300 hover:bg-sky-500/25 border border-sky-500/30 disabled:opacity-50"
          >
            <CalendarClock className="w-3.5 h-3.5" /> สร้างจากแผน
          </button>
          <button
            onClick={() => openDemand(todayYmd())}
            disabled={busy}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25 border border-emerald-500/30 disabled:opacity-50"
          >
            <Users className="w-3.5 h-3.5" /> สร้างจากยอดสาขา
          </button>
          <button
            onClick={() => setOrderDraft({
              orderId: null, produceDate: todayYmd(), productKey: '', productCode: '',
              productName: '', orderQty: '', unit: '', note: '',
            })}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold bg-amber-500 text-slate-950 hover:bg-amber-400"
          >
            <Plus className="w-3.5 h-3.5" /> สั่งผลิตใหม่
          </button>
        </div>
      </header>

      <div className="flex flex-wrap items-end gap-3 bg-slate-900/60 border border-slate-800 rounded-xl p-4">
        <div>
          <label className="block text-[11px] text-slate-500 mb-1">ตั้งแต่วันที่</label>
          <input
            type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
            className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-slate-100 focus:outline-none focus:border-amber-500/60"
          />
        </div>
        <div>
          <label className="block text-[11px] text-slate-500 mb-1">ถึงวันที่</label>
          <input
            type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
            className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-slate-100 focus:outline-none focus:border-amber-500/60"
          />
        </div>
        <div>
          <label className="block text-[11px] text-slate-500 mb-1">สถานะ</label>
          <select
            value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-slate-100 focus:outline-none focus:border-amber-500/60"
          >
            <option value="">ทั้งหมด</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
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
          <Loader2 className="w-5 h-5 animate-spin text-amber-400" /> กำลังโหลดคำสั่งผลิต...
        </div>
      ) : orders.length === 0 ? (
        <div className="py-20 text-center text-slate-500 text-sm">ไม่มีคำสั่งผลิตในช่วงวันที่นี้</div>
      ) : (
        <div className="bg-slate-900/60 border border-slate-800 rounded-xl overflow-x-auto">
          <table className="w-full text-sm min-w-[900px]">
            <thead className="bg-slate-900 text-slate-400 text-xs">
              <tr>
                <th className="text-left px-4 py-3 font-medium">เลขที่ / วันที่ผลิต</th>
                <th className="text-left px-4 py-3 font-medium">สินค้า</th>
                <th className="text-right px-4 py-3 font-medium">สั่งผลิต</th>
                <th className="text-right px-4 py-3 font-medium">ผลิตแล้ว</th>
                <th className="text-center px-4 py-3 font-medium">ที่มา</th>
                <th className="text-center px-4 py-3 font-medium">สถานะ</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => {
                const done = Number(o.produced_qty) >= Number(o.order_qty);
                return (
                  <tr key={o.order_id} className="border-t border-slate-800/70 hover:bg-slate-800/30">
                    <td className="px-4 py-3">
                      <div className="text-slate-300 font-mono text-xs">{o.doc_no}</div>
                      <div className="text-[11px] text-slate-500">{formatThaiDate(o.produce_date)}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-slate-200">{o.product_name}</div>
                      <div className="text-[11px] text-slate-500 flex items-center gap-1.5">
                        {o.product_code}
                        {!o.has_recipe && (
                          <span className="text-amber-400/80" title="สินค้านี้ยังไม่มีสูตร จะคำนวณวัตถุดิบให้ไม่ได้">
                            · ไม่มีสูตร
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right text-slate-300">
                      {formatQty(o.order_qty)} <span className="text-slate-500 text-xs">{o.unit || ''}</span>
                    </td>
                    <td className={`px-4 py-3 text-right ${done ? 'text-emerald-300' : 'text-slate-400'}`}>
                      {formatQty(o.produced_qty)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="text-[11px] px-2 py-0.5 rounded bg-slate-700/40 text-slate-300 border border-slate-600/40">
                        {ORDER_SOURCE_LABEL[o.source] || o.source}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <select
                        value={o.status}
                        onChange={(e) => changeStatus(o, e.target.value)}
                        className={`text-[11px] px-2 py-1 rounded border bg-transparent focus:outline-none ${ORDER_STATUS_STYLE[o.status] || 'text-slate-300 border-slate-600'}`}
                      >
                        {STATUSES.map((s) => (
                          <option key={s} value={s} className="bg-slate-900 text-slate-200">{s}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => setOrderDraft({
                            orderId: o.order_id,
                            produceDate: String(o.produce_date).slice(0, 10) || todayYmd(),
                            productKey: o.product_key, productCode: o.product_code,
                            productName: o.product_name, orderQty: String(o.order_qty),
                            unit: o.unit || '', note: o.note || '',
                          })}
                          disabled={o.status === 'ยกเลิก'}
                          className="p-1.5 rounded text-slate-400 hover:text-amber-300 hover:bg-slate-800 disabled:opacity-40"
                          title="แก้คำสั่งผลิต"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => setRunDraft({
                            orderId: o.order_id, docNo: o.doc_no, productName: o.product_name,
                            produceDate: String(o.produce_date).slice(0, 10) || todayYmd(),
                            qtyProduced: '', qtyWaste: '', note: '',
                          })}
                          disabled={o.status === 'ยกเลิก'}
                          className="flex items-center gap-1 px-2.5 py-1.5 rounded text-[11px] bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25 border border-emerald-500/30 disabled:opacity-40"
                        >
                          <Factory className="w-3 h-3" /> บันทึกผลิต
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {orderDraft && (
        <Modal title={orderDraft.orderId ? 'แก้คำสั่งผลิต' : 'สั่งผลิตใหม่'} onClose={() => setOrderDraft(null)}>
          <div className="space-y-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">วันที่ต้องผลิต</label>
              <input
                type="date" value={orderDraft.produceDate}
                onChange={(e) => setOrderDraft({ ...orderDraft, produceDate: e.target.value })}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-amber-500/60"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">สินค้าที่จะผลิต</label>
              {orderDraft.productKey ? (
                <div className="flex items-center justify-between bg-slate-800/60 border border-slate-700 rounded-lg px-3 py-2">
                  <div>
                    <div className="text-sm text-slate-200">{orderDraft.productName}</div>
                    <div className="text-[11px] text-slate-500">{orderDraft.productCode}</div>
                  </div>
                  <button
                    onClick={() => setOrderDraft({ ...orderDraft, productKey: '', productCode: '', productName: '' })}
                    className="text-[11px] text-slate-400 hover:text-slate-200"
                  >
                    เปลี่ยน
                  </button>
                </div>
              ) : (
                <ItemPicker
                  items={items}
                  onSelect={(it) => setOrderDraft({
                    ...orderDraft,
                    productKey: it.item_key, productCode: it.item_code,
                    productName: it.item_name, unit: orderDraft.unit || it.unit || '',
                  })}
                />
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1.5">จำนวนที่สั่งผลิต</label>
                <input
                  type="number" step="0.001" min="0" value={orderDraft.orderQty}
                  onChange={(e) => setOrderDraft({ ...orderDraft, orderQty: e.target.value })}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-amber-500/60"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1.5">หน่วย</label>
                <input
                  type="text" value={orderDraft.unit}
                  onChange={(e) => setOrderDraft({ ...orderDraft, unit: e.target.value })}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-amber-500/60"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">หมายเหตุ</label>
              <input
                type="text" value={orderDraft.note}
                onChange={(e) => setOrderDraft({ ...orderDraft, note: e.target.value })}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-amber-500/60"
              />
            </div>
          </div>
          <ModalActions onCancel={() => setOrderDraft(null)} onSave={saveOrder} busy={busy} label="บันทึกคำสั่งผลิต" />
        </Modal>
      )}

      {runDraft && (
        <Modal title={`บันทึกการผลิต · ${runDraft.docNo}`} onClose={() => setRunDraft(null)}>
          <p className="text-xs text-slate-500 mb-4">{runDraft.productName}</p>
          <div className="space-y-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">วันที่ผลิต</label>
              <input
                type="date" value={runDraft.produceDate}
                onChange={(e) => setRunDraft({ ...runDraft, produceDate: e.target.value })}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-emerald-500/60"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1.5">ผลิตได้จริง</label>
                <input
                  type="number" step="0.001" min="0" value={runDraft.qtyProduced}
                  onChange={(e) => setRunDraft({ ...runDraft, qtyProduced: e.target.value })}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-emerald-500/60"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1.5">ของเสีย</label>
                <input
                  type="number" step="0.001" min="0" value={runDraft.qtyWaste}
                  onChange={(e) => setRunDraft({ ...runDraft, qtyWaste: e.target.value })}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-emerald-500/60"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">หมายเหตุ</label>
              <input
                type="text" value={runDraft.note}
                onChange={(e) => setRunDraft({ ...runDraft, note: e.target.value })}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-emerald-500/60"
              />
            </div>
            <p className="text-[11px] text-slate-500">
              บันทึกได้หลายครั้งต่อใบ ระบบจะรวมยอดให้เอง และเลื่อนสถานะเป็น "ผลิตเสร็จ" เมื่อครบตามสั่ง
            </p>
          </div>
          <ModalActions onCancel={() => setRunDraft(null)} onSave={saveRun} busy={busy} label="บันทึกการผลิต" tone="emerald" />
        </Modal>
      )}

      {demand && (
        <Modal title="สร้างคำสั่งผลิตจากยอดที่สาขาเบิก" onClose={() => setDemand(null)} wide>
          <div className="flex flex-wrap items-end gap-3 mb-4">
            <div>
              <label className="block text-[11px] text-slate-500 mb-1">ยอดเบิกของวันส่ง</label>
              <input
                type="date" value={demand.delDate}
                onChange={(e) => openDemand(e.target.value)}
                className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-slate-100 focus:outline-none focus:border-emerald-500/60"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-500 mb-1">ให้ผลิตวันที่</label>
              <input
                type="date" value={demand.produceDate}
                onChange={(e) => setDemand({ ...demand, produceDate: e.target.value })}
                className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-slate-100 focus:outline-none focus:border-emerald-500/60"
              />
            </div>
          </div>
          <p className="text-[11px] text-slate-500 mb-3">
            แสดงเฉพาะสินค้าที่ครัวกลางมีสูตรผลิต · แก้จำนวนก่อนกดสร้างได้ · กดซ้ำวันเดิมจะปรับจำนวนของใบเดิม ไม่สร้างใบซ้ำ
          </p>
          <div className="max-h-80 overflow-y-auto border border-slate-800 rounded-lg">
            <table className="w-full text-sm">
              <thead className="bg-slate-900 text-slate-400 text-xs sticky top-0">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">สินค้า</th>
                  <th className="text-right px-3 py-2 font-medium">สาขาขอ</th>
                  <th className="text-center px-3 py-2 font-medium">กี่สาขา</th>
                  <th className="text-right px-3 py-2 font-medium">สั่งผลิต</th>
                </tr>
              </thead>
              <tbody>
                {demand.rows.map((r, idx) => (
                  <tr key={r.product_key} className="border-t border-slate-800/70">
                    <td className="px-3 py-2">
                      <div className="text-slate-200">{r.product_name}</div>
                      <div className="text-[11px] text-slate-500">{r.product_code}</div>
                    </td>
                    <td className="px-3 py-2 text-right text-slate-400">{formatQty(r.requested_qty)}</td>
                    <td className="px-3 py-2 text-center text-slate-500">{r.branch_count}</td>
                    <td className="px-3 py-2 text-right">
                      <input
                        type="number" step="0.001" min="0" value={r.order_qty}
                        onChange={(e) => {
                          const next = [...demand.rows];
                          next[idx] = { ...next[idx], order_qty: e.target.value };
                          setDemand({ ...demand, rows: next });
                        }}
                        className="w-24 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm text-right text-slate-100 focus:outline-none focus:border-emerald-500/60"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ModalActions onCancel={() => setDemand(null)} onSave={createFromDemand} busy={busy} label="สร้างคำสั่งผลิต" tone="emerald" />
        </Modal>
      )}

      {plansOpen && <PlanManager items={items} onClose={() => setPlansOpen(false)} />}
    </div>
  );
}

/* --------------------------------- ส่วนประกอบย่อย --------------------------------- */

function Modal({ title, onClose, children, wide }) {
  return (
    <div className="fixed inset-0 z-40 bg-black/70 flex items-start justify-center overflow-y-auto p-4">
      <div className={`bg-slate-900 border border-slate-700 rounded-2xl w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} my-8 shadow-2xl`}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
          <h2 className="font-semibold text-slate-100">{title}</h2>
          <button onClick={onClose} className="p-1 text-slate-500 hover:text-slate-300">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

function ModalActions({ onCancel, onSave, busy, label, tone = 'amber' }) {
  const toneClass = tone === 'emerald'
    ? 'bg-emerald-500 hover:bg-emerald-400'
    : 'bg-amber-500 hover:bg-amber-400';
  return (
    <div className="flex items-center justify-end gap-2 mt-5 pt-4 border-t border-slate-800">
      <button onClick={onCancel} className="px-4 py-2 rounded-lg text-xs text-slate-300 hover:bg-slate-800">
        ยกเลิก
      </button>
      <button
        onClick={onSave}
        disabled={busy}
        className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold text-slate-950 disabled:opacity-50 ${toneClass}`}
      >
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
        {label}
      </button>
    </div>
  );
}

/** ตั้งแผนผลิตประจำรอบ — อยู่ในหน้านี้เพราะมันคือ "ที่มาของคำสั่งผลิต" ไม่ใช่เมนูของตัวเอง */
function PlanManager({ items, onClose }) {
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await kitchenCall('getProductionPlans', { includeInactive: true });
      setPlans(res.plans || []);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!draft.productKey) { toast.error('เลือกสินค้าก่อน'); return; }
    if (Number(draft.plannedQty) <= 0) { toast.error('ใส่จำนวนที่วางแผนผลิต'); return; }
    setBusy(true);
    try {
      const res = await kitchenCall('saveProductionPlan', {
        productKey: draft.productKey,
        productCode: draft.productCode,
        productName: draft.productName,
        cycle: draft.cycle,
        weekday: draft.cycle === 'weekly' ? Number(draft.weekday) : undefined,
        plannedQty: Number(draft.plannedQty),
        unit: draft.unit,
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

  const remove = async (plan) => {
    if (!window.confirm(`ลบแผนผลิต "${plan.product_name}" ใช่ไหม?`)) return;
    try {
      const res = await kitchenCall('deleteProductionPlan', { planId: plan.plan_id });
      toast.success(res.message);
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <Modal title="แผนผลิตประจำรอบ" onClose={onClose} wide>
      <p className="text-[11px] text-slate-500 mb-4">
        ตั้งไว้ว่ารอบไหนต้องผลิตอะไรเท่าไหร่ แล้วกดปุ่ม "สร้างจากแผน" ในหน้ารายการเพื่อออกคำสั่งผลิตของวันนั้น
      </p>

      {loading ? (
        <div className="flex items-center justify-center py-10 text-slate-500 gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> กำลังโหลด...
        </div>
      ) : (
        <div className="border border-slate-800 rounded-lg overflow-hidden mb-4">
          {plans.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-slate-500">ยังไม่มีแผนผลิต</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-900 text-slate-400 text-xs">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">สินค้า</th>
                  <th className="text-left px-3 py-2 font-medium">รอบ</th>
                  <th className="text-right px-3 py-2 font-medium">จำนวน</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {plans.map((p) => (
                  <tr key={p.plan_id} className="border-t border-slate-800/70">
                    <td className="px-3 py-2">
                      <div className="text-slate-200">{p.product_name}</div>
                      <div className="text-[11px] text-slate-500">{p.product_code}</div>
                    </td>
                    <td className="px-3 py-2 text-slate-400 text-xs">
                      {p.cycle === 'daily' ? 'ทุกวัน' : `ทุกวัน${WEEKDAY_LABEL[p.weekday] || '?'}`}
                    </td>
                    <td className="px-3 py-2 text-right text-slate-300">
                      {formatQty(p.planned_qty)} <span className="text-slate-500 text-xs">{p.unit || ''}</span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button onClick={() => remove(p)} className="p-1.5 text-slate-500 hover:text-rose-300">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {draft ? (
        <div className="space-y-3 bg-slate-800/40 border border-slate-800 rounded-lg p-4">
          {draft.productKey ? (
            <div className="flex items-center justify-between">
              <div className="text-sm text-slate-200">{draft.productName}</div>
              <button
                onClick={() => setDraft({ ...draft, productKey: '', productCode: '', productName: '' })}
                className="text-[11px] text-slate-400 hover:text-slate-200"
              >
                เปลี่ยน
              </button>
            </div>
          ) : (
            <ItemPicker
              items={items}
              onSelect={(it) => setDraft({
                ...draft,
                productKey: it.item_key, productCode: it.item_code,
                productName: it.item_name, unit: draft.unit || it.unit || '',
              })}
            />
          )}
          <div className="grid grid-cols-3 gap-2">
            <select
              value={draft.cycle}
              onChange={(e) => setDraft({ ...draft, cycle: e.target.value })}
              className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-2 text-sm text-slate-100 focus:outline-none focus:border-sky-500/60"
            >
              <option value="weekly">รายสัปดาห์</option>
              <option value="daily">ทุกวัน</option>
            </select>
            <select
              value={draft.weekday}
              disabled={draft.cycle === 'daily'}
              onChange={(e) => setDraft({ ...draft, weekday: e.target.value })}
              className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-2 text-sm text-slate-100 focus:outline-none focus:border-sky-500/60 disabled:opacity-40"
            >
              {WEEKDAY_LABEL.map((label, idx) => (
                <option key={label} value={idx}>{label}</option>
              ))}
            </select>
            <input
              type="number" step="0.001" min="0" placeholder="จำนวน"
              value={draft.plannedQty}
              onChange={(e) => setDraft({ ...draft, plannedQty: e.target.value })}
              className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-2 text-sm text-right text-slate-100 placeholder-slate-600 focus:outline-none focus:border-sky-500/60"
            />
          </div>
          <div className="flex items-center justify-end gap-2">
            <button onClick={() => setDraft(null)} className="px-3 py-1.5 rounded text-xs text-slate-400 hover:bg-slate-800">
              ยกเลิก
            </button>
            <button
              onClick={save}
              disabled={busy}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold bg-sky-500 text-slate-950 hover:bg-sky-400 disabled:opacity-50"
            >
              {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
              บันทึกแผน
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setDraft({
            productKey: '', productCode: '', productName: '',
            cycle: 'weekly', weekday: 1, plannedQty: '', unit: '',
          })}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs bg-sky-500/15 text-sky-300 hover:bg-sky-500/25 border border-sky-500/30"
        >
          <Plus className="w-3.5 h-3.5" /> เพิ่มแผนผลิต
        </button>
      )}
    </Modal>
  );
}
