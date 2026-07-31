import express from 'express';
import mysql from 'mysql2/promise';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import iconv from 'iconv-lite';

// Parse .env if present
try {
  if (fs.existsSync('.env')) {
    const envFile = fs.readFileSync('.env', 'utf8');
    envFile.split('\n').forEach(line => {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match) {
        const key = match[1];
        let value = match[2] || '';
        if (value.length > 0 && value.startsWith('"') && value.endsWith('"')) {
          value = value.substring(1, value.length - 1);
        }
        process.env[key] = value.trim();
      }
    });
  }
} catch (e) {
  console.warn("Could not parse .env file", e);
}

const app = express();
app.use(cors());
app.use(express.json());

let pool;
function getPool() {
  if (!pool) {
    const required = ['MYSQL_HOST', 'MYSQL_USER', 'MYSQL_PASSWORD', 'MYSQL_DATABASE'];
    const missing = required.filter(k => !process.env[k]);
    if (missing.length > 0) {
      throw new Error(`Missing required database environment variables: ${missing.join(', ')}. Set them in .env (local) or your hosting provider's environment settings.`);
    }
    pool = mysql.createPool({
      host: process.env.MYSQL_HOST,
      port: Number(process.env.MYSQL_PORT) || 3306,
      user: process.env.MYSQL_USER,
      password: process.env.MYSQL_PASSWORD,
      database: process.env.MYSQL_DATABASE,
      waitForConnections: true,
      connectionLimit: 10,
      connectTimeout: 15000,
    });
  }
  return pool;
}

const r2 = (n) => Number((Number(n) || 0).toFixed(2));

// Safe text decoder for TIS-620 / UTF-8 buffers from legacy MySQL
function decodeText(val) {
  if (!val) return '';
  if (Buffer.isBuffer(val)) {
    try {
      const tis = iconv.decode(val, 'tis620').trim();
      if (tis && !tis.includes('')) return tis;
      return iconv.decode(val, 'utf8').trim();
    } catch (e) {
      return val.toString().trim();
    }
  }
  return String(val).trim();
}

// Store Categories loaded from Google Sheet (Col N)
let itemCategoryMapByCode = {};
let itemCategoryMapById = {};

async function loadGoogleSheetItemCategories() {
  try {
    const url = 'https://docs.google.com/spreadsheets/d/1v8WRTaUiEqjtRXzX2g2i5Z8p9FAUvQ37gkdZC8TzhWw/gviz/tq?tqx=out:json&gid=302875824';
    const res = await fetch(url);
    if (!res.ok) return;
    const text = await res.text();
    const a = text.indexOf('{');
    const b = text.lastIndexOf('}');
    if (a === -1 || b === -1) return;
    const json = JSON.parse(text.substring(a, b + 1));
    
    const byCode = {};
    const byId = {};

    (json.table.rows || []).forEach(row => {
      const c = row.c || [];
      const code = c[0]?.v != null ? String(c[0].v).trim() : '';
      const itemId = c[10]?.v != null ? String(c[10].v).trim() : '';
      const category = c[13]?.v != null ? String(c[13].v).trim() : '';

      if (category) {
        if (code) byCode[code] = category;
        if (code) byCode[code.replace(/^0+/, '')] = category;
        if (itemId) byId[itemId] = category;
      }
    });

    itemCategoryMapByCode = byCode;
    itemCategoryMapById = byId;
    console.log(`✅ Loaded Google Sheet item categories: ${Object.keys(byCode).length} codes, ${Object.keys(byId).length} itemIds`);
  } catch (err) {
    console.warn("Error loading Google Sheet item categories:", err.message);
  }
}

// Initial load + refresh every 1 hour
loadGoogleSheetItemCategories();
setInterval(loadGoogleSheetItemCategories, 60 * 60 * 1000);

// Stock Count Summary loaded from Google Sheet "ข้อมูลนับสตอค"
// Each row is one count event (date, branch, item, qty). We keep only the LATEST
// row per (branch, item) and sum those latest balances across branches per item.
const STOCK_COUNT_SHEET_ID = '1xegMuvTYJ9A5E_Wj8J2orc-fp7fSq_lCOXZCQK0eKBQ';
const STOCK_COUNT_GID = '923363118';
let stockCountSummaryCache = { items: [], branches: [], loadedAt: null };

// Parses the sheet's formatted date string ("dd/mm/yyyy" or "dd/mm/yyyy HH:MM:SS") into a comparable number.
function parseSheetDateCell(cell) {
  const f = cell?.f;
  if (!f) return 0;
  const m = f.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}):(\d{2}))?$/);
  if (!m) return 0;
  const [, dd, mm, yyyy, hh, mi, ss] = m;
  return Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd), Number(hh || 0), Number(mi || 0), Number(ss || 0));
}

