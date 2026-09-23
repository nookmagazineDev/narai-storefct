import React, { useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Loader2, Save, ChevronLeft, RotateCcw, AlertTriangle } from 'lucide-react';
import { kitchenCall, todayYmd, formatQty } from '../../services/kitchenService';
import { MIN_QTY, round3, toStockQty } from '../../services/qcrdService';

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const inputCls = 'bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-amber-500/60 disabled:opacity-50';

/**
 * ฟอร์มผลิตตามสูตร BOM — ใช้ทั้งหน้า "สั่งผลิต" (ออกคำสั่งใหม่) และปุ่มดินสอในหน้ารายการสั่งผลิต
 * (บันทึกต่อบนคำสั่งผลิตที่มีอยู่แล้ว)
 *
 * แสดงสูตร BOM คูณตามจำนวนสูตร ให้กรอกยอดใช้จริงต่อวัตถุดิบ (หน่วยเดียวกับสูตร เช่น กรัม เพราะ
 * คนครัวชั่งเป็นหน่วยนั้น) กับจำนวนที่ได้จริง แล้วบันทึกตามลำดับ
 *   1) คำสั่งผลิต — ไม่มี order: สร้างใหม่ · มี order: แก้วันที่/จำนวนสั่ง เฉพาะเมื่อเปลี่ยน
 *   2) ใบเบิกวัตถุดิบผูกกับคำสั่ง (ยอดใช้จริงแปลงเป็นหน่วยสต๊อก)
 *   3) ยอดผลิตได้ + ของเสีย
 *   4) ปิดงานเป็น "ผลิตเสร็จ" ถ้าติ๊กไว้
 *
 * office-server ไม่มี action ที่ทำทั้งหมดใน transaction เดียว จึงจำขั้นที่ผ่านแล้วไว้
 * ขั้นหลังพลาด กดบันทึกซ้ำจะทำต่อเฉพาะขั้นที่เหลือ ไม่ออกคำสั่งผลิตหรือใบเบิกซ้ำ
 *
 * @param {object} props
 * @param {object} props.menu เมนู QC/RD ({ code, key, name, groupName, yieldQty, yieldUnit })
 * @param {Array} props.lines บรรทัดสูตรจาก /api/qcrd_recipe (ว่างได้ ถ้าสินค้าไม่มีสูตรใน QC/RD)
 * @param {Array} props.stockItems stock_item สำหรับชื่อ/หน่วยสต๊อก
 * @param {object} [props.order] คำสั่งผลิตที่มีอยู่แล้ว (แถวจาก getProductionOrders)
 * @param {() => void} [props.onChangeMenu] แสดงปุ่ม "เลือกเมนูอื่น" ก่อนเริ่มบันทึก
 * @param {(summary: object) => void} props.onSaved เรียกเมื่อบันทึกครบทุกขั้น
 */
