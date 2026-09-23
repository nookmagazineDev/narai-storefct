import React, { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import {
  ChefHat, Loader2, Save, ChevronLeft, RotateCcw, CheckCircle2, AlertTriangle,
} from 'lucide-react';
import { kitchenCall, todayYmd, formatQty } from '../../services/kitchenService';
import { MIN_QTY, round3, toStockQty, fetchQcrdRecipe } from '../../services/qcrdService';
import QcrdMenuPicker from '../../components/kitchen/QcrdMenuPicker';

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const inputCls = 'bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-amber-500/60 disabled:opacity-50';

/**
 * สั่งผลิต — เลือกเมนูจาก QC/RD แล้วผลิตตามสูตร BOM
 *
 * หน้านี้บันทึกการผลิตหนึ่งครั้งจบในที่เดียว: คนครัวเห็นยอดตามสูตร กรอกยอดที่ใช้จริง
 * กับจำนวนที่ได้จริง แล้วกดบันทึกครั้งเดียว ระบบออกเอกสารให้สามใบตามลำดับ
 *   1) คำสั่งผลิต (saveProductionOrder) — จำนวนสั่ง = ผลผลิตที่สูตรบอกว่าควรได้
 *   2) ใบเบิกวัตถุดิบผูกกับคำสั่งนั้น (saveMaterialIssue) — ยอด "ใช้จริง" แปลงเป็นหน่วยสต๊อก
 *   3) บันทึกผลิตได้ (saveProductionRun) — ยอด "ได้จริง" + ของเสีย
 * แล้วปิดงานเป็น "ผลิตเสร็จ" ถ้าติ๊กไว้ (ไม่งั้นได้น้อยกว่าสูตรจะค้างเป็น "กำลังผลิต")
 *
 * office-server ไม่มี action ที่ทำทั้งหมดใน transaction เดียว จึงยิงทีละขั้นและจำว่าขั้นไหนผ่านแล้ว
 * ขั้นหลังพลาด กดบันทึกซ้ำจะทำต่อเฉพาะขั้นที่ยังไม่ผ่าน ไม่ออกคำสั่งผลิตหรือใบเบิกซ้ำ
 *
 * ยอดใช้จริงกรอกเป็นหน่วยเดียวกับสูตร (กรัม/มล.) เพราะคนครัวชั่งเป็นหน่วยนั้น
 * แต่ใบเบิกลงเป็นหน่วยสต๊อก (กก./ถุง) ให้ตรงกับหน้าวัตถุดิบคงเหลือ
 */
export default function ProduceByRecipe() {
  const [stockItems, setStockItems] = useState([]);
  const [picked, setPicked] = useState(null); // { menu, lines }
  const [pickLoading, setPickLoading] = useState(false);

  const [produceDate, setProduceDate] = useState(todayYmd());
  const [batch, setBatch] = useState('1');
  const [actual, setActual] = useState({}); // index -> ยอดใช้จริง (หน่วยสูตร) ที่คนแก้เอง
  const [producedQty, setProducedQty] = useState('');
  const [producedTouched, setProducedTouched] = useState(false);
  const [yieldUnit, setYieldUnit] = useState('');
  const [wasteQty, setWasteQty] = useState('');
  const [note, setNote] = useState('');
  const [closeOrder, setCloseOrder] = useState(true);

  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState({}); // { orderId, docNo, issueDoc, runDone, closed }
  const [done, setDone] = useState(false);

  useEffect(() => {
    kitchenCall('getKitchenItems')
      .then((res) => setStockItems(res.items || []))
      .catch((err) => toast.error(err.message));
  }, []);

  const stockByKey = useMemo(() => new Map(stockItems.map((it) => [it.item_key, it])), [stockItems]);

  const reset = () => {
    setPicked(null);
    setBatch('1');
    setActual({});
    setProducedQty('');
    setProducedTouched(false);
    setWasteQty('');
    setNote('');
    setProgress({});
    setDone(false);
  };

  const pick = async (menu) => {
    setPickLoading(true);
    try {
      const res = await fetchQcrdRecipe(menu.code);
      reset();
      setPicked({ menu: res.menu, lines: res.lines || [] });
      setYieldUnit(res.menu.yieldUnit || '');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setPickLoading(false);
    }
  };

  const mult = num(batch) > 0 ? num(batch) : 0;
  const expectedYield = picked ? round3((picked.menu.yieldQty > 0 ? picked.menu.yieldQty : 1) * mult) : 0;
  const producedValue = producedTouched ? producedQty : (expectedYield ? String(expectedYield) : '');

  const rows = useMemo(() => {
    if (!picked) return [];
    return picked.lines.map((l, idx) => {
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
    });
  }, [picked, stockByKey, actual, mult]);

  // บรรทัดที่จะลงใบเบิก: ใช้จริงมากกว่า 0 ไม่ใช่ "ไม่ตัด BOM" และแปลงแล้วไม่เป็น 0
  const issueRows = rows.filter((r) => !r.noDeduct && r.usedNum > 0 && !r.tooSmall && r.itemKey);
  const tooSmallRows = rows.filter((r) => !r.noDeduct && r.tooSmall);
  const started = Boolean(progress.orderId);

  const save = async () => {
    const qtyProduced = num(producedValue);
    if (!(mult > 0)) { toast.error('จำนวนสูตรต้องมากกว่า 0'); return; }
    if (qtyProduced <= 0) { toast.error('ใส่จำนวนที่ผลิตได้'); return; }
    if (num(wasteQty) < 0) { toast.error('ของเสียติดลบไม่ได้'); return; }
    if (issueRows.length === 0) { toast.error('ไม่มีวัตถุดิบที่ใช้จริง — ใส่ยอดใช้จริงอย่างน้อยหนึ่งรายการ'); return; }

    const { menu } = picked;
    const next = { ...progress };
    setSaving(true);
    try {
      if (!next.orderId) {
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
        setProgress({ ...next });
      }

      if (!next.issueDoc) {
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

      if (!next.runDone) {
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
      setDone(true);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-4 md:p-6 space-y-5">
      <header>
        <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2">
          <ChefHat className="w-5 h-5 text-amber-400" />
          สั่งผลิต
        </h1>
        <p className="text-xs text-slate-500 mt-0.5">
          เลือกเมนูจาก QC/RD เพื่อดูสูตร BOM · กรอกยอดใช้จริงและจำนวนที่ได้ · บันทึกครั้งเดียวได้ทั้งคำสั่งผลิต ใบเบิกวัตถุดิบ และยอดผลิต
        </p>
      </header>

      {!picked ? (
        <section className="bg-slate-900/60 border border-slate-800 rounded-xl p-4">
          <h2 className="text-sm font-semibold text-slate-200 mb-3">เลือกเมนูที่จะผลิต</h2>
          <QcrdMenuPicker onPick={pick} disabled={pickLoading} listClassName="max-h-[60vh]" />
        </section>
      ) : done ? (
        <section className="bg-slate-900/60 border border-emerald-500/30 rounded-xl p-6 space-y-4">
          <div className="flex items-center gap-2 text-emerald-300 font-semibold">
            <CheckCircle2 className="w-5 h-5" /> บันทึกการผลิต {picked.menu.name} แล้ว
          </div>
          <ul className="text-sm text-slate-300 space-y-1">
            <li>คำสั่งผลิต <span className="font-mono text-slate-100">{progress.docNo}</span> · ได้ {formatQty(producedValue)} {yieldUnit}{progress.closed ? ' · ปิดงานแล้ว' : ''}</li>
            <li>ใบเบิกวัตถุดิบ <span className="font-mono text-slate-100">{progress.issueDoc}</span> · {issueRows.length} รายการ</li>
          </ul>
          <button
            onClick={reset}
            className="px-4 py-2 rounded-lg text-xs font-semibold bg-amber-500 text-slate-950 hover:bg-amber-400"
          >
            ผลิตเมนูอื่น
          </button>
        </section>
      ) : (
        <>
          <section className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-lg text-slate-100 font-semibold">{picked.menu.name}</div>
                <div className="text-[11px] text-slate-500">
                  {picked.menu.code}{picked.menu.groupName ? ` · ${picked.menu.groupName}` : ''}
                  {' · '}สูตร 1 ชุด ได้ {formatQty(picked.menu.yieldQty || 1)} {picked.menu.yieldUnit || '(ไม่ระบุหน่วย)'}
                </div>
              </div>
              {!started && (
                <button onClick={reset} className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200">
                  <ChevronLeft className="w-3.5 h-3.5" /> เลือกเมนูอื่น
                </button>
              )}
            </div>

            <div className="flex flex-wrap items-end gap-4">
              <div>
                <label className="block text-[11px] text-slate-500 mb-1">วันที่ผลิต</label>
                <input type="date" value={produceDate} disabled={started}
                  onChange={(e) => setProduceDate(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className="block text-[11px] text-slate-500 mb-1">ผลิตกี่สูตร</label>
                <input type="number" min="0" step="any" value={batch} disabled={started}
                  onChange={(e) => { setBatch(e.target.value); setActual({}); }}
                  className={`${inputCls} w-28 text-right`} />
              </div>
              <div className="text-xs text-slate-400 pb-2">
                ตามสูตรควรได้ <span className="text-slate-100 font-medium">{formatQty(expectedYield)}</span> {picked.menu.yieldUnit}
              </div>
            </div>
          </section>

          <section className="bg-slate-900/60 border border-slate-800 rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
              <h2 className="text-sm font-semibold text-slate-200">สูตร BOM · วัตถุดิบที่ใช้</h2>
              <button
                onClick={() => setActual({})}
                disabled={Boolean(progress.issueDoc)}
                className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-200 disabled:opacity-40"
              >
                <RotateCcw className="w-3 h-3" /> ใช้ยอดตามสูตรทั้งหมด
              </button>
            </div>
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
                    <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-500">เมนูนี้ยังไม่มีสูตรใน QC/RD</td></tr>
                  ) : rows.map((r) => (
                    <tr key={r.idx} className={`border-t border-slate-800/70 ${r.noDeduct ? 'opacity-50' : ''}`}>
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
                          disabled={r.noDeduct || Boolean(progress.issueDoc)}
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
                        {r.noDeduct ? <span className="text-slate-600">—</span>
                          : r.tooSmall ? <span className="text-[11px] text-rose-300">น้อยเกินบันทึก</span>
                          : <span className="text-slate-200">{formatQty(r.stockQty)} <span className="text-slate-500">{r.stockUnit}</span></span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {tooSmallRows.length > 0 && (
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
                <label className="block text-[11px] text-slate-500 mb-1">จำนวนที่ได้จริง</label>
                <input type="number" min="0" step="any" value={producedValue} disabled={progress.runDone}
                  onChange={(e) => { setProducedTouched(true); setProducedQty(e.target.value); }}
                  className={`${inputCls} w-full text-right`} />
              </div>
              <div>
                <label className="block text-[11px] text-slate-500 mb-1">หน่วย</label>
                <input type="text" value={yieldUnit} disabled={started}
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
                {expectedYield > 0 && num(producedValue) > 0 && (
                  <span className={num(producedValue) < expectedYield ? 'text-amber-300' : 'text-emerald-300'}>
                    {Math.round((num(producedValue) / expectedYield) * 100)}% ของที่สูตรควรได้
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
              ปิดงานเป็น "ผลิตเสร็จ" ทันที (ไม่ติ๊ก = ถ้าได้น้อยกว่าสูตร คำสั่งจะค้างเป็น "กำลังผลิต")
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
                disabled={saving || rows.length === 0}
                className="flex items-center gap-1.5 px-5 py-2.5 rounded-lg text-sm font-semibold bg-amber-500 text-slate-950 hover:bg-amber-400 disabled:opacity-50"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                บันทึกการผลิต
              </button>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