async function loadStockCountSummary() {
  try {
    const url = `https://docs.google.com/spreadsheets/d/${STOCK_COUNT_SHEET_ID}/gviz/tq?tqx=out:json&gid=${STOCK_COUNT_GID}`;
    const res = await fetch(url);
    if (!res.ok) return;
    const text = await res.text();
    const a = text.indexOf('{');
    const b = text.lastIndexOf('}');
    if (a === -1 || b === -1) return;
    const json = JSON.parse(text.substring(a, b + 1));
    const rows = json.table.rows || [];

    // latestByBranch[branch][itemKey] = { tsVal, qty, name, unit, code }
    const latestByBranch = {};

    for (const row of rows) {
      const c = row.c || [];
      const branch = c[2]?.v ? String(c[2].v).trim().toLowerCase() : '';
      if (!branch) continue;

      const rawCode = c[3]?.v;
      const code = (rawCode !== null && rawCode !== undefined && rawCode !== '')
        ? String(Math.round(rawCode))
        : '';
      const name = c[4]?.v ? String(c[4].v).trim() : '';
      if (!code && !name) continue;

      const unit = c[5]?.v ? String(c[5].v).trim() : '';
      const qty = Number(c[6]?.v) || 0;
      const tsVal = parseSheetDateCell(c[0]);

      // Items without a registered code are grouped by name instead, so they still count.
      const itemKey = code || ('NAME:' + name);

      if (!latestByBranch[branch]) latestByBranch[branch] = {};
      const bucket = latestByBranch[branch];
      const existing = bucket[itemKey];
      // >= so that, on tied/unparsed timestamps, the row appearing later in the sheet wins
      // (new counts are appended to the bottom of the sheet).
      if (!existing || tsVal >= existing.tsVal) {
        bucket[itemKey] = { tsVal, qty, name, unit, code };
      }
    }

    // Merge each branch's latest counts into one item master list with per-branch balances.
    const itemsMap = {};
    for (const branch of Object.keys(latestByBranch)) {
      for (const itemKey of Object.keys(latestByBranch[branch])) {
        const rec = latestByBranch[branch][itemKey];
        if (!itemsMap[itemKey]) {
          itemsMap[itemKey] = { code: rec.code, name: rec.name, unit: rec.unit, balances: {} };
        }
        const item = itemsMap[itemKey];
        if (rec.name && rec.name.length > (item.name || '').length) item.name = rec.name;
        if (!item.unit && rec.unit) item.unit = rec.unit;
        item.balances[branch] = rec.qty;
      }
    }

    // Look up price from the live item master table (myfbdata.item) by code.
    let priceMap = {};
    try {
      const dbPool = getPool();
      const [priceRows] = await dbPool.query('SELECT Itm_Code AS code, Itm_LastPrice AS lastPrice, Itm_AvePrice AS avePrice FROM item');
      priceRows.forEach(r => {
        const code = decodeText(r.code);
        if (!code) return;
        const price = r2(r.lastPrice || r.avePrice || 0);
        priceMap[code] = price;
        priceMap[code.replace(/^0+/, '')] = price;
      });
    } catch (dbErr) {
      console.warn("Stock count summary: could not load item prices from DB:", dbErr.message);
    }

    const items = Object.values(itemsMap).map(item => {
      const cleanCode = (item.code || '').replace(/^0+/, '');
      const price = priceMap[item.code] ?? priceMap[cleanCode] ?? 0;
      const category = item.code ? getCategoryForItem(item.code, '') : 'อื่นๆ';
      return {
        code: item.code || '',
        name: item.name || '(ไม่ทราบชื่อ)',
        category,
        unit: item.unit || '-',
        price,
        balances: item.balances
      };
    });

    stockCountSummaryCache = {
      items,
      branches: Object.keys(latestByBranch),
      loadedAt: new Date().toISOString()
    };
    console.log(`✅ Loaded Stock Count Summary: ${items.length} items across ${Object.keys(latestByBranch).length} branches (${rows.length} raw rows)`);
  } catch (err) {
    console.warn("Error loading Stock Count Summary sheet:", err.message);
  }
}

// Initial load + refresh every 15 minutes
loadStockCountSummary();
setInterval(loadStockCountSummary, 15 * 60 * 1000);

// Branch Receiving Status — reads the "รับของ" sheet tab (written by the narai-branch app's
// "รับสินค้า" page) so the warehouse side (this app) can show "สาขารับของแล้ว" (branch has
// received) per requisition, without the branch and warehouse apps talking to each other directly.
const RECEIVE_SHEET_GID = '1358423318'; // gid of "รับของ" tab, same spreadsheet as "จัดของ"
let receivedStatusCache = { receivedDocNos: {}, loadedAt: null };

async function loadReceivedStatus() {
  try {
    const url = `https://docs.google.com/spreadsheets/d/1bxohT8wK4ySAJgqGHEg9JHp0KJJKG7SVUEhJksBgBSI/gviz/tq?tqx=out:json&gid=${RECEIVE_SHEET_GID}`;
    const res = await fetch(url);
    if (!res.ok) return;
    const text = await res.text();
    const a = text.indexOf('{');
    const b = text.lastIndexOf('}');
    if (a === -1 || b === -1) return;
    const json = JSON.parse(text.substring(a, b + 1));
    const rows = json.table.rows || [];

    // Columns: A วันที่รับ, B สาขา, C เลขที่ใบเบิก, ... I สถานะ, ... M เวลาบันทึก
    const receivedDocNos = {};
    rows.forEach(row => {
      const c = row.c || [];
      const docNo = c[2]?.v ? String(c[2].v).trim() : '';
      if (!docNo) return;
      const branch = c[1]?.v ? String(c[1].v).trim() : '';
      const itemStatus = c[8]?.v ? String(c[8].v).trim() : '';
      const recordedAt = c[12]?.f || c[12]?.v || '';

      if (!receivedDocNos[docNo]) {
        receivedDocNos[docNo] = { branch, itemCount: 0, hasEdit: false, lastRecordedAt: recordedAt };
      }
      receivedDocNos[docNo].itemCount++;
      if (itemStatus === 'แก้ไข') receivedDocNos[docNo].hasEdit = true;
      receivedDocNos[docNo].lastRecordedAt = recordedAt; // rows are appended in order, last one wins
    });

    receivedStatusCache = { receivedDocNos, loadedAt: new Date().toISOString() };
    console.log(`✅ Loaded Branch Receiving Status: ${Object.keys(receivedDocNos).length} requisitions (${rows.length} raw rows)`);
  } catch (err) {
    console.warn("Error loading Branch Receiving Status sheet:", err.message);
  }
}

// Initial load + refresh every 15 minutes
loadReceivedStatus();
setInterval(loadReceivedStatus, 15 * 60 * 1000);

