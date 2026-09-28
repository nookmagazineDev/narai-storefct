import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import {
  CalendarDays, CalendarCheck, CalendarRange, ChevronLeft, ChevronRight, RefreshCw, Plus,
  Trash2, Pencil, Loader2, Save, X, Factory, ClipboardList, CheckCircle2, Search, Info,
} from 'lucide-react';
import {
  kitchenCall, todayYmd, shiftYmd, formatQty, formatStamp, ORDER_STATUS_STYLE,
} from '../../services/kitchenService';
import { fetchQcrdMenus } from '../../services/qcrdService';
import { isKitchenItemName } from '../../../lib/kitchenRequests';

const THAI_MONTHS = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
];
const THAI_MONTHS_SHORT = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
  'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const WEEKDAYS = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];

// วันที่ทั้งหน้าเป็นสตริง YYYY-MM-DD คิดด้วย UTC ล้วน ไม่ผ่านเขตเวลาของเครื่อง (ดู toLocalDateStr ในปฏิทินสโตร์)
const parseYmd = (s) => String(s).slice(0, 10).split('-').map(Number);
const monthStart = (y, m) => new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
const weekdayOf = (s) => { const [y, m, d] = parseYmd(s); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); };
const formatLong = (s) => { const [y, m, d] = parseYmd(s); return `${d} ${THAI_MONTHS[m - 1]} ${y + 543}`; };
const formatShort = (s) => { const [, m, d] = parseYmd(s); return `${WEEKDAYS[weekdayOf(s)]} ${d} ${THAI_MONTHS_SHORT[m - 1]}`; };

function datesBetween(a, b) {
  const [from, to] = a <= b ? [a, b] : [b, a];
  const out = [];
  for (let d = from; d <= to && out.length < 93; d = shiftYmd(d, 1)) out.push(d);
  return out;
}

const isKitchenMenu = (menu) => isKitchenItemName(menu.name) && menu.status !== 'ปิดการใช้งาน';
const isOrdered = (p) => Boolean(p.order_id) && p.order_status !== 'ยกเลิก';

/**
 * จำนวนต่อแผน = ผลผลิตหนึ่งสูตรจาก QC/RD — ไม่มีช่องให้กรอก ยอดวัตถุดิบดึงจากสูตรตอนสั่งผลิต
 * สูตรที่ยังไม่มีข้อมูลที่ผลิตได้ นับเป็น 1 สูตร (กติกาเดียวกับ baseYield ของ RecipeRunForm)
 * ดินสอของคำสั่งผลิตจึงเปิดสูตรมาที่ 1 ชุดพอดี
 */
const recipeYield = (menu) => (Number(menu?.yieldQty) > 0
  ? { qty: Number(menu.yieldQty), unit: menu.yieldUnit || '', known: true }
  : { qty: 1, unit: 'สูตร', known: false });

/**
 * แพลนผลิต — ปฏิทินรายเดือนแบบเดียวกับปฏิทินใบเบิกของสโตร์ แต่ละช่องคือแผนผลิตของวันนั้น
 *
 * สองโหมด:
 *   เลือกวันเดียว — กดช่องแล้วแผงขวาแสดงแผนของวันนั้น เพิ่ม/แก้/ลบ และสร้างคำสั่งผลิตจากแผนของวันนั้นได้
 *                   ปุ่ม + มุมช่องเปิดฟอร์มเพิ่มแผนของวันนั้นทันที
 *   เลือกหลายวัน — กดช่องเพื่อเลือก/เอาออก · Shift+คลิกเลือกเป็นช่วง · กดหัวคอลัมน์เลือกทุกวันนั้นในเดือน
 *                   หรือระบุช่วงวันที่เอง แล้วตั้งแผนเมนูเดียวกันให้ทุกวันที่เลือกทีเดียว
 *
 * แผนเก็บเป็นรายวัน (หนึ่งแถวต่อวันต่อเมนู) ตั้งเมนูเดิมซ้ำในวันเดิม = อัปเดตแผนเดิม
 * ไม่มีช่องกรอกจำนวน — จำนวนต่อแผนคือผลผลิตหนึ่งสูตรจาก QC/RD (ดู recipeYield)
 */
