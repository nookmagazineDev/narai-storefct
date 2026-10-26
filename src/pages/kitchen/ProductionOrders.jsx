import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  Loader2, Save, X, RefreshCw,
  Users, Factory, CheckCircle2, Pencil, Store, History, Search, CalendarClock, Ban, Recycle,
} from 'lucide-react';
import {
  kitchenCall, createManualOrder, keepOrderRecipe, todayYmd, shiftYmd, formatThaiDate, formatQty, formatStamp, formatBaht,
  ORDER_STATUS_STYLE, ORDER_SOURCE_LABEL,
} from '../../services/kitchenService';
import ItemPicker from '../../components/kitchen/ItemPicker';
import BranchRequests, { fetchBranchRequests } from '../../components/kitchen/BranchRequests';
import RecipeRunForm from '../../components/kitchen/RecipeRunForm';
import { RangeQuick, DayQuick } from '../../components/kitchen/DateQuick';
import { fetchQcrdMenus, fetchQcrdRecipe } from '../../services/qcrdService';
import { parseRecipeSnapshot } from '../../services/kitchenUsage';

/**
 * จำนวนสูตรและต้นทุนของคำสั่งผลิตหนึ่งใบ (คอลัมน์ในหน้าสถานะการผลิต)
 *   จำนวนสูตร      = จำนวนสั่ง ÷ ผลผลิตต่อสูตรของ QC/RD (หน่วยต้องตรงกัน · สูตรที่ไม่มีผลผลิต สั่งเป็นหน่วย "สูตร")
 *   ต้นทุนตามสูตร   = จำนวนสูตร × ต้นทุนสูตร 1 ชุดของ QC/RD · ต่อหน่วย = ต้นทุนสูตร ÷ ผลผลิตต่อสูตร
 *   ต้นทุนผลิตจริง  = ใบเบิกวัตถุดิบของคำสั่ง (material_cost จาก office-server) · ต่อหน่วย = ÷ จำนวนที่ผลิตได้
 * เมนู = สูตร ณ วันผลิตที่เก็บไว้กับคำสั่ง (recipe_snapshot) ถ้ามี ไม่งั้นสูตรปัจจุบันของ QC/RD
 * ค่าที่คิดไม่ได้เป็น null (หน้าจอแสดง "-")
 */
function orderCosts(o, menu) {
  const orderQty = Number(o.order_qty);
  const yieldQty = Number(menu?.yieldQty);
  const unit = String(o.unit || '');
  let batches = null;
  let perBatchQty = null;
  if (yieldQty > 0 && (!unit || !menu.yieldUnit || unit === menu.yieldUnit)) {
    batches = orderQty / yieldQty;
    perBatchQty = yieldQty;
  } else if (unit === 'สูตร') {
    batches = orderQty;
    perBatchQty = 1;
  }
  const cost = Number(menu?.cost);
  const hasCost = batches !== null && cost > 0;
  const actual = o.material_cost === null || o.material_cost === undefined ? null : Number(o.material_cost);
  const produced = Number(o.produced_qty);
  return {
    batches,
    recipeTotal: hasCost ? batches * cost : null,
    recipePerUnit: hasCost ? cost / perBatchQty : null,
    actualTotal: Number.isFinite(actual) ? actual : null,
    actualPerUnit: Number.isFinite(actual) && produced > 0 ? actual / produced : null,
  };
}

const STATUSES = ['รอผลิต', 'กำลังผลิต', 'ผลิตเสร็จ', 'ยกเลิก'];
const ACTIVE_STATUSES = new Set(['รอผลิต', 'กำลังผลิต']);
// dropdown สถานะในตารางไม่มี "ผลิตเสร็จ" — ปิดงานผ่านปุ่ม "ผลิตเสร็จ" ซึ่งบังคับกรอกยอดที่ได้ก่อน
// (เปลี่ยนเป็นผลิตเสร็จโดยไม่มียอด คอลัมน์ "ผลิตแล้ว" จะค้างเป็น 0)
const EDITABLE_STATUSES = ['รอผลิต', 'กำลังผลิต', 'ยกเลิก'];
// ตัวเลือกพิเศษใน dropdown สถานะ — ไม่ใช่สถานะ เปิดหน้าต่างเลื่อนวันผลิต
const MOVE_OPTION = '__move';

// ตัวกรองสถานะในหน้า "สถานะการผลิต" — ค่าเริ่มต้นคืองานที่ยังไม่จบ (รอผลิต + กำลังผลิต)
const STATUS_TABS = [
  { key: 'active', label: 'ยังไม่เสร็จ', match: (o) => ACTIVE_STATUSES.has(o.status) },
  ...STATUSES.map((s) => ({ key: s, label: s, match: (o) => o.status === s })),
  { key: 'all', label: 'ทั้งหมด', match: () => true },
];

/**
 * สองเมนูของครัวกลางที่ใช้คอมโพเนนต์นี้ร่วมกัน (modal สั่งผลิต/บันทึกผลิต/ดินสอ ชุดเดียวกัน):
 *   view="requests"   — รายการที่สาขาเบิก (/kitchen/orders): ของที่ต้องทำ สั่งผลิตรายตัวหรือทั้งหมด
 *   view="production" — สถานะการผลิต (/kitchen/status): คำสั่งผลิตที่ออกไปแล้ว กรองตามสถานะ ปิดงาน
 *
 * คำสั่งผลิตเกิดได้สามทาง ซึ่งเก็บไว้ในคอลัมน์ source เพื่อให้ตอบได้เสมอว่า "ใครสั่ง":
 *   กรอกเอง   — หน้าสั่งผลิต หรือปุ่มสั่งผลิตรายตัวในหน้ารายการที่สาขาเบิก
 *   ยอดสาขา  — รวมยอดที่สาขาสั่งเบิกในหน้านับสต๊อก (myfbdata.orderd) เฉพาะสินค้าที่ชื่อขึ้นต้นด้วย FC
 *   ตามแผน    — สร้างจากแผนรายวันในเมนูแพลนผลิต (pages/kitchen/ProductionPlan.jsx)
 *
 * เดิมสองหน้านี้เป็นแท็บในหน้าเดียว (?tab=production) — ลิงก์เก่าถูกพาไปที่ /kitchen/status ให้เอง
 */