// "ดึงข้อมูลแล้ว" Status — reads the "ดึงข้อมูลใบเบิก" sheet tab (an audit log appended to by
// /api/mark_fetched below) so the fetched flag survives across serverless invocations. The
// local fetched_status.json file written by /api/mark_fetched is best-effort only and does NOT
// persist on read-only/ephemeral filesystems (e.g. Vercel) — this sheet-backed cache is the
// durable source of truth, same pattern as loadReceivedStatus() above.
// No gid is known ahead of time (the tab is created on-demand by Apps Script), so it's fetched
// by name via gviz's `sheet=` parameter instead of `gid=`.
const FETCHED_SHEET_NAME = 'ดึงข้อมูลใบเบิก';
let fetchedStatusSheetCache = { fetchedDocNos: {}, loadedAt: null };

async function loadFetchedStatusFromSheet() {
  try {
    const url = `https://docs.google.com/spreadsheets/d/1bxohT8wK4ySAJgqGHEg9JHp0KJJKG7SVUEhJksBgBSI/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(FETCHED_SHEET_NAME)}`;
    const res = await fetch(url);
    if (!res.ok) return; // tab doesn't exist yet (no one has marked anything fetched) — keep empty cache
    const text = await res.text();
    const a = text.indexOf('{');
    const b = text.lastIndexOf('}');
    if (a === -1 || b === -1) return;
    const json = JSON.parse(text.substring(a, b + 1));
    const rows = json.table.rows || [];

    // Columns: A วันที่ B สาขา C เลขที่ใบเบิก D เวลาบันทึก
    const fetchedDocNos = {};
    rows.forEach(row => {
      const c = row.c || [];
      const docNo = c[2]?.v ? String(c[2].v).trim() : '';
      if (!docNo) return;
      fetchedDocNos[docNo] = {
        branch: c[1]?.v ? String(c[1].v).trim() : '',
        date: c[0]?.f || c[0]?.v || '',
        fetchedAt: c[3]?.f || c[3]?.v || ''
      }; // rows are appended in order, last one for a given docNo wins
    });

    fetchedStatusSheetCache = { fetchedDocNos, loadedAt: new Date().toISOString() };
    console.log(`✅ Loaded Fetched-Status Sheet: ${Object.keys(fetchedDocNos).length} requisitions (${rows.length} raw rows)`);
  } catch (err) {
    console.warn("Error loading Fetched-Status sheet:", err.message);
  }
}

// Initial load + refresh every 15 minutes
loadFetchedStatusFromSheet();
setInterval(loadFetchedStatusFromSheet, 15 * 60 * 1000);

// Cancelled Requisitions ("ยกใบเบิก") — reads the "ยกเลิกใบเบิก" sheet tab (logged externally
// whenever a requisition is withdrawn/cancelled) so the Requisition Calendar can hide these
// entirely and the Status Check page can flag them instead of showing them as just "pending".
// Same spreadsheet as the other tabs; fetched by name since its gid isn't known ahead of time.
const CANCELLED_SHEET_NAME = 'ยกเลิกใบเบิก';
let cancelledStatusCache = { cancelledDocNos: {}, loadedAt: null };

async function loadCancelledStatus() {
  try {
    const url = `https://docs.google.com/spreadsheets/d/1bxohT8wK4ySAJgqGHEg9JHp0KJJKG7SVUEhJksBgBSI/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(CANCELLED_SHEET_NAME)}`;
    const res = await fetch(url);
    if (!res.ok) return;
    const text = await res.text();
    const a = text.indexOf('{');
    const b = text.lastIndexOf('}');
    if (a === -1 || b === -1) return;
    const json = JSON.parse(text.substring(a, b + 1));
    const rows = json.table.rows || [];

    // Columns: A วันที่สั่ง B สาขา C เลขที่ใบเบิก D วันที่รับ E จำนวนรายการ F ผู้บันทึก G เวลาที่ยกเลิก
    const cancelledDocNos = {};
    rows.forEach(row => {
      const c = row.c || [];
      const branch = c[1]?.v ? String(c[1].v).trim() : '';
      const rawNo = c[2]?.v;
      if (rawNo === null || rawNo === undefined || rawNo === '') return; // no doc number to attribute this row to
      const docNo = `${branch.toUpperCase()}-${Math.round(Number(rawNo))}`;
      cancelledDocNos[docNo] = {
        branch,
        deldate: c[3]?.f || c[3]?.v || '',
        itemCount: Number(c[4]?.v) || 0,
        recorder: c[5]?.v ? String(c[5].v).trim() : '',
        cancelledAt: c[6]?.f || c[6]?.v || ''
      };
    });

    cancelledStatusCache = { cancelledDocNos, loadedAt: new Date().toISOString() };
    console.log(`✅ Loaded Cancelled Requisitions: ${Object.keys(cancelledDocNos).length} docs (${rows.length} raw rows)`);
  } catch (err) {
    console.warn("Error loading Cancelled Requisitions sheet:", err.message);
  }
}

// Initial load + refresh every 15 minutes
loadCancelledStatus();
setInterval(loadCancelledStatus, 15 * 60 * 1000);

// Helper to determine category from Google Sheet
function getCategoryForItem(code, itemId) {
  const cStr = String(code || '').trim();
  const idStr = String(itemId || '').trim();
  const cleanCode = cStr.replace(/^0+/, '');

  if (itemCategoryMapByCode[cStr]) return itemCategoryMapByCode[cStr];
  if (itemCategoryMapByCode[cleanCode]) return itemCategoryMapByCode[cleanCode];
  if (itemCategoryMapById[idStr]) return itemCategoryMapById[idStr];

  return 'อื่นๆ';
}

// Header-list results are cached briefly in memory: the underlying `orderd` table has
// 2.2M+ rows with no index on the date columns this query filters/sorts by, so each
// uncached call takes several seconds. Caching turns repeat navigations (switching pages,
// re-opening the branch dropdown) into an instant response instead of re-running that scan.
const pendingOrdersListCache = new Map(); // key: `${outletId}|${backDays}` -> { payload, expiresAt }
const PENDING_ORDERS_CACHE_TTL_MS = 60 * 1000;