export default function ProductionPlan() {
  const today = todayYmd();
  const [view, setView] = useState(() => { const [y, m] = parseYmd(today); return { y, m: m - 1 }; });
  const [mode, setMode] = useState('single');
  const [selectedDate, setSelectedDate] = useState(today);
  const [picked, setPicked] = useState(() => new Set());
  const [anchor, setAnchor] = useState(null);
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [menus, setMenus] = useState([]);
  const [menusLoading, setMenusLoading] = useState(true);
  const [form, setForm] = useState(null); // null | { plan?: object } — เปิดฟอร์มในโหมดเลือกวันเดียว

  const cells = useMemo(() => {
    const first = monthStart(view.y, view.m);
    const lead = weekdayOf(first);
    const daysInMonth = new Date(Date.UTC(view.y, view.m + 1, 0)).getUTCDate();
    const total = lead + daysInMonth > 35 ? 42 : 35;
    const start = shiftYmd(first, -lead);
    return Array.from({ length: total }, (_, i) => {
      const dateStr = shiftYmd(start, i);
      const [, m, d] = parseYmd(dateStr);
      return { dateStr, dayNum: d, isCurrentMonth: m === view.m + 1 };
    });
  }, [view]);

  const rangeFrom = cells[0].dateStr;
  const rangeTo = cells[cells.length - 1].dateStr;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await kitchenCall('getDatedPlans', { dateFrom: rangeFrom, dateTo: rangeTo });
      setPlans(res.plans || []);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [rangeFrom, rangeTo]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    fetchQcrdMenus()
      .then((res) => setMenus((res.menus || []).filter(isKitchenMenu)))
      .catch((err) => toast.error(`โหลดเมนู QC/RD ไม่ได้: ${err.message}`))
      .finally(() => setMenusLoading(false));
  }, []);

  const plansByDate = useMemo(() => {
    const map = {};
    for (const p of plans) {
      const key = String(p.plan_date).slice(0, 10);
      (map[key] ||= []).push(p);
    }
    return map;
  }, [plans]);

  const monthPrefix = `${view.y}-${String(view.m + 1).padStart(2, '0')}`;
  const monthPlans = plans.filter((p) => String(p.plan_date).startsWith(monthPrefix));
  const monthOrdered = monthPlans.filter(isOrdered).length;

  const pickedList = useMemo(() => [...picked].sort(), [picked]);
  const menuByKey = useMemo(() => Object.fromEntries(menus.map((m) => [m.key, m])), [menus]);

  /* ------------------------------ เลือกวัน ------------------------------ */

  const switchMode = (next) => {
    setMode(next);
    setForm(null);
    // เข้าโหมดหลายวันโดยเริ่มจากวันที่ดูอยู่ — ไม่ต้องกดซ้ำอีกครั้ง
    if (next === 'multi' && picked.size === 0) setPicked(new Set([selectedDate]));
  };

  const clickCell = (dateStr, e) => {
    if (mode === 'single') {
      setSelectedDate(dateStr);
      setForm(null);
      return;
    }
    setPicked((prev) => {
      const next = new Set(prev);
      if (e.shiftKey && anchor) {
        datesBetween(anchor, dateStr).forEach((d) => next.add(d));
      } else if (next.has(dateStr)) {
        next.delete(dateStr);
      } else {
        next.add(dateStr);
      }
      return next;
    });
    setAnchor(dateStr);
  };

  const quickAdd = (dateStr, e) => {
    e.stopPropagation();
    setSelectedDate(dateStr);
    setForm({});
  };

  // กดหัวคอลัมน์ = เลือกทุกวันนั้นในเดือนที่ดูอยู่ (เลือกครบแล้วกดซ้ำ = เอาออกทั้งหมด)
  const toggleWeekday = (wd) => {
    const days = cells.filter((c) => c.isCurrentMonth && weekdayOf(c.dateStr) === wd).map((c) => c.dateStr);
    setPicked((prev) => {
      const next = new Set(prev);
      const allIn = days.every((d) => next.has(d));
      days.forEach((d) => (allIn ? next.delete(d) : next.add(d)));
      return next;
    });
  };

  const addRange = (from, to) => {
    if (!from || !to) { toast.error('ระบุวันที่เริ่มและวันที่สิ้นสุด'); return; }
    setPicked((prev) => new Set([...prev, ...datesBetween(from, to)]));
  };

  const goMonth = (delta) => setView(({ y, m }) => {
    const d = new Date(Date.UTC(y, m + delta, 1));
    return { y: d.getUTCFullYear(), m: d.getUTCMonth() };
  });

  const goToday = () => {
    const [y, m] = parseYmd(today);
    setView({ y, m: m - 1 });
    setSelectedDate(today);
  };

  /* ------------------------------ บันทึก / สร้างคำสั่ง ------------------------------ */

  const removePlan = async (plan) => {
    if (!window.confirm(`ลบแผน "${plan.product_name}" ของวันที่ ${formatLong(plan.plan_date)} ใช่ไหม?`)) return;
    try {
      const res = await kitchenCall('deleteDatedPlan', { planId: plan.plan_id });
      toast.success(res.message);
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  // สร้างทีละวัน — createOrdersFromPlan ข้ามเมนูที่มีคำสั่งตามแผนของวันนั้นอยู่แล้ว กดซ้ำจึงปลอดภัย
  const createOrders = async (dates) => {
    const pending = dates.filter((d) => (plansByDate[d] || []).some((p) => !isOrdered(p)));
    if (pending.length === 0) { toast('ทุกแผนในวันที่เลือกสั่งผลิตไปแล้ว', { icon: 'ℹ️' }); return; }
    if (pending.length > 1 && !window.confirm(`สร้างคำสั่งผลิตตามแผนของ ${pending.length} วัน ใช่ไหม?`)) return;
    setBusy(true);
    let created = 0;
    try {
      // ถึงเวลาสั่งผลิตค่อยดึงจำนวนจากสูตร — แผนที่ตั้งไว้ก่อนสูตรมีข้อมูลที่ผลิตได้ ก่อนสูตรเปลี่ยน
      // หรือแผนรุ่นแรกที่กรอกจำนวนเอง อัปเดตให้ตรงสูตรล่าสุดก่อนออกคำสั่ง (หาเมนูไม่เจอ = ใช้จำนวนที่บันทึกไว้)
      for (const p of pending.flatMap((d) => plansByDate[d]).filter((x) => !isOrdered(x))) {
        const menu = menuByKey[p.product_key];
        const y = recipeYield(menu);
        if (menu && (Number(p.planned_qty) !== y.qty || (p.unit || '') !== y.unit)) {
          await kitchenCall('saveDatedPlans', { planId: p.plan_id, plannedQty: y.qty, unit: y.unit, note: p.note });
        }
      }
      for (const produceDate of pending) {
        const res = await kitchenCall('createOrdersFromPlan', { produceDate });
        created += Number(res.created || 0);
      }
      toast.success(`สร้างคำสั่งผลิตตามแผนแล้ว ${created} ใบ`);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
      load();
    }
  };

  const dayPlans = plansByDate[selectedDate] || [];

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* หัวหน้า — รูปแบบเดียวกับปฏิทินใบเบิกของสโตร์ */}
      <div className="glass-panel rounded-2xl p-5 border border-slate-800 bg-gradient-to-r from-slate-900 via-slate-900 to-cyan-950/30 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold text-cyan-400 mb-1">
            <CalendarDays className="w-4 h-4" />
            <span>ครัวกลาง · แพลนผลิต</span>
          </div>
          <h1 className="text-xl md:text-2xl font-bold text-slate-100">แพลนผลิตรายวัน</h1>
          <p className="text-xs text-slate-400 mt-1">
            กดช่องในปฏิทินเพื่อวางแผนของวันนั้น หรือสลับเป็น <strong className="text-cyan-300">เลือกหลายวัน</strong> เพื่อตั้งแผนเมนูเดียวกันให้หลายวันทีเดียว
          </p>
        </div>

        <div className="grid grid-cols-3 gap-2 md:flex md:items-center md:gap-3">
          <Stat Icon={ClipboardList} label="แผนทั้งเดือน" value={`${monthPlans.length} รายการ`} tone="text-slate-200" />
          <Stat Icon={CalendarDays} label="ยังไม่สั่งผลิต" value={`${monthPlans.length - monthOrdered} รายการ`} tone="text-cyan-300" />
          <Stat Icon={CheckCircle2} label="สั่งผลิตแล้ว" value={`${monthOrdered} รายการ`} tone="text-emerald-400" />
        </div>
      </div>

      {/* แถบควบคุม */}
      <div className="glass-card rounded-2xl p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <button onClick={() => goMonth(-1)} className={NAV_BTN}><ChevronLeft className="w-4 h-4" /></button>
          <span className="text-base font-bold text-slate-100 min-w-36 text-center font-mono">
            {THAI_MONTHS[view.m]} {view.y + 543}
          </span>
          <button onClick={() => goMonth(1)} className={NAV_BTN}><ChevronRight className="w-4 h-4" /></button>
          <button
            onClick={goToday}
            className="px-3 py-1.5 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/30 text-xs font-semibold hover:bg-amber-500/20 transition-colors ml-1"
          >
            วันนี้
          </button>
        </div>

        <div className="flex items-center bg-slate-950 p-1 rounded-xl border border-slate-800">
          <ModeButton active={mode === 'single'} onClick={() => switchMode('single')} Icon={CalendarCheck} label="เลือกวันเดียว" />
          <ModeButton active={mode === 'multi'} onClick={() => switchMode('multi')} Icon={CalendarRange} label="เลือกหลายวัน" />
        </div>

        <button onClick={load} className={NAV_BTN} title="รีเฟรชข้อมูล">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-amber-400' : ''}`} />
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* ปฏิทิน */}
        <div className="lg:col-span-8 glass-panel rounded-2xl p-4 border border-slate-800 shadow-xl space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-800/80">
            <h2 className="text-xs font-bold text-slate-300 flex items-center gap-2">
              <CalendarDays className="w-4 h-4 text-cyan-400" />
              {mode === 'single'
                ? <span>กดช่องเพื่อดูแผนของวันนั้น<span className="hidden md:inline"> · กด <Plus className="inline w-3 h-3" /> มุมช่องเพื่อเพิ่มแผนทันที</span></span>
                : <span>กดวันเพื่อเลือก/เอาออก · Shift+คลิกเลือกเป็นช่วง · กดหัวคอลัมน์เลือกทุกวันนั้นในเดือน</span>}
            </h2>
            <div className="flex items-center gap-3 text-[10px] text-slate-400">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-cyan-400" /> ยังไม่สั่งผลิต</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-400" /> สั่งผลิตแล้ว</span>
            </div>
          </div>

          <div className="grid grid-cols-7 gap-1 text-center">
            {WEEKDAYS.map((w, idx) => {
              const weekend = idx === 0 || idx === 6;
              const cls = `py-1.5 text-[11px] font-bold rounded-lg ${
                weekend ? 'text-amber-400 bg-amber-500/5' : 'text-slate-400 bg-slate-900/60'}`;
              return mode === 'multi' ? (
                <button key={w} onClick={() => toggleWeekday(idx)} title={`เลือกทุกวัน${w}ในเดือนนี้`}
                  className={`${cls} hover:bg-cyan-500/15 hover:text-cyan-300 cursor-pointer`}>
                  {w}
                </button>
              ) : (
                <div key={w} className={cls}>{w}</div>
              );
            })}
          </div>

          <div className="grid grid-cols-7 gap-1.5">
            {cells.map((cell) => (
              <DayCell
                key={cell.dateStr}
                cell={cell}
                plans={plansByDate[cell.dateStr] || []}
                isToday={cell.dateStr === today}
                isSelected={mode === 'single' && cell.dateStr === selectedDate}
                isPicked={mode === 'multi' && picked.has(cell.dateStr)}
                mode={mode}
                onClick={(e) => clickCell(cell.dateStr, e)}
                onQuickAdd={(e) => quickAdd(cell.dateStr, e)}
              />
            ))}
          </div>
        </div>

        {/* แผงขวา */}
        <div className="lg:col-span-4 glass-panel rounded-2xl p-5 border border-slate-800 shadow-xl flex flex-col min-h-[420px]">
          {mode === 'single' ? (
            <>
              <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                <div>
                  <p className="text-[11px] text-cyan-400 font-semibold flex items-center gap-1">
                    <CalendarCheck className="w-3.5 h-3.5" /> แผนผลิตวันที่
                  </p>
                  <h3 className="text-base font-bold text-slate-100 font-mono mt-0.5">{formatLong(selectedDate)}</h3>
                </div>
                <span className="px-3 py-1 rounded-full bg-cyan-500/10 text-cyan-300 border border-cyan-500/30 font-bold text-xs">
                  {dayPlans.length} รายการ
                </span>
              </div>

              <div className="mt-4 space-y-2.5 flex-1">
                {dayPlans.length === 0 && !form && (
                  <div className="py-10 text-center text-slate-500 space-y-2">
                    <CalendarDays className="w-8 h-8 mx-auto text-slate-700 stroke-1" />
                    <p className="text-xs">ยังไม่มีแผนผลิตในวันนี้</p>
                  </div>
                )}
                {dayPlans.map((p) => (
                  <PlanRow key={p.plan_id} plan={p} group={menuByKey[p.product_key]?.groupName}
                    onEdit={() => setForm({ plan: p })} onDelete={() => removePlan(p)} />
                ))}

                {form ? (
                  <PlanForm
                    key={form.plan?.plan_id || selectedDate}
                    dates={[selectedDate]}
                    editing={form.plan}
                    menus={menus}
                    menusLoading={menusLoading}
                    plansByDate={plansByDate}
                    onCancel={() => setForm(null)}
                    onSaved={() => { setForm(null); load(); }}
                  />
                ) : (
                  <button onClick={() => setForm({})} className={ADD_BTN}>
                    <Plus className="w-3.5 h-3.5" /> เพิ่มแผนผลิตวันนี้
                  </button>
                )}
              </div>

              <div className="pt-3 mt-4 border-t border-slate-800">
                <CreateOrdersButton
                  busy={busy}
                  count={dayPlans.filter((p) => !isOrdered(p)).length}
                  label="สร้างคำสั่งผลิตจากแผนวันนี้"
                  onClick={() => createOrders([selectedDate])}
                />
              </div>
            </>
          ) : (
            <MultiDayPanel
              pickedList={pickedList}
              onUnpick={(d) => setPicked((prev) => { const n = new Set(prev); n.delete(d); return n; })}
              onClear={() => setPicked(new Set())}
              onAddRange={addRange}
              defaultFrom={pickedList[0] || today}
              menus={menus}
              menusLoading={menusLoading}
              plansByDate={plansByDate}
              onSaved={load}
              busy={busy}
              pendingCount={pickedList.reduce((n, d) => n + (plansByDate[d] || []).filter((p) => !isOrdered(p)).length, 0)}
              onCreateOrders={() => createOrders(pickedList)}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/* --------------------------------- ส่วนประกอบย่อย --------------------------------- */

const NAV_BTN = 'p-2 rounded-xl bg-slate-950 border border-slate-800 text-slate-300 hover:text-amber-400 hover:border-amber-500/40 transition-colors';
const ADD_BTN = 'w-full flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-xs font-semibold bg-cyan-500/10 text-cyan-300 hover:bg-cyan-500/20 border border-dashed border-cyan-500/40';

function Stat({ Icon, label, value, tone }) {
  return (
    <div className="px-2.5 md:px-3.5 py-2 rounded-xl bg-slate-950/60 border border-slate-800 flex items-center gap-2">
      <Icon className={`hidden md:block w-4 h-4 ${tone}`} />
      <div>
        <p className="text-[10px] text-slate-400">{label}</p>
        <p className={`text-sm font-bold ${tone}`}>{value}</p>
      </div>
    </div>
  );
}

function ModeButton({ active, onClick, Icon, label }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
        active ? 'bg-amber-500 text-slate-950 shadow-md' : 'text-slate-400 hover:text-slate-200'}`}
    >
      <Icon className="w-3.5 h-3.5" />
      <span>{label}</span>
    </button>
  );
}

function DayCell({ cell, plans, isToday, isSelected, isPicked, mode, onClick, onQuickAdd }) {
  const shown = plans.slice(0, 3);
  const more = plans.length - shown.length;
  const tone = isSelected
    ? 'bg-amber-500/15 border-amber-400 ring-2 ring-amber-400/60 z-10'
    : isPicked
    ? 'bg-cyan-500/15 border-cyan-400 ring-1 ring-cyan-400/60'
    : !cell.isCurrentMonth
    ? 'bg-slate-950/20 border-slate-900/50 opacity-40'
    : isToday
    ? 'bg-amber-950/30 border-amber-500/60 hover:bg-amber-900/40'
    : 'bg-slate-900/60 border-slate-800/80 hover:bg-slate-800/60 hover:border-slate-700';

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(e); } }}
      className={`group relative h-16 md:h-28 p-1 md:p-1.5 rounded-xl border text-left cursor-pointer transition-all flex flex-col gap-1 select-none ${tone}`}
    >
      <div className="flex items-center justify-between">
        <span className={`text-xs font-mono ${
          isSelected || isToday ? 'text-amber-400 font-bold' : cell.isCurrentMonth || isPicked ? 'text-slate-300' : 'text-slate-600'}`}>
          {cell.dayNum}
        </span>
        {isPicked ? (
          <CheckCircle2 className="w-4 h-4 text-cyan-300" />
        ) : mode === 'single' && cell.isCurrentMonth ? (
          <button
            onClick={onQuickAdd}
            title="เพิ่มแผนผลิตวันนี้"
            className={`w-5 h-5 rounded-md items-center justify-center bg-cyan-500/20 text-cyan-300 hover:bg-cyan-500 hover:text-slate-950 ${
              isSelected ? 'hidden md:flex' : 'hidden md:group-hover:flex'}`}
          >
            <Plus className="w-3 h-3" />
          </button>
        ) : null}
      </div>

      {/* จอมือถือช่องแคบเกินจะอ่านชื่อ — แสดงเป็นจุดตามจำนวนแผน สีตามสถานะ */}
      {plans.length > 0 && (
        <div className="md:hidden mt-auto flex flex-wrap justify-center gap-0.5 pb-0.5">
          {plans.slice(0, 6).map((p) => (
            <span key={p.plan_id} className={`w-1.5 h-1.5 rounded-full ${isOrdered(p) ? 'bg-emerald-400' : 'bg-cyan-400'}`} />
          ))}
        </div>
      )}

      {shown.map((p) => (
        <div
          key={p.plan_id}
          className={`hidden md:flex items-center justify-between gap-1 px-1.5 py-0.5 rounded-md text-[10px] leading-tight border ${
            isOrdered(p)
              ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/25'
              : 'bg-cyan-500/10 text-cyan-200 border-cyan-500/25'}`}
          title={`${p.product_code} ${p.product_name} ${formatQty(p.planned_qty)} ${p.unit || ''}`}
        >
          <span className="font-mono truncate">{p.product_code || p.product_key}</span>
          <span className="font-mono shrink-0">{formatQty(p.planned_qty)}</span>
        </div>
      ))}
      {more > 0 && <span className="hidden md:block text-[10px] text-slate-400 pl-1">+{more} รายการ</span>}
    </div>
  );
}

/** รายละเอียดแผนหนึ่งรายการในแผงขวา — ช่องในปฏิทินมีแค่รหัสกับจำนวน รายละเอียดครบอยู่ที่นี่ */
function PlanRow({ plan, group, onEdit, onDelete }) {
  const ordered = isOrdered(plan);
  return (
    <div className={`p-3.5 rounded-xl border bg-slate-900/80 ${ordered ? 'border-emerald-500/30' : 'border-cyan-500/30'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="px-2 py-0.5 rounded-md font-mono text-xs font-bold bg-slate-950 text-slate-100 border border-slate-700">
              {plan.product_code || plan.product_key}
            </span>
            {ordered ? (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-300 border border-emerald-500/30">
                สั่งผลิตแล้ว
              </span>
            ) : (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-cyan-500/10 text-cyan-300 border border-cyan-500/30">
                ยังไม่สั่งผลิต
              </span>
            )}
          </div>
          <div className="mt-1.5 text-sm font-semibold text-slate-100">{plan.product_name}</div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-lg font-bold text-slate-100 leading-tight">{formatQty(plan.planned_qty)}</div>
          <div className="text-[11px] text-slate-400">{plan.unit}</div>
        </div>
      </div>

      <dl className="mt-2.5 pt-2.5 border-t border-slate-800 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px]">
        <dt className="text-slate-500">หมวด</dt>
        <dd className="text-slate-300">{group || '-'}</dd>
        <dt className="text-slate-500">คำสั่งผลิต</dt>
        <dd>
          {ordered ? (
            <span className={`px-1.5 py-0.5 rounded border text-[10px] font-semibold ${ORDER_STATUS_STYLE[plan.order_status] || ''}`}>
              {plan.order_doc_no} · {plan.order_status}
            </span>
          ) : <span className="text-slate-400">ยังไม่ออกคำสั่ง</span>}
        </dd>
        <dt className="text-slate-500">หมายเหตุ</dt>
        <dd className="text-slate-300">{plan.note || '-'}</dd>
        <dt className="text-slate-500">บันทึกแผนเมื่อ</dt>
        <dd className="text-slate-400">{formatStamp(plan.created_at)}</dd>
      </dl>

      <div className="mt-2.5 flex justify-end gap-1">
        <button onClick={onEdit} disabled={ordered} title={ordered ? 'สั่งผลิตแล้ว แก้ที่เมนูสถานะการผลิต' : 'แก้แผน'}
          className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] text-slate-400 hover:text-amber-300 hover:bg-slate-800 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-slate-400">
          <Pencil className="w-3 h-3" /> แก้
        </button>
        <button onClick={onDelete} disabled={ordered} title={ordered ? 'สั่งผลิตแล้ว ลบไม่ได้' : 'ลบแผน'}
          className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] text-slate-400 hover:text-rose-300 hover:bg-slate-800 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-slate-400">
          <Trash2 className="w-3 h-3" /> ลบ
        </button>
      </div>
    </div>
  );
}

