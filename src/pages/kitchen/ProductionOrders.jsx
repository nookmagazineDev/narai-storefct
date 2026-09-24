import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  ClipboardList, Plus, Loader2, Save, X, RefreshCw, CalendarClock,
  Users, Factory, Trash2, CheckCircle2, Pencil, Store,
} from 'lucide-react';
import {
  kitchenCall, createManualOrder, todayYmd, shiftYmd, formatThaiDate, formatQty, formatStamp,
  ORDER_STATUS_STYLE, ORDER_SOURCE_LABEL, WEEKDAY_LABEL,
} from '../../services/kitchenService';
import ItemPicker from '../../components/kitchen/ItemPicker';
import BranchRequests, { fetchBranchRequests } from '../../components/kitchen/BranchRequests';
import RecipeRunForm from '../../components/kitchen/RecipeRunForm';
import { fetchQcrdMenus, fetchQcrdRecipe } from '../../services/qcrdService';

const STATUSES = ['รอผลิต', 'กำลังผลิต', 'ผลิตเสร็จ', 'ยกเลิก'];
const ACTIVE_STATUSES = new Set(['รอผลิต', 'กำลังผลิต']);
// dropdown สถานะในตารางไม่มี "ผลิตเสร็จ" — ปิดงานผ่านปุ่ม "ผลิตเสร็จ" ซึ่งบังคับกรอกยอดที่ได้ก่อน
// (เปลี่ยนเป็นผลิตเสร็จโดยไม่มียอด คอลัมน์ "ผลิตแล้ว" จะค้างเป็น 0)
const EDITABLE_STATUSES = ['รอผลิต', 'กำลังผลิต', 'ยกเลิก'];

// ตัวกรองสถานะในแท็บ "สถานะการผลิต" — ค่าเริ่มต้นคืองานที่ยังไม่จบ (รอผลิต + กำลังผลิต)
const STATUS_TABS = [
  { key: 'active', label: 'ยังไม่เสร็จ', match: (o) => ACTIVE_STATUSES.has(o.status) },
  ...STATUSES.map((s) => ({ key: s, label: s, match: (o) => o.status === s })),
  { key: 'all', label: 'ทั้งหมด', match: () => true },
];

const TABS = [
  { key: 'requests', label: 'รายการที่สาขาเบิก', Icon: Store },
  { key: 'production', label: 'สถานะการผลิต', Icon: Factory },
];

/**
 * รายการสั่งผลิต
 *
 * คำสั่งผลิตเกิดได้สามทาง ซึ่งเก็บไว้ในคอลัมน์ source เพื่อให้ตอบได้เสมอว่า "ใครสั่ง":
 *   กรอกเอง   — ครัวกลางเลือกสินค้าและใส่จำนวนในหน้านี้
 *   ยอดสาขา  — รวมยอดที่สาขาสั่งเบิกในหน้านับสต๊อก (myfbdata.orderd) เฉพาะสินค้าที่ชื่อมี FC
 *   ตามแผน    — สร้างจากแผนประจำรอบ (รายวัน/รายสัปดาห์) ที่ตั้งไว้
 *
 * แบ่งเป็นสองแท็บ: "รายการที่สาขาเบิก" (ของที่ต้องทำ) กับ "สถานะการผลิต" (คำสั่งผลิตที่ออกไปแล้ว)
 * แท็บที่เปิดอยู่เก็บใน ?tab= ของ URL ส่งลิงก์ให้กันแล้วเปิดตรงแท็บเดิมได้
 * ทั้งสองแท็บ render ค้างไว้ (ซ่อนด้วย CSS) สลับไปมาจึงไม่โหลดใหม่และช่วงวันที่เลือกไว้ไม่หาย
 */
