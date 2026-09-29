// ไฟล์ Excel ของเมนูครัวกลาง — ปุ่ม "พิมพ์รายการเบิก" ของแท็บเบิกตามแพลน (หน้าเบิกวัตถุดิบ)
//
// ใช้ xlsx-js-style ตัวเดียวกับใบจัดของของสโตร์ (services/fulfillmentService.js) เพราะต้องเขียนสไตล์
// (ตัวหนา ขอบ พื้นช่อง) และกำหนดความกว้างให้พิมพ์พอดี A4 แนวตั้ง

const dmy = (ymd) => {
  const [y, m, d] = String(ymd || '').slice(0, 10).split('-');
  return y && m && d ? `${d}/${m}/${y}` : '-';
};

const fmtNum = (n) => {
  const v = Math.round(Number(n) * 1000) / 1000;
  return Number.isFinite(v) ? v : '';
};

/**
 * ใบเบิกวัตถุดิบครัวกลาง — ชีท "ใบเบิก" + ชีท "สรุปแพลน"
 *
 * ช่อง "เบิกจริง" เว้นว่างเสมอ ให้เขียนด้วยมือบนกระดาษ
 * (ยอดเบิกจริงบนหน้าจอไม่ถูกใส่ลงไฟล์ ตั้งใจให้ไฟล์เป็นแบบฟอร์มที่มียอดตามสูตรไว้อ้างอิง)
 *
 * @param {object} p
 * @param {string|number} [p.docNo]   เลขที่ใบเบิกที่ส่งไปแล้ว (ยังไม่ส่ง = ว่าง)
 * @param {string} p.deldate          วันที่ต้องการของ YYYY-MM-DD
 * @param {string} p.planFrom
 * @param {string} p.planTo
 * @param {Array<{ code, name, unit, qty, uses: Array<[string, number]> }>} p.rows  qty = ตามสูตร
 * @param {Array<{ date, name, batches, qty, unit, order }>} p.plans  แพลนที่นับ
 */
