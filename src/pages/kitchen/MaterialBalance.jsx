import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Boxes, Loader2, RefreshCw, Search, AlertTriangle, Pencil, X, Save, History, ScrollText, FileSpreadsheet } from 'lucide-react';
import CountImport from '../../components/kitchen/CountImport';
import StockCard from '../../components/kitchen/StockCard';
import { DayQuick } from '../../components/kitchen/DateQuick';
import { kitchenCall, todayYmd, formatThaiDate, formatQty, formatStamp } from '../../services/kitchenService';

/**
 * วัตถุดิบคงเหลือ (ครัวกลาง)
 *
 * ไม่ได้อ่านตัวเลข "คงเหลือ" จากที่ไหน — คำนวณสดจากเหตุการณ์ทุกครั้ง:
 *
 *   คงเหลือ = ยอดนับล่าสุด + รับเข้าหลังวันนับ - เบิกไปใช้หลังวันนับ + ผลิตได้หลังวันนับ
 *
 * ตัวตั้งคือการนับจริง การนับสต๊อกรอบใหม่จึงล้างความคลาดเคลื่อนสะสมให้เอง
 * หน้านี้แสดงทุกตัวตั้งแยกกัน เพื่อให้ตรวจย้อนได้ว่าตัวเลขสุดท้ายมาจากไหน
 *
 * แก้ยอดคงเหลือ (ดินสอท้ายแถว) = บันทึกยอดนับใหม่ของสาขาครัว (saveKitchenCount → dbo.stock_count)
 * ไม่ได้ทับตัวเลข — คงเหลือเริ่มนับใหม่จากยอดนั้น และหน้านับสต๊อกของ Narai-branch เห็นยอดเดียวกัน
 *
 * กดชื่อวัตถุดิบ (หรือไอคอนสต๊อกการ์ด) = สต๊อกการ์ด ยอดยกมา + ความเคลื่อนไหวรายวันในช่วงวันที่ (components/kitchen/StockCard.jsx)
 */
