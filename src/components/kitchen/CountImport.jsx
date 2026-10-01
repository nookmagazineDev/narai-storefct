import React, { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { FileSpreadsheet, Loader2, Save, Upload, AlertTriangle, Download } from 'lucide-react';
import Modal from './KitchenModal';
import { kitchenCall, todayYmd, shiftYmd, formatQty } from '../../services/kitchenService';

const normKey = (v) => String(v ?? '').trim().replace(/\.0+$/, '').replace(/^0+/, '').toLowerCase();
const normUnit = (u) => String(u || '').replace(/[\s.]/g, '').toLowerCase();
const THAI_MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
const pad = (n) => String(n).padStart(2, '0');
// ปี พ.ศ. → ค.ศ. (ไฟล์ของครัวใช้ พ.ศ. เช่น 30-09-2569)
const toYmd = (d, m, y) => {
  const year = Number(y) > 2400 ? Number(y) - 543 : Number(y);
  if (!(d >= 1 && d <= 31 && m >= 1 && m <= 12 && year > 2000)) return '';
  return `${year}-${pad(m)}-${pad(d)}`;
};

/** วันที่ของยอดนับจากหัวไฟล์ ("วันที่ 30 กันยายน 2569") หรือชื่อไฟล์ ("..._30-09-2569.xlsx") */
function guessDate(texts) {
  for (const t of texts) {
    const s = String(t || '');
    const thai = s.match(/(\d{1,2})\s*(มกราคม|กุมภาพันธ์|มีนาคม|เมษายน|พฤษภาคม|มิถุนายน|กรกฎาคม|สิงหาคม|กันยายน|ตุลาคม|พฤศจิกายน|ธันวาคม)\s*(\d{4})/);
    if (thai) {
      const ymd = toYmd(Number(thai[1]), THAI_MONTHS.indexOf(thai[2]) + 1, thai[3]);
      if (ymd) return ymd;
    }
    const num = s.match(/(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
    if (num) {
      const ymd = toYmd(Number(num[1]), Number(num[2]), num[3]);
      if (ymd) return ymd;
    }
  }
  return '';
}

/**
 * อ่านไฟล์ยอดนับ — หาแถวหัวตารางที่มีคอลัมน์รหัส (CODE/รหัส) และจำนวน (จำนวน/คงเหลือ/QTY)
 * @returns {{ rows: Array<{ line, code, name, unit, qty }>, date: string, sheet: string }}
 */
async function parseFile(file) {
  const mod = await import('xlsx-js-style');
  const XLSX = mod.default || mod;
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  for (const sheet of wb.SheetNames) {
    const grid = XLSX.utils.sheet_to_json(wb.Sheets[sheet], { header: 1, raw: true, defval: '' });
    const headerAt = grid.findIndex((r) => r.some((c) => /^(code|รหัส)/i.test(String(c).trim()))
      && r.some((c) => /(จำนวน|คงเหลือ|qty|นับ)/i.test(String(c).trim())));
    if (headerAt < 0) continue;
    const head = grid[headerAt].map((c) => String(c).trim());
    const col = (re) => head.findIndex((h) => re.test(h));
    const cCode = col(/^(code|รหัส)/i);
    const cName = col(/(ชื่อ|name|รายการ)/i);
    const cUnit = col(/(หน่วย|unit)/i);
    const cQty = col(/(จำนวน|คงเหลือ|qty|นับ)/i);
    const rows = [];
    grid.slice(headerAt + 1).forEach((r, i) => {
      const code = String(r[cCode] ?? '').trim();
      if (!/\d/.test(code)) return; // แถวว่าง / หมายเหตุท้ายไฟล์ / แถวรวม
      const rawQty = r[cQty];
      const qty = rawQty === '' || rawQty === null ? NaN : Number(String(rawQty).replace(/,/g, ''));
      rows.push({
        line: headerAt + i + 2, code,
        name: cName >= 0 ? String(r[cName] ?? '').trim() : '',
        unit: cUnit >= 0 ? String(r[cUnit] ?? '').trim() : '',
        qty,
      });
    });
    const titles = grid.slice(0, headerAt).flat();
    return { rows, sheet, date: guessDate([...titles, file.name]) };
  }
  throw new Error('ไม่พบหัวตารางที่มีคอลัมน์ "CODE/รหัส" และ "จำนวน" ในไฟล์นี้');
}

/**
 * นำเข้ายอดนับครัวกลางจากไฟล์ Excel (เช่น Ending_Stock_FCT_30-09-2569.xlsx) — หน้าวัตถุดิบคงเหลือ
 * ตรวจรหัสกับทะเบียนสินค้า (getKitchenItems) ก่อนบันทึก แล้วบันทึกทั้งไฟล์ทีเดียวด้วย saveKitchenCounts
 * ยอดนับ = ยอด ณ สิ้นวันที่เลือก · วัตถุดิบที่ยังไม่อยู่ในรายการของครัวจะถูกเพิ่มเข้ามาเพราะมียอดนับแล้ว
 */
export default function CountImport({ currentRows, onClose, onSaved }) {
  const [items, setItems] = useState(null); // Map normKey -> stock_item
  const [parsed, setParsed] = useState(null);
  const [fileName, setFileName] = useState('');
  const [countDate, setCountDate] = useState(() => shiftYmd(todayYmd(), -1));
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    kitchenCall('getKitchenItems', { includeInactive: true })
      .then((res) => setItems(new Map((res.items || []).map((it) => [normKey(it.item_key), it]))))
      .catch((err) => toast.error(`โหลดทะเบียนสินค้าไม่ได้: ${err.message}`));
  }, []);

  const current = useMemo(() => new Map((currentRows || []).map((r) => [normKey(r.item_key), r])), [currentRows]);

  const pick = async (file) => {
    if (!file) return;
    setReading(true);
    setFileName(file.name);
    try {
      const res = await parseFile(file);
      setParsed(res);
      if (res.date) setCountDate(res.date);
      toast.success(`อ่านไฟล์แล้ว ${res.rows.length} รายการ (ชีท ${res.sheet})`);
    } catch (err) {
      setParsed(null);
      toast.error(err.message);
    } finally {
      setReading(false);
    }
  };

  const rows = useMemo(() => (parsed?.rows || []).map((r) => {
    const key = normKey(r.code);
    const it = items?.get(key);
    const cur = current.get(key);
    let status = 'ok';
    if (!Number.isFinite(r.qty) || r.qty < 0) status = 'badqty';
    // ไม่มีในทะเบียนสินค้า = วัตถุดิบเฉพาะของครัว นำเข้าได้ด้วยชื่อ/หน่วยจากไฟล์ (ไม่มีชื่อในไฟล์ถึงข้าม)
    else if (!it) status = r.name ? 'unreg' : 'missing';
    const unitDiff = Boolean(it && r.unit && it.unit && normUnit(r.unit) !== normUnit(it.unit));
    return { ...r, key, it, cur, status, unitDiff, isNew: Boolean(it) && !cur };
  }).sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true })), [parsed, items, current]);

  const ready = rows.filter((r) => r.status === 'ok' || r.status === 'unreg');
  const counts = {
    all: rows.length,
    ok: ready.length,
    missing: rows.filter((r) => r.status === 'missing').length,
    unreg: rows.filter((r) => r.status === 'unreg').length,
    badqty: rows.filter((r) => r.status === 'badqty').length,
    isNew: rows.filter((r) => (r.isNew && r.status === 'ok') || (r.status === 'unreg' && !r.cur)).length,
    unitDiff: rows.filter((r) => r.unitDiff).length,
  };
  const shown = rows.filter((r) => (filter === 'all' ? true
    : filter === 'problem' ? r.status !== 'ok' || r.unitDiff
      : filter === 'new' ? (r.isNew && r.status === 'ok') || (r.status === 'unreg' && !r.cur) : true));

  // รายการที่ไม่มีในทะเบียนสินค้า (QC/RD > วัตถุดิบ) ส่งออกเป็น Excel ไว้ส่งให้ QC/RD เพิ่มรหัส
  const exportUnregistered = async () => {
    const list = rows.filter((r) => r.status === 'unreg' || r.status === 'missing');
    if (list.length === 0) { toast('ทุกรหัสในไฟล์มีในทะเบียนสินค้าแล้ว', { icon: '✅' }); return; }
    const mod = await import('xlsx-js-style');
    const XLSX = mod.default || mod;
    const ws = XLSX.utils.aoa_to_sheet([
      ['รหัส', 'ชื่อสินค้า (จากไฟล์)', 'หน่วย', 'ยอดนับ'],
      ...list.map((r) => [r.code, r.name, r.unit, Number.isFinite(r.qty) ? r.qty : '']),
    ]);
    ws['!cols'] = [{ wch: 12 }, { wch: 48 }, { wch: 8 }, { wch: 10 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'ไม่มีในQCRD');
    XLSX.writeFile(wb, `ไม่มีในทะเบียน_QCRD_${countDate || todayYmd()}.xlsx`);
  };

  const save = async () => {
    if (!countDate) { toast.error('เลือกวันที่ของยอดนับ'); return; }
    if (ready.length === 0) { toast.error('ไม่มีรายการที่นำเข้าได้'); return; }
    const extra = counts.missing + counts.badqty;
    if (!window.confirm(`บันทึกยอดนับ ณ สิ้นวัน ${countDate} จำนวน ${ready.length} รายการ${extra ? ` (ข้าม ${extra} รายการที่มีปัญหา)` : ''} ใช่ไหม?\n`
      + 'คงเหลือของวัตถุดิบเหล่านี้จะเริ่มนับใหม่จากยอดนี้')) return;
    setSaving(true);
    try {
      const res = await kitchenCall('saveKitchenCounts', {
        countDate,
        items: ready.map((r) => ({ itemCode: r.code, remaining: r.qty, itemName: r.name, unit: r.unit })),
      });
      toast.success(res.message || 'นำเข้าแล้ว', { duration: 6000 });
      if (res.skipped?.length) toast(`ข้ามรหัส: ${res.skipped.slice(0, 10).join(', ')}${res.skipped.length > 10 ? ' …' : ''}`, { icon: '⚠️', duration: 8000 });
      onSaved?.(countDate);
    } catch (err) {
      toast.error(/ไม่รู้จัก|unknown action/i.test(err.message)
        ? 'office-server ที่ออฟฟิศยังเป็นรุ่นเก่า ยังนำเข้าไม่ได้ — รัน update-office-server.bat ของ Narai-branch ก่อน'
        : err.message);
    } finally {
      setSaving(false);
    }
  };

  const STATUS = {
    ok: null,
    missing: <span className="text-rose-300">ไม่มีรหัสนี้ในทะเบียนสินค้า และไม่มีชื่อในไฟล์</span>,
    unreg: <span className="text-amber-300">ยังไม่มีในทะเบียนสินค้า — นำเข้าด้วยชื่อ/หน่วยจากไฟล์</span>,
    badqty: <span className="text-rose-300">จำนวนไม่ใช่ตัวเลข</span>,
  };

  return (
    <Modal onClose={onClose} title={<span className="flex items-center gap-2"><FileSpreadsheet className="w-4 h-4 text-emerald-400" /> นำเข้ายอดนับจาก Excel</span>}>
      <div className="space-y-3 text-xs">
        <label className={`flex items-center justify-center gap-2 px-3 py-4 rounded-xl border border-dashed cursor-pointer ${
          parsed ? 'border-emerald-500/40 bg-emerald-500/5 text-emerald-300' : 'border-slate-600 bg-slate-950/40 text-slate-300 hover:border-sky-500/50'}`}>
          {reading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
          {fileName || 'เลือกไฟล์ .xlsx (คอลัมน์ CODE · ชื่อสินค้า · หน่วย · จำนวน)'}
          <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
        </label>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-slate-400">ยอด ณ สิ้นวันที่</span>
          <input type="date" value={countDate} max={todayYmd()} onChange={(e) => setCountDate(e.target.value)}
            className="bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-sm text-slate-100" />
          <span className="text-[11px] text-slate-500">รับเข้า/เบิกใช้ของวันนี้และก่อนหน้าไม่ถูกรวมอีก</span>
        </div>

        {parsed && (
          <>
            <div className="flex flex-wrap gap-1.5">
              {[
                ['all', `ทั้งหมด ${counts.all}`],
                ['new', `เพิ่มเข้ารายการครัวใหม่ ${counts.isNew}`],
                ['problem', `ต้องตรวจ ${counts.missing + counts.badqty + counts.unitDiff + counts.unreg}`],
              ].map(([k, label]) => (
                <button key={k} onClick={() => setFilter(k)}
                  className={`px-2.5 py-1 rounded-lg border ${filter === k ? 'bg-sky-500/15 text-sky-300 border-sky-500/40' : 'text-slate-400 border-slate-700 hover:text-slate-200'}`}>
                  {label}
                </button>
              ))}
            </div>
            {counts.unreg > 0 && (
              <div className="flex gap-1.5 text-[11px] text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg px-2.5 py-2">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>
                  {counts.unreg} รายการยังไม่มีในทะเบียนสินค้า — นำเข้าเป็นวัตถุดิบของครัวด้วยชื่อ/หน่วยจากไฟล์ (ขึ้นในหน้าคงเหลือ)
                  ถ้าจะใช้เลือกในใบเบิก/สูตร ให้เพิ่มรหัสนี้ที่ QC/RD &gt; วัตถุดิบ
                </span>
              </div>
            )}
            {(counts.missing > 0 || counts.badqty > 0) && (
              <div className="flex gap-1.5 text-[11px] text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-lg px-2.5 py-2">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>ข้าม {counts.missing + counts.badqty} รายการที่จำนวนผิดหรือไม่มีทั้งรหัสในทะเบียนและชื่อในไฟล์</span>
              </div>
            )}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[11px] text-slate-400">นำเข้าได้ <strong className="text-slate-200">{ready.length}</strong> จาก {counts.all} รายการ</p>
              {counts.unreg + counts.missing > 0 && (
                <button onClick={exportUnregistered}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] text-amber-300 border border-amber-500/40 hover:bg-amber-500/10">
                  <Download className="w-3.5 h-3.5" /> ส่งออกรายการที่ไม่มีใน QC/RD ({counts.unreg + counts.missing})
                </button>
              )}
            </div>
            <div className="max-h-[50vh] overflow-auto rounded-lg border border-slate-800">
              <table className="w-full">
                <thead className="sticky top-0 bg-slate-950 text-slate-400">
                  <tr>
                    <th className="px-2.5 py-2 text-left font-medium">รหัส / ชื่อ</th>
                    <th className="px-2.5 py-2 text-right font-medium">คงเหลือตอนนี้</th>
                    <th className="px-2.5 py-2 text-right font-medium">ยอดนับในไฟล์</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {shown.map((r, i) => (
                    <tr key={`${r.line}-${i}`} className={r.status === 'missing' || r.status === 'badqty' ? 'bg-rose-500/5' : ''}>
                      <td className="px-2.5 py-1.5">
                        <div className="text-slate-200">{r.it?.item_name || r.name}</div>
                        <div className="text-[10px] text-slate-500">
                          {r.code}
                          {r.isNew && r.status === 'ok' && <span className="text-emerald-300"> · เพิ่มเข้ารายการครัว</span>}
                          {r.unitDiff && <span className="text-amber-300"> · หน่วยในไฟล์ "{r.unit}" ทะเบียน "{r.it.unit}"</span>}
                          {STATUS[r.status] && <> · {STATUS[r.status]}</>}
                        </div>
                      </td>
                      <td className="px-2.5 py-1.5 text-right font-mono text-slate-500 whitespace-nowrap">
                        {r.cur ? formatQty(r.cur.balance) : '-'}
                      </td>
                      <td className="px-2.5 py-1.5 text-right font-mono text-slate-100 whitespace-nowrap">
                        {Number.isFinite(r.qty) ? formatQty(r.qty) : String(r.qty)} <span className="text-slate-500">{r.it?.unit || r.unit}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        <div className="flex items-center justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 rounded-lg text-slate-400 hover:bg-slate-800">ยกเลิก</button>
          <button data-write onClick={save} disabled={saving || !items || ready.length === 0}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg font-semibold bg-emerald-500 text-slate-950 hover:bg-emerald-400 disabled:opacity-40">
            {saving || (!items && parsed) ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            บันทึกยอดนับ {ready.length > 0 && `${ready.length} รายการ`}
          </button>
        </div>
      </div>
    </Modal>
  );
}