// GET /api/pending_orders?outletId=12[&no=3451][&days=365][&daysAhead=30]
app.get('/api/pending_orders', async (req, res) => {
  const { outletId, days, daysAhead, no } = req.query;

  try {
    const dbPool = getPool();

    // Query item details for a specific order document from myfbdata.orderd joined with myfbdata.item
    if (no) {
      const cleanNo = String(no).replace(/[^0-9]/g, '');
      let queryStr = `
        SELECT o.Ord_Seq AS seq,
               o.Ord_ItmID AS itemId,
               o.Ord_itemCode AS rawItemCode,
               i.Itm_Code AS masterItemCode,
               o.Ord_ItemName AS rawItemName,
               i.Itm_Name AS masterItemName,
               o.Ord_Qty AS qty,
               o.Ord_Unit AS rawUnit,
               i.Itm_IssUnit AS masterUnit,
               o.Ord_UnPr AS unitPrice,
               i.Itm_LastPrice AS lastPrice,
               i.Itm_AvePrice AS avePrice,
               o.Ord_Rcv AS received
          FROM orderd o
          LEFT JOIN item i ON o.Ord_ItmID = i.Itm_ID
         WHERE o.Ord_No = ?
      `;
      const queryParams = [Number(cleanNo || no)];

      if (outletId && outletId !== 'ALL' && outletId !== 'undefined') {
        queryStr += ` AND o.Ord_StrID = ?`;
        queryParams.push(Number(outletId));
      }

      queryStr += ` ORDER BY o.Ord_Seq`;

      const [items] = await dbPool.query(queryStr, queryParams);

      return res.json({
        status: 'success',
        no: Number(cleanNo || no),
        count: items.length,
        items: items.map(it => {
          const rawCode = decodeText(it.rawItemCode);
          const masterCode = decodeText(it.masterItemCode);
          const rawName = decodeText(it.rawItemName);
          const masterName = decodeText(it.masterItemName);
          const unitStr = decodeText(it.rawUnit) || 'ชิ้น';

          const finalCode = rawCode || masterCode || String(it.itemId);
          const finalName = rawName || masterName || `สินค้า (ID: ${it.itemId})`;
          const price = r2(it.unitPrice || it.lastPrice || it.avePrice || 0);

          const category = getCategoryForItem(finalCode, it.itemId);

          return {
            seq: it.seq,
            itemId: it.itemId,
            itemCode: finalCode,
            itemName: finalName,
            category: category,
            qty: r2(it.qty),
            unit: unitStr,
            unitPrice: price,
            amount: r2(it.qty * price),
            received: Boolean(it.received)
          };
        })
      });
    }

    // Query real requisition header list from myfbdata.orderd joined with myfbdata.store for exact Str_Name
    const backDays = Math.min(Number(days) || 365, 730);
    // forwardDays bounds how far into the future a row can be. Without this, rows with
    // bad/typo'd future dates (e.g. year 3017, or Buddhist/Gregorian mixups) sort to the
    // very top (ORDER BY deldate DESC) and can crowd genuinely relevant rows out of LIMIT 500.
    const forwardDays = daysAhead !== undefined ? Math.min(Number(daysAhead) || 0, 730) : null;

    const cacheKey = `${outletId || 'ALL'}|${backDays}|${forwardDays ?? 'inf'}`;
    const cached = pendingOrdersListCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return res.json(cached.payload);
    }

    let whereConditions = [];
    let queryParams = [];

    if (outletId && outletId !== 'ALL' && outletId !== 'undefined') {
      whereConditions.push(`o.Ord_StrID = ?`);
      queryParams.push(Number(outletId));
    }

    // Filter by recent periods (+ optional forward bound)
    if (forwardDays !== null) {
      whereConditions.push(`(
        o.Ord_DelDate BETWEEN DATE_SUB(CURDATE(), INTERVAL ? DAY) AND DATE_ADD(CURDATE(), INTERVAL ? DAY)
        OR o.Ord_OrdDate BETWEEN DATE_SUB(CURDATE(), INTERVAL ? DAY) AND DATE_ADD(CURDATE(), INTERVAL ? DAY)
      )`);
      queryParams.push(backDays, forwardDays, backDays, forwardDays);
    } else {
      whereConditions.push(`(o.Ord_DelDate >= DATE_SUB(CURDATE(), INTERVAL ? DAY) OR o.Ord_OrdDate >= DATE_SUB(CURDATE(), INTERVAL ? DAY))`);
      queryParams.push(backDays, backDays);
    }

    const whereSql = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

    const sql = `
      SELECT o.Ord_StrID AS outletId,
             s.Str_Name AS rawStoreName,
             o.Ord_No AS no,
             DATE_FORMAT(o.Ord_OrdDate, '%Y-%m-%d') AS orderDate,
             DATE_FORMAT(o.Ord_DelDate, '%Y-%m-%d') AS deldate,
             COUNT(*) AS itemCount,
             SUM(o.Ord_Qty) AS totalQty,
             SUM(COALESCE(o.Ord_Rcv, 0)) AS receivedQty
        FROM orderd o
        LEFT JOIN store s ON o.Ord_StrID = s.Str_ID
      ${whereSql}
       GROUP BY o.Ord_StrID, s.Str_Name, o.Ord_No, o.Ord_OrdDate, o.Ord_DelDate
       ORDER BY o.Ord_DelDate DESC, o.Ord_No DESC
       LIMIT 500
    `;

    const [rows] = await dbPool.query(sql, queryParams);
    const fetchedStatusMap = loadFetchedStatusMap();

    const all = rows.map(r => {
      const dbBranchName = decodeText(r.rawStoreName) || String(r.outletId);
      const fetchedEntry = fetchedStatusMap[`${r.outletId}|${r.no}`];
      return {
        outletId: r.outletId,
        branchName: dbBranchName,
        no: r.no,
        orderDate: r.orderDate,
        deldate: r.deldate,
        itemCount: Number(r.itemCount),
        totalQty: r2(r.totalQty),
        received: Number(r.receivedQty) > 0,
        status: Number(r.receivedQty) > 0 ? 'รับของแล้ว' : 'รอรับของ',
        dataFetched: Boolean(fetchedEntry),
        fetchedAt: fetchedEntry?.fetchedAt || null,
      };
    });

    const payload = {
      status: 'success',
      count: all.length,
      data: all.filter(o => !o.received),
      all
    };
    pendingOrdersListCache.set(cacheKey, { payload, expiresAt: Date.now() + PENDING_ORDERS_CACHE_TTL_MS });
    return res.json(payload);
  } catch (err) {
    console.error("API /api/pending_orders Error:", err.message);
    return res.status(500).json({ status: 'error', message: err.message });
  }
});

