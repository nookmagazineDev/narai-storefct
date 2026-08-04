/**
 * Google Apps Script for Store Requisition & Order Fulfillment System
 * Target Spreadsheet ID: 1bxohT8wK4ySAJgqGHEg9JHp0KJJKG7SVUEhJksBgBSI
 * Target Sheet Name: จัดของ
 */

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const action = data.action;

    if (action === 'saveFulfillment') {
      return handleSaveFulfillment(data);
    }

    if (action === 'markFetched') {
      return handleMarkFetched(data);
    }

    if (action === 'approveReceivedEdit') {
      return handleApproveReceivedEdit(data);
    }

    return ContentService
      .createTextOutput(JSON.stringify({ status: 'error', message: 'Invalid action: ' + action }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'error', message: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function handleSaveFulfillment(data) {
  const spreadsheetId = data.spreadsheetId || '1bxohT8wK4ySAJgqGHEg9JHp0KJJKG7SVUEhJksBgBSI';
  const sheetName = data.sheetName || 'จัดของ';
  const items = data.items || data.rows || [];

  if (!items || items.length === 0) {
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'error', message: 'ไม่มีรายการสินค้าส่งมา' }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  const ss = SpreadsheetApp.openById(spreadsheetId);
  let sheet = ss.getSheetByName(sheetName);

  // If sheet doesn't exist, create it
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
  }

  // Ensure Header Row exists
  if (sheet.getLastRow() === 0) {
    const headers = [
      'วันที่',
      'สาขา',
      'รหัส',
      'ชื่อ',
      'จำนวนเบิก',
      'จำนวนส่ง',
      'เลขที่ใบเบิก',
      'สถานะ',
      'เวลาบันทึก',
      'หมายเหตุ'
    ];
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#f3f4f6');
  } else if (String(sheet.getRange(1, 10).getValue() || '') !== 'หมายเหตุ') {
    // Sheet created before the หมายเหตุ column existed — add the header in place (column J)
    sheet.getRange(1, 10).setValue('หมายเหตุ').setFontWeight('bold').setBackground('#f3f4f6');
  }

  // Build a lookup of existing rows keyed by "เลขที่ใบเบิก|รหัส" so re-saving the same
  // requisition item updates its existing row instead of appending a duplicate.
  // If a docNo+code was saved more than once before this change, this points at the
  // LAST such row (existing duplicates from before are not auto-cleaned up).
  const lastRow = sheet.getLastRow();
  const existingRowByKey = {};
  if (lastRow > 1) {
    const existingValues = sheet.getRange(2, 1, lastRow - 1, 9).getValues();
    existingValues.forEach((row, i) => {
      const rowCode = String(row[2] || '').replace(/^'/, '').trim(); // Column C: รหัส
      const rowDocNo = String(row[6] || '').trim();                  // Column G: เลขที่ใบเบิก
      if (!rowDocNo && !rowCode) return;
      existingRowByKey[rowDocNo + '|' + rowCode] = i + 2; // +2: data starts at sheet row 2
    });
  }

  let updatedCount = 0;
  const rowsToAppend = [];

  items.forEach(it => {
    const docNo = String(it.docNo || data.docNo || '').trim();
    const code = String(it.code || '').trim();
    const rowValues = [
      it.date || data.date || '',
      it.branch || data.branch || '',
      "'" + code, // Prefix with single quote to preserve leading zeroes in item codes
      it.name || '',
      Number(it.reqQty) || 0,
      Number(it.delQty !== undefined ? it.delQty : it.reqQty) || 0,
      docNo,
      it.status || 'ยืนยัน',
      it.timestamp || new Date().toLocaleString('th-TH'),
      it.note || '' // หมายเหตุ (คอลัมน์ J) — เหตุผลกรณีแก้ไขจำนวน/ไม่ได้จัดส่ง
    ];

    const key = docNo + '|' + code;
    const existingRowNum = existingRowByKey[key];
    if (existingRowNum) {
      sheet.getRange(existingRowNum, 1, 1, 10).setValues([rowValues]);
      updatedCount++;
    } else {
      rowsToAppend.push(rowValues);
    }
  });

  if (rowsToAppend.length > 0) {
    const startRow = sheet.getLastRow() + 1;
    sheet.getRange(startRow, 1, rowsToAppend.length, 10).setValues(rowsToAppend);
  }

  return ContentService
    .createTextOutput(JSON.stringify({
      status: 'success',
      message: 'บันทึกข้อมูลการจัดของเรียบร้อยแล้ว',
      count: items.length,
      updated: updatedCount,
      appended: rowsToAppend.length
    }))
    .setMimeType(ContentService.MimeType.JSON);
}

// Logs a "ดึงข้อมูลแล้ว" (data fetched) event into its own sheet tab.
// This is an audit log, not a status table — each mark simply appends a new row.
function handleMarkFetched(data) {
  const spreadsheetId = data.spreadsheetId || '1bxohT8wK4ySAJgqGHEg9JHp0KJJKG7SVUEhJksBgBSI';
  const sheetName = data.sheetName || 'ดึงข้อมูลใบเบิก';

  const ss = SpreadsheetApp.openById(spreadsheetId);
  let sheet = ss.getSheetByName(sheetName);

  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
  }

  if (sheet.getLastRow() === 0) {
    const headers = ['วันที่', 'สาขา', 'เลขที่ใบเบิก', 'เวลาบันทึก'];
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#f3f4f6');
  }

  sheet.appendRow([
    data.date || '',
    data.branch || '',
    data.docNo || '',
    data.fetchedAt || new Date().toLocaleString('th-TH')
  ]);

  return ContentService
    .createTextOutput(JSON.stringify({ status: 'success', message: 'บันทึกสถานะดึงข้อมูลแล้วเรียบร้อย' }))
    .setMimeType(ContentService.MimeType.JSON);
}

// อนุมัติรายการที่สาขาแก้ไขจำนวนตอนรับของ (ชีท "รับของ", เขียนโดยแอปฝั่งสาขา) — เขียนคอลัมน์
// N (อนุมัติจากโกดัง) และ O (เวลาอนุมัติ) เพิ่มเข้าไปที่แถวล่าสุดของ (เลขที่ใบเบิก, รหัส) ที่ตรงกัน
// (ไม่แตะคอลัมน์เดิม A-M ที่แอปฝั่งสาขาเป็นเจ้าของ)
function handleApproveReceivedEdit(data) {
  const spreadsheetId = data.spreadsheetId || '1bxohT8wK4ySAJgqGHEg9JHp0KJJKG7SVUEhJksBgBSI';
  const sheetName = data.sheetName || 'รับของ';
  const docNo = String(data.docNo || '').trim();
  const code = String(data.code || '').trim();
  const approvedBy = data.approvedBy || 'โกดัง';

  if (!docNo || !code) {
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'error', message: 'ต้องระบุ docNo และ code' }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  const ss = SpreadsheetApp.openById(spreadsheetId);
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'error', message: 'ไม่พบชีท ' + sheetName }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'error', message: 'ไม่มีข้อมูลในชีท' }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  if (String(sheet.getRange(1, 14).getValue() || '') !== 'อนุมัติจากโกดัง') {
    sheet.getRange(1, 14).setValue('อนุมัติจากโกดัง').setFontWeight('bold');
    sheet.getRange(1, 15).setValue('เวลาอนุมัติ').setFontWeight('bold');
  }

  // Columns A..D: วันที่รับ, สาขา, เลขที่ใบเบิก, รหัส
  const values = sheet.getRange(2, 1, lastRow - 1, 4).getValues();
  let targetRow = -1;
  for (let i = values.length - 1; i >= 0; i--) { // search from bottom — latest matching row wins
    const rowDocNo = String(values[i][2] || '').trim();
    const rowCode = String(values[i][3] || '').replace(/^'/, '').trim();
    if (rowDocNo === docNo && rowCode === code) {
      targetRow = i + 2;
      break;
    }
  }

  if (targetRow === -1) {
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'error', message: 'ไม่พบรายการที่ตรงกันในชีทรับของ (เลขที่ใบเบิก+รหัส)' }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  const now = Utilities.formatDate(new Date(), 'Asia/Bangkok', 'dd/MM/yyyy HH:mm:ss');
  sheet.getRange(targetRow, 14).setValue(approvedBy);
  sheet.getRange(targetRow, 15).setValue(now);

  return ContentService
    .createTextOutput(JSON.stringify({ status: 'success', message: 'อนุมัติเรียบร้อยแล้ว', approvedAt: now }))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  return ContentService
    .createTextOutput(JSON.stringify({ status: 'success', message: 'Store Apps Script API is active' }))
    .setMimeType(ContentService.MimeType.JSON);
}