export default function RecipeRunForm({ menu, lines, stockItems, order, onChangeMenu, onSaved }) {
  const isEdit = Boolean(order);
  const baseYield = menu.yieldQty > 0 ? menu.yieldQty : 1;
  const alreadyProduced = num(order?.produced_qty);

  const [produceDate, setProduceDate] = useState(
    () => (order ? String(order.produce_date).slice(0, 10) : todayYmd()) || todayYmd()
  );
  // คำสั่งเดิม: จำนวนสูตรตั้งต้น = จำนวนสั่ง ÷ ผลผลิตต่อสูตร ยอดตามสูตรจะได้ตรงกับที่สั่งไว้
  const [batch, setBatch] = useState(() => (order ? String(round3(num(order.order_qty) / baseYield)) : '1'));
  const [actual, setActual] = useState({}); // index -> ยอดใช้จริง (หน่วยสูตร) ที่คนแก้เอง
  const [producedQty, setProducedQty] = useState('');
  const [producedTouched, setProducedTouched] = useState(false);
  const [yieldUnit, setYieldUnit] = useState(() => order?.unit || menu.yieldUnit || '');
  const [wasteQty, setWasteQty] = useState('');
  const [note, setNote] = useState('');
  // คำสั่งใหม่จากหน้าสั่งผลิตคือผลิตจบในรอบเดียว ปิดงานเลย · คำสั่งเดิมอาจแค่มาแก้จำนวน อย่าปิดให้เอง
  const [closeOrder, setCloseOrder] = useState(() => !order);
  // คำสั่งที่เบิกวัตถุดิบไปแล้ว ตั้งต้นให้ไม่ลงใบเบิกซ้ำ — เบิกเพิ่มได้โดยเอาติ๊กออก
  const [skipIssue, setSkipIssue] = useState(() => num(order?.issue_count) > 0);

  const [saving, setSaving] = useState(false);
  // orderId มีตั้งแต่ต้นถ้าเป็นคำสั่งเดิม แต่ "orderSaved" ต้องผ่านขั้นแก้คำสั่งก่อน
  const [progress, setProgress] = useState(() => (order
    ? { orderId: order.order_id, docNo: order.doc_no }
    : {}));

  const stockByKey = useMemo(
    () => new Map((stockItems || []).map((it) => [it.item_key, it])),
    [stockItems]
  );

  const mult = num(batch) > 0 ? num(batch) : 0;
  const expectedYield = round3(baseYield * mult);
  // คำสั่งเดิม: ค่าตั้งต้นของ "ได้จริง" คือส่วนที่ยังขาด ไม่ใช่ทั้งหมด (เคยบันทึกไปบางส่วนแล้ว)
  const defaultProduced = Math.max(round3(expectedYield - alreadyProduced), 0);
  const producedValue = producedTouched ? producedQty : (defaultProduced ? String(defaultProduced) : '');

  const rows = useMemo(() => lines.map((l, idx) => {
    const stock = stockByKey.get(l.itemKey);
    const standard = round3((l.qty || 0) * mult);
    const used = actual[idx] !== undefined ? actual[idx] : String(standard);
    const usedNum = num(used);
    const stockQty = toStockQty(usedNum, l.converter);
    return {
      ...l,
      idx,
      stock,
      standard,
      used,
      usedNum,
      stockQty,
      stockUnit: stock?.unit || l.purchaseUnit || '',
      diff: usedNum - standard,
      tooSmall: usedNum > 0 && stockQty < MIN_QTY,
    };
  }), [lines, stockByKey, actual, mult]);

  // บรรทัดที่จะลงใบเบิก: ใช้จริงมากกว่า 0 ไม่ใช่ "ไม่ตัด BOM" และแปลงแล้วไม่เป็น 0
  const issueRows = skipIssue ? [] : rows.filter((r) => !r.noDeduct && r.usedNum > 0 && !r.tooSmall && r.itemKey);
  const tooSmallRows = rows.filter((r) => !r.noDeduct && r.tooSmall);

  const orderChanged = isEdit && (
    produceDate !== String(order.produce_date).slice(0, 10)
    || Math.abs(expectedYield - num(order.order_qty)) > 1e-9
    || yieldUnit !== (order.unit || '')
  );
  // เริ่มบันทึกไปแล้วบางขั้น = ล็อกช่องที่ขั้นนั้นใช้ กันยอดในจอไม่ตรงกับที่บันทึกไปแล้ว
  const started = isEdit ? Boolean(progress.orderSaved || progress.issueDoc || progress.runDone) : Boolean(progress.orderId);
  const lockOrder = isEdit ? Boolean(progress.orderSaved) : started;

  const save = async () => {
    const qtyProduced = num(producedValue);
    if (!(mult > 0)) { toast.error('จำนวนสูตรต้องมากกว่า 0'); return; }
    if (qtyProduced < 0 || num(wasteQty) < 0) { toast.error('จำนวนติดลบไม่ได้'); return; }
    if (!isEdit) {
      if (qtyProduced <= 0) { toast.error('ใส่จำนวนที่ผลิตได้'); return; }
      if (issueRows.length === 0) { toast.error('ไม่มีวัตถุดิบที่ใช้จริง — ใส่ยอดใช้จริงอย่างน้อยหนึ่งรายการ'); return; }
    } else if (!orderChanged && issueRows.length === 0 && qtyProduced <= 0 && !closeOrder) {
      toast.error('ไม่มีอะไรเปลี่ยน — ใส่ยอดใช้จริง จำนวนที่ได้ หรือแก้จำนวนสั่งก่อน');
      return;
    }

    const next = { ...progress };
    setSaving(true);
    try {
      if (!isEdit && !next.orderId) {
        const res = await kitchenCall('saveProductionOrder', {
          produceDate,
          productKey: menu.key,
          productCode: menu.code,
          productName: menu.name,
          orderQty: expectedYield,
          unit: yieldUnit,
          note: `ผลิตตามสูตร QC/RD ${menu.code} ×${mult}${note ? ` · ${note}` : ''}`,
        });
        if (!res.orderId) throw new Error('สร้างคำสั่งผลิตแล้วแต่ไม่ได้เลขคำสั่งกลับมา — ตรวจที่หน้ารายการสั่งผลิตก่อนกดซ้ำ');
        next.orderId = res.orderId;
        next.docNo = res.docNo;
        next.orderSaved = true;
        setProgress({ ...next });
      }

      if (isEdit && !next.orderSaved) {
        if (orderChanged) {
          await kitchenCall('saveProductionOrder', {
            orderId: order.order_id,
            produceDate,
            productKey: order.product_key,
            productCode: order.product_code,
            productName: order.product_name,
            orderQty: expectedYield,
            unit: yieldUnit,
            note: order.note || '',
          });
        }
        next.orderSaved = true;
        setProgress({ ...next });
      }

      if (issueRows.length > 0 && !next.issueDoc) {
        const res = await kitchenCall('saveMaterialIssue', {
          issueDate: produceDate,
          orderId: next.orderId,
          items: issueRows.map((r) => ({
            itemKey: r.itemKey,
            code: r.stock?.item_code || r.itemCode,
            name: r.stock?.item_name || r.itemName,
            qty: r.stockQty,
            unit: r.stockUnit,
            note: `ใช้จริง ${formatQty(r.usedNum)} ${r.useUnit || ''} (สูตร ${formatQty(r.standard)})`.slice(0, 500),
          })),
        });
        next.issueDoc = res.docNo;
        setProgress({ ...next });
      }

      if (qtyProduced > 0 && !next.runDone) {
        await kitchenCall('saveProductionRun', {
          orderId: next.orderId,
          produceDate,
          qtyProduced,
          qtyWaste: num(wasteQty),
          unit: yieldUnit,
          note,
        });
        next.runDone = true;
        setProgress({ ...next });
      }

      if (closeOrder && !next.closed) {
        await kitchenCall('updateProductionOrderStatus', { orderId: next.orderId, status: 'ผลิตเสร็จ' });
        next.closed = true;
        setProgress({ ...next });
      }

      toast.success(`บันทึกการผลิต ${menu.name} แล้ว`);
      onSaved({
        docNo: next.docNo,
        issueDoc: next.issueDoc || '',
        issueCount: issueRows.length,
        produced: qtyProduced,
        unit: yieldUnit,
        closed: Boolean(next.closed),
      });
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <section className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-lg text-slate-100 font-semibold">{menu.name}</div>
            <div className="text-[11px] text-slate-500">
              {menu.code}{menu.groupName ? ` · ${menu.groupName}` : ''}
              {lines.length > 0
                ? <>{' · '}สูตร 1 ชุด ได้ {formatQty(baseYield)} {menu.yieldUnit || '(ไม่ระบุหน่วย)'}</>
                : ' · ไม่มีสูตรใน QC/RD'}
            </div>
            {isEdit && (
              <div className="text-[11px] text-slate-400 mt-1">
                คำสั่ง <span className="font-mono">{order.doc_no}</span> · สั่ง {formatQty(order.order_qty)} {order.unit || ''}
                {' · '}ผลิตแล้ว {formatQty(alreadyProduced)} · {order.status}
              </div>
            )}
          </div>
          {onChangeMenu && !started && (
            <button onClick={onChangeMenu} className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200">
              <ChevronLeft className="w-3.5 h-3.5" /> เลือกเมนูอื่น
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="block text-[11px] text-slate-500 mb-1">วันที่ผลิต</label>
            <input type="date" value={produceDate} disabled={lockOrder}
              onChange={(e) => setProduceDate(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className="block text-[11px] text-slate-500 mb-1">
              {lines.length > 0 ? 'ผลิตกี่สูตร' : 'จำนวนสั่งผลิต'}
            </label>
            <input type="number" min="0" step="any" value={batch} disabled={lockOrder}
              onChange={(e) => { setBatch(e.target.value); setActual({}); }}
              className={`${inputCls} w-28 text-right`} />
          </div>
          {lines.length > 0 && (
            <div className="text-xs text-slate-400 pb-2">
              {isEdit ? 'จำนวนสั่ง' : 'ตามสูตรควรได้'} <span className="text-slate-100 font-medium">{formatQty(expectedYield)}</span> {yieldUnit}
              {orderChanged && <span className="text-amber-300"> · จะแก้คำสั่งจาก {formatQty(order.order_qty)}</span>}
            </div>
          )}
        </div>
      </section>

      <section className="bg-slate-900/60 border border-slate-800 rounded-xl overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-slate-800">
          <h2 className="text-sm font-semibold text-slate-200">สูตร BOM · วัตถุดิบที่ใช้</h2>
          <div className="flex items-center gap-4">
            {isEdit && lines.length > 0 && (
              <label className="flex items-center gap-1.5 text-[11px] text-slate-400">
                <input type="checkbox" className="accent-amber-500" checked={skipIssue}
                  disabled={Boolean(progress.issueDoc)} onChange={(e) => setSkipIssue(e.target.checked)} />
                ไม่ลงใบเบิกวัตถุดิบรอบนี้
              </label>
            )}
            <button
              onClick={() => setActual({})}
              disabled={Boolean(progress.issueDoc) || skipIssue}
              className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-200 disabled:opacity-40"
            >
              <RotateCcw className="w-3 h-3" /> ใช้ยอดตามสูตรทั้งหมด
            </button>
          </div>
        </div>
        {isEdit && num(order.issue_count) > 0 && (
          <div className="flex items-start gap-1.5 px-4 py-2 border-b border-slate-800 text-[11px] text-amber-300 bg-amber-500/5">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            คำสั่งนี้เบิกวัตถุดิบไปแล้ว {order.issue_count} รายการ — ถ้าจะเบิกเพิ่ม เอาติ๊ก "ไม่ลงใบเบิกวัตถุดิบรอบนี้" ออก แล้วใส่เฉพาะยอดที่ใช้เพิ่ม
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead className="bg-slate-900 text-slate-400 text-xs">
              <tr>
                <th className="text-left px-4 py-2 font-medium">วัตถุดิบ</th>
                <th className="text-right px-4 py-2 font-medium">ตามสูตร</th>
                <th className="text-right px-4 py-2 font-medium">ใช้จริง</th>
                <th className="text-right px-4 py-2 font-medium">ต่างจากสูตร</th>
                <th className="text-right px-4 py-2 font-medium">ลงใบเบิก (หน่วยสต๊อก)</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-500">สินค้านี้ยังไม่มีสูตรใน QC/RD — บันทึกได้เฉพาะจำนวนที่ได้</td></tr>
              ) : rows.map((r) => {
                const off = r.noDeduct || skipIssue;
                return (
                  <tr key={r.idx} className={`border-t border-slate-800/70 ${off ? 'opacity-50' : ''}`}>
                    <td className="px-4 py-2">
                      <div className="text-slate-200">{r.stock?.item_name || r.itemName}</div>
                      <div className="text-[11px] text-slate-500 flex flex-wrap gap-x-2">
                        <span>{r.itemCode}</span>
                        {!r.stock && <span className="text-amber-400">ไม่มีในทะเบียนสต๊อก</span>}
                        {r.noDeduct && <span>ไม่ตัด BOM · ไม่ลงใบเบิก</span>}
                      </div>
                    </td>
                    <td className="px-4 py-2 text-right text-slate-400 whitespace-nowrap">
                      {formatQty(r.standard)} <span className="text-slate-600">{r.useUnit}</span>
                    </td>
                    <td className="px-4 py-2 text-right whitespace-nowrap">
                      <input
                        type="number" min="0" step="any"
                        value={r.used}
                        disabled={off || Boolean(progress.issueDoc)}
                        onChange={(e) => setActual({ ...actual, [r.idx]: e.target.value })}
                        className="w-28 bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-sm text-right text-slate-100 focus:outline-none focus:border-amber-500/60 disabled:opacity-50"
                      />
                      <span className="ml-1.5 text-[11px] text-slate-500 inline-block w-10 text-left">{r.useUnit}</span>
                    </td>
                    <td className={`px-4 py-2 text-right text-xs whitespace-nowrap ${
                      Math.abs(r.diff) < 1e-9 ? 'text-slate-600' : r.diff > 0 ? 'text-rose-300' : 'text-sky-300'}`}>
                      {Math.abs(r.diff) < 1e-9 ? '—' : `${r.diff > 0 ? '+' : ''}${formatQty(r.diff)}`}
                      {r.standard > 0 && Math.abs(r.diff) >= 1e-9 && (
                        <span className="text-slate-500"> ({r.diff > 0 ? '+' : ''}{Math.round((r.diff / r.standard) * 100)}%)</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right whitespace-nowrap">
                      {off ? <span className="text-slate-600">—</span>
                        : r.tooSmall ? <span className="text-[11px] text-rose-300">น้อยเกินบันทึก</span>
                        : <span className="text-slate-200">{formatQty(r.stockQty)} <span className="text-slate-500">{r.stockUnit}</span></span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {tooSmallRows.length > 0 && !skipIssue && (
          <div className="flex items-start gap-1.5 px-4 py-2 border-t border-slate-800 text-[11px] text-rose-300">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            {tooSmallRows.length} รายการน้อยกว่า 0.001 หน่วยสต๊อก จะไม่ลงใบเบิก (ตารางเก็บทศนิยม 3 ตำแหน่ง)
          </div>
        )}
      </section>

      <section className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 space-y-4">
        <h2 className="text-sm font-semibold text-slate-200">ผลผลิต</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <label className="block text-[11px] text-slate-500 mb-1">
              จำนวนที่ได้จริง{isEdit && alreadyProduced > 0 ? ' (รอบนี้)' : ''}
            </label>
            <input type="number" min="0" step="any" value={producedValue} disabled={progress.runDone}
              onChange={(e) => { setProducedTouched(true); setProducedQty(e.target.value); }}
              className={`${inputCls} w-full text-right`} />
          </div>
          <div>
            <label className="block text-[11px] text-slate-500 mb-1">หน่วย</label>
            <input type="text" value={yieldUnit} disabled={lockOrder}
              onChange={(e) => setYieldUnit(e.target.value)} placeholder="กก. / ถุง / ถาด"
              className={`${inputCls} w-full`} />
          </div>
          <div>
            <label className="block text-[11px] text-slate-500 mb-1">ของเสีย</label>
            <input type="number" min="0" step="any" value={wasteQty} disabled={progress.runDone}
              onChange={(e) => setWasteQty(e.target.value)} placeholder="0"
              className={`${inputCls} w-full text-right`} />
          </div>
          <div className="flex items-end pb-2 text-xs">
            {expectedYield > 0 && (num(producedValue) + alreadyProduced) > 0 && (
              <span className={(num(producedValue) + alreadyProduced) < expectedYield ? 'text-amber-300' : 'text-emerald-300'}>
                รวม {formatQty(num(producedValue) + alreadyProduced)} = {Math.round(((num(producedValue) + alreadyProduced) / expectedYield) * 100)}% ของที่สั่ง
              </span>
            )}
          </div>
        </div>
        <div>
          <label className="block text-[11px] text-slate-500 mb-1">หมายเหตุ</label>
          <input type="text" value={note} disabled={started}
            onChange={(e) => setNote(e.target.value)} className={`${inputCls} w-full`} />
        </div>
        <label className="flex items-center gap-2 text-xs text-slate-400">
          <input type="checkbox" className="accent-amber-500" checked={closeOrder} disabled={progress.closed}
            onChange={(e) => setCloseOrder(e.target.checked)} />
          ปิดงานเป็น "ผลิตเสร็จ" ทันที (ไม่ติ๊ก = ถ้าได้น้อยกว่าที่สั่ง คำสั่งจะค้างเป็น "กำลังผลิต")
        </label>

        {started && (
          <div className="text-[11px] text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">
            บันทึกไปแล้วบางขั้น: คำสั่งผลิต {progress.docNo}
            {progress.issueDoc ? ` · ใบเบิก ${progress.issueDoc}` : ''}
            {progress.runDone ? ' · ยอดผลิต' : ''} — กดบันทึกอีกครั้งเพื่อทำขั้นที่เหลือ (ไม่ออกเอกสารซ้ำ)
          </div>
        )}

        <div className="flex justify-end">
          <button
            onClick={save}
            disabled={saving || (!isEdit && rows.length === 0)}
            className="flex items-center gap-1.5 px-5 py-2.5 rounded-lg text-sm font-semibold bg-amber-500 text-slate-950 hover:bg-amber-400 disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            บันทึกการผลิต
          </button>
        </div>
      </section>
    </div>
  );
}