// GET /api/stock_count_summary
// Consolidated stock balances built from the latest count entry per (branch, item)
// in the "ข้อมูลนับสตอค" Google Sheet, summed across all branches.
app.get('/api/stock_count_summary', async (req, res) => {
  try {
    if (!stockCountSummaryCache.loadedAt) {
      await loadStockCountSummary();
    }
    return res.json({ status: 'success', ...stockCountSummaryCache });
  } catch (err) {
    console.error("API /api/stock_count_summary Error:", err.message);
    return res.status(500).json({ status: 'error', message: err.message });
  }
});

// GET /api/received_status
// Which requisitions the branch has already received/confirmed, from the "รับของ" sheet
// (written by the narai-branch app's "รับสินค้า" page).
app.get('/api/received_status', async (req, res) => {
  try {
    if (!receivedStatusCache.loadedAt) {
      await loadReceivedStatus();
    }
    return res.json({ status: 'success', ...receivedStatusCache });
  } catch (err) {
    console.error("API /api/received_status Error:", err.message);
    return res.status(500).json({ status: 'error', message: err.message });
  }
});

// GET /api/fetched_status
// Which requisitions have been marked "ดึงข้อมูลแล้ว", read back from the sheet-backed cache
// above (durable across serverless restarts, unlike the local fetched_status.json file).
app.get('/api/fetched_status', async (req, res) => {
  try {
    if (!fetchedStatusSheetCache.loadedAt) {
      await loadFetchedStatusFromSheet();
    }
    return res.json({ status: 'success', ...fetchedStatusSheetCache });
  } catch (err) {
    console.error("API /api/fetched_status Error:", err.message);
    return res.status(500).json({ status: 'error', message: err.message });
  }
});

// GET /api/cancelled_status
// Which requisitions have been cancelled ("ยกใบเบิก"), read from the "ยกเลิกใบเบิก" sheet-backed
// cache above.
app.get('/api/cancelled_status', async (req, res) => {
  try {
    if (!cancelledStatusCache.loadedAt) {
      await loadCancelledStatus();
    }
    return res.json({ status: 'success', ...cancelledStatusCache });
  } catch (err) {
    console.error("API /api/cancelled_status Error:", err.message);
    return res.status(500).json({ status: 'error', message: err.message });
  }
});

// Fetch and parse one Google Sheet tab's rows via the public gviz endpoint.
// Used for on-demand per-requisition lookups (small sheets, low request frequency —
// not worth the periodic-cache machinery used for the larger stock/pending-order data).
async function fetchGvizRows(gid) {
  const url = `https://docs.google.com/spreadsheets/d/1bxohT8wK4ySAJgqGHEg9JHp0KJJKG7SVUEhJksBgBSI/gviz/tq?tqx=out:json&gid=${gid}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('โหลดข้อมูลจาก Google Sheet ไม่สำเร็จ');
  const text = await res.text();
  const a = text.indexOf('{');
  const b = text.lastIndexOf('}');
  if (a === -1 || b === -1) throw new Error('รูปแบบข้อมูลจาก Google Sheet ไม่ถูกต้อง');
  const json = JSON.parse(text.substring(a, b + 1));
  return json.table.rows || [];
}

// "ยอดคงเหลือไอเทม" tab (same spreadsheet as จัดของ/รับของ) — as of writing this tab is still
// completely empty (no header row yet), so its column layout isn't finalized. Columns are
// matched by header keyword ("รหัส" for item code, "คงเหลือ" for the balance value, "ชื่อ"/"หน่วย"
// if present) instead of fixed position, so this keeps working whichever order the columns end
// up in once someone populates it.
const ITEM_BALANCE_GID = '656669133';

async function loadItemBalanceMap() {
  try {
    const url = `https://docs.google.com/spreadsheets/d/1bxohT8wK4ySAJgqGHEg9JHp0KJJKG7SVUEhJksBgBSI/gviz/tq?tqx=out:json&gid=${ITEM_BALANCE_GID}`;
    const res = await fetch(url);
    if (!res.ok) return {};
    const text = await res.text();
    const a = text.indexOf('{');
    const b = text.lastIndexOf('}');
    if (a === -1 || b === -1) return {};
    const json = JSON.parse(text.substring(a, b + 1));
    const cols = json.table.cols || [];
    let rows = json.table.rows || [];
    if (rows.length === 0) return {};

    // Google's gviz sometimes detects a text header row as real column labels (exposed via
    // `cols[].label`), and sometimes just includes it as an ordinary first data row — handle both.
    let headerTexts = cols.map(c => c?.label ? String(c.label).trim() : '');
    if (headerTexts.every(h => !h)) {
      headerTexts = (rows[0].c || []).map(c => c?.v ? String(c.v).trim() : '');
      rows = rows.slice(1);
    }

    const codeIdx = headerTexts.findIndex(h => h.includes('รหัส'));
    const balanceIdx = headerTexts.findIndex(h => h.includes('คงเหลือ'));
    const nameIdx = headerTexts.findIndex(h => h.includes('ชื่อ'));
    const unitIdx = headerTexts.findIndex(h => h.includes('หน่วย'));
    if (codeIdx === -1 || balanceIdx === -1) return {};

    const balanceMap = {};
    rows.forEach(row => {
      const c = row.c || [];
      const code = c[codeIdx]?.v ? String(c[codeIdx].v).replace(/^'/, '').trim() : '';
      if (!code) return;
      const remainingRaw = c[balanceIdx]?.v;
      balanceMap[code] = {
        remaining: (remainingRaw !== null && remainingRaw !== undefined && remainingRaw !== '') ? Number(remainingRaw) : null,
        name: nameIdx !== -1 ? (c[nameIdx]?.v ? String(c[nameIdx].v).trim() : '') : '',
        unit: unitIdx !== -1 ? (c[unitIdx]?.v ? String(c[unitIdx].v).trim() : '') : ''
      };
    });
    return balanceMap;
  } catch (err) {
    console.warn("Error loading item balance map:", err.message);
    return {};
  }
}

