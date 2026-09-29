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
 * ช่อง "เบิกจริง" และ "จ่ายจริง" เว้นว่างเสมอ ให้เขียนด้วยมือบนกระดาษ
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

  const COLS = 8;
  const data = [
    ['ใบเบิกวัตถุดิบ ครัวกลาง (FCT)'],
    [`เลขที่ใบเบิก: ${docNo || 'ยังไม่ได้ส่ง'}`, '', '', `วันที่ต้องการของ: ${dmy(deldate)}`],
    [`แพลนผลิตวันที่: ${dmy(planFrom)} ถึง ${dmy(planTo)}`, '', '', `พิมพ์เมื่อ: ${printedAt}`],
    [`แพลนที่นับ (${plans.length}): ${planList || '-'}`],
    [],
  ];
  const headRow = data.length;
  data.push(['ลำดับ', 'รหัส', 'วัตถุดิบ', 'ใช้ผลิต (เมนู × สูตร)', 'ตามสูตร', 'เบิกจริง', 'หน่วย', 'จ่ายจริง']);
  rows.forEach((r, i) => {
    data.push([
      i + 1,
      r.code || '',
      r.name || '',
      r.uses.map(([menu, b]) => `${menu} ×${fmtNum(b)}`).join(' · '),
      fmtNum(r.qty),
      '', // เบิกจริง — เขียนด้วยมือ
      r.unit || '',
      '', // จ่ายจริง — สโตร์เขียนด้วยมือ
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
  ws['!cols'] = [{ wch: 5 }, { wch: 9 }, { wch: 22 }, { wch: 26 }, { wch: 8 }, { wch: 9 }, { wch: 6 }, { wch: 8 }];
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
          ...(c === 5 || c === 7 ? { fill: writeIn } : {}),
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