function CreateOrdersButton({ busy, count, label, onClick }) {
  return (
    <button
      onClick={onClick}
      disabled={busy || count === 0}
      className="w-full flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-semibold bg-emerald-500 text-slate-950 hover:bg-emerald-400 disabled:opacity-40 disabled:hover:bg-emerald-500"
    >
      {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Factory className="w-3.5 h-3.5" />}
      {label} {count > 0 && `(${count} รายการ)`}
    </button>
  );
}

function MultiDayPanel({
  pickedList, onUnpick, onClear, onAddRange, defaultFrom, menus, menusLoading, plansByDate,
  onSaved, busy, pendingCount, onCreateOrders,
}) {
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(() => shiftYmd(defaultFrom, 6));

  return (
    <>
      <div className="flex items-center justify-between pb-3 border-b border-slate-800">
        <div>
          <p className="text-[11px] text-cyan-400 font-semibold flex items-center gap-1">
            <CalendarRange className="w-3.5 h-3.5" /> วางแผนหลายวัน
          </p>
          <h3 className="text-base font-bold text-slate-100 mt-0.5">เลือกไว้ {pickedList.length} วัน</h3>
        </div>
        {pickedList.length > 0 && (
          <button onClick={onClear} className="text-[11px] text-slate-400 hover:text-rose-300">ล้างที่เลือก</button>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
        {pickedList.length === 0 ? (
          <p className="text-xs text-slate-500 py-2">ยังไม่ได้เลือกวัน — กดวันในปฏิทิน หรือระบุช่วงวันที่ด้านล่าง</p>
        ) : pickedList.map((d) => (
          <span key={d} className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full text-[11px] bg-cyan-500/10 text-cyan-200 border border-cyan-500/30">
            {formatShort(d)}
            <button onClick={() => onUnpick(d)} className="p-0.5 text-cyan-400/70 hover:text-rose-300"><X className="w-3 h-3" /></button>
          </span>
        ))}
      </div>

      <div className="mt-3 p-3 rounded-xl bg-slate-950/50 border border-slate-800">
        <p className="text-[11px] text-slate-400 mb-2">ระบุช่วงวันที่</p>
        <div className="flex items-center gap-1.5">
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={`${INPUT} flex-1 min-w-0`} />
          <span className="text-xs text-slate-500">ถึง</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={`${INPUT} flex-1 min-w-0`} />
          <button onClick={() => onAddRange(from, to)} title="เพิ่มช่วงนี้เข้าไปในวันที่เลือก"
            className="p-2 rounded-lg bg-cyan-500/15 text-cyan-300 hover:bg-cyan-500/25 border border-cyan-500/30">
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="mt-3 flex-1">
        <PlanForm
          dates={pickedList}
          menus={menus}
          menusLoading={menusLoading}
          plansByDate={plansByDate}
          onSaved={onSaved}
        />
      </div>

      <div className="pt-3 mt-4 border-t border-slate-800">
        <CreateOrdersButton busy={busy} count={pendingCount} label="สร้างคำสั่งผลิตจากแผนของวันที่เลือก" onClick={onCreateOrders} />
      </div>
    </>
  );
}

const INPUT = 'bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-cyan-500/60';

/**
 * ฟอร์มตั้งแผน — ใช้ทั้งวันเดียว (เพิ่ม/แก้) และหลายวัน (เมนูเดียวกันทุกวันที่เลือก)
 * เมนูมาจาก QC/RD เฉพาะชื่อที่มี FC กติกาเดียวกับหน้าสั่งผลิต
 * ไม่มีช่องกรอกจำนวน — จำนวนต่อแผนคือผลผลิตหนึ่งสูตร (recipeYield) ยอดวัตถุดิบดึงจากสูตรตอนสั่งผลิต
 */
function PlanForm({ dates, editing, menus, menusLoading, plansByDate, onCancel, onSaved }) {
  const [menu, setMenu] = useState(() => (editing
    ? { key: editing.product_key, code: editing.product_code, name: editing.product_name }
    : null));
  const [term, setTerm] = useState('');
  const [note, setNote] = useState(editing?.note || '');
  const [saving, setSaving] = useState(false);

  // ใช้ข้อมูลสูตรล่าสุดจากทะเบียน QC/RD เสมอ — แก้แผนที่หาเมนูในทะเบียนไม่เจอ (โหลดไม่ได้/เมนูถูกปิด)
  // คงจำนวนเดิมไว้ ไม่งั้นกดบันทึกหมายเหตุอย่างเดียวจะรีเซ็ตเป็น 1 สูตร
  const recipe = useMemo(() => menu && menus.find((m) => m.key === menu.key), [menu, menus]);
  const yld = recipe || !editing
    ? recipeYield(recipe)
    : { qty: Number(editing.planned_qty), unit: editing.unit || '', known: true };

  const matches = useMemo(() => {
    const q = term.trim().toLowerCase();
    return menus.filter((m) => !q || m.name.toLowerCase().includes(q) || m.code.toLowerCase().includes(q)).slice(0, 8);
  }, [menus, term]);

  // วันที่เลือกที่มีแผนเมนูนี้อยู่แล้ว — บันทึกแล้วอัปเดตแถวเดิม ไม่เพิ่มแถวซ้ำ
  const clashes = useMemo(() => (menu && !editing
    ? dates.filter((d) => (plansByDate[d] || []).some((p) => p.product_key === menu.key))
    : []), [menu, editing, dates, plansByDate]);

  const multi = dates.length > 1;

  const save = async () => {
    if (dates.length === 0) { toast.error('เลือกวันที่ก่อน'); return; }
    if (!menu) { toast.error('เลือกเมนูที่จะผลิต'); return; }
    setSaving(true);
    try {
      const res = await kitchenCall('saveDatedPlans', {
        planId: editing?.plan_id,
        dates,
        productKey: menu.key,
        productCode: menu.code,
        productName: menu.name,
        plannedQty: yld.qty,
        unit: yld.unit,
        note,
      });
      toast.success(res.message);
      if (!editing) { setMenu(null); setNote(''); }
      onSaved?.();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3 bg-slate-800/40 border border-slate-700/70 rounded-xl p-3.5">
      <p className="text-xs font-semibold text-slate-200">
        {editing ? 'แก้แผนผลิต' : multi ? `ตั้งแผนให้ ${dates.length} วันที่เลือก` : 'เพิ่มแผนผลิต'}
      </p>

      {menu ? (
        <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-slate-900 border border-cyan-500/40">
          <div className="min-w-0">
            <div className="text-sm text-slate-100 truncate">{menu.name}</div>
            <div className="text-[11px] text-slate-500">{menu.code}</div>
          </div>
          {!editing && (
            <button onClick={() => setMenu(null)} className="text-[11px] text-slate-400 hover:text-slate-200 shrink-0">เปลี่ยน</button>
          )}
        </div>
      ) : (
        <div>
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="ค้นหาเมนู FC..."
              className={`${INPUT} w-full pl-8`} />
          </div>
          <div className="mt-1.5 max-h-40 overflow-y-auto rounded-lg border border-slate-800 divide-y divide-slate-800/70">
            {menusLoading ? (
              <div className="flex items-center gap-2 px-3 py-3 text-xs text-slate-500"><Loader2 className="w-3.5 h-3.5 animate-spin" /> กำลังโหลดเมนู...</div>
            ) : matches.length === 0 ? (
              <div className="px-3 py-3 text-xs text-slate-500">ไม่พบเมนู</div>
            ) : matches.map((m) => (
              <button key={m.key} onClick={() => setMenu(m)}
                className="w-full text-left px-3 py-1.5 hover:bg-slate-800/70">
                <div className="text-xs text-slate-200">{m.name}</div>
                <div className="text-[10px] text-slate-500">{m.code}{m.groupName ? ` · ${m.groupName}` : ''}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      <div>
        <label className="block text-[10px] text-slate-500 mb-1">
          {multi ? 'จำนวนที่ผลิตได้ต่อวัน' : 'จำนวนที่ผลิตได้'} (ตามสูตร QC/RD)
        </label>
        <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-slate-950/60 border border-slate-800 text-sm">
          {!menu ? (
            <span className="text-slate-600">เลือกเมนูก่อน</span>
          ) : yld.known ? (
            <span className="font-semibold text-slate-100">{formatQty(yld.qty)} {yld.unit}</span>
          ) : (
            <span className="text-slate-400">ยังไม่มีข้อมูลที่ผลิตได้ · นับเป็น 1 สูตร</span>
          )}
        </div>
        <p className="mt-1 text-[10px] text-slate-500">ยอดวัตถุดิบดึงจากสูตรตอนสั่งผลิต</p>
      </div>
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="หมายเหตุ (ถ้ามี)" className={`${INPUT} w-full`} />

      {clashes.length > 0 && (
        <div className="flex gap-1.5 text-[11px] text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg px-2.5 py-2">
          <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>มีแผนเมนูนี้อยู่แล้ว {clashes.length} วัน ({clashes.map(formatShort).join(', ')}) — บันทึกซ้ำจะอัปเดตแผนเดิม ไม่เพิ่มรายการซ้ำ</span>
        </div>
      )}

      {multi && menu && yld.known && (
        <p className="text-[11px] text-slate-400">
          {dates.length} วัน × {formatQty(yld.qty)} {yld.unit} = รวม <strong className="text-cyan-300">{formatQty(yld.qty * dates.length)} {yld.unit}</strong>
        </p>
      )}

      <div className="flex items-center justify-end gap-2">
        {onCancel && (
          <button onClick={onCancel} className="px-3 py-1.5 rounded-lg text-xs text-slate-400 hover:bg-slate-800">ยกเลิก</button>
        )}
        <button onClick={save} disabled={saving || dates.length === 0}
          className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-cyan-500 text-slate-950 hover:bg-cyan-400 disabled:opacity-40">
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          {editing ? 'บันทึกการแก้ไข' : multi ? `บันทึกแผนให้ ${dates.length} วัน` : 'บันทึกแผน'}
        </button>
      </div>
    </div>
  );
}