// Same lack-of-index issue as the pending_orders header list (2.2M+ row table, no index on
// Ord_DelDate) — a query here takes several seconds regardless of range size. Cache briefly so
// switching between presets or reloading within a short window doesn't repeat the full scan.
// Caches the in-flight PROMISE (not just the resolved value) so two requests for the same range
// arriving close together (e.g. React StrictMode's double effect-invocation in dev, or a
// double-click) share one query instead of both hitting the DB.
const deliverySummaryCache = new Map(); // key: `${startDate}|${endDate}` -> { promise, expiresAt }
const DELIVERY_SUMMARY_CACHE_TTL_MS = 60 * 1000;

async function computeDeliverySummary(startDate, endDate) {
  const dbPool = getPool();
  const sql = `
    SELECT o.Ord_StrID AS outletId,
           s.Str_Name AS rawStoreName,
           o.Ord_No AS no,
           DATE_FORMAT(o.Ord_DelDate, '%Y-%m-%d') AS deldate,
           o.Ord_itemCode AS rawItemCode,
           i.Itm_Code AS masterItemCode,
           o.Ord_ItemName AS rawItemName,
           i.Itm_Name AS masterItemName,
           o.Ord_Qty AS qty,
           o.Ord_Unit AS rawUnit,
           i.Itm_IssUnit AS masterUnit
      FROM orderd o
      LEFT JOIN item i ON o.Ord_ItmID = i.Itm_ID
      LEFT JOIN store s ON o.Ord_StrID = s.Str_ID
     WHERE o.Ord_DelDate BETWEEN ? AND ?
  `;
  const [rows] = await dbPool.query(sql, [startDate, endDate]);

  const byCode = {};
  rows.forEach(r => {
    const code = decodeText(r.rawItemCode) || decodeText(r.masterItemCode);
    if (!code) return;
    const name = decodeText(r.rawItemName) || decodeText(r.masterItemName);
    const unit = decodeText(r.rawUnit) || decodeText(r.masterUnit);
    const branch = decodeText(r.rawStoreName) || String(r.outletId);
    const qty = r2(r.qty);

    if (!byCode[code]) byCode[code] = { code, name: '', unit: '', totalSent: 0, breakdown: [] };
    byCode[code].totalSent += qty;
    if (!byCode[code].name && name) byCode[code].name = name;
    if (!byCode[code].unit && unit) byCode[code].unit = unit;
    byCode[code].breakdown.push({ branch, docNo: String(r.no), date: r.deldate, qtySent: qty });
  });

  const balanceMap = await loadItemBalanceMap();
  const items = Object.values(byCode).map(it => ({
    ...it,
    unit: it.unit || balanceMap[it.code]?.unit || '',
    remaining: balanceMap[it.code]?.remaining ?? null
  }));
  items.sort((a, b) => b.totalSent - a.totalSent);

  return { status: 'success', startDate, endDate, count: items.length, items };
}

// GET /api/delivery_summary?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
// Sums the requisitioned qty (Ord_Qty) per item across every branch/requisition whose delivery
// date (Ord_DelDate) falls in range — read straight from myfbdata.orderd (the real, complete
// record of every requisition), not the "จัดของ" sheet, which only has rows for documents that
// happened to go through the manual Fulfillment-page packing flow. Cross-referenced with each
// item's remaining balance from "ยอดคงเหลือไอเทม". Powers the "สรุปส่งของ" menu.
app.get('/api/delivery_summary', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) {
      return res.status(400).json({ status: 'error', message: 'ต้องระบุ startDate และ endDate' });
    }

    const cacheKey = `${startDate}|${endDate}`;
    const cached = deliverySummaryCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      const payload = await cached.promise;
      return res.json(payload);
    }

    const promise = computeDeliverySummary(startDate, endDate);
    deliverySummaryCache.set(cacheKey, { promise, expiresAt: Date.now() + DELIVERY_SUMMARY_CACHE_TTL_MS });
    promise.catch(() => deliverySummaryCache.delete(cacheKey)); // don't cache a failed run

    const payload = await promise;
    return res.json(payload);
  } catch (err) {
    console.error("API /api/delivery_summary Error:", err.message);
    return res.status(500).json({ status: 'error', message: err.message });
  }
});

