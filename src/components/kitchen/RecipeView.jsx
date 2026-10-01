import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { kitchenCall, formatQty } from '../../services/kitchenService';
import { fetchQcrdRecipe, round3 } from '../../services/qcrdService';

const normKey = (v) => String(v ?? '').trim().replace(/\.0+$/, '').replace(/^0+/, '').toLowerCase();

/**
 * โหลดสูตร QC/RD ของเมนูหนึ่งตัว + ทะเบียนวัตถุดิบ + คงเหลือครัว (สองอย่างหลังเป็นคอลัมน์เสริม โหลดไม่ได้ก็แสดง "-")
 * @returns {{ recipe: object|null, error: string, items: Map, balance: Map }}
 */
export function useRecipeData(code) {
  const [recipe, setRecipe] = useState(null);
  const [error, setError] = useState('');
  const [items, setItems] = useState(() => new Map());
  const [balance, setBalance] = useState(() => new Map());

  useEffect(() => {
    let alive = true;
    setRecipe(null);
    setError('');
    fetchQcrdRecipe(code)
      .then((res) => alive && setRecipe(res))
      .catch((err) => alive && setError(err.message));
    kitchenCall('getKitchenItems')
      .then((res) => alive && setItems(new Map((res.items || []).map((it) => [normKey(it.item_key), it]))))
      .catch(() => {});
    kitchenCall('getKitchenBalance', {})
      .then((res) => alive && setBalance(new Map((res.items || []).map((r) => [normKey(r.item_key), Number(r.balance)]))))
      .catch(() => {});
    return () => { alive = false; };
  }, [code]);

  return { recipe, error, items, balance };
}

/**
 * ตารางวัตถุดิบตามสูตร — ต่อ 1 สูตร · × mult (ถ้า scaledLabel) · หน่วยสต๊อก (÷ converter) · คงเหลือครัว (ไม่พอ = แดง)
 * ใช้ทั้งป๊อปอัพเช็คสูตรของแพลนผลิต และหน้าเมนูครัวกลาง · ดูอย่างเดียว ไม่บันทึกอะไร
 */
export function RecipeTable({ data, mult = 1, scaledLabel }) {
  const { recipe, error, items, balance } = data;
  if (error) {
    return <div className="px-3 py-3 rounded-lg text-xs text-rose-300 bg-rose-500/10 border border-rose-500/30">{error}</div>;
  }
  if (!recipe) {
    return <div className="flex items-center gap-2 py-6 justify-center text-xs text-slate-500"><Loader2 className="w-3.5 h-3.5 animate-spin" /> กำลังโหลดสูตร...</div>;
  }

  const rows = (recipe.lines || []).map((l) => {
    const key = l.itemKey || normKey(l.itemCode);
    const it = items.get(key);
    const need = round3((Number(l.qty) || 0) * mult);
    const stockQty = round3(need / (Number(l.converter) || 1000));
    const bal = balance.get(key);
    return {
      key: `${l.seq}-${key}`, line: l, it, need, stockQty, bal,
      unit: it?.unit || l.purchaseUnit || '',
      short: !l.noDeduct && Number.isFinite(bal) && bal < stockQty,
    };
  });
  if (rows.length === 0) return <div className="py-6 text-center text-xs text-slate-500">เมนูนี้ยังไม่มีสูตร (BOM) ใน QC/RD</div>;
  const shortCount = rows.filter((r) => r.short).length;

  return (
    <>
      <div className="overflow-x-auto rounded-lg border border-slate-800">
        <table className="w-full text-xs">
          <thead className="bg-slate-950/60 text-slate-400">
            <tr>
              <th className="px-2.5 py-2 text-left font-medium">วัตถุดิบ</th>
              <th className="px-2.5 py-2 text-right font-medium">ต่อ 1 สูตร</th>
              {scaledLabel && <th className="px-2.5 py-2 text-right font-medium">{scaledLabel}</th>}
              <th className="px-2.5 py-2 text-right font-medium">หน่วยสต๊อก</th>
              <th className="px-2.5 py-2 text-right font-medium">คงเหลือครัว</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/70">
            {rows.map((r) => (
              <tr key={r.key} className={r.line.noDeduct ? 'opacity-50' : ''}>
                <td className="px-2.5 py-1.5">
                  <div className="text-slate-200">{r.it?.item_name || r.line.itemName}</div>
                  <div className="text-[10px] text-slate-500">
                    {r.line.itemCode}{r.line.noDeduct && ' · ไม่ตัดสต๊อก'}
                  </div>
                </td>
                <td className="px-2.5 py-1.5 text-right font-mono text-slate-400 whitespace-nowrap">{formatQty(r.line.qty)} {r.line.useUnit}</td>
                {scaledLabel && (
                  <td className="px-2.5 py-1.5 text-right font-mono text-cyan-300 whitespace-nowrap">{formatQty(r.need)} {r.line.useUnit}</td>
                )}
                <td className="px-2.5 py-1.5 text-right font-mono text-slate-200 whitespace-nowrap">{formatQty(r.stockQty)} {r.unit}</td>
                <td className={`px-2.5 py-1.5 text-right font-mono whitespace-nowrap ${r.short ? 'text-rose-300' : 'text-slate-400'}`}>
                  {Number.isFinite(r.bal) ? formatQty(r.bal) : '-'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[10px] text-slate-500">
        {shortCount > 0 && <span className="text-rose-300">คงเหลือไม่พอ {shortCount} รายการ · </span>}
        สูตรจาก QC/RD · หน่วยสต๊อก = ยอด{scaledLabel || 'ต่อ 1 สูตร'} ÷ ตัวแปลงหน่วย · คงเหลือครัว = ยอดปัจจุบันของครัวกลาง
      </p>
    </>
  );
}