export default function ProductionOrders({ view = 'requests' }) {
  const [dateFrom, setDateFrom] = useState(() => shiftYmd(todayYmd(), -7));
  const [dateTo, setDateTo] = useState(() => shiftYmd(todayYmd(), 7));
  const [statusFilter, setStatusFilter] = useState('active');
  const [search, setSearch] = useState('');
  const [searchParams] = useSearchParams();
  const [orders, setOrders] = useState([]);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [orderDraft, setOrderDraft] = useState(null);
  // ช่อง "ผลิตได้จริง" หน้าปุ่มผลิตเสร็จ — order_id -> ยอดที่แก้เอง (ไม่แก้ = ส่วนที่ยังขาดตามสูตร)
  const [quickQty, setQuickQty] = useState({});
  const [finishingId, setFinishingId] = useState(null);
  const [runEdit, setRunEdit] = useState(null); // คำสั่งที่เปิดป๊อปอัพแก้ยอดผลิต + ประวัติ
  const [historyOrder, setHistoryOrder] = useState(null); // คำสั่งที่เปิดดูประวัติทั้งหมด
  const [statusAction, setStatusAction] = useState(null); // { kind: 'move' | 'cancel', order } — หน้าต่างเลื่อนวัน / ยกเลิก
  // ใบที่บันทึกยอดไปแล้วแต่ปิดงานพลาด — กดซ้ำปิดงานอย่างเดียว ไม่บันทึกยอดซ้ำ
  const quickSaved = useRef(new Set());
  const [demand, setDemand] = useState(null);
  const [recipeEdit, setRecipeEdit] = useState(null); // { order, menu, lines, issued }
  const [openingOrderId, setOpeningOrderId] = useState(null);
  const [qcrdMenus, setQcrdMenus] = useState(() => new Map()); // key -> เมนู QC/RD (ผลผลิต/ต้นทุนต่อสูตร)

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // โหลดทุกสถานะแล้วกรองในเบราว์เซอร์ ตัวกรองสถานะจะได้โชว์จำนวนของแต่ละสถานะได้
      const res = await kitchenCall('getProductionOrders', { dateFrom, dateTo });
      // วันผลิตล่าสุดขึ้นก่อน ในวันเดียวกันใบที่เพิ่งกดสั่งขึ้นก่อน (สินค้าเดิมสั่งซ้ำได้หลายใบต่อวัน)
      // created_at เป็นข้อความรูปแบบเดียวกันทุกแถว เทียบเป็นข้อความได้เลย
      // recipe = สูตร ณ วันผลิตที่เก็บไว้กับคำสั่ง (null = ยังไม่ได้เก็บ ใช้สูตรปัจจุบันของ QC/RD)
      const rows = (res.orders || []).map((o) => ({ ...o, recipe: parseRecipeSnapshot(o.recipe_snapshot) })).sort((a, b) =>
        String(b.produce_date).slice(0, 10).localeCompare(String(a.produce_date).slice(0, 10))
        || String(b.created_at || '').localeCompare(String(a.created_at || '')));
      setOrders(rows);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo]);

  // ค้นหาด้วยชื่อสินค้า / รหัส / เลขที่คำสั่ง (หลายคำคั่นช่องว่าง = ต้องมีครบทุกคำ) — ตัวนับของแท็บสถานะนับตามผลค้นหา
  const searchedOrders = useMemo(() => {
    const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length === 0) return orders;
    return orders.filter((o) => {
      const text = `${o.product_name || ''} ${o.product_code || ''} ${o.doc_no || ''}`.toLowerCase();
      return words.every((w) => text.includes(w));
    });
  }, [orders, search]);
  const statusCounts = useMemo(
    () => Object.fromEntries(STATUS_TABS.map((t) => [t.key, searchedOrders.filter(t.match).length])),
    [searchedOrders]
  );
  const visibleOrders = useMemo(() => {
    const t = STATUS_TABS.find((x) => x.key === statusFilter) || STATUS_TABS[0];
    return searchedOrders.filter(t.match);
  }, [searchedOrders, statusFilter]);

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
      .then((res) => setQcrdMenus(new Map((res.menus || []).map((m) => [m.key, m]))))
      .catch(() => {});
  }, []);

  // ของเหลือที่ผูกกับเมนู (หน้าเมนูครัวกลาง) — เมนูที่มี กดผลิตเสร็จแล้วเปิดหน้าต่างให้กรอกของเหลือก่อน
  // office-server รุ่นเก่า / ยังไม่มีตาราง = ไม่มีเมนูไหนมีของเหลือ ปิดงานได้ทันทีเหมือนเดิม
  const [leftoverByMenu, setLeftoverByMenu] = useState(() => new Map());
  useEffect(() => {
    kitchenCall('getLeftoverLinks')
      .then((res) => {
        const m = new Map();
        for (const l of res.links || []) {
          if (!m.has(l.product_key)) m.set(l.product_key, []);
          m.get(l.product_key).push(l);
        }
        setLeftoverByMenu(m);
      })
      .catch(() => {});
  }, []);
  const [finishDraft, setFinishDraft] = useState(null); // { order, produced, waste, leftovers: { item_key: qty } }

  // ดินสอ = เปิดสูตร BOM ของสินค้านั้นพร้อมช่องกรอกยอดใช้จริง/ที่ได้ ผูกกับคำสั่งผลิตเดิม
  // สินค้าที่ไม่มีสูตรใน QC/RD ยังเปิดได้ แก้วันที่/จำนวนสั่งและบันทึกจำนวนที่ได้ได้เหมือนเดิม
  const openRecipeEdit = async (o) => {
    setOpeningOrderId(o.order_id);
    let menu = null;
    let lines = [];
    let issued = [];
    const produceDate = String(o.produce_date).slice(0, 10);
    // ใบเบิกวัตถุดิบเดิมของคำสั่งนี้ — ฟอร์มแสดงยอดที่เบิกแล้วและรวมในต้นทุน
    // getMaterialIssues กรองได้แค่ช่วงวันที่ จึงดึงช่วงกว้างรอบวันผลิตแล้วกรองด้วยเลขคำสั่งเอง
    const issuesReq = Number(o.issue_count) > 0
      ? kitchenCall('getMaterialIssues', {
        dateFrom: shiftYmd(produceDate, -60),
        dateTo: shiftYmd(produceDate > todayYmd() ? produceDate : todayYmd(), 1),
      }).then((res) => (res.issues || []).filter((it) => String(it.order_id) === String(o.order_id)))
        .catch((err) => { toast(`โหลดใบเบิกเดิมไม่ได้ ต้นทุนจะไม่รวมยอดที่เบิกแล้ว: ${err.message}`, { icon: '⚠️' }); return []; })
      : Promise.resolve([]);
    // คำสั่งที่เก็บสูตร ณ วันผลิตไว้แล้ว ใช้สูตรนั้น — แก้สูตรใน QC/RD ทีหลัง ยอดตามสูตรของใบนี้ไม่ขยับ
    if (o.recipe) {
      menu = o.recipe.menu;
      lines = o.recipe.lines;
    } else {
      try {
        const res = await fetchQcrdRecipe(o.product_code || o.product_key);
        menu = res.menu;
        lines = res.lines || [];
      } catch (err) {
        if (!/ไม่พบเมนู/.test(err.message)) toast(`โหลดสูตรจาก QC/RD ไม่ได้: ${err.message}`, { icon: '⚠️' });
      }
    }
    issued = await issuesReq;
    setRecipeEdit({
      order: o,
      menu: menu || {
        code: o.product_code, key: o.product_key, name: o.product_name,
        groupName: '', yieldQty: null, yieldUnit: o.unit || '',
      },
      lines,
      issued,
    });
    setOpeningOrderId(null);
  };

  /** ยอดตั้งต้นของช่องผลิตได้จริง = ควรได้ตามสูตร − ที่บันทึกไปแล้ว */
  const remainingOf = (o) => Math.max(Math.round((Number(o.order_qty) - Number(o.produced_qty || 0)) * 1000) / 1000, 0);
  const quickValue = (o) => (quickQty[o.order_id] !== undefined ? quickQty[o.order_id] : String(remainingOf(o)));

  // ปุ่มผลิตเสร็จในแถว — บันทึกยอดจากช่องข้างปุ่ม แล้วปิดงานทันที ไม่ต้องเปิดหน้าต่าง
  // (ของเสีย/หมายเหตุ/ยอดใช้จริง กรอกที่ดินสอ)
  // extra = มาจากหน้าต่างปิดงาน (ของเหลือ/ของเสีย) · ไม่มี + เมนูนี้ผูกของเหลือ = เปิดหน้าต่างก่อน
  const quickFinish = async (o, extra) => {
    if (!extra && leftoverByMenu.has(o.product_key)) {
      setFinishDraft({ order: o, produced: quickValue(o), waste: '', leftovers: {} });
      return;
    }
    const raw = extra ? extra.produced : quickValue(o);
    const qty = Number(raw);
    const leftovers = (extra?.leftovers || []).filter((l) => Number(l.qty) > 0);
    if (String(raw).trim() === '' || !Number.isFinite(qty) || qty < 0) { toast.error('ใส่จำนวนที่ผลิตได้จริง'); return; }
    const already = quickSaved.current.has(o.order_id);
    if (!(qty > 0) && !already && !(Number(o.produced_qty) > 0)) { toast.error('ใส่จำนวนที่ผลิตได้จริงมากกว่า 0'); return; }
    if (leftovers.length > 0 && !(qty > 0) && !already) { toast.error('บันทึกของเหลือต้องมียอดผลิตได้ของรอบนี้ด้วย'); return; }
    setFinishingId(o.order_id);
    try {
      if (qty > 0 && !already) {
        keepOrderRecipe({ orderId: o.order_id, productCode: o.product_code || o.product_key });
        await kitchenCall('saveProductionRun', {
          orderId: o.order_id,
          produceDate: String(o.produce_date).slice(0, 10) || todayYmd(),
          qtyProduced: qty,
          qtyWaste: Number(extra?.waste || 0),
          leftovers: leftovers.map((l) => ({ itemKey: l.itemKey, qty: Number(l.qty) })),
        });
        quickSaved.current.add(o.order_id);
      }
      await kitchenCall('updateProductionOrderStatus', { orderId: o.order_id, status: 'ผลิตเสร็จ' });
      quickSaved.current.delete(o.order_id);
      setQuickQty(({ [o.order_id]: _, ...rest }) => rest);
      setFinishDraft(null);
      toast.success(`ปิดงาน ${o.doc_no} · ผลิตได้ ${formatQty(qty)} ${o.unit || ''}`.trim()
        + (leftovers.length ? ` · ของเหลือเข้าสต๊อกครัว ${leftovers.length} รายการ` : ''));
      load();
    } catch (err) {
      toast.error(quickSaved.current.has(o.order_id)
        ? `บันทึกยอดแล้ว แต่ปิดงานไม่สำเร็จ: ${err.message} — กดผลิตเสร็จอีกครั้ง (ไม่บันทึกยอดซ้ำ)`
        : err.message);
    } finally {
      setFinishingId(null);
    }
  };

  // dropdown สถานะ: "เลื่อนวันผลิต…" และ "ยกเลิก…" เปิดหน้าต่างก่อน (ยกเลิกต้องใส่เหตุผล) ที่เหลือเปลี่ยนทันที
  const onStatusSelect = (order, value) => {
    if (value === MOVE_OPTION) setStatusAction({ kind: 'move', order });
    else if (value === 'ยกเลิก') setStatusAction({ kind: 'cancel', order });
    else changeStatus(order, value);
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
        keepOrderRecipe({ orderId: res.orderId, productCode: payload.productCode || payload.productKey });
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

  // ลิงก์เก่าตอนสถานะการผลิตยังเป็นแท็บ (/kitchen/orders?tab=production)
  if (view === 'requests' && searchParams.get('tab') === 'production') {
    return <Navigate to="/kitchen/status" replace />;
  }

  return (
    <div className="p-4 md:p-6 space-y-5">
      {view === 'production' ? (
        <header>
          <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2">
            <Factory className="w-5 h-5 text-amber-400" />
            สถานะการผลิต
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            คำสั่งผลิตที่ออกไปแล้วว่าผลิตไปถึงไหน · ดินสอ = ดูสูตร กรอกยอดใช้จริง/จำนวนที่ได้ · ใส่ยอดผลิตได้จริงในช่องแล้วกดผลิตเสร็จ = บันทึกและปิดงาน
            · คำสั่งมาจากหน้าสั่งผลิต รายการที่สาขาเบิก และแพลนผลิต
          </p>
        </header>
      ) : (
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2">
              <Store className="w-5 h-5 text-amber-400" />
              รายการที่สาขาเบิก
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              ของที่สาขาสั่งเบิกจากหน้านับสต๊อก (เฉพาะสินค้าที่ชื่อขึ้นต้นด้วย FC) · สั่งผลิตรายตัว หรือสร้างคำสั่งผลิตทั้งหมดทีเดียว
              · ติดตามคำสั่งที่ออกไปแล้วที่เมนูสถานะการผลิต
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button data-write
              onClick={() => openDemand(todayYmd())}
              disabled={busy}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25 border border-emerald-500/30 disabled:opacity-50"
            >
              <Users className="w-3.5 h-3.5" /> สร้างจากยอดสาขา
            </button>
          </div>
        </header>
      )}

      {view === 'requests' && (
        <BranchRequests
          orders={orders}
          onOrder={orderFromRequest}
          onOrderAll={(reqItems, from, to) => showDemand(reqItems, from, to)}
        />
      )}

      {view === 'production' && (
      <div className="space-y-5">
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
        <RangeQuick from={dateFrom} to={dateTo} onChange={(f, t) => { setDateFrom(f); setDateTo(t); }} />
        <button
          onClick={load}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700"
        >
          <RefreshCw className="w-3.5 h-3.5" /> รีเฟรช
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <div className="relative w-full sm:w-72 sm:mr-2">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ค้นหาสินค้า / รหัส / เลขที่คำสั่ง..."
            className="w-full bg-slate-900 border border-slate-700 rounded-full pl-8 pr-8 py-1.5 text-xs text-slate-100 placeholder-slate-600 focus:outline-none focus:border-amber-500/60"
          />
          {search && (
            <button onClick={() => setSearch('')} title="ล้างคำค้น"
              className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-slate-500 hover:text-slate-200">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
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
          {orders.length === 0 ? 'ไม่มีคำสั่งผลิตในช่วงวันที่นี้'
            : searchedOrders.length === 0 ? `ไม่พบคำสั่งผลิตที่ตรงกับ "${search.trim()}"` : 'ไม่มีคำสั่งผลิตในสถานะนี้'}
        </div>
      ) : (
        <div className="bg-slate-900/60 border border-slate-800 rounded-xl overflow-x-auto">
          <table className="w-full text-sm min-w-[1280px]">
            <thead className="bg-slate-900 text-slate-400 text-xs">
              <tr>
                <th className="text-left px-4 py-3 font-medium">เลขที่ / วันที่ผลิต / เวลาที่สั่ง</th>
                <th className="text-left px-4 py-3 font-medium">สินค้า</th>
                <th className="text-right px-3 py-3 font-medium">จำนวนสูตร</th>
                <th className="text-right px-3 py-3 font-medium">ควรได้ตามสูตร</th>
                <th className="text-right px-3 py-3 font-medium">ผลิตได้</th>
                <th className="text-right px-3 py-3 font-medium">ต้นทุนตามสูตร<div className="font-normal text-slate-500">รวม / ต่อหน่วย</div></th>
                <th className="text-right px-3 py-3 font-medium">ต้นทุนผลิตจริง<div className="font-normal text-slate-500">รวม / ต่อหน่วย</div></th>
                <th className="text-center px-4 py-3 font-medium">ที่มา</th>
                <th className="text-center px-4 py-3 font-medium">สถานะ</th>
                <th className="text-right px-4 py-3 font-medium">ผลิตได้จริง → ปิดงาน</th>
              </tr>
            </thead>
            <tbody>
              {visibleOrders.map((o) => {
                const done = Number(o.produced_qty) >= Number(o.order_qty);
                const c = orderCosts(o, o.recipe?.menu || qcrdMenus.get(o.product_key));
                return (
                  <tr key={o.order_id} className="border-t border-slate-800/70 hover:bg-slate-800/30">
                    <td className="px-4 py-3">
                      <div className="text-slate-300 font-mono text-xs">{o.doc_no}</div>
                      <div className="text-[11px] text-slate-500">ผลิต {formatThaiDate(o.produce_date)}</div>
                      {o.moved_from && (
                        <div className="text-[11px] text-amber-300/90" title={o.moved_at ? `เลื่อนเมื่อ ${formatStamp(o.moved_at)}` : undefined}>
                          เลื่อนจาก {formatThaiDate(o.moved_from)}{o.move_reason ? ` · ${o.move_reason}` : ''}
                        </div>
                      )}
                      {/* สินค้าเดิมวันเดิมสั่งได้หลายใบ — เวลาที่กดสั่งคือสิ่งที่แยกใบออกจากกัน */}
                      <div className="text-[11px] text-slate-600">สั่ง {formatStamp(o.created_at)}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-slate-200">{o.product_name}</div>
                      <div className="text-[11px] text-slate-500 flex items-center gap-1.5">
                        {o.product_code}
                        {!o.has_recipe && !(qcrdMenus.get(o.product_key)?.lineCount > 0) && (
                          <span className="text-amber-400/80" title="สินค้านี้ยังไม่มีสูตร จะคำนวณวัตถุดิบให้ไม่ได้">
                            · ไม่มีสูตร
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-right text-slate-300">
                      {c.batches !== null ? formatQty(c.batches) : <span className="text-slate-600">-</span>}
                    </td>
                    <td className="px-3 py-3 text-right text-slate-300">
                      {formatQty(o.order_qty)} <span className="text-slate-500 text-xs">{o.unit || ''}</span>
                    </td>
                    <td className={`px-3 py-3 text-right ${done ? 'text-emerald-300' : 'text-slate-400'}`}>
                      {Number(o.produced_qty) > 0 ? (
                        // บันทึกยอดไปแล้ว = กดแก้ยอดผลิตได้ / ของเสีย และดูประวัติการแก้
                        <button onClick={() => setRunEdit(o)} title="แก้ยอดผลิตได้ / ของเสีย · ดูประวัติการแก้"
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 -mr-1.5 rounded hover:bg-slate-800 hover:text-amber-200 group">
                          {formatQty(o.produced_qty)} <span className="text-slate-500 text-xs">{o.unit || ''}</span>
                          <Pencil className="w-3 h-3 text-slate-600 group-hover:text-amber-300" />
                        </button>
                      ) : (
                        <>{formatQty(o.produced_qty)} <span className="text-slate-500 text-xs">{o.unit || ''}</span></>
                      )}
                    </td>
                    <td className="px-3 py-3 text-right">
                      {c.recipeTotal !== null ? (
                        <>
                          <div className="text-slate-300">{formatBaht(c.recipeTotal)}</div>
                          <div className="text-[11px] text-slate-500">{formatBaht(c.recipePerUnit)}/{o.unit || 'หน่วย'}</div>
                        </>
                      ) : <span className="text-slate-600" title="เมนูนี้ไม่มีต้นทุนหรือผลผลิตต่อสูตรใน QC/RD">-</span>}
                    </td>
                    <td className="px-3 py-3 text-right">
                      {c.actualTotal !== null ? (
                        <>
                          <div className="text-slate-200">{formatBaht(c.actualTotal)}</div>
                          {c.actualPerUnit !== null ? (
                            <div className={`text-[11px] ${c.recipePerUnit === null ? 'text-slate-400'
                              : c.actualPerUnit > c.recipePerUnit ? 'text-rose-300' : 'text-emerald-300'}`}
                              title={c.recipePerUnit !== null ? 'แดง = แพงกว่าตามสูตร · เขียว = ไม่เกินตามสูตร' : undefined}>
                              {formatBaht(c.actualPerUnit)}/{o.unit || 'หน่วย'}
                            </div>
                          ) : <div className="text-[11px] text-slate-600">ยังไม่มียอดผลิต</div>}
                          {Number(o.no_price_count) > 0 && (
                            <div className="text-[10px] text-amber-400/80" title="บรรทัดใบเบิกที่ไม่มีราคาไม่ถูกนับ ต้นทุนจริงจึงต่ำกว่าที่ควร">
                              ไม่มีราคา {o.no_price_count} บรรทัด
                            </div>
                          )}
                        </>
                      ) : (
                        <span className="text-slate-600" title={o.material_cost === undefined
                          ? 'office-server ยังไม่ส่งต้นทุนมา — รัน update-office-server.bat'
                          : 'ยังไม่มีใบเบิกวัตถุดิบที่มีราคา'}>-</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="text-[11px] px-2 py-0.5 rounded bg-slate-700/40 text-slate-300 border border-slate-600/40">
                        {ORDER_SOURCE_LABEL[o.source] || o.source}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <select
                        value={o.status}
                        onChange={(e) => onStatusSelect(o, e.target.value)}
                        className={`text-[11px] px-2 py-1 rounded border bg-transparent focus:outline-none ${ORDER_STATUS_STYLE[o.status] || 'text-slate-300 border-slate-600'}`}
                      >
                        {/* ใบที่ผลิตเสร็จแล้วยังต้องแสดงสถานะตัวเองได้ แต่เลือกกลับมาเป็นผลิตเสร็จจาก dropdown ไม่ได้ */}
                        {(o.status === 'ผลิตเสร็จ' ? ['ผลิตเสร็จ', ...EDITABLE_STATUSES] : EDITABLE_STATUSES).map((s) => (
                          <option key={s} value={s} disabled={s === 'ผลิตเสร็จ'} className="bg-slate-900 text-slate-200">
                            {s === 'ยกเลิก' && o.status !== 'ยกเลิก' ? 'ยกเลิก…' : s}
                          </option>
                        ))}
                        {ACTIVE_STATUSES.has(o.status) && (
                          <option value={MOVE_OPTION} className="bg-slate-900 text-amber-300">เลื่อนวันผลิต…</option>
                        )}
                      </select>
                      {o.status === 'ยกเลิก' && o.cancel_reason && (
                        <div className="mt-1 text-[10px] text-rose-300/90 max-w-[10rem] mx-auto break-words"
                          title={o.cancelled_at ? `ยกเลิกเมื่อ ${formatStamp(o.cancelled_at)}${o.cancelled_by ? ` · ${o.cancelled_by}` : ''}` : undefined}>
                          เหตุผล: {o.cancel_reason}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        {/* ดูอย่างเดียว — ไม่ติด data-write ผู้ที่ดูหน้าได้อย่างเดียวก็เปิดดูประวัติได้ */}
                        <button onClick={() => setHistoryOrder(o)} title="ประวัติ: เลื่อนวัน / ยกเลิก / เปลี่ยนสถานะ / แก้ยอดผลิต"
                          className="p-1.5 rounded text-slate-400 hover:text-sky-300 hover:bg-slate-800">
                          <History className="w-3.5 h-3.5" />
                        </button>
                        <button data-write
                          onClick={() => openRecipeEdit(o)}
                          disabled={o.status === 'ยกเลิก' || openingOrderId !== null}
                          className="p-1.5 rounded text-slate-400 hover:text-amber-300 hover:bg-slate-800 disabled:opacity-40"
                          title="ดูสูตร / กรอกยอดใช้จริงและจำนวนที่ได้"
                        >
                          {openingOrderId === o.order_id
                            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            : <Pencil className="w-3.5 h-3.5" />}
                        </button>
                        {o.status !== 'ยกเลิก' && o.status !== 'ผลิตเสร็จ' && (
                          <label data-write className="flex items-center gap-1 ml-1" title="ผลิตได้จริง — ตั้งต้นตามสูตร (ส่วนที่ยังขาด) แก้ได้">
                            <input
                              type="number" inputMode="decimal" min="0" step="any"
                              value={quickValue(o)}
                              onChange={(e) => setQuickQty((q) => ({ ...q, [o.order_id]: e.target.value }))}
                              onKeyDown={(e) => { if (e.key === 'Enter') quickFinish(o); }}
                              disabled={finishingId !== null}
                              className="w-20 px-2 py-1 rounded bg-slate-950 border border-slate-700 text-right text-xs text-slate-100 focus:outline-none focus:border-emerald-500/60 disabled:opacity-50"
                            />
                            <span className="text-[10px] text-slate-500 w-6 truncate">{o.unit || ''}</span>
                          </label>
                        )}
                        <button data-write
                          onClick={() => quickFinish(o)}
                          disabled={o.status === 'ยกเลิก' || o.status === 'ผลิตเสร็จ' || finishingId !== null}
                          title={o.status === 'ผลิตเสร็จ' ? 'ปิดงานแล้ว' : 'บันทึกยอดในช่องข้าง ๆ แล้วปิดงานทันที'}
                          className="flex items-center gap-1 px-2.5 py-1.5 rounded text-[11px] bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25 border border-emerald-500/30 disabled:opacity-40"
                        >
                          {finishingId === o.order_id ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />} ผลิตเสร็จ
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
              <DayQuick value={orderDraft.produceDate} onChange={(d) => setOrderDraft({ ...orderDraft, produceDate: d })} className="mt-1.5" />
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

      {finishDraft && (
        <FinishModal draft={finishDraft} items={leftoverByMenu.get(finishDraft.order.product_key) || []}
          busy={finishingId !== null} onChange={setFinishDraft} onClose={() => setFinishDraft(null)}
          onSave={() => quickFinish(finishDraft.order, {
            produced: finishDraft.produced,
            waste: finishDraft.waste,
            leftovers: Object.entries(finishDraft.leftovers).map(([itemKey, qty]) => ({ itemKey, qty })),
          })} />
      )}

      {historyOrder && <OrderHistoryModal order={historyOrder} onClose={() => setHistoryOrder(null)} />}

      {statusAction?.kind === 'move' && (
        <MoveOrderModal order={statusAction.order} onClose={() => setStatusAction(null)}
          onDone={() => { setStatusAction(null); load(); }} />
      )}
      {statusAction?.kind === 'cancel' && (
        <CancelOrderModal order={statusAction.order} onClose={() => setStatusAction(null)}
          onDone={() => { setStatusAction(null); load(); }} />
      )}

      {runEdit && (
        <RunEditModal order={runEdit} onClose={() => setRunEdit(null)} onChanged={load} />
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
              <DayQuick value={demand.delDate} onChange={(d) => openDemand(d)} className="mt-1.5" />
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
              <DayQuick value={demand.produceDate} onChange={(d) => setDemand({ ...demand, produceDate: d })} className="mt-1.5" />
            </div>
          </div>
          <p className="text-[11px] text-slate-500 mb-3">
            จากใบเบิกที่สาขากดส่งในหน้านับสต๊อก เฉพาะสินค้าที่ชื่อขึ้นต้นด้วย FC · แก้จำนวนก่อนกดสร้างได้ · กดซ้ำวันเดิมจะปรับจำนวนของใบเดิม ไม่สร้างใบซ้ำ
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
            issued={recipeEdit.issued}
            onSaved={() => { setRecipeEdit(null); load(); }}
          />
        </Modal>
      )}

    </div>
  );
}

/* --------------------------------- ส่วนประกอบย่อย --------------------------------- */

function Modal({ title, onClose, children, wide, size }) {
  const width = size === 'xl' ? 'max-w-6xl' : wide ? 'max-w-3xl' : 'max-w-lg';
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

/**
 * แก้ยอดผลิตที่บันทึกแล้ว — หนึ่งบรรทัดต่อรอบผลิต (การบันทึกผลิตหนึ่งครั้ง) ดูอย่างเดียว กด "แก้ไข" แล้วบรรทัดนั้นเปิดช่องแก้
 * ประวัติ: "แก้ครั้งที่ N" นับต่อรอบผลิต (ครั้งแรกที่แก้ = 1) · ใบที่มีหลายรอบบอกรอบผลิตต่อท้าย
 * office-server เก็บประวัติทุกครั้ง (updateProductionRun → kitchen_production_run_edit) แสดงด้านล่างใหม่สุดก่อน
 * ใบที่ปิดงานแล้วแก้ยอดได้ สถานะไม่เปลี่ยนกลับเอง
 */
function RunEditModal({ order, onClose, onChanged }) {
  const [data, setData] = useState(null); // { runs, edits, historyReady }
  const [error, setError] = useState('');
  // แก้ทีละรอบ: กด "แก้ไข" ที่บรรทัดไหน บรรทัดนั้นถึงเปิดช่องให้แก้
  const [editing, setEditing] = useState(null); // { runId, produced, waste, reason } | null
  const [savingId, setSavingId] = useState(null);
  const unit = order.unit || '';

  const reload = useCallback(async () => {
    try {
      setData(await kitchenCall('getProductionRunHistory', { orderId: order.order_id }));
      setError('');
    } catch (err) {
      setError(/ไม่รู้จัก/.test(err.message)
        ? 'office-server ที่ออฟฟิศยังเป็นรุ่นเก่า — รัน update-office-server.bat ของ Narai-branch ก่อน'
        : err.message);
    }
  }, [order.order_id]);
  useEffect(() => { reload(); }, [reload]);

  const startEdit = (r) => setEditing({
    runId: r.run_id, produced: String(Number(r.qty_produced)), waste: String(Number(r.qty_waste)), reason: '',
  });
  const changed = (r) => editing && (Number(editing.produced) !== Number(r.qty_produced) || Number(editing.waste || 0) !== Number(r.qty_waste));

  const save = async (r) => {
    const produced = Number(editing.produced);
    const waste = Number(editing.waste || 0);
    if (!(produced > 0)) { toast.error('ยอดผลิตได้ต้องมากกว่า 0'); return; }
    if (!(waste >= 0)) { toast.error('ของเสียติดลบไม่ได้'); return; }
    setSavingId(r.run_id);
    try {
      const res = await kitchenCall('updateProductionRun', {
        runId: r.run_id, qtyProduced: produced, qtyWaste: waste, reason: editing.reason,
      });
      toast.success(res.message);
      setEditing(null);
      await reload();
      onChanged();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSavingId(null);
    }
  };

  const runNo = (runId) => (data?.runs || []).findIndex((r) => r.run_id === runId) + 1;
  // ลำดับการแก้ของแต่ละรอบผลิต (เก่าสุด = แก้ครั้งที่ 1) — ประวัติเรียงใหม่สุดก่อน จึงนับจากท้ายรายการ
  const editSeq = useMemo(() => {
    const seq = new Map();
    const perRun = new Map();
    for (const e of [...(data?.edits || [])].reverse()) {
      const n = (perRun.get(e.run_id) || 0) + 1;
      perRun.set(e.run_id, n);
      seq.set(e.edit_id, n);
    }
    return seq;
  }, [data]);
  const manyRuns = (data?.runs || []).length > 1;
  const editLabel = (e) => {
    const no = runNo(e.run_id);
    if (e.action === 'delete') return `ลบบันทึกการผลิต${no > 0 ? ` รอบที่ ${no}` : ''}`;
    const round = no > 0 ? (manyRuns ? ` · รอบผลิตที่ ${no}` : '') : ' · รอบผลิตที่ลบไปแล้ว';
    return `แก้ครั้งที่ ${editSeq.get(e.edit_id) || 1}${round}`;
  };
  const fieldInput = 'w-full px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-right text-sm text-slate-100 focus:outline-none focus:border-amber-500/60';

  return (
    <Modal wide onClose={onClose} title={(
      <span className="flex items-center gap-2"><History className="w-4 h-4 text-amber-400" /> แก้ยอดผลิต · {order.doc_no}</span>
    )}>
      <p className="text-xs text-slate-400 mb-3">
        {order.product_name} · สั่ง {formatQty(order.order_qty)} {unit} · ผลิตได้รวม {formatQty(order.produced_qty)} {unit} · {order.status}
      </p>
      {error ? (
        <p className="text-xs text-rose-300 py-6 text-center">{error}</p>
      ) : !data ? (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500"><Loader2 className="w-4 h-4 animate-spin" /> กำลังโหลด...</div>
      ) : (
        <div className="space-y-5">
          {!data.historyReady && (
            <p className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">
              ยังไม่มีตารางเก็บประวัติการแก้ — แก้ยอดได้หลังรัน update-office-server.bat ที่เครื่องออฟฟิศ
            </p>
          )}
          {/* หนึ่งบรรทัดต่อรอบผลิต — ดูอย่างเดียวจนกว่าจะกด "แก้ไข" แล้วบรรทัดนั้นเปิดช่องให้แก้ */}
          <ul className="space-y-2">
            {data.runs.map((r, idx) => {
              const isEditing = editing?.runId === r.run_id;
              return (
                <li key={r.run_id} className={`rounded-lg border text-sm ${isEditing ? 'border-amber-500/50 bg-amber-500/5' : 'border-slate-800 bg-slate-950/40'}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
                    <div className="min-w-0">
                      <span className="text-slate-200 font-semibold">รอบที่ {idx + 1}</span>
                      <span className="text-[11px] text-slate-500"> · บันทึก {formatStamp(r.recorded_at)} · {r.recorder || '-'}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-slate-300">
                        ผลิตได้ <strong className="text-slate-100">{formatQty(r.qty_produced)}</strong> {unit}
                        <span className="text-slate-600"> · </span>
                        ของเสีย <strong className={Number(r.qty_waste) > 0 ? 'text-rose-300' : 'text-slate-100'}>{formatQty(r.qty_waste)}</strong>
                      </span>
                      {!isEditing && (
                        <button data-write onClick={() => startEdit(r)} disabled={!data.historyReady || savingId !== null}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] text-amber-300 border border-amber-500/40 hover:bg-amber-500/10 disabled:opacity-30">
                          <Pencil className="w-3 h-3" /> แก้ไข
                        </button>
                      )}
                    </div>
                  </div>
                  {isEditing && (
                    <div className="px-3 pb-3 pt-1 border-t border-amber-500/20 space-y-2">
                      <div className="grid grid-cols-2 gap-2">
                        <label className="text-[11px] text-slate-400">ผลิตได้ ({unit || 'หน่วย'})
                          <input type="number" inputMode="decimal" min="0" step="any" autoFocus className={`${fieldInput} mt-1`}
                            value={editing.produced} onChange={(e) => setEditing({ ...editing, produced: e.target.value })} />
                        </label>
                        <label className="text-[11px] text-slate-400">ของเสีย ({unit || 'หน่วย'})
                          <input type="number" inputMode="decimal" min="0" step="any" className={`${fieldInput} mt-1`}
                            value={editing.waste} onChange={(e) => setEditing({ ...editing, waste: e.target.value })} />
                        </label>
                      </div>
                      <input value={editing.reason} onChange={(e) => setEditing({ ...editing, reason: e.target.value })}
                        placeholder="เหตุผลที่แก้ (ถ้ามี) — เก็บไว้ในประวัติ"
                        className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-amber-500/60" />
                      <div className="flex justify-end gap-2">
                        <button onClick={() => setEditing(null)} disabled={savingId !== null}
                          className="px-3 py-1.5 rounded-lg text-xs text-slate-400 hover:bg-slate-800">ยกเลิก</button>
                        <button data-write onClick={() => save(r)} disabled={!changed(r) || savingId !== null}
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-500 text-slate-950 hover:bg-amber-400 disabled:opacity-30">
                          {savingId === r.run_id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />} บันทึกการแก้ไข
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
            {data.runs.length === 0 && (
              <li className="px-3 py-6 text-center text-xs text-slate-500">ยังไม่มีบันทึกการผลิตของคำสั่งนี้</li>
            )}
          </ul>

          <div>
            <h3 className="text-xs font-semibold text-slate-300 mb-2 flex items-center gap-1.5">
              <History className="w-3.5 h-3.5 text-slate-400" /> ประวัติการแก้ไข
              <span className="px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 text-[10px]">{data.edits.length}</span>
            </h3>
            {data.edits.length === 0 ? (
              <p className="text-xs text-slate-500">ยังไม่เคยแก้ยอด</p>
            ) : (
              <ul className="space-y-1.5">
                {data.edits.map((e) => (
                  <li key={e.edit_id} className="px-3 py-2 rounded-lg bg-slate-950/50 border border-slate-800 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-slate-300">
                        {editLabel(e)}
                        {' · '}ผลิตได้ <span className="text-slate-500 line-through">{formatQty(e.old_qty_produced)}</span>
                        {e.action === 'delete' ? '' : <> → <strong className="text-amber-200">{formatQty(e.new_qty_produced)}</strong></>}
                        {' · '}ของเสีย <span className="text-slate-500 line-through">{formatQty(e.old_qty_waste)}</span>
                        {e.action === 'delete' ? '' : <> → <strong className="text-amber-200">{formatQty(e.new_qty_waste)}</strong></>}
                      </span>
                      <span className="text-[11px] text-slate-500">{formatStamp(e.edited_at)} · {e.recorder || '-'}</span>
                    </div>
                    {e.reason && <div className="mt-1 text-[11px] text-slate-400">เหตุผล: {e.reason}</div>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

/**
 * ปิดงานผลิตของเมนูที่ผูกของเหลือไว้ — ผลิตได้จริง · ของเสีย (ทิ้ง) · ของเหลือแต่ละตัว (เข้าสต๊อกครัว ใช้ครั้งต่อไป)
 * ของเหลือบันทึกพร้อมยอดผลิตใน saveProductionRun ครั้งเดียว (ใบรับเข้า MR ที่มา "ของเหลือจาก PRD-…")
 */
function FinishModal({ draft, items, busy, onChange, onClose, onSave }) {
  const o = draft.order;
  const unit = o.unit || '';
  const set = (patch) => onChange({ ...draft, ...patch });
  const inputCls = 'w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-right text-slate-100 focus:outline-none focus:border-emerald-500/60';
  return (
    <Modal onClose={onClose} title={`ปิดงานผลิต · ${o.doc_no}`}>
      <div className="space-y-4">
        <p className="text-xs text-slate-400">
          {o.product_name} · สั่ง {formatQty(o.order_qty)} {unit} · บันทึกแล้ว {formatQty(o.produced_qty)} {unit}
        </p>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs text-slate-400">ผลิตได้จริง{Number(o.produced_qty) > 0 ? ' (เพิ่มจากที่บันทึกแล้ว)' : ''} ({unit || 'หน่วย'})
            <input type="number" inputMode="decimal" min="0" step="any" autoFocus value={draft.produced}
              onChange={(e) => set({ produced: e.target.value })} className={`${inputCls} mt-1.5`} />
          </label>
          <label className="text-xs text-slate-400">ของเสีย (ทิ้ง)
            <input type="number" inputMode="decimal" min="0" step="any" value={draft.waste} placeholder="0"
              onChange={(e) => set({ waste: e.target.value })} className={`${inputCls} mt-1.5`} />
          </label>
        </div>
        <div className="rounded-xl border border-teal-500/30 bg-teal-500/5 p-3 space-y-2">
          <h3 className="text-xs font-semibold text-teal-300 flex items-center gap-1.5">
            <Recycle className="w-3.5 h-3.5" /> ของเหลือ — เข้าสต๊อกครัว เก็บไว้ใช้ครั้งต่อไป
          </h3>
          {items.map((it) => (
            <div key={it.item_key} className="grid grid-cols-[1fr_8rem_3rem] items-center gap-2 text-sm">
              <span className="text-slate-200 truncate" title={it.item_code}>{it.item_name}</span>
              <input type="number" inputMode="decimal" min="0" step="any" placeholder="0"
                value={draft.leftovers[it.item_key] ?? ''}
                onChange={(e) => set({ leftovers: { ...draft.leftovers, [it.item_key]: e.target.value } })}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-sm text-right text-slate-100 focus:outline-none focus:border-teal-500/60" />
              <span className="text-[11px] text-slate-500">{it.unit || ''}</span>
            </div>
          ))}
          <p className="text-[11px] text-slate-500">ไม่มีของเหลือ เว้นว่างได้ · บันทึกเป็นใบรับเข้าครัว ที่มา "ของเหลือจาก {o.doc_no}"</p>
        </div>
        <p className="text-[11px] text-slate-500">ยอดนี้เข้าคอลัมน์ "ผลิตได้" แล้วปิดงานเป็น "ผลิตเสร็จ" แม้ได้น้อยกว่าที่สั่ง</p>
      </div>
      <ModalActions onCancel={onClose} onSave={onSave} busy={busy} tone="emerald" label="บันทึกและปิดงาน" />
    </Modal>
  );
}

/**
 * ประวัติทั้งหมดของคำสั่งผลิตหนึ่งใบ เป็นไทม์ไลน์เดียว ใหม่สุดก่อน
 *   สร้างคำสั่ง · บันทึกผลิต (แต่ละรอบ) · แก้/ลบยอดผลิต · เลื่อนวันผลิต · ยกเลิก · เปลี่ยนสถานะ
 * ข้อมูลจาก getProductionRunHistory (runs + edits + events) — เหตุการณ์ก่อนมีตารางประวัติไม่มีให้ดูย้อนหลัง
 */
const HISTORY_KIND = {
  create: { label: 'สร้างคำสั่ง', dot: 'bg-slate-400', text: 'text-slate-200' },
  run: { label: 'บันทึกผลิต', dot: 'bg-emerald-400', text: 'text-emerald-300' },
  edit: { label: 'แก้ยอดผลิต', dot: 'bg-amber-400', text: 'text-amber-300' },
  move: { label: 'เลื่อนวันผลิต', dot: 'bg-sky-400', text: 'text-sky-300' },
  cancel: { label: 'ยกเลิก', dot: 'bg-rose-400', text: 'text-rose-300' },
  status: { label: 'เปลี่ยนสถานะ', dot: 'bg-violet-400', text: 'text-violet-300' },
};
const HISTORY_FILTERS = [
  { key: 'all', label: 'ทั้งหมด', match: () => true },
  { key: 'order', label: 'เลื่อนวัน / ยกเลิก / สถานะ', match: (it) => ['move', 'cancel', 'status'].includes(it.kind) },
  { key: 'qty', label: 'ยอดผลิต', match: (it) => ['run', 'edit'].includes(it.kind) },
];

function OrderHistoryModal({ order, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('all');
  const unit = order.unit || '';

  useEffect(() => {
    kitchenCall('getProductionRunHistory', { orderId: order.order_id })
      .then(setData)
      .catch((err) => setError(/ไม่รู้จัก/.test(err.message)
        ? 'office-server ที่ออฟฟิศยังเป็นรุ่นเก่า — รัน update-office-server.bat ของ Narai-branch ก่อน'
        : err.message));
  }, [order.order_id]);

  const items = useMemo(() => {
    if (!data) return [];
    const runNo = new Map((data.runs || []).map((r, i) => [r.run_id, i + 1]));
    const q = (v) => `${formatQty(v)} ${unit}`.trim();
    const out = [{
      kind: 'create', at: order.created_at, who: order.recorder,
      text: `สั่ง ${q(order.order_qty)} · วันผลิต ${formatThaiDate(order.produce_date)} · ${ORDER_SOURCE_LABEL[order.source] || order.source}`,
    }];
    for (const r of data.runs || []) {
      out.push({
        kind: 'run', at: r.recorded_at, who: r.recorder,
        text: `รอบที่ ${runNo.get(r.run_id)} · ผลิตได้ ${q(r.qty_produced)}${Number(r.qty_waste) > 0 ? ` · ของเสีย ${q(r.qty_waste)}` : ''}`,
        reason: r.note,
      });
    }
    for (const e of data.edits || []) {
      const round = runNo.has(e.run_id) ? `รอบที่ ${runNo.get(e.run_id)}` : 'รอบที่ลบไปแล้ว';
      out.push(e.action === 'delete'
        ? { kind: 'edit', at: e.edited_at, who: e.recorder, reason: e.reason,
          text: `ลบบันทึกการผลิต ${round} · ผลิตได้ ${q(e.old_qty_produced)} · ของเสีย ${q(e.old_qty_waste)}` }
        : { kind: 'edit', at: e.edited_at, who: e.recorder, reason: e.reason,
          text: `${round} · ผลิตได้ ${formatQty(e.old_qty_produced)} → ${q(e.new_qty_produced)} · ของเสีย ${formatQty(e.old_qty_waste)} → ${formatQty(e.new_qty_waste)}` });
    }
    for (const ev of data.events || []) {
      if (ev.action === 'move') {
        out.push({ kind: 'move', at: ev.created_at, who: ev.recorder, reason: ev.reason,
          text: `${formatThaiDate(ev.old_date)} → ${formatThaiDate(ev.new_date)}${ev.plan_moved ? ' · ย้ายแผนในปฏิทินด้วย' : ''}` });
      } else {
        out.push({ kind: ev.action === 'cancel' ? 'cancel' : 'status', at: ev.created_at, who: ev.recorder, reason: ev.reason,
          text: `${ev.old_status || '-'} → ${ev.new_status || '-'}` });
      }
    }
    // ใหม่สุดก่อน · เวลาเท่ากัน (เช่น สร้าง+บันทึกในวินาทีเดียว) เรียงตามลำดับที่เกิดก่อนหลังของชนิด
    const order2 = ['create', 'run', 'edit', 'move', 'status', 'cancel'];
    return out.sort((a, b) => String(b.at || '').localeCompare(String(a.at || ''))
      || order2.indexOf(b.kind) - order2.indexOf(a.kind));
  }, [data, order, unit]);

  const f = HISTORY_FILTERS.find((x) => x.key === filter) || HISTORY_FILTERS[0];
  const shown = items.filter(f.match);

  return (
    <Modal wide onClose={onClose} title={(
      <span className="flex items-center gap-2"><History className="w-4 h-4 text-sky-400" /> ประวัติคำสั่งผลิต · {order.doc_no}</span>
    )}>
      <p className="text-xs text-slate-400 mb-3">
        {order.product_name} · สั่ง {formatQty(order.order_qty)} {unit} · ผลิตได้ {formatQty(order.produced_qty)} {unit}
        {' · '}วันผลิต {formatThaiDate(order.produce_date)} · {order.status}
      </p>
      {error ? (
        <p className="text-xs text-rose-300 py-6 text-center">{error}</p>
      ) : !data ? (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500"><Loader2 className="w-4 h-4 animate-spin" /> กำลังโหลด...</div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-1">
            {HISTORY_FILTERS.map((x) => (
              <button key={x.key} onClick={() => setFilter(x.key)}
                className={`px-3 py-1 rounded-full text-xs border ${filter === x.key
                  ? 'bg-sky-500/15 text-sky-300 border-sky-500/30'
                  : 'text-slate-400 border-slate-700 hover:text-slate-200'}`}>
                {x.label} <span className="opacity-70">{items.filter(x.match).length}</span>
              </button>
            ))}
          </div>
          {(!data.eventsReady || !data.historyReady) && (
            <p className="text-[11px] text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">
              ยังไม่มีตารางเก็บประวัติบางส่วน — รัน update-office-server.bat ที่เครื่องออฟฟิศ แล้วจะเริ่มเก็บตั้งแต่ตอนนั้น
            </p>
          )}
          {shown.length === 0 ? (
            <p className="text-xs text-slate-500 py-6 text-center">ไม่มีประวัติในหมวดนี้</p>
          ) : (
            <ol className="relative border-l border-slate-800 ml-2 space-y-3">
              {shown.map((it, i) => {
                const k = HISTORY_KIND[it.kind];
                return (
                  <li key={`${it.kind}-${i}`} className="pl-4">
                    <span className={`absolute -left-[5px] mt-1.5 w-2.5 h-2.5 rounded-full ${k.dot}`} />
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                      <span className="text-sm">
                        <strong className={k.text}>{k.label}</strong>
                        <span className="text-slate-300"> · {it.text}</span>
                      </span>
                      <span className="text-[11px] text-slate-500">{formatStamp(it.at)}{it.who ? ` · ${it.who}` : ''}</span>
                    </div>
                    {it.reason && <div className="text-[11px] text-slate-400 mt-0.5">{it.kind === 'run' ? 'หมายเหตุ' : 'เหตุผล'}: {it.reason}</div>}
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      )}
    </Modal>
  );
}

/**
 * เลื่อนวันผลิต (เช่น วัตถุดิบไม่ครบ) — rescheduleProductionOrder เก็บประวัติ (วันเดิม → วันใหม่ · เหตุผล · ผู้ทำ)
 * คำสั่งจากแพลนผลิต: ติ๊ก "ย้ายแผนในปฏิทินไปด้วย" ไว้ให้ ไม่งั้นปฏิทินยังโชว์งานที่วันเดิม
 * เลขที่ใบไม่เปลี่ยน · ใบเบิกที่เบิกไปแล้วไม่เปลี่ยน
 */
function MoveOrderModal({ order, onClose, onDone }) {
  const oldDate = String(order.produce_date).slice(0, 10);
  const [date, setDate] = useState(() => shiftYmd(oldDate, 1));
  const [reason, setReason] = useState('');
  const [movePlan, setMovePlan] = useState(true);
  const [busy, setBusy] = useState(false);
  const fromPlan = order.source === 'plan';
  const quick = [['+1 วัน', 1], ['+2 วัน', 2], ['+1 สัปดาห์', 7]];

  const save = async () => {
    if (!date) { toast.error('เลือกวันผลิตใหม่'); return; }
    if (date === oldDate) { toast.error('วันใหม่ต้องไม่ใช่วันเดิม'); return; }
    setBusy(true);
    try {
      const res = await kitchenCall('rescheduleProductionOrder', {
        orderId: order.order_id, produceDate: date, reason: reason.trim(), movePlan: fromPlan && movePlan,
      });
      toast.success(res.message);
      onDone();
    } catch (err) {
      toast.error(/ไม่รู้จัก/.test(err.message)
        ? 'office-server ที่ออฟฟิศยังเป็นรุ่นเก่า — รัน update-office-server.bat ของ Narai-branch ก่อน'
        : err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal onClose={onClose} title={(
      <span className="flex items-center gap-2"><CalendarClock className="w-4 h-4 text-amber-400" /> เลื่อนวันผลิต · {order.doc_no}</span>
    )}>
      <div className="space-y-4">
        <p className="text-xs text-slate-400">
          {order.product_name} · {formatQty(order.order_qty)} {order.unit || ''} · วันผลิตเดิม{' '}
          <strong className="text-slate-200">{formatThaiDate(oldDate)}</strong>
        </p>
        <div>
          <label className="block text-xs text-slate-400 mb-1.5">ย้ายไปวันที่</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-amber-500/60" />
          <div className="flex flex-wrap gap-1 mt-1.5">
            {quick.map(([label, n]) => {
              const d = shiftYmd(oldDate, n);
              return (
                <button key={label} type="button" onClick={() => setDate(d)}
                  className={`px-2.5 py-1 rounded-md text-xs border ${d === date
                    ? 'bg-sky-500/15 text-sky-300 border-sky-500/30'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 border-transparent'}`}>
                  {label}
                </button>
              );
            })}
          </div>
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1.5">เหตุผล</label>
          <input value={reason} onChange={(e) => setReason(e.target.value)} autoFocus maxLength={500}
            placeholder="เช่น วัตถุดิบไม่ครบ แป้งยังไม่เข้า"
            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-amber-500/60" />
        </div>
        {fromPlan && (
          <label className="flex items-center gap-2 text-xs text-slate-300">
            <input type="checkbox" checked={movePlan} onChange={(e) => setMovePlan(e.target.checked)} className="accent-amber-500" />
            ย้ายแผนในปฏิทินแพลนผลิตไปวันใหม่ด้วย
          </label>
        )}
        <p className="text-[11px] text-slate-500 bg-slate-950/50 border border-slate-800 rounded-lg px-3 py-2">
          ใบเบิกวัตถุดิบที่เบิกไปแล้วไม่เปลี่ยน · เลขที่ใบเดิม · เก็บประวัติการเลื่อน (วันเดิม → วันใหม่ · เหตุผล · ใคร · เมื่อไร)
        </p>
      </div>
      <ModalActions onCancel={onClose} onSave={save} busy={busy}
        label={date && date !== oldDate ? `เลื่อนไป ${formatThaiDate(date)}` : 'เลื่อนวันผลิต'} />
    </Modal>
  );
}

/** ยกเลิกคำสั่งผลิต — ต้องพิมพ์เหตุผลก่อน (updateProductionOrderStatus เก็บลงประวัติ) */
function CancelOrderModal({ order, onClose, onDone }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const ok = reason.trim().length > 0;

  const save = async () => {
    if (!ok) { toast.error('พิมพ์เหตุผลที่ยกเลิกก่อน'); return; }
    setBusy(true);
    try {
      const res = await kitchenCall('updateProductionOrderStatus', { orderId: order.order_id, status: 'ยกเลิก', reason: reason.trim() });
      toast.success(res.message);
      onDone();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal onClose={onClose} title={(
      <span className="flex items-center gap-2"><Ban className="w-4 h-4 text-rose-400" /> ยกเลิกคำสั่งผลิต · {order.doc_no}</span>
    )}>
      <div className="space-y-4">
        <p className="text-xs text-slate-400">
          {order.product_name} · {formatQty(order.order_qty)} {order.unit || ''} · ผลิต {formatThaiDate(order.produce_date)}
        </p>
        <div>
          <label className="block text-xs text-slate-400 mb-1.5">เหตุผลที่ยกเลิก <span className="text-rose-300">*</span></label>
          <input value={reason} onChange={(e) => setReason(e.target.value)} autoFocus maxLength={500}
            onKeyDown={(e) => { if (e.key === 'Enter') save(); }}
            placeholder="เช่น วัตถุดิบไม่มี สาขายกเลิก สั่งซ้ำ"
            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-rose-500/60" />
        </div>
        {order.source === 'plan' && (
          <p className="text-[11px] text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">
            แผนในปฏิทินจะกลับไปเป็น "แพลนผลิต" สั่งผลิตใหม่ได้ · เปลี่ยนกลับเป็นรอผลิตได้จาก dropdown
          </p>
        )}
      </div>
      <div className="flex items-center justify-end gap-2 mt-5 pt-4 border-t border-slate-800">
        <button onClick={onClose} className="px-4 py-2 rounded-lg text-xs text-slate-300 hover:bg-slate-800">ไม่ยกเลิก</button>
        <button data-write onClick={save} disabled={busy || !ok}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-rose-500 text-white hover:bg-rose-400 disabled:opacity-40">
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Ban className="w-3.5 h-3.5" />} ยืนยันยกเลิก
        </button>
      </div>
    </Modal>
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
      <button data-write
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