// GET /api/fulfillment_items_detail?docNo=CRM-4223
// Per-item "จำนวนส่ง" (qty actually packed by the warehouse) from the "จัดของ" sheet.
app.get('/api/fulfillment_items_detail', async (req, res) => {
  try {
    const docNo = String(req.query.docNo || '').trim();
    if (!docNo) return res.status(400).json({ status: 'error', message: 'ต้องระบุ docNo' });

    const rows = await fetchGvizRows('0'); // "จัดของ" tab
    // Columns: A วันที่ B สาขา C รหัส D ชื่อ E จำนวนเบิก F จำนวนส่ง G เลขที่ใบเบิก H สถานะฝั่งstore I เวลาบันทึก
    const byCode = {};
    rows.forEach(row => {
      const c = row.c || [];
      const rowDocNo = c[6]?.v ? String(c[6].v).trim() : '';
      if (rowDocNo !== docNo) return;
      const code = c[2]?.v ? String(c[2].v).replace(/^'/, '').trim() : '';
      if (!code) return;
      byCode[code] = {
        code,
        qtySent: Number(c[5]?.v) || 0,
        status: c[7]?.v ? String(c[7].v).trim() : '',
        recordedAt: c[8]?.f || c[8]?.v || ''
      };
    });

    return res.json({ status: 'success', docNo, items: byCode });
  } catch (err) {
    console.error("API /api/fulfillment_items_detail Error:", err.message);
    return res.status(500).json({ status: 'error', message: err.message });
  }
});

// GET /api/received_items_detail?docNo=CRM-4223
// Per-item "จำนวนที่สาขารับจริง" + edit reason/photo/approval status, from the "รับของ" sheet.
app.get('/api/received_items_detail', async (req, res) => {
  try {
    const docNo = String(req.query.docNo || '').trim();
    if (!docNo) return res.status(400).json({ status: 'error', message: 'ต้องระบุ docNo' });

    const rows = await fetchGvizRows(RECEIVE_SHEET_GID);
    // Columns: A วันที่รับ B สาขา C เลขที่ใบเบิก D รหัส E ชื่อ F จำนวนเบิก G จำนวนส่ง
    //          H จำนวนที่รับจริง I สถานะ J หมายเหตุ K รูปภาพ L ผู้บันทึก M เวลาบันทึก
    //          N อนุมัติจากโกดัง O เวลาอนุมัติ (only present once at least one row has been approved)
    const byCode = {};
    rows.forEach(row => {
      const c = row.c || [];
      const rowDocNo = c[2]?.v ? String(c[2].v).trim() : '';
      if (rowDocNo !== docNo) return;
      const code = c[3]?.v ? String(c[3].v).replace(/^'/, '').trim() : '';
      if (!code) return;
      byCode[code] = { // later rows for the same code overwrite earlier ones — "latest wins"
        code,
        qtyReceived: Number(c[7]?.v) || 0,
        status: c[8]?.v ? String(c[8].v).trim() : '',
        note: c[9]?.v ? String(c[9].v).trim() : '',
        photoUrl: c[10]?.v ? String(c[10].v).trim() : '',
        recorder: c[11]?.v ? String(c[11].v).trim() : '',
        recordedAt: c[12]?.f || c[12]?.v || '',
        approvedBy: c[13]?.v ? String(c[13].v).trim() : '',
        approvedAt: c[14]?.f || c[14]?.v || ''
      };
    });

    return res.json({ status: 'success', docNo, items: byCode });
  } catch (err) {
    console.error("API /api/received_items_detail Error:", err.message);
    return res.status(500).json({ status: 'error', message: err.message });
  }
});

// GET /api/pending_edit_approvals
// All branch-reported receiving discrepancies (status "แก้ไข" in ชีท "รับของ") not yet approved
// by the warehouse, grouped by docNo. Powers the "ตรวจสอบสถานะ" menu's notification list/badge.
app.get('/api/pending_edit_approvals', async (req, res) => {
  try {
    const rows = await fetchGvizRows(RECEIVE_SHEET_GID);
    // Columns: A วันที่รับ B สาขา C เลขที่ใบเบิก D รหัส E ชื่อ F จำนวนเบิก G จำนวนส่ง
    //          H จำนวนที่รับจริง I สถานะ J หมายเหตุ K รูปภาพ L ผู้บันทึก M เวลาบันทึก
    //          N อนุมัติจากโกดัง O เวลาอนุมัติ
    const byKey = {}; // "docNo|code" -> latest row wins (same assumption as /api/received_items_detail)
    rows.forEach(row => {
      const c = row.c || [];
      const docNo = c[2]?.v ? String(c[2].v).trim() : '';
      const code = c[3]?.v ? String(c[3].v).replace(/^'/, '').trim() : '';
      if (!docNo || !code) return;
      byKey[`${docNo}|${code}`] = {
        docNo,
        branch: c[1]?.v ? String(c[1].v).trim() : '',
        code,
        name: c[4]?.v ? String(c[4].v).trim() : '',
        qtyRequested: Number(c[5]?.v) || 0,
        qtySent: Number(c[6]?.v) || 0,
        qtyReceived: Number(c[7]?.v) || 0,
        status: c[8]?.v ? String(c[8].v).trim() : '',
        note: c[9]?.v ? String(c[9].v).trim() : '',
        photoUrl: c[10]?.v ? String(c[10].v).trim() : '',
        recorder: c[11]?.v ? String(c[11].v).trim() : '',
        recordedAt: c[12]?.f || c[12]?.v || '',
        approvedBy: c[13]?.v ? String(c[13].v).trim() : ''
      };
    });

    const pendingItems = Object.values(byKey).filter(it => it.status === 'แก้ไข' && !it.approvedBy);

    const byDocNo = {};
    pendingItems.forEach(it => {
      if (!byDocNo[it.docNo]) byDocNo[it.docNo] = { docNo: it.docNo, branch: it.branch, items: [] };
      byDocNo[it.docNo].items.push(it);
    });

    const docs = Object.values(byDocNo).sort((a, b) => b.items.length - a.items.length);
    return res.json({ status: 'success', count: pendingItems.length, docCount: docs.length, docs });
  } catch (err) {
    console.error("API /api/pending_edit_approvals Error:", err.message);
    return res.status(500).json({ status: 'error', message: err.message });
  }
});

// POST /api/approve_received_edit
// Warehouse approves one branch-reported receiving discrepancy (status "แก้ไข" in ชีท "รับของ").
app.post('/api/approve_received_edit', async (req, res) => {
  try {
    const { docNo, code, approvedBy } = req.body;
    if (!docNo || !code) {
      return res.status(400).json({ status: 'error', message: 'ต้องระบุ docNo และ code' });
    }

    const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbySsi-rYTkEBxtIXDV8CdTqg5vFKs1qQzTAL2We2ey25Xi-9TTTB3T7hg8rDE7-gbK8/exec";
    const gasRes = await fetch(SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'approveReceivedEdit',
        spreadsheetId: '1bxohT8wK4ySAJgqGHEg9JHp0KJJKG7SVUEhJksBgBSI',
        sheetName: 'รับของ',
        docNo,
        code,
        approvedBy: approvedBy || 'โกดัง'
      })
    });
    const gasJson = await gasRes.json();
    if (gasJson.status !== 'success') {
      return res.status(500).json({ status: 'error', message: gasJson.message || 'อนุมัติไม่สำเร็จ' });
    }

    return res.json({ status: 'success', approvedAt: gasJson.approvedAt });
  } catch (err) {
    console.error("API /api/approve_received_edit Error:", err.message);
    return res.status(500).json({ status: 'error', message: err.message });
  }
});