export async function exportRequisitionExcel({ docNo, deldate, planFrom, planTo, rows, plans }) {
  const mod = await import('xlsx-js-style');
  const XLSX = mod.default || mod;

  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const printedAt = `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const planList = plans.map((p) => `${p.name} ×${fmtNum(p.batches)} สูตร`).join(' · ');

  const COLS = 7;
  const data = [
    ['ใบเบิกวัตถุดิบ ครัวกลาง (FCT)'],
    [`เลขที่ใบเบิก: ${docNo || 'ยังไม่ได้ส่ง'}`, '', '', `วันที่ต้องการของ: ${dmy(deldate)}`],
    [`แพลนผลิตวันที่: ${dmy(planFrom)} ถึง ${dmy(planTo)}`, '', '', `พิมพ์เมื่อ: ${printedAt}`],
    [`แพลนที่นับ (${plans.length}): ${planList || '-'}`],
    [],
  ];
  const headRow = data.length;
  data.push(['ลำดับ', 'รหัส', 'วัตถุดิบ', 'ใช้ผลิต (เมนู × สูตร)', 'ตามสูตร', 'เบิกจริง', 'หน่วย']);
  rows.forEach((r, i) => {
    data.push([
      i + 1,
      r.code || '',
      r.name || '',
      r.uses.map(([menu, b]) => `${menu} ×${fmtNum(b)}`).join(' · '),
      fmtNum(r.qty),
      '', // เบิกจริง — เขียนด้วยมือ
      r.unit || '',
    ]);
  });
  const lastItemRow = data.length - 1;
  data.push([]);
  data.push([`รวม ${rows.length} รายการ`]);
  data.push([]);
  const signRow = data.length;
  data.push(['ผู้เบิก ..............................', '', '', 'ผู้จ่าย ..............................', '', 'ผู้รับ ..............................']);
  data.push(['(ครัวกลาง)', '', '', '(สโตร์)', '', '(ครัวกลาง)']);

  const ws = XLSX.utils.aoa_to_sheet(data);
  // รวมราว 93 ตัวอักษร — ขอบกระดาษแคบแล้วพิมพ์ได้ในหน้ากว้าง A4 แนวตั้ง 100% (แนวเดียวกับใบจัดของ)
  ws['!cols'] = [{ wch: 5 }, { wch: 9 }, { wch: 26 }, { wch: 30 }, { wch: 8 }, { wch: 9 }, { wch: 6 }];
  ws['!margins'] = { left: 0.25, right: 0.25, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 };
  ws['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: COLS - 1 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 2 } }, { s: { r: 1, c: 3 }, e: { r: 1, c: COLS - 1 } },
    { s: { r: 2, c: 0 }, e: { r: 2, c: 2 } }, { s: { r: 2, c: 3 }, e: { r: 2, c: COLS - 1 } },
    { s: { r: 3, c: 0 }, e: { r: 3, c: COLS - 1 } },
    { s: { r: signRow, c: 0 }, e: { r: signRow, c: 2 } }, { s: { r: signRow, c: 3 }, e: { r: signRow, c: 4 } },
    { s: { r: signRow, c: 5 }, e: { r: signRow, c: COLS - 1 } },
    { s: { r: signRow + 1, c: 0 }, e: { r: signRow + 1, c: 2 } }, { s: { r: signRow + 1, c: 3 }, e: { r: signRow + 1, c: 4 } },
    { s: { r: signRow + 1, c: 5 }, e: { r: signRow + 1, c: COLS - 1 } },
  ];

  const thin = { style: 'thin', color: { rgb: '999999' } };
  const border = { top: thin, bottom: thin, left: thin, right: thin };
  const writeIn = { fgColor: { rgb: 'FFF7D6' } }; // ช่องที่ต้องเขียนด้วยมือ
  for (let r = 0; r < data.length; r++) {
    for (let c = 0; c < COLS; c++) {
      const ref = XLSX.utils.encode_cell({ r, c });
      const isItem = r > headRow && r <= lastItemRow;
      // ช่องว่างในตารางต้องมีเซลล์จริงถึงจะมีขอบ/พื้นสี
      if (!ws[ref] && (isItem || r === headRow)) ws[ref] = { t: 's', v: '' };
      const cell = ws[ref];
      if (!cell) continue;
      if (r === 0) cell.s = { font: { bold: true, sz: 14 } };
      else if (r < headRow) cell.s = { font: { sz: 10 }, alignment: { wrapText: r === 3, vertical: 'top' } };
      else if (r === headRow) {
        cell.s = {
          font: { bold: true, sz: 10 },
          alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
          fill: { fgColor: { rgb: 'E8E8E8' } },
          border,
        };
      } else if (isItem) {
        cell.s = {
          font: { sz: c === 2 || c === 3 ? 9 : 10, bold: c === 4 },
          alignment: {
            vertical: 'center',
            wrapText: c === 2 || c === 3,
            horizontal: c === 0 || c === 6 ? 'center' : c === 4 ? 'right' : 'left',
          },
          border,
          ...(c === 5 ? { fill: writeIn } : {}),
        };
      } else if (r >= signRow) {
        cell.s = r === signRow + 1
          ? { font: { sz: 10, color: { rgb: '555555' } }, alignment: { horizontal: 'center' } }
          : { font: { sz: 10 }, alignment: { horizontal: 'left' } };
      } else {
        cell.s = { font: { sz: 10 } };
      }
    }
  }
  // แถวแพลนที่นับอาจยาวหลายบรรทัด
  ws['!rows'] = [];
  ws['!rows'][3] = { hpt: Math.min(15 * Math.ceil((planList.length + 20) / 90), 75) };

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'ใบเบิก');

  // ชีทสรุปแพลน
  const planData = [['วันที่ผลิต', 'เมนู', 'จำนวนสูตร', 'ยอดผลิต', 'หน่วย', 'คำสั่งผลิต']];
  for (const p of plans) planData.push([dmy(p.date), p.name, fmtNum(p.batches), fmtNum(p.qty), p.unit || '', p.order || 'ยังไม่ออกคำสั่ง']);
  const ws2 = XLSX.utils.aoa_to_sheet(planData);
  ws2['!cols'] = [{ wch: 12 }, { wch: 36 }, { wch: 10 }, { wch: 10 }, { wch: 8 }, { wch: 26 }];
  for (let r = 0; r < planData.length; r++) {
    for (let c = 0; c < 6; c++) {
      const cell = ws2[XLSX.utils.encode_cell({ r, c })];
      if (!cell) continue;
      cell.s = r === 0
        ? { font: { bold: true, sz: 10 }, alignment: { horizontal: 'center' }, fill: { fgColor: { rgb: 'E8E8E8' } }, border }
        : { font: { sz: 10 }, alignment: { horizontal: c === 0 || c === 4 ? 'center' : c === 2 || c === 3 ? 'right' : 'left' }, border };
    }
  }
  XLSX.utils.book_append_sheet(wb, ws2, 'สรุปแพลน');

  XLSX.writeFile(wb, `ใบเบิกวัตถุดิบ_FCT_${deldate}${docNo ? `_${docNo}` : ''}.xlsx`);
}

const escapeHtml = (v) => String(v ?? '').replace(/[&<>"']/g, (ch) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

/**
 * ใบเบิกวัตถุดิบเป็น PDF ขนาด A4 แนวตั้ง — ตารางหน้าตาเดียวกับชีท "ใบเบิก" ของไฟล์ Excel
 *
 * ไม่ได้สร้างไฟล์ PDF เองด้วยไลบรารี (ต้องฝังฟอนต์ไทยหลายร้อย KB และตัดคำไทยเองไม่ได้)
 * แต่วางหน้าเอกสารลง iframe ที่ซ่อนไว้แล้วเรียกหน้าต่างพิมพ์ของเบราว์เซอร์ → เลือก "บันทึกเป็น PDF"
 * แบบเดียวกับปุ่มพิมพ์ใบเบิกของสโตร์ (RequisitionDetailModal ใช้ window.print())
 * ชื่อไฟล์ที่เบราว์เซอร์เสนอมาจาก <title> ของหน้า
 *
 * พารามิเตอร์ชุดเดียวกับ exportRequisitionExcel
 */
export function printRequisitionPdf({ docNo, deldate, planFrom, planTo, rows, plans }) {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const printedAt = `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const planList = plans.map((p) => `${p.name} ×${fmtNum(p.batches)} สูตร`).join(' · ');
  const title = `ใบเบิกวัตถุดิบ_FCT_${deldate}${docNo ? `_${docNo}` : ''}`;

  const itemRows = rows.map((r, i) => `
    <tr>
      <td class="c">${i + 1}</td>
      <td class="mono">${escapeHtml(r.code)}</td>
      <td>${escapeHtml(r.name)}</td>
      <td class="small">${escapeHtml(r.uses.map(([menu, b]) => `${menu} ×${fmtNum(b)}`).join(' · '))}</td>
      <td class="n b">${escapeHtml(fmtNum(r.qty))}</td>
      <td class="write"></td>
      <td class="c">${escapeHtml(r.unit)}</td>
    </tr>`).join('');

  const planRows = plans.map((p) => `
    <tr>
      <td class="c">${escapeHtml(dmy(p.date))}</td>
      <td>${escapeHtml(p.name)}</td>
      <td class="n">${escapeHtml(fmtNum(p.batches))}</td>
      <td class="n">${escapeHtml(fmtNum(p.qty))}</td>
      <td class="c">${escapeHtml(p.unit)}</td>
      <td>${escapeHtml(p.order || 'ยังไม่ออกคำสั่ง')}</td>
    </tr>`).join('');

  const html = `<!doctype html><html lang="th"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>
  @page { size: A4 portrait; margin: 10mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Tahoma, "Leelawadee UI", "Noto Sans Thai", "Sarabun", sans-serif; font-size: 10.5pt; color: #000; }
  h1 { font-size: 15pt; margin: 0 0 6px; }
  .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 2px 16px; margin-bottom: 4px; }
  .plans { margin: 2px 0 8px; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  th, td { border: 1px solid #999; padding: 3px 5px; vertical-align: middle; overflow-wrap: anywhere; }
  thead { display: table-header-group; }
  th { background: #e8e8e8; font-weight: bold; text-align: center; white-space: nowrap; padding: 4px 3px; }
  tr { page-break-inside: avoid; break-inside: avoid; }
  .c { text-align: center; } .n { text-align: right; } .b { font-weight: bold; }
  .small { font-size: 9pt; } .mono { font-size: 9.5pt; }
  .write { background: #fff7d6; }
  .total { margin: 8px 0 0; }
  .sign { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-top: 34px; text-align: center; break-inside: avoid; }
  .sign .who { color: #555; margin-top: 4px; }
  h2 { font-size: 12pt; margin: 18px 0 6px; break-after: avoid; }
  .plan-sheet { break-before: page; }
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
</style></head><body>
  <h1>ใบเบิกวัตถุดิบ ครัวกลาง (FCT)</h1>
  <div class="meta">
    <div>เลขที่ใบเบิก: ${escapeHtml(docNo || 'ยังไม่ได้ส่ง')}</div><div>วันที่ต้องการของ: ${escapeHtml(dmy(deldate))}</div>
    <div>แพลนผลิตวันที่: ${escapeHtml(dmy(planFrom))} ถึง ${escapeHtml(dmy(planTo))}</div><div>พิมพ์เมื่อ: ${printedAt}</div>
  </div>
  <div class="plans">แพลนที่นับ (${plans.length}): ${escapeHtml(planList || '-')}</div>
  <table>
    <colgroup><col style="width:7%"><col style="width:11%"><col style="width:26%"><col style="width:30%"><col style="width:9%"><col style="width:10%"><col style="width:7%"></colgroup>
    <thead><tr><th>ลำดับ</th><th>รหัส</th><th>วัตถุดิบ</th><th>ใช้ผลิต (เมนู × สูตร)</th><th>ตามสูตร</th><th>เบิกจริง</th><th>หน่วย</th></tr></thead>
    <tbody>${itemRows}</tbody>
  </table>
  <div class="total">รวม ${rows.length} รายการ</div>
  <div class="sign">
    <div>ผู้เบิก ..............................<div class="who">(ครัวกลาง)</div></div>
    <div>ผู้จ่าย ..............................<div class="who">(สโตร์)</div></div>
    <div>ผู้รับ ..............................<div class="who">(ครัวกลาง)</div></div>
  </div>
  <div class="plan-sheet">
    <h2>สรุปแพลน</h2>
    <table>
      <colgroup><col style="width:13%"><col style="width:34%"><col style="width:11%"><col style="width:10%"><col style="width:7%"><col style="width:25%"></colgroup>
      <thead><tr><th>วันที่ผลิต</th><th>เมนู</th><th>จำนวนสูตร</th><th>ยอดผลิต</th><th>หน่วย</th><th>คำสั่งผลิต</th></tr></thead>
      <tbody>${planRows}</tbody>
    </table>
  </div>
</body></html>`;

  // iframe ที่ซ่อนไว้ — ไม่ต้องเปิดแท็บใหม่ (ไม่โดนตัวกันป๊อปอัพ) และไม่ต้องยุ่งกับสไตล์ของหน้าแอป
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  doc.open();
  doc.write(html);
  doc.close();
  // ชื่อไฟล์ PDF ที่ Chrome เสนอบางรุ่นมาจาก title ของหน้าหลัก ไม่ใช่ของ iframe — สลับชั่วคราวแล้วคืน
  const prevTitle = document.title;
  const restore = () => { document.title = prevTitle; };
  const cleanup = () => { restore(); setTimeout(() => frame.remove(), 1000); };
  const run = () => {
    try {
      document.title = title;
      frame.contentWindow.focus();
      frame.contentWindow.addEventListener('afterprint', cleanup, { once: true });
      frame.contentWindow.print();
    } finally {
      // เบราว์เซอร์บางตัวไม่ยิง afterprint — กันไว้ไม่ให้ iframe ค้าง
      setTimeout(() => { restore(); if (frame.isConnected) frame.remove(); }, 60000);
    }
  };
  // รอฟอนต์โหลดครบก่อนพิมพ์ ไม่งั้นหน้าแรกอาจออกมาเป็นฟอนต์สำรอง
  if (doc.fonts?.ready) doc.fonts.ready.then(run); else setTimeout(run, 300);
}
