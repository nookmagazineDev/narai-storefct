import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { BookOpen, Plus, Pencil, Trash2, Loader2, Save, X, RefreshCw, Download, AlertTriangle } from 'lucide-react';
import { kitchenCall, formatQty } from '../../services/kitchenService';
import ItemPicker from '../../components/kitchen/ItemPicker';
import QcrdMenuImport from '../../components/kitchen/QcrdMenuImport';

const emptyDraft = () => ({
  recipeId: null,
  productKey: '',
  productCode: '',
  productName: '',
  yieldQty: '1',
  yieldUnit: '',
  note: '',
  isActive: true,
  items: [],
});

/**
 * รายการสูตรการผลิต
 *
 * สูตรหนึ่งผูกกับสินค้าหนึ่งตัว และบอกว่า "ทำได้ครั้งละเท่าไหร่ (yield) ใช้วัตถุดิบอะไรบ้าง"
 * จำนวนวัตถุดิบเก็บเป็นต่อหนึ่ง yield ไม่ใช่ต่อหนึ่งหน่วย — หน้าเบิกวัตถุดิบเอาไปคูณตามสัดส่วนเอง
 */
export default function RecipeList() {
  const [recipes, setRecipes] = useState([]);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState(null);
  const [importing, setImporting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [recipeRes, itemRes] = await Promise.all([
        kitchenCall('getKitchenRecipes', { includeInactive: true }),
        kitchenCall('getKitchenItems'),
      ]);
      setRecipes(recipeRes.recipes || []);
      setItems(itemRes.items || []);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openNew = () => setDraft(emptyDraft());

  const openEdit = async (recipe) => {
    try {
      const res = await kitchenCall('getKitchenRecipe', { recipeId: recipe.recipe_id });
      if (!res.recipe) { toast.error('ไม่พบสูตรนี้แล้ว'); return; }
      setDraft({
        recipeId: res.recipe.recipe_id,
        productKey: res.recipe.product_key,
        productCode: res.recipe.product_code,
        productName: res.recipe.product_name,
        yieldQty: String(res.recipe.yield_qty),
        yieldUnit: res.recipe.yield_unit || '',
        note: res.recipe.note || '',
        isActive: Boolean(res.recipe.is_active),
        items: (res.items || []).map((it) => ({
          itemKey: it.item_key,
          code: it.item_code,
          name: it.item_name,
          qty: String(it.qty),
          unit: it.unit || '',
          note: it.note || '',
        })),
      });
    } catch (err) {
      toast.error(err.message);
    }
  };

  const removeRecipe = async (recipe) => {
    if (!window.confirm(`ลบสูตร "${recipe.product_name}" ใช่ไหม? ประวัติการผลิตที่ผ่านมาจะยังอยู่`)) return;
    try {
      const res = await kitchenCall('deleteKitchenRecipe', { recipeId: recipe.recipe_id });
      toast.success(res.message);
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const save = async () => {
    if (!draft.productKey) { toast.error('เลือกสินค้าที่ผลิตก่อน'); return; }
    if (Number(draft.yieldQty) <= 0) { toast.error('จำนวนที่ผลิตได้ต่อสูตร ต้องมากกว่า 0'); return; }
    const lines = draft.items.filter((it) => Number(it.qty) > 0);
    if (lines.length === 0) { toast.error('ใส่วัตถุดิบอย่างน้อยหนึ่งรายการ'); return; }

    setSaving(true);
    try {
      const res = await kitchenCall('saveKitchenRecipe', {
        productKey: draft.productKey,
        productCode: draft.productCode,
        productName: draft.productName,
        yieldQty: Number(draft.yieldQty),
        yieldUnit: draft.yieldUnit,
        note: draft.note,
        isActive: draft.isActive,
        items: lines.map((it) => ({
          itemKey: it.itemKey, code: it.code, name: it.name,
          qty: Number(it.qty), unit: it.unit, note: it.note || '',
        })),
      });
      toast.success(res.message);
      setDraft(null);
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const stockByKey = useMemo(() => new Map(items.map((it) => [it.item_key, it])), [items]);

  // สินค้าจากเมนู QC/RD ไม่ได้อยู่ใน stock_item — ถ้ารหัสเมนูไปชนรหัสวัตถุดิบที่ชื่อไม่ตรงกัน
  // ยอดผลิตจะไปบวกคงเหลือของวัตถุดิบตัวนั้น ต้องเตือนก่อนบันทึก
  const productClash = useMemo(() => {
    if (!draft?.productKey) return null;
    const hit = stockByKey.get(draft.productKey);
    if (!hit || String(hit.item_name).trim() === String(draft.productName).trim()) return null;
    return hit;
  }, [draft, stockByKey]);

  const usedKeys = useMemo(
    () => new Set((draft?.items || []).map((it) => it.itemKey)),
    [draft]
  );

  return (
    <div className="p-4 md:p-6 space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-purple-400" />
            รายการสูตรการผลิต
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            สูตรบอกว่าผลิตหนึ่งชุดได้เท่าไหร่ และใช้วัตถุดิบอะไรบ้าง · ใช้คำนวณใบเบิกวัตถุดิบให้อัตโนมัติ
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setImporting(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs bg-slate-800 text-purple-300 hover:bg-slate-700 border border-purple-500/40"
          >
            <Download className="w-3.5 h-3.5" /> ดึงจากเมนู QC/RD
          </button>
          <button
            onClick={load}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700"
          >
            <RefreshCw className="w-3.5 h-3.5" /> รีเฟรช
          </button>
          <button
            onClick={openNew}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold bg-purple-500 text-slate-950 hover:bg-purple-400"
          >
            <Plus className="w-3.5 h-3.5" /> เพิ่มสูตรใหม่
          </button>
        </div>
      </header>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-slate-500 gap-2">
          <Loader2 className="w-5 h-5 animate-spin text-purple-400" /> กำลังโหลดสูตร...
        </div>
      ) : recipes.length === 0 ? (
        <div className="py-20 text-center text-slate-500 text-sm">
          ยังไม่มีสูตรการผลิต — กด "ดึงจากเมนู QC/RD" หรือ "เพิ่มสูตรใหม่" เพื่อเริ่ม
        </div>
      ) : (
        <div className="bg-slate-900/60 border border-slate-800 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-900 text-slate-400 text-xs">
              <tr>
                <th className="text-left px-4 py-3 font-medium">สินค้าที่ผลิต</th>
                <th className="text-right px-4 py-3 font-medium">ได้ครั้งละ</th>
                <th className="text-center px-4 py-3 font-medium">วัตถุดิบ</th>
                <th className="text-center px-4 py-3 font-medium">สถานะ</th>
                <th className="text-right px-4 py-3 font-medium">แก้ไขล่าสุด</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {recipes.map((r) => (
                <tr key={r.recipe_id} className="border-t border-slate-800/70 hover:bg-slate-800/30">
                  <td className="px-4 py-3">
                    <div className="text-slate-200">{r.product_name}</div>
                    <div className="text-[11px] text-slate-500">{r.product_code}</div>
                  </td>
                  <td className="px-4 py-3 text-right text-slate-300">
                    {formatQty(r.yield_qty)} <span className="text-slate-500">{r.yield_unit || ''}</span>
                  </td>
                  <td className="px-4 py-3 text-center text-slate-400">{r.item_count} รายการ</td>
                  <td className="px-4 py-3 text-center">
                    {r.is_active ? (
                      <span className="text-[11px] px-2 py-0.5 rounded border bg-emerald-500/15 text-emerald-300 border-emerald-500/30">ใช้งาน</span>
                    ) : (
                      <span className="text-[11px] px-2 py-0.5 rounded border bg-slate-600/20 text-slate-400 border-slate-600/40">ปิดใช้</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right text-[11px] text-slate-500">
                    {r.updated_by || '-'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => openEdit(r)}
                        className="p-1.5 rounded text-slate-400 hover:text-amber-300 hover:bg-slate-800"
                        title="แก้ไขสูตร"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => removeRecipe(r)}
                        className="p-1.5 rounded text-slate-400 hover:text-rose-300 hover:bg-slate-800"
                        title="ลบสูตร"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {draft && (
        <div className="fixed inset-0 z-40 bg-black/70 flex items-start justify-center overflow-y-auto p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-3xl my-8 shadow-2xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
              <h2 className="font-semibold text-slate-100">
                {draft.recipeId ? 'แก้ไขสูตร' : draft.fromQcrd ? 'สูตรใหม่จากเมนู QC/RD' : 'สูตรใหม่'}
              </h2>
              <button onClick={() => setDraft(null)} className="p-1 text-slate-500 hover:text-slate-300">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-5">
              <div>
                <label className="block text-xs text-slate-400 mb-1.5">สินค้าที่ผลิต</label>
                {draft.productKey ? (
                  <div className="flex items-center justify-between bg-slate-800/60 border border-slate-700 rounded-lg px-3 py-2">
                    <div>
                      <div className="text-sm text-slate-200">{draft.productName}</div>
                      <div className="text-[11px] text-slate-500">{draft.productCode}</div>
                    </div>
                    {/* แก้สูตรของเดิมแล้วเปลี่ยนสินค้าไม่ได้ เพราะ product_key เป็นคีย์ของสูตร
                        ถ้าจะทำสูตรของสินค้าอื่นให้สร้างสูตรใหม่ */}
                    {!draft.recipeId && (
                      <button
                        onClick={() => setDraft({ ...draft, productKey: '', productCode: '', productName: '' })}
                        className="text-[11px] text-slate-400 hover:text-slate-200"
                      >
                        เปลี่ยน
                      </button>
                    )}
                  </div>
                ) : (
                  <ItemPicker
                    items={items}
                    placeholder="ค้นหาสินค้าที่ครัวกลางผลิต..."
                    onSelect={(it) => setDraft({
                      ...draft,
                      productKey: it.item_key,
                      productCode: it.item_code,
                      productName: it.item_name,
                      yieldUnit: draft.yieldUnit || it.unit || '',
                    })}
                  />
                )}
              </div>

              {productClash && (
                <div className="flex items-start gap-2 text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>
                    รหัส {draft.productCode} ตรงกับวัตถุดิบ "{productClash.item_name}" ในทะเบียนสต๊อก
                    — ยอดที่ผลิตได้จะไปนับรวมกับวัตถุดิบตัวนั้นในหน้าคงเหลือ ตรวจให้แน่ใจว่าเป็นของชิ้นเดียวกัน
                  </span>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-400 mb-1.5">ผลิตได้ครั้งละ</label>
                  <input
                    type="number" step="0.001" min="0"
                    value={draft.yieldQty}
                    onChange={(e) => setDraft({ ...draft, yieldQty: e.target.value })}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-purple-500/60"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1.5">หน่วย</label>
                  <input
                    type="text"
                    value={draft.yieldUnit}
                    onChange={(e) => setDraft({ ...draft, yieldUnit: e.target.value })}
                    placeholder="กก. / ถุง / หม้อ"
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-purple-500/60"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs text-slate-400">
                    วัตถุดิบที่ใช้ <span className="text-slate-600">(ต่อการผลิตหนึ่งครั้ง)</span>
                  </label>
                  <span className="text-[11px] text-slate-500">{draft.items.length} รายการ</span>
                </div>

                <ItemPicker
                  items={items}
                  excludeKeys={usedKeys}
                  placeholder="เพิ่มวัตถุดิบ..."
                  onSelect={(it) => setDraft({
                    ...draft,
                    items: [...draft.items, {
                      itemKey: it.item_key, code: it.item_code, name: it.item_name,
                      qty: '', unit: it.unit || '',
                    }],
                  })}
                />

                {draft.items.length > 0 && (
                  <div className="mt-3 space-y-1.5">
                    {draft.items.map((it, idx) => (
                      <div key={it.itemKey} className="flex items-center gap-2 bg-slate-800/40 border border-slate-800 rounded-lg px-3 py-2">
                        <div className="flex-1 min-w-0">
                          <div className="text-sm text-slate-200 truncate">{it.name}</div>
                          <div className="text-[11px] text-slate-500 flex flex-wrap gap-x-2">
                            <span>{it.code}</span>
                            {it.note && <span>{it.note}</span>}
                            {!stockByKey.has(it.itemKey) && <span className="text-amber-400">ไม่มีในทะเบียนสต๊อก</span>}
                          </div>
                        </div>
                        <input
                          type="number" step="0.001" min="0"
                          value={it.qty}
                          onChange={(e) => {
                            const next = [...draft.items];
                            next[idx] = { ...next[idx], qty: e.target.value };
                            setDraft({ ...draft, items: next });
                          }}
                          placeholder="จำนวน"
                          className="w-24 bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-sm text-right text-slate-100 placeholder-slate-600 focus:outline-none focus:border-purple-500/60"
                        />
                        <input
                          type="text"
                          value={it.unit}
                          onChange={(e) => {
                            const next = [...draft.items];
                            next[idx] = { ...next[idx], unit: e.target.value };
                            setDraft({ ...draft, items: next });
                          }}
                          placeholder="หน่วย"
                          className="w-20 bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-purple-500/60"
                        />
                        <button
                          onClick={() => setDraft({ ...draft, items: draft.items.filter((_, i) => i !== idx) })}
                          className="p-1.5 text-slate-500 hover:text-rose-300"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1.5">หมายเหตุ / วิธีทำโดยย่อ</label>
                <textarea
                  rows={2}
                  value={draft.note}
                  onChange={(e) => setDraft({ ...draft, note: e.target.value })}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-purple-500/60"
                />
              </div>

              <label className="flex items-center gap-2 text-xs text-slate-400">
                <input
                  type="checkbox"
                  checked={draft.isActive}
                  onChange={(e) => setDraft({ ...draft, isActive: e.target.checked })}
                  className="accent-purple-500"
                />
                เปิดใช้งานสูตรนี้
              </label>
            </div>

            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-slate-800">
              <button
                onClick={() => setDraft(null)}
                className="px-4 py-2 rounded-lg text-xs text-slate-300 hover:bg-slate-800"
              >
                ยกเลิก
              </button>
              <button
                onClick={save}
                disabled={saving}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-purple-500 text-slate-950 hover:bg-purple-400 disabled:opacity-50"
              >
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                บันทึกสูตร
              </button>
            </div>
          </div>
        </div>
      )}

      {importing && (
        <QcrdMenuImport
          stockItems={items}
          recipes={recipes}
          onClose={() => setImporting(false)}
          onImport={(next) => { setImporting(false); setDraft(next); }}
        />
      )}
    </div>
  );
}
