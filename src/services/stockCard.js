// สต๊อกการ์ดวัตถุดิบครัวกลาง — เดินยอดรายวันจากยอดยกมา + ความเคลื่อนไหว (getKitchenStockCard ของ office-server)
//
// กติกาเดียวกับ getKitchenBalance: วันที่มียอดนับ คงเหลือสิ้นวัน = ยอดนับล่าสุดของวันนั้น และรายการอื่นของวันเดียวกัน
// ไม่ถูกรวม (ใบรับ/ใบเบิกเก็บแค่วันที่ ไม่มีเวลา เทียบก่อน/หลังการนับไม่ได้) — ยอดในการ์ดจึงตรงกับหน้าคงเหลือเสมอ

import { shiftYmd } from './kitchenService';

const r3 = (n) => Math.round(n * 1000) / 1000;

/**
 * @param {number} opening  คงเหลือ ณ สิ้นวันก่อน from
 * @param {Array<{ kind, date, at, doc_no, ref, qty, loss_qty }>} events
 * @returns {Array<{ date, open, received, issued, loss, produced, count, close, events }>}
 */
export function buildStockCard(opening, events, from, to) {
  const byDate = new Map();
  for (const e of events || []) {
    const d = String(e.date).slice(0, 10);
    if (!byDate.has(d)) byDate.set(d, []);
    byDate.get(d).push(e);
  }
  const days = [];
  let bal = Number(opening) || 0;
  for (let d = from; d <= to && days.length < 400; d = shiftYmd(d, 1)) {
    const ev = byDate.get(d) || [];
    const sum = (kinds) => r3(ev.filter((e) => kinds.includes(e.kind)).reduce((s, e) => s + (Number(e.qty) || 0), 0));
    const received = sum(['receipt', 'store']);
    const issued = sum(['issue']);
    const produced = sum(['produce']);
    const loss = r3(ev.filter((e) => e.kind === 'issue').reduce((s, e) => s + (Number(e.loss_qty) || 0), 0));
    const counts = ev.filter((e) => e.kind === 'count').sort((a, b) => String(a.at).localeCompare(String(b.at)));
    const count = counts.length ? Number(counts[counts.length - 1].qty) : null;
    const open = r3(bal);
    bal = count !== null ? count : bal + received - issued + produced;
    days.push({ date: d, open, received, issued, loss, produced, count, close: r3(bal), events: ev });
  }
  return days;
}

/** ช่วงวันที่ลัด — สัปดาห์เริ่มวันจันทร์ */
export function quickRange(kind, today) {
  const [y, m, d] = today.split('-').map(Number);
  if (kind === 'today') return [today, today];
  if (kind === 'week') {
    const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = อาทิตย์
    return [shiftYmd(today, -((wd + 6) % 7)), today];
  }
  if (kind === 'month') return [`${y}-${String(m).padStart(2, '0')}-01`, today];
  if (kind === 'lastMonth') {
    const first = new Date(Date.UTC(y, m - 2, 1));
    const last = new Date(Date.UTC(y, m - 1, 0));
    return [first.toISOString().slice(0, 10), last.toISOString().slice(0, 10)];
  }
  return [today, today];
}
