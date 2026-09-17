// เมนูครัวกลาง — ฝั่งเรียก office-server
//
// ตรรกะ SQL ทั้งหมดอยู่ที่ office-server/kitchen.js ของ repo Narai-branch ที่นี่เป็นแค่ตัวส่งต่อ
// เหตุผลเดียวกับงานสโตร์: Vercel ต่อ SQL Server ตรงไม่ได้ ต้องผ่านเครื่องที่ออฟฟิศ
//
//   เบราว์เซอร์ -> /api/kitchen (แอปนี้) -> office-server :8787/schedule -> SQL Server

import { callOffice } from './officeServer.js';

/**
 * action ของครัวกลางที่หน้าเว็บเรียกได้ — ทำเป็นรายชื่อตายตัว ไม่ใช่ส่งต่อทุกอย่างที่ขอมา
 *
 * สำคัญ: /schedule ของ office-server รวม action ของทุกระบบไว้ที่เดียว ทั้งตารางงาน พนักงาน
 * ล็อกอิน และสต๊อก ถ้าปล่อยให้ route นี้ส่งต่อชื่อ action อะไรก็ได้ที่หน้าเว็บพิมพ์มา
 * เท่ากับเปิด endpoint สาธารณะให้เรียก action ทั้งหมดนั้นได้ด้วย ซึ่งไม่ใช่สิ่งที่ตั้งใจ
 */
export const KITCHEN_ACTIONS = new Set([
  // รายการสินค้า/วัตถุดิบ
  'getKitchenItems',
  // สูตรการผลิต
  'getKitchenRecipes',
  'getKitchenRecipe',
  'saveKitchenRecipe',
  'deleteKitchenRecipe',
  // แผนผลิตประจำรอบ
  'getProductionPlans',
  'saveProductionPlan',
  'deleteProductionPlan',
  // คำสั่งผลิต
  'getProductionOrders',
  'saveProductionOrder',
  'updateProductionOrderStatus',
  'getBranchDemand',
  'createOrdersFromDemand',
  'createOrdersFromPlan',
  // เบิกวัตถุดิบ
  'getOrderMaterials',
  'getMaterialIssues',
  'saveMaterialIssue',
  // คงเหลือ
  'getKitchenBalance',
  // ผลิตจริง + รายงาน
  'saveProductionRun',
  'deleteProductionRun',
  'getProductionReport',
]);

/** action ที่อ่านอย่างเดียว — ลองใหม่ได้เมื่อเน็ตสะดุด ที่เหลือห้ามลองซ้ำอัตโนมัติ */
const READ_ONLY = new Set([
  'getKitchenItems',
  'getKitchenRecipes',
  'getKitchenRecipe',
  'getProductionPlans',
  'getProductionOrders',
  'getBranchDemand',
  'getOrderMaterials',
  'getMaterialIssues',
  'getKitchenBalance',
  'getProductionReport',
]);

/**
 * เรียก action ของครัวกลาง
 * @throws {Error} ข้อความไทย เมื่อชื่อ action ไม่อยู่ในรายการ หรือปลายทางตอบว่าไม่สำเร็จ
 */
export async function callKitchen(action, payload = {}) {
  if (!KITCHEN_ACTIONS.has(action)) {
    throw Object.assign(new Error(`ไม่รู้จักคำสั่ง "${action}"`), { status: 400 });
  }
  // คำสั่งเขียนตั้ง retries เป็น 0 — คำสั่งอาจถึงปลายทางแล้วแต่คำตอบหายกลางทาง
  // ยิงซ้ำจะได้ใบเบิกวัตถุดิบหรือบันทึกการผลิตซ้ำ ซึ่งเป็นตารางแบบต่อท้าย ไม่ได้ทับตามคีย์
  return callOffice(action, payload, { retries: READ_ONLY.has(action) ? 1 : 0 });
}