export default function MaterialBalance() {
  const [asOf, setAsOf] = useState(() => todayYmd());
  const [rows, setRows] = useState([]);
  const [branch, setBranch] = useState('');
  const [term, setTerm] = useState('');
  const [onlyMoved, setOnlyMoved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // แถวที่กำลังแก้ยอดคงเหลือ
  const [cardRow, setCardRow] = useState(null); // แถวที่เปิดสต๊อกการ์ด
  const [importOpen, setImportOpen] = useState(false); // ป๊อปอัพนำเข้ายอดนับจาก Excel

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await kitchenCall('getKitchenBalance', { asOf });
      setRows(res.items || []);
      setBranch(res.branch || '');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [asOf]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = term.trim().toLowerCase();
    return rows.filter((r) => {
      if (onlyMoved) {
        const moved = Number(r.received_qty) || Number(r.issued_qty) || Number(r.produced_qty);
        if (!moved) return false;
      }
      if (!q) return true;
      return String(r.item_name || '').toLowerCase().includes(q)
        || String(r.item_code || '').toLowerCase().includes(q);
    });
  }, [rows, term, onlyMoved]);

  const neverCounted = useMemo(
    () => rows.filter((r) => !r.count_date).length,
    [rows]
  );

  return (
    <div className="p-4 md:p-6 space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2">
            <Boxes className="w-5 h-5 text-sky-400" />
            วัตถุดิบคงเหลือ
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            คำนวณสดจาก: ยอดนับล่าสุด + รับเข้า − เบิกใช้ + ผลิตได้
            {branch ? ` · สาขา ${branch}` : ''}
            {!loading && ` · ${rows.length.toLocaleString()} รายการ${filtered.length !== rows.length ? ` (แสดง ${filtered.length.toLocaleString()})` : ''}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button data-write
            onClick={() => setImportOpen(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 border border-emerald-500/30"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" /> นำเข้ายอดนับจาก Excel
          </button>
          <button
            onClick={load}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700"
          >
            <RefreshCw className="w-3.5 h-3.5" /> รีเฟรช
          </button>
        </div>
      </header>

      {importOpen && (
        <CountImport
          currentRows={rows}
          onClose={() => setImportOpen(false)}
          onSaved={() => { setImportOpen(false); load(); }}
        />
      )}

      <div className="flex flex-wrap items-end gap-3 bg-slate-900/60 border border-slate-800 rounded-xl p-4">
        <div>
          <label className="block text-[11px] text-slate-500 mb-1">คงเหลือ ณ วันที่</label>
          <input
            type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)}
            className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-slate-100 focus:outline-none focus:border-sky-500/60"
          />
        </div>
        <DayQuick value={asOf} onChange={setAsOf} presets={['yesterday', 'today']} className="p-1 bg-slate-950/60 border border-slate-800 rounded-lg" />
        <div className="flex-1 min-w-[200px]">
          <label className="block text-[11px] text-slate-500 mb-1">ค้นหา</label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
            <input
              type="text" value={term} onChange={(e) => setTerm(e.target.value)}
              placeholder="ชื่อหรือรหัสวัตถุดิบ"
              className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-9 pr-3 py-1.5 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-sky-500/60"
            />
          </div>
        </div>
        <label className="flex items-center gap-2 text-xs text-slate-400 pb-1.5">
          <input
            type="checkbox" checked={onlyMoved}
            onChange={(e) => setOnlyMoved(e.target.checked)}
            className="accent-sky-500"
          />
          เฉพาะที่มีความเคลื่อนไหว
        </label>
      </div>

      {neverCounted > 0 && !loading && (
        <div className="flex items-start gap-2 bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-3">
          <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
          <p className="text-xs text-amber-200/90">
            มี {neverCounted} รายการที่ยังไม่เคยถูกนับสต๊อกที่ครัวกลางเลย —
            ตัวเลขคงเหลือของรายการเหล่านั้นมาจากการรวมรับเข้า/เบิกใช้/ผลิตได้ทั้งหมดตั้งแต่ต้น
            ซึ่งจะแม่นก็ต่อเมื่อบันทึกครบทุกครั้ง ถือเป็นเรื่องปกติในช่วงแรก และจะหายไปเองเมื่อครัว
            เริ่มนับสต๊อก ซึ่งตอนนั้นตัวเลขจะเริ่มนับใหม่จากของจริง
          </p>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20 text-slate-500 gap-2">
          <Loader2 className="w-5 h-5 animate-spin text-sky-400" /> กำลังคำนวณคงเหลือ...
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-20 text-center text-slate-500 text-sm">
          {rows.length === 0
            ? 'ยังไม่มีวัตถุดิบในระบบครัวกลาง — ติ๊กสาขา FCT ที่ QC/RD > วัตถุดิบ หรือนำเข้ายอดนับ แล้ววัตถุดิบจะขึ้นที่นี่'
            : 'ไม่พบรายการที่ตรงกับเงื่อนไข'}
        </div>
      ) : (
        <div className="bg-slate-900/60 border border-slate-800 rounded-xl overflow-x-auto">
          <table className="w-full text-sm min-w-[820px]">
            <thead className="bg-slate-900 text-slate-400 text-xs">
              <tr>
                <th className="text-left px-4 py-3 font-medium">วัตถุดิบ</th>
                <th className="text-right px-4 py-3 font-medium">นับล่าสุด</th>
                <th className="text-right px-4 py-3 font-medium">รับเข้า</th>
                <th className="text-right px-4 py-3 font-medium">เบิกใช้</th>
                <th className="text-right px-4 py-3 font-medium">ผลิตได้</th>
                <th className="text-right px-4 py-3 font-medium">คงเหลือ</th>
                <th className="px-2 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const balance = Number(r.balance);
                return (
                  <tr key={r.item_key} className="border-t border-slate-800/70 hover:bg-slate-800/30">
                    <td className="px-4 py-3">
                      <button onClick={() => setCardRow(r)} title="ดูสต๊อกการ์ด (ความเคลื่อนไหวรายวัน)"
                        className="text-left group">
                        <div className="text-slate-200 group-hover:text-sky-300 flex items-center gap-1.5">
                          {r.item_name}
                          <ScrollText className="w-3.5 h-3.5 text-slate-600 group-hover:text-sky-400" />
                        </div>
                        <div className="text-[11px] text-slate-500">
                          {r.item_code}{r.unit ? ` · ${r.unit}` : ''}
                          {Number(r.in_registry) !== 0 && Number(r.is_kitchen) === 0 && r.is_kitchen !== undefined && (
                            <span className="ml-1.5 text-slate-500" title="ยังไม่ได้ติ๊กสาขา FCT ในหน้า QC/RD > วัตถุดิบ — ขึ้นที่นี่เพราะอยู่ในสูตร/ใบเบิก/ยอดนับของครัว">
                              · ไม่ได้ตั้งสาขา FCT
                            </span>
                          )}
                          {Number(r.in_registry) === 0 && (
                            <span className="ml-1.5 text-amber-300" title="รหัสนี้ยังไม่มีในทะเบียนสินค้า (QC/RD > วัตถุดิบ) — ชื่อ/หน่วยมาจากไฟล์นับของครัว">
                              · ยังไม่มีในทะเบียนสินค้า
                            </span>
                          )}
                        </div>
                      </button>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {/* กดที่ยอดนับได้เหมือนดินสอ — เพิ่มยอดนับใหม่ ช่องนี้แสดงยอดล่าสุด ยอดเก่ายังอยู่ใน stock_count */}
                      <button onClick={() => setEditing(r)} title="กดเพื่อใส่ยอดนับใหม่ (ยอดเก่ายังเก็บเป็นประวัติ)"
                        className="group inline-flex flex-col items-end rounded px-1.5 py-0.5 -mr-1.5 hover:bg-slate-800">
                        <span className="text-slate-300 group-hover:text-sky-300 inline-flex items-center gap-1">
                          <Pencil className="w-3 h-3 opacity-0 group-hover:opacity-100" />
                          {formatQty(r.counted_qty)}
                        </span>
                        <span className="text-[10px] text-slate-600 group-hover:text-sky-400/70">
                          {r.count_date ? formatThaiDate(r.count_date) : 'ยังไม่เคยนับ · กดเพื่อนับ'}
                        </span>
                      </button>
                    </td>
                    <td className="px-4 py-3 text-right text-emerald-300/80">
                      {Number(r.received_qty) ? `+${formatQty(r.received_qty)}` : '-'}
                    </td>
                    <td className="px-4 py-3 text-right text-rose-300/80">
                      {Number(r.issued_qty) ? `−${formatQty(r.issued_qty)}` : '-'}
                    </td>
                    <td className="px-4 py-3 text-right text-purple-300/80">
                      {Number(r.produced_qty) ? `+${formatQty(r.produced_qty)}` : '-'}
                    </td>
                    <td className={`px-4 py-3 text-right font-semibold ${balance < 0 ? 'text-rose-400' : 'text-slate-100'}`}>
                      {formatQty(balance)}
                    </td>
                    <td className="px-2 py-3 text-right whitespace-nowrap">
                      <button data-write onClick={() => setEditing(r)} title="แก้ยอดคงเหลือ (บันทึกเป็นยอดนับ)"
                        className="p-1.5 rounded text-slate-500 hover:text-sky-300 hover:bg-slate-800">
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => setCardRow(r)} title="สต๊อกการ์ด (ความเคลื่อนไหวรายวัน)"
                        className="p-1.5 rounded text-slate-500 hover:text-teal-300 hover:bg-slate-800">
                        <ScrollText className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => setEditing(r)} title="ดูประวัติการแก้ยอด/ยอดนับ"
                        className="p-1.5 rounded text-slate-500 hover:text-amber-300 hover:bg-slate-800">
                        <History className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {cardRow && <StockCard row={cardRow} onClose={() => setCardRow(null)} />}

      {editing && (
        <CountEditor
          row={editing}
          defaultDate={asOf && asOf < todayYmd() ? asOf : todayYmd()}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}

      <p className="text-[11px] text-slate-600">
        รายการที่ติดลบแปลว่าเบิกใช้มากกว่าที่รับเข้า ตั้งแต่วันที่นับล่าสุด — มักเกิดจากลืมบันทึก
        รับของที่หน้า "เบิกวัตถุดิบ → รับเข้า" หรือเบิกเกินจริง ไม่ใช่ข้อมูลเสีย
      </p>
    </div>
  );
}

/**
 * แก้ยอดคงเหลือของวัตถุดิบหนึ่งตัว — บันทึกเป็นยอดนับใหม่ของสาขาครัว
 * ยอดนับถือเป็นยอด ณ สิ้นวันของวันที่เลือก: รับเข้า/เบิกใช้/ผลิตได้ของวันเดียวกันจะไม่ถูกรวมอีก
 */
function CountEditor({ row, defaultDate, onClose, onSaved }) {
  const current = Number(row.balance);
  const [value, setValue] = useState(() => String(Number.isFinite(current) && current > 0 ? current : 0));
  const [countDate, setCountDate] = useState(defaultDate);
  const [saving, setSaving] = useState(false);
  const today = todayYmd();
  const [history, setHistory] = useState(null); // null = กำลังโหลด
  const [historyError, setHistoryError] = useState('');
  useEffect(() => {
    let alive = true;
    kitchenCall('getKitchenCountHistory', { itemKey: row.item_key, limit: 30 })
      .then((res) => { if (alive) setHistory(res.history || []); })
      .catch((err) => {
        if (!alive) return;
        setHistory([]);
        setHistoryError(/ไม่รู้จักคำสั่ง|unknown action/i.test(err.message)
          ? 'office-server ยังเป็นรุ่นเก่า ยังดูประวัติไม่ได้ — รัน update-office-server.bat'
          : err.message);
      });
    return () => { alive = false; };
  }, [row.item_key]);
  const n = Number(value);
  const valid = value !== '' && Number.isFinite(n) && n >= 0;
  const diff = valid ? Math.round((n - current) * 1000) / 1000 : 0;

  const save = async () => {
    if (!valid) { toast.error('ใส่ยอดคงเหลือเป็นตัวเลขตั้งแต่ 0 ขึ้นไป'); return; }
    setSaving(true);
    try {
      const res = await kitchenCall('saveKitchenCount', {
        itemKey: row.item_key, itemCode: row.item_code, itemName: row.item_name, unit: row.unit,
        remaining: n, countDate,
      });
      toast.success(res.message || 'บันทึกยอดคงเหลือแล้ว');
      onSaved();
    } catch (err) {
      toast.error(/ไม่รู้จักคำสั่ง|unknown action/i.test(err.message)
        ? 'office-server ที่ออฟฟิศยังเป็นรุ่นเก่า ยังแก้ยอดคงเหลือไม่ได้ — รัน update-office-server.bat ของ Narai-branch ก่อน'
        : err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 bg-black/70 flex items-start justify-center overflow-y-auto p-4" onClick={() => !saving && onClose()}>
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md my-16 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-slate-800">
          <div className="min-w-0">
            <h2 className="font-semibold text-slate-100 text-sm">แก้ยอดคงเหลือ / ประวัติยอดนับ</h2>
            <p className="text-xs text-slate-400 mt-0.5 truncate">{row.item_name}</p>
            <p className="text-[11px] text-slate-500">{row.item_code}{row.unit ? ` · ${row.unit}` : ''}</p>
          </div>
          <button onClick={onClose} disabled={saving} className="p-1 text-slate-500 hover:text-slate-300"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 space-y-4">
          <div className="flex items-center justify-between text-xs bg-slate-950/50 border border-slate-800 rounded-lg px-3 py-2">
            <span className="text-slate-500">คงเหลือตามระบบตอนนี้</span>
            <span className={`font-semibold ${current < 0 ? 'text-rose-300' : 'text-slate-200'}`}>{formatQty(current)} {row.unit || ''}</span>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1.5">ยอดคงเหลือจริง ({row.unit || 'หน่วยสต๊อก'})</label>
            <input
              type="number" step="any" min="0" inputMode="decimal" autoFocus value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') save(); }}
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-lg font-mono text-right text-slate-100 focus:outline-none focus:border-sky-500/60"
            />
            {valid && diff !== 0 && (
              <p className={`mt-1 text-[11px] text-right ${diff > 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                ต่างจากระบบ {diff > 0 ? '+' : ''}{formatQty(diff)} {row.unit || ''}
              </p>
            )}
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1.5">เป็นยอด ณ สิ้นวันที่</label>
            <input
              type="date" value={countDate} max={today} onChange={(e) => setCountDate(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-sky-500/60"
            />
            <DayQuick value={countDate} onChange={setCountDate} presets={['yesterday', 'today']} max={today} className="mt-1.5" />
            <p className="mt-1.5 text-[11px] text-slate-500 leading-relaxed">
              บันทึกเป็นยอดนับใหม่ของสาขาครัวกลาง ช่อง "นับล่าสุด" จะแสดงยอดนี้ ยอดนับเก่ายังเก็บเป็นประวัติ ·
              คงเหลือจะเริ่มนับใหม่จากยอดนี้ ·
              รับเข้า/เบิกใช้/ผลิตได้ที่ลงวันที่เดียวกันจะไม่ถูกรวมอีก จึงควรใส่ยอดตอนปิดครัว
              {countDate === today && ' — ถ้าวันนี้ยังจะมีเบิกหรือผลิตต่อ ให้เลือกเป็นยอดของเมื่อวานแทน'}
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={onClose} disabled={saving} className="px-3 py-1.5 rounded-lg text-xs text-slate-400 hover:bg-slate-800">ยกเลิก</button>
            <button data-write onClick={save} disabled={saving || !valid}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold bg-sky-500 text-slate-950 hover:bg-sky-400 disabled:opacity-40">
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              บันทึกยอดคงเหลือ
            </button>
          </div>

          <div className="pt-3 border-t border-slate-800">
            <p className="text-xs text-slate-300 flex items-center gap-1.5 mb-2">
              <History className="w-3.5 h-3.5 text-amber-300" /> ประวัติยอดนับ / การแก้ยอด
              <span className="text-[10px] text-slate-500">ใหม่สุดก่อน · รวมที่นับจากหน้านับสต๊อกของสาขา</span>
            </p>
            {history === null ? (
              <div className="flex items-center gap-2 text-xs text-slate-500 py-3"><Loader2 className="w-3.5 h-3.5 animate-spin" /> กำลังโหลดประวัติ...</div>
            ) : historyError ? (
              <p className="text-xs text-rose-300 py-2">{historyError}</p>
            ) : history.length === 0 ? (
              <p className="text-xs text-slate-500 py-2">ยังไม่เคยนับหรือแก้ยอดของรายการนี้</p>
            ) : (
              <div className="max-h-56 overflow-y-auto border border-slate-800 rounded-lg">
                <table className="w-full text-xs">
                  <thead className="bg-slate-950/60 text-slate-500 sticky top-0">
                    <tr>
                      <th className="text-left px-2.5 py-1.5 font-medium">ยอด ณ</th>
                      <th className="text-right px-2.5 py-1.5 font-medium">ยอดนับ</th>
                      <th className="text-right px-2.5 py-1.5 font-medium">เปลี่ยนจากครั้งก่อน</th>
                      <th className="text-left px-2.5 py-1.5 font-medium">ผู้บันทึก</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((h, i) => {
                      const prev = history[i + 1];
                      const change = prev ? Math.round((Number(h.remaining) - Number(prev.remaining)) * 1000) / 1000 : null;
                      return (
                        <tr key={h.count_id} className="border-t border-slate-800/70">
                          <td className="px-2.5 py-1.5 text-slate-300" title={`กดบันทึกเมื่อ ${formatStamp(h.created_at)}`}>
                            {formatStamp(h.counted_at)}
                            {i === 0 && <span className="ml-1.5 text-[9px] px-1 rounded bg-sky-500/15 text-sky-300 border border-sky-500/30">ล่าสุด</span>}
                          </td>
                          <td className="px-2.5 py-1.5 text-right font-mono text-slate-100">{formatQty(h.remaining)}</td>
                          <td className={`px-2.5 py-1.5 text-right font-mono ${
                            change === null ? 'text-slate-600' : change > 0 ? 'text-emerald-300' : change < 0 ? 'text-rose-300' : 'text-slate-500'}`}>
                            {change === null ? '-' : `${change > 0 ? '+' : ''}${formatQty(change)}`}
                          </td>
                          <td className="px-2.5 py-1.5 text-slate-400 truncate max-w-[110px]">{h.counter_name || '-'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