// POST /api/save_fulfillment
// Save fulfillment data to local file store and forward to Google Apps Script / Sheet
app.post('/api/save_fulfillment', async (req, res) => {
  try {
    const { spreadsheetId, sheetName, docNo, date, branch, items } = req.body;
    if (!docNo || !Array.isArray(items)) {
      return res.status(400).json({ status: 'error', message: 'กรอกข้อมูลไม่ครบถ้วน' });
    }

    // Save to local JSON store — best-effort only. Serverless hosts (e.g. Vercel) have a
    // read-only filesystem, so this is expected to silently no-op there; the Google Sheet
    // write below is the real source of truth and must still happen either way.
    try {
      const filePath = path.join(process.cwd(), 'fulfillment_records.json');
      let existingData = {};
      if (fs.existsSync(filePath)) {
        try {
          existingData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        } catch (e) {
          existingData = {};
        }
      }

      existingData[docNo] = {
        docNo,
        date,
        branch,
        savedAt: new Date().toISOString(),
        items
      };

      fs.writeFileSync(filePath, JSON.stringify(existingData, null, 2), 'utf8');
    } catch (fsErr) {
      console.warn("Local fulfillment_records.json backup skipped (read-only filesystem?):", fsErr.message);
    }

    // Forward to Google Apps Script URL if available
    const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbySsi-rYTkEBxtIXDV8CdTqg5vFKs1qQzTAL2We2ey25Xi-9TTTB3T7hg8rDE7-gbK8/exec";
    try {
      fetch(SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'saveFulfillment',
          spreadsheetId: spreadsheetId || '1bxohT8wK4ySAJgqGHEg9JHp0KJJKG7SVUEhJksBgBSI',
          sheetName: sheetName || 'จัดของ',
          docNo,
          date,
          branch,
          items
        })
      }).catch(err => console.warn("Background Google Apps Script Post Notice:", err.message));
    } catch (gErr) {
      console.warn("Google Apps script post error:", gErr);
    }

    return res.json({
      status: 'success',
      message: 'บันทึกข้อมูลการจัดของเรียบร้อยแล้ว',
      docNo,
      count: items.length
    });
  } catch (err) {
    console.error("POST /api/save_fulfillment Error:", err);
    return res.status(500).json({ status: 'error', message: err.message });
  }
});

// POST /api/mark_fetched
// Marks a requisition as "ดึงข้อมูลแล้ว" (data fetched) — a lightweight status flag,
// stored locally and logged to the "ดึงข้อมูลใบเบิก" Google Sheet tab, keyed by
// outletId+no (unambiguous even when the same order number exists at multiple branches).
const FETCHED_STATUS_FILE = path.join(process.cwd(), 'fetched_status.json');

function loadFetchedStatusMap() {
  if (!fs.existsSync(FETCHED_STATUS_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(FETCHED_STATUS_FILE, 'utf8'));
  } catch (e) {
    return {};
  }
}

app.post('/api/mark_fetched', async (req, res) => {
  try {
    const { outletId, no, docNo, branch, date } = req.body;
    if (!outletId || !no) {
      return res.status(400).json({ status: 'error', message: 'กรอกข้อมูลไม่ครบถ้วน (ต้องระบุ outletId และ no)' });
    }

    const key = `${outletId}|${no}`;
    const fetchedAt = new Date().toISOString();

    // Best-effort local persistence — see note above save_fulfillment's file write.
    // On a read-only/ephemeral filesystem (serverless), this status won't actually
    // persist or show up in the app; the sheet log below still records the event either way.
    try {
      const existingData = loadFetchedStatusMap();
      existingData[key] = { docNo, branch, date, outletId, no, fetchedAt };
      fs.writeFileSync(FETCHED_STATUS_FILE, JSON.stringify(existingData, null, 2), 'utf8');
    } catch (fsErr) {
      console.warn("Local fetched_status.json write skipped (read-only filesystem?):", fsErr.message);
    }

    // Log to the "ดึงข้อมูลใบเบิก" sheet tab (fire-and-forget, same pattern as save_fulfillment)
    const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbySsi-rYTkEBxtIXDV8CdTqg5vFKs1qQzTAL2We2ey25Xi-9TTTB3T7hg8rDE7-gbK8/exec";
    try {
      fetch(SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'markFetched',
          spreadsheetId: '1bxohT8wK4ySAJgqGHEg9JHp0KJJKG7SVUEhJksBgBSI',
          sheetName: 'ดึงข้อมูลใบเบิก',
          docNo,
          branch,
          date,
          fetchedAt
        })
      }).catch(err => console.warn("Background Google Apps Script Post Notice (markFetched):", err.message));
    } catch (gErr) {
      console.warn("Google Apps script post error (markFetched):", gErr);
    }

    return res.json({ status: 'success', key, fetchedAt });
  } catch (err) {
    console.error("POST /api/mark_fetched Error:", err);
    return res.status(500).json({ status: 'error', message: err.message });
  }
});

// Vercel imports this module as a serverless function (see api/index.js) and invokes the
// exported Express app directly per-request — it never calls app.listen(). Only bind a real
// port when running as a standalone process (local dev, or a traditional Node host).
if (!process.env.VERCEL) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`🚀 Live MySQL API Proxy server running on http://localhost:${PORT} with Google Sheet Col N item categories`);
  });
}

export default app;