export default function ProductionOrders() {
  const [dateFrom, setDateFrom] = useState(() => shiftYmd(todayYmd(), -7));
  const [dateTo, setDateTo] = useState(() => shiftYmd(todayYmd(), 7));
  const [statusFilter, setStatusFilter] = useState('active');
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get('tab') === 'production' ? 'production' : 'requests';
  const setTab = (key) => setSearchParams((prev) => {
    const next = new URLSearchParams(prev);
    next.set('tab', key);
    return next;
  }, { replace: true });
  const [requestCount, setRequestCount] = useState(null);
  const [orders, setOrders] = useState([]);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [orderDraft, setOrderDraft] = useState(null);
  const [runDraft, setRunDraft] = useState(null);
  const [demand, setDemand] = useState(null);
  const [plansOpen, setPlansOpen] = useState(false);
  const [recipeEdit, setRecipeEdit] = useState(null); // { order, menu, lines }
  const [openingOrderId, setOpeningOrderId] = useState(null);
  const [qcrdRecipeKeys, setQcrdRecipeKeys] = useState(() => new Set());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // โหลดทุกสถานะแล้วกรองในเบราว์เซอร์ ตัวกรองสถานะจะได้โชว์จำนวนของแต่ละสถานะได้
      const res = await kitchenCall('getProductionOrders', { dateFrom, dateTo });
      // วันผลิตล่าสุดขึ้นก่อน ในวันเดียวกันใบที่เพิ่งกดสั่งขึ้นก่อน (สินค้าเดิมสั่งซ้ำได้หลายใบต่อวัน)
      // created_at เป็นข้อความรูปแบบเดียวกันทุกแถว เทียบเป็นข้อความได้เลย
      const rows = [...(res.orders || [])].sort((a, b) =>
        String(b.produce_date).slice(0, 10).localeCompare(String(a.produce_date).slice(0, 10))
        || String(b.created_at || '').localeCompare(String(a.created_at || '')));
      setOrders(rows);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo]);

  const statusCounts = useMemo(
    () => Object.fromEntries(STATUS_TABS.map((t) => [t.key, orders.filter(t.match).length])),
    [orders]
  );
  const visibleOrders = useMemo(() => {
    const t = STATUS_TABS.find((x) => x.key === statusFilter) || STATUS_TABS[0];
    return orders.filter(t.match);
  }, [orders, statusFilter]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    kitchenCall('getKitchenItems')
      .then((res) => setItems(res.items || []))
      .catch((err) => toast.error(err.message));
  }, []);

  // has_recipe ของ office-server ดูแค่ตาราง kitchen_recipe (สูตรที่กรอกในหน้าสูตรการผลิต)
  // แต่หน้าสั่งผลิตใช้สูตร BOM จาก QC/RD ซึ่งไม่ได้อยู่ในตารางนั้น — นับเมนูที่มีสูตรใน QC/RD ด้วย
  // ไม่งั้นทุกคำสั่งที่ออกจากหน้าสั่งผลิตจะขึ้น "ไม่มีสูตร" ทั้งที่มีสูตร (โหลดไม่ได้ = ใช้ has_recipe อย่างเดียว)
  useEffect(() => {
    fetchQcrdMenus()
      .then((res) => setQcrdRecipeKeys(new Set(
        (res.menus || []).filter((m) => m.lineCount > 0).map((m) => m.key)
      )))
      .catch(() => {});
  }, []);

  // ดินสอ = เปิดสูตร BOM ของสินค้านั้นพร้อมช่องกรอกยอดใช้จริง/ที่ได้ ผูกกับคำสั่งผลิตเดิม
  // สินค้าที่ไม่มีสูตรใน QC/RD ยังเปิดได้ แก้วันที่/จำนวนสั่งและบันทึกจำนวนที่ได้ได้เหมือนเดิม
  const openRecipeEdit = async (o) => {
    setOpeningOrderId(o.order_id);
    let menu = null;
    let lines = [];
    try {
      const res = await fetchQcrdRecipe(o.product_code || o.product_key);
      menu = res.menu;
      lines = res.lines || [];
    } catch (err) {
      if (!/ไม่พบเมนู/.test(err.message)) toast(`โหลดสูตรจาก QC/RD ไม่ได้: ${err.message}`, { icon: '⚠️' });
    }
    setRecipeEdit({
      order: o,
      menu: menu || {
        code: o.product_code, key: o.product_key, name: o.product_name,
        groupName: '', yieldQty: null, yieldUnit: o.unit || '',
      },
      lines,
    });
    setOpeningOrderId(null);
  };

  // เปิดหน้าต่างบันทึกยอดผลิต — finish = มาจากการเลือก "ผลิตเสร็จ" ใน dropdown สถานะ
  const openRun = (o, finish = false) => {
    const remaining = Math.max(Math.round((Number(o.order_qty) - Number(o.produced_qty || 0)) * 1000) / 1000, 0);
    setRunDraft({
      orderId: o.order_id, docNo: o.doc_no, productName: o.product_name,
      produceDate: String(o.produce_date).slice(0, 10) || todayYmd(),
      orderQty: Number(o.order_qty), producedSoFar: Number(o.produced_qty || 0), unit: o.unit || '',
      qtyProduced: finish && remaining > 0 ? String(remaining) : '', qtyWaste: '', note: '',
      finish, runSaved: false,
    });
  };

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
      const payload = {
        produceDate: orderDraft.produceDate,
        productKey: orderDraft.productKey,
        productCode: orderDraft.productCode,
        productName: orderDraft.productName,
        orderQty: Number(orderDraft.orderQty),
        unit: orderDraft.unit,
        note: orderDraft.note,
      };
      if (orderDraft.orderId) {
        const res = await kitchenCall('saveProductionOrder', { ...payload, orderId: orderDraft.orderId });
        toast.success(res.message);
      } else {
        // สินค้าเดิมวันเดิมมีคำสั่งอยู่แล้ว = ถามว่าจะเพิ่มเข้าใบเดิมไหม (ตาราง UNIQUE ต่อวัน)
        const res = await createManualOrder(payload);
        if (!res) return; // ไม่รับการเพิ่มเข้าใบเดิม — ฟอร์มยังเปิดอยู่ให้เปลี่ยนวันที่ได้
        // สั่งผลิตใหม่ทุกครั้งเริ่มที่ "กำลังผลิต" (saveProductionOrder สร้างเป็น "รอผลิต")
        // ขั้นนี้พลาด = คำสั่งออกไปแล้วแต่ค้างเป็นรอผลิต แจ้งให้รู้ แต่ไม่ถือว่าสั่งไม่สำเร็จ
        await kitchenCall('updateProductionOrderStatus', { orderId: res.orderId, status: 'กำลังผลิต' })
          .catch((err) => toast.error(`สร้างคำสั่งแล้ว แต่เปลี่ยนเป็นกำลังผลิตไม่ได้: ${err.message}`));
        toast.success(res.merged ? `เพิ่มเข้าคำสั่งผลิต ${res.docNo} แล้ว` : `สร้างคำสั่งผลิต ${res.docNo} แล้ว`);
      }
      setOrderDraft(null);
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const saveRun = async () => {
    const qty = Number(runDraft.qtyProduced);
    // ปิดงานโดยไม่เพิ่มยอดได้ เฉพาะใบที่เคยบันทึกยอดไปแล้ว — ใบที่ยังเป็น 0 ต้องกรอกยอดก่อน
    const closeOnly = runDraft.finish && !(qty > 0) && runDraft.producedSoFar > 0;
    if (!(qty > 0) && !closeOnly && !runDraft.runSaved) { toast.error('ใส่จำนวนที่ผลิตได้'); return; }
    if (Number(runDraft.qtyWaste || 0) < 0) { toast.error('ของเสียติดลบไม่ได้'); return; }
    setBusy(true);
    try {
      if (qty > 0 && !runDraft.runSaved) {
        await kitchenCall('saveProductionRun', {
          orderId: runDraft.orderId,
          produceDate: runDraft.produceDate,
          qtyProduced: qty,
          qtyWaste: Number(runDraft.qtyWaste || 0),
          note: runDraft.note,
        });
        // จำไว้ก่อนขั้นถัดไป — ถ้าเปลี่ยนสถานะพลาด กดซ้ำจะไม่บันทึกยอดซ้ำ
        setRunDraft((d) => ({ ...d, runSaved: true }));
      }
      // ได้ครบตามสั่ง office-server เลื่อนเป็นผลิตเสร็จให้เองอยู่แล้ว แต่ได้ไม่ครบจะค้างเป็นกำลังผลิต
      // เลือก "ผลิตเสร็จ" มาเอง = ปิดงานเสมอ
      if (runDraft.finish) {
        await kitchenCall('updateProductionOrderStatus', { orderId: runDraft.orderId, status: 'ผลิตเสร็จ' });
      }
      toast.success(runDraft.finish
        ? `ปิดงาน ${runDraft.docNo} เป็นผลิตเสร็จแล้ว`
        : `บันทึกการผลิต ${runDraft.productName} จำนวน ${qty} แล้ว`);
      setRunDraft(null);
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  // ยอดสาขา -> แถวในหน้าต่างสร้างคำสั่งผลิต (รูปแบบเดียวกับที่ createOrdersFromDemand รับ)
  const demandRows = (reqItems) => reqItems.map((it) => ({
    product_key: it.itemKey,
    product_code: it.itemCode,
    product_name: it.itemName,
    requested_qty: it.totalQty,
    branch_count: it.branchCount,
    unit: it.unit,
    order_qty: String(it.totalQty),
  }));

  const showDemand = (reqItems, delDate, delTo = delDate) => {
    if (reqItems.length === 0) {
      toast('ไม่มีสาขาสั่งเบิกของครัวกลางในวันส่งนั้น', { icon: 'ℹ️' });
      return;
    }
    setDemand({ delDate, delTo, produceDate: delDate, rows: demandRows(reqItems) });
  };

  const openDemand = async (delDate) => {
    setBusy(true);
    try {
      const res = await fetchBranchRequests(delDate, delDate);
      showDemand(res.items || [], delDate);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  // สั่งผลิตรายการเดียวจากยอดสาขา — เปิดฟอร์มสั่งผลิตเดิมพร้อมเติมให้ ตรวจแล้วค่อยบันทึก
  const orderFromRequest = (it, from) => {
    const firstDel = it.lines?.[0]?.deldate || from;
    setOrderDraft({
      orderId: null,
      produceDate: firstDel,
      productKey: it.itemKey,
      productCode: it.itemCode,
      productName: it.itemName,
      orderQty: String(it.totalQty),
      unit: it.unit,
      note: `สาขาสั่งเบิก ${it.branchCount} สาขา`,
    });
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
            ดูของที่สาขาสั่งเบิก แล้วติดตามคำสั่งผลิตว่าผลิตไปถึงไหน · สั่งผลิตได้สามทาง: กรอกเอง · รวมยอดที่สาขาเบิก · ตามแผนประจำรอบ
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
        </div>
      </header>

      <div className="flex gap-1 border-b border-slate-800" role="tablist">
        {TABS.map(({ key, label, Icon }) => {
          const count = key === 'requests' ? requestCount : statusCounts.active;
          const selected = tab === key;
          return (
            <button
              key={key}
              role="tab"
              aria-selected={selected}
              onClick={() => setTab(key)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm -mb-px border-b-2 ${
                selected
                  ? 'border-amber-400 text-slate-100 font-semibold'
                  : 'border-transparent text-slate-400 hover:text-slate-200'}`}
            >
              <Icon className={`w-4 h-4 ${selected ? 'text-amber-400' : ''}`} />
              {label}
              {count != null && (
                <span className={`text-[11px] px-1.5 py-0.5 rounded-full ${
                  selected ? 'bg-amber-500/20 text-amber-300' : 'bg-slate-800 text-slate-400'}`}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className={tab === 'requests' ? '' : 'hidden'}>
        <BranchRequests
          orders={orders}
          onOrder={orderFromRequest}
          onOrderAll={(reqItems, from, to) => showDemand(reqItems, from, to)}
          onLoaded={setRequestCount}
        />
      </div>

      <div className={`space-y-5 ${tab === 'production' ? '' : 'hidden'}`}>
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
        <button
          onClick={load}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700"
        >
          <RefreshCw className="w-3.5 h-3.5" /> รีเฟรช
        </button>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {STATUS_TABS.map((t) => {
          const selected = statusFilter === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setStatusFilter(t.key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs border ${
                selected
                  ? (ORDER_STATUS_STYLE[t.key] || 'bg-amber-500/15 text-amber-300 border-amber-500/40')
                  : 'bg-slate-900 text-slate-400 border-slate-700 hover:text-slate-200'}`}
            >
              {t.label}
              <span className="text-[10px] opacity-80">{statusCounts[t.key] ?? 0}</span>
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-slate-500 gap-2">
          <Loader2 className="w-5 h-5 animate-spin text-amber-400" /> กำลังโหลดคำสั่งผลิต...
        </div>
      ) : visibleOrders.length === 0 ? (
        <div className="py-20 text-center text-slate-500 text-sm">
          {orders.length === 0 ? 'ไม่มีคำสั่งผลิตในช่วงวันที่นี้' : 'ไม่มีคำสั่งผลิตในสถานะนี้'}
        </div>
      ) : (
        <div className="bg-slate-900/60 border border-slate-800 rounded-xl overflow-x-auto">
          <table className="w-full text-sm min-w-[900px]">
            <thead className="bg-slate-900 text-slate-400 text-xs">
              <tr>
                <th className="text-left px-4 py-3 font-medium">เลขที่ / วันที่ผลิต / เวลาที่สั่ง</th>
                <th className="text-left px-4 py-3 font-medium">สินค้า</th>
                <th className="text-right px-4 py-3 font-medium">สั่งผลิต</th>
                <th className="text-right px-4 py-3 font-medium">ผลิตแล้ว</th>
                <th className="text-center px-4 py-3 font-medium">ที่มา</th>
                <th className="text-center px-4 py-3 font-medium">สถานะ</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {visibleOrders.map((o) => {
                const done = Number(o.produced_qty) >= Number(o.order_qty);
                return (
                  <tr key={o.order_id} className="border-t border-slate-800/70 hover:bg-slate-800/30">
                    <td className="px-4 py-3">
                      <div className="text-slate-300 font-mono text-xs">{o.doc_no}</div>
                      <div className="text-[11px] text-slate-500">ผลิต {formatThaiDate(o.produce_date)}</div>
                      {/* สินค้าเดิมวันเดิมสั่งได้หลายใบ — เวลาที่กดสั่งคือสิ่งที่แยกใบออกจากกัน */}
                      <div className="text-[11px] text-slate-600">สั่ง {formatStamp(o.created_at)}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-slate-200">{o.product_name}</div>
                      <div className="text-[11px] text-slate-500 flex items-center gap-1.5">
                        {o.product_code}
                        {!o.has_recipe && !qcrdRecipeKeys.has(o.product_key) && (
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
                        {/* ใบที่ผลิตเสร็จแล้วยังต้องแสดงสถานะตัวเองได้ แต่เลือกกลับมาเป็นผลิตเสร็จจาก dropdown ไม่ได้ */}
                        {(o.status === 'ผลิตเสร็จ' ? ['ผลิตเสร็จ', ...EDITABLE_STATUSES] : EDITABLE_STATUSES).map((s) => (
                          <option key={s} value={s} disabled={s === 'ผลิตเสร็จ'} className="bg-slate-900 text-slate-200">{s}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => openRecipeEdit(o)}
                          disabled={o.status === 'ยกเลิก' || openingOrderId !== null}
                          className="p-1.5 rounded text-slate-400 hover:text-amber-300 hover:bg-slate-800 disabled:opacity-40"
                          title="ดูสูตร / กรอกยอดใช้จริงและจำนวนที่ได้"
                        >
                          {openingOrderId === o.order_id
                            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            : <Pencil className="w-3.5 h-3.5" />}
                        </button>
                        <button
                          onClick={() => openRun(o, true)}
                          disabled={o.status === 'ยกเลิก' || o.status === 'ผลิตเสร็จ'}
                          title={o.status === 'ผลิตเสร็จ' ? 'ปิดงานแล้ว' : 'กรอกจำนวนที่ผลิตได้แล้วปิดงาน'}
                          className="flex items-center gap-1 px-2.5 py-1.5 rounded text-[11px] bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25 border border-emerald-500/30 disabled:opacity-40"
                        >
                          <CheckCircle2 className="w-3 h-3" /> ผลิตเสร็จ
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
      </div>

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
        <Modal
          title={runDraft.finish ? `ปิดงานผลิต · ${runDraft.docNo}` : `บันทึกการผลิต · ${runDraft.docNo}`}
          onClose={() => setRunDraft(null)}
        >
          <p className="text-xs text-slate-500 mb-1">{runDraft.productName}</p>
          <p className="text-xs text-slate-400 mb-4">
            สั่ง {formatQty(runDraft.orderQty)} {runDraft.unit} · บันทึกแล้ว {formatQty(runDraft.producedSoFar)} {runDraft.unit}
          </p>
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
                <label className="block text-xs text-slate-400 mb-1.5">
                  ผลิตได้จริง{runDraft.producedSoFar > 0 ? ' (เพิ่มจากที่บันทึกแล้ว)' : ''}
                </label>
                <input
                  type="number" step="0.001" min="0" value={runDraft.qtyProduced} disabled={runDraft.runSaved}
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
            {runDraft.finish ? (
              <p className="text-[11px] text-slate-500">
                ยอดนี้จะเข้าคอลัมน์ "ผลิตแล้ว" แล้วปิดงานเป็น "ผลิตเสร็จ" แม้ได้น้อยกว่าที่สั่ง
                {runDraft.producedSoFar > 0 ? ' · ไม่มียอดเพิ่มให้เว้นว่างแล้วกดปิดงานได้เลย' : ''}
              </p>
            ) : (
              <p className="text-[11px] text-slate-500">
                บันทึกได้หลายครั้งต่อใบ ระบบจะรวมยอดให้เอง และเลื่อนสถานะเป็น "ผลิตเสร็จ" เมื่อครบตามสั่ง
              </p>
            )}
            {runDraft.runSaved && (
              <p className="text-[11px] text-amber-300">บันทึกยอดแล้ว แต่ยังปิดงานไม่สำเร็จ — กดอีกครั้งเพื่อปิดงาน (ไม่บันทึกยอดซ้ำ)</p>
            )}
          </div>
          <ModalActions
            onCancel={() => setRunDraft(null)} onSave={saveRun} busy={busy} tone="emerald"
            label={runDraft.finish ? 'บันทึกและปิดงาน' : 'บันทึกการผลิต'}
          />
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
              {demand.delTo && demand.delTo !== demand.delDate && (
                <div className="text-[11px] text-slate-500 mt-1">รวมถึงวันส่ง {formatThaiDate(demand.delTo)}</div>
              )}
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
            จากใบเบิกที่สาขากดส่งในหน้านับสต๊อก เฉพาะสินค้าที่ชื่อมี FC · แก้จำนวนก่อนกดสร้างได้ · กดซ้ำวันเดิมจะปรับจำนวนของใบเดิม ไม่สร้างใบซ้ำ
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
                  <tr key={`${r.product_key}|${r.unit}`} className="border-t border-slate-800/70">
                    <td className="px-3 py-2">
                      <div className="text-slate-200">{r.product_name}</div>
                      <div className="text-[11px] text-slate-500">{r.product_code}</div>
                    </td>
                    <td className="px-3 py-2 text-right text-slate-400">{formatQty(r.requested_qty)} <span className="text-slate-600">{r.unit}</span></td>
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

      {recipeEdit && (
        <Modal title={`ผลิตตามสูตร · ${recipeEdit.order.doc_no}`} onClose={() => setRecipeEdit(null)} size="xl">
          <RecipeRunForm
            key={recipeEdit.order.order_id}
            menu={recipeEdit.menu}
            lines={recipeEdit.lines}
            stockItems={items}
            order={recipeEdit.order}
            onSaved={() => { setRecipeEdit(null); load(); }}
          />
        </Modal>
      )}

      {plansOpen && <PlanManager items={items} onClose={() => setPlansOpen(false)} />}
    </div>
  );
}

/* --------------------------------- ส่วนประกอบย่อย --------------------------------- */

function Modal({ title, onClose, children, wide, size }) {
  const width = size === 'xl' ? 'max-w-5xl' : wide ? 'max-w-3xl' : 'max-w-lg';
  return (
    <div className="fixed inset-0 z-40 bg-black/70 flex items-start justify-center overflow-y-auto p-4">
      <div className={`bg-slate-900 border border-slate-700 rounded-2xl w-full ${width} my-8 shadow-2xl`}>
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
