/* ============================================================================
   ตารางงานสโตร์/โกดัง บน MySQL — ฐานข้อมูล narai_store
   อยู่บนเซิร์ฟเวอร์เดียวกับ myfbdata (inventory.dyndns.tv) แต่แยกฐานข้อมูลกัน

   รันไฟล์นี้ครั้งเดียวก่อนเปิดใช้งาน dual-write

   วิธีรัน (จากเครื่องที่ต่อ MySQL ได้):
     mysql -h inventory.dyndns.tv -u root -p < docs/schema-store.sql

   ที่มา: ย้ายมาจาก Google Sheets ไฟล์ 1bxohT8wK4ySAJgqGHEg9JHp0KJJKG7SVUEhJksBgBSI
     ชีท 'จัดของ'            -> fulfillment
     ชีท 'รับของ'            -> receiving
     ชีท 'ดึงข้อมูลใบเบิก'    -> fetched_log
     ชีท 'ยกเลิกใบเบิก'      -> cancelled_doc

   ทำไมต้องแยกฐานข้อมูลออกจาก myfbdata
   ---------------------------------------------------------------------------
   1) myfbdata เป็นฐานของระบบ POS เดิม ไม่ใช่ของเรา — ถ้าวันหนึ่งผู้ขายอัปเกรดระบบ
      หรือ restore ฐานกลับ ตารางที่เราแอบใส่เข้าไปจะหายไปทั้งหมดโดยไม่มีอะไรเตือน
   2) ตาราง POS เป็น MyISAM ซึ่งไม่มี transaction (ดู api/insert_order.js ของ Narai-branch
      ที่ต้องใช้ LOCK TABLES แทน) ตารางในไฟล์นี้เป็น InnoDB จึงใช้ transaction ได้ตามปกติ
   3) สิทธิ์แยกกันได้ ถ้าวันหนึ่งอยากให้แอปนี้ใช้ user ที่เขียนได้เฉพาะ narai_store

   ข้อออกแบบที่ต่างจากชีทเดิม
   ---------------------------------------------------------------------------
   1) ชีททุกใบเป็น log ต่อท้าย (append-only) แล้วให้ฝั่งอ่าน "เอาแถวหลังสุดชนะ"
      ตารางนี้เก็บผลของกติกานั้นไว้เลย คือหนึ่งแถวต่อหนึ่ง (ใบเบิก, สินค้า) แล้ว UPSERT ทับ
      ฝั่งอ่านจึงไม่ต้องไล่ทั้งชีทมายุบเองทุกครั้ง ซึ่งเป็นต้นเหตุที่หน้าเว็บช้าอยู่ตอนนี้
      ประวัติการแก้ไม่ได้หายไปไหน — ชีทยังเก็บครบระหว่างที่ยังเขียนสองที่ (dual-write)
   2) รหัสสินค้าในชีทเขียนไม่ตรงกัน บางที่มี 0 นำหน้า ('00123') บางที่เป็นตัวเลขล้วน
      จึงเก็บรหัสที่ normalize แล้วไว้เป็น item_key และใช้เป็นคีย์ทุกจุด
      ส่วน item_code เก็บตามที่พิมพ์มาไว้แสดงผล (กติกาเดียวกับ stock_item ของ Narai-branch)
   3) เลขที่ใบเบิกเก็บเป็น doc_no รูปแบบที่หน้าเว็บใช้ ('CRM-3451') พร้อมแยก outlet_id กับ
      ord_no ไว้ต่างหากในตารางที่มี เพื่อ JOIN กับ myfbdata.orderd ได้ตรงโดยไม่ต้องแกะสตริง
   4) เวลาทุกคอลัมน์เป็นเวลาไทย (Asia/Bangkok) และเป็นปี ค.ศ. — ชีทเก็บเป็นสตริง พ.ศ.
      จากการ toLocaleString('th-TH') ซึ่งเทียบมากกว่า/น้อยกว่าไม่ได้
============================================================================ */

CREATE DATABASE IF NOT EXISTS `narai_store`
  DEFAULT CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE `narai_store`;


/* ---------------------------------------------------------------------------
   จัดของ — โกดังบันทึกว่าจัดของให้สาขาไปเท่าไหร่ต่อรายการ
   เขียนโดย: หน้า "จัดของ" ของแอปนี้ (POST /api/save_fulfillment)
   ชีทเดิม: 'จัดของ' (gid 0)
     A วันที่ B สาขา C รหัส D ชื่อ E จำนวนเบิก F จำนวนส่ง G เลขที่ใบเบิก
     H สถานะ I เวลาบันทึก J หมายเหตุ
--------------------------------------------------------------------------- */
CREATE TABLE IF NOT EXISTS `fulfillment` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `doc_no`      VARCHAR(50)     NOT NULL                COMMENT 'เลขที่ใบเบิกแบบที่หน้าเว็บใช้ เช่น CRM-3451',
  `outlet_id`   INT             NULL                    COMMENT 'Ord_StrID — NULL ถ้าแกะจากชีทเก่าไม่ได้',
  `ord_no`      INT             NULL                    COMMENT 'Ord_No (ส่วนตัวเลขของ doc_no)',
  `branch`      VARCHAR(50)     NOT NULL DEFAULT ''     COMMENT 'ชื่อสาขาตามที่บันทึกมา',
  `del_date`    DATE            NULL                    COMMENT 'วันที่ส่งของ (ตรงกับ Ord_DelDate)',
  `item_key`    VARCHAR(50)     NOT NULL                COMMENT 'รหัสสินค้าที่ normalize แล้ว',
  `item_code`   VARCHAR(50)     NOT NULL DEFAULT ''     COMMENT 'รหัสสินค้าตามที่พิมพ์มา',
  `item_name`   VARCHAR(255)    NOT NULL DEFAULT '',
  `req_qty`     DECIMAL(14,2)   NOT NULL DEFAULT 0      COMMENT 'จำนวนเบิก',
  `del_qty`     DECIMAL(14,2)   NOT NULL DEFAULT 0      COMMENT 'จำนวนส่งจริง',
  `status`      VARCHAR(50)     NOT NULL DEFAULT ''     COMMENT 'ยืนยัน / แก้ไข / ไม่ได้จัดส่ง',
  `note`        VARCHAR(500)    NOT NULL DEFAULT ''     COMMENT 'หมายเหตุ (มีเฉพาะแถวแก้ไข/ไม่ได้จัดส่ง)',
  `recorded_at` DATETIME        NULL                    COMMENT 'เวลาที่โกดังกดบันทึก (เวลาไทย) — NULL ถ้าย้ายมาจากชีทเก่าที่อ่านเวลาไม่ออก',
  `source`      VARCHAR(20)     NOT NULL DEFAULT 'app'  COMMENT 'app = เขียนสดจากหน้าเว็บ, sheet = ย้ายมาจากชีท',
  `created_at`  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  /* หนึ่งแถวต่อหนึ่ง (ใบเบิก, สินค้า) — บันทึกซ้ำ/แก้ไขคือ UPSERT ทับแถวเดิม
     ทำให้ย้ายข้อมูลจากชีทซ้ำกี่รอบก็ไม่เกิดแถวซ้ำ */
  UNIQUE KEY `uq_fulfillment_doc_item` (`doc_no`, `item_key`),
  KEY `idx_fulfillment_del_date` (`del_date`),
  KEY `idx_fulfillment_branch_date` (`branch`, `del_date`),
  KEY `idx_fulfillment_order` (`outlet_id`, `ord_no`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='ชีท "จัดของ" — โกดังจัดของให้สาขา';


/* ---------------------------------------------------------------------------
   รับของ — สาขายืนยันว่ารับของครบ/ไม่ครบ
   เขียนโดย: หน้า "รับสินค้า" ของแอป Narai-branch (ยังเขียนลงชีทอยู่)
             + หน้า "ตรวจสอบสถานะ" ของแอปนี้ ที่มาเติมคอลัมน์อนุมัติ
   ชีทเดิม: 'รับของ' (gid 1358423318)
     A วันที่รับ B สาขา C เลขที่ใบเบิก D รหัส E ชื่อ F จำนวนเบิก G จำนวนส่ง
     H จำนวนที่รับจริง I สถานะ J หมายเหตุ K รูปภาพ L ผู้บันทึก M เวลาบันทึก
     N อนุมัติจากโกดัง O เวลาอนุมัติ

   หมายเหตุ: ตราบใดที่ Narai-branch ยังเขียนชีท ตารางนี้ได้ข้อมูลจากการซิงก์ชีท -> MySQL
   เท่านั้น (ดู syncReceiving ใน lib/storeDb.js) จะเลิกซิงก์ได้ก็ต่อเมื่อฝั่งนั้น
   ย้ายมาเขียนตรงที่ตารางนี้แล้ว
--------------------------------------------------------------------------- */
CREATE TABLE IF NOT EXISTS `receiving` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `doc_no`        VARCHAR(50)     NOT NULL,
  `branch`        VARCHAR(50)     NOT NULL DEFAULT '',
  `receive_date`  DATE            NULL                  COMMENT 'วันที่สาขารับของ',
  `item_key`      VARCHAR(50)     NOT NULL,
  `item_code`     VARCHAR(50)     NOT NULL DEFAULT '',
  `item_name`     VARCHAR(255)    NOT NULL DEFAULT '',
  `req_qty`       DECIMAL(14,2)   NOT NULL DEFAULT 0    COMMENT 'จำนวนเบิก',
  `del_qty`       DECIMAL(14,2)   NOT NULL DEFAULT 0    COMMENT 'จำนวนที่โกดังส่ง',
  `qty_received`  DECIMAL(14,2)   NOT NULL DEFAULT 0    COMMENT 'จำนวนที่สาขารับจริง',
  `status`        VARCHAR(50)     NOT NULL DEFAULT ''   COMMENT 'ปกติ / แก้ไข',
  `note`          VARCHAR(500)    NOT NULL DEFAULT '',
  `photo_url`     VARCHAR(500)    NOT NULL DEFAULT '',
  `recorder`      VARCHAR(100)    NOT NULL DEFAULT ''   COMMENT 'ผู้บันทึกฝั่งสาขา',
  `recorded_at`   DATETIME        NULL,
  `approved_by`   VARCHAR(100)    NOT NULL DEFAULT ''   COMMENT 'ผู้อนุมัติฝั่งโกดัง (ว่าง = ยังไม่อนุมัติ)',
  `approved_at`   DATETIME        NULL,
  `source`        VARCHAR(20)     NOT NULL DEFAULT 'sheet',
  `created_at`    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_receiving_doc_item` (`doc_no`, `item_key`),
  KEY `idx_receiving_date` (`receive_date`),
  /* หน้า "ตรวจสอบสถานะ" ถามว่า "มีรายการแก้ไขที่ยังไม่อนุมัติไหม" ทุกครั้งที่เปิดหน้า
     ดัชนีนี้ทำให้ตอบได้โดยไม่ต้องอ่านทั้งตาราง */
  KEY `idx_receiving_pending_edit` (`status`, `approved_by`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='ชีท "รับของ" — สาขายืนยันการรับของ';


/* ---------------------------------------------------------------------------
   ดึงข้อมูลใบเบิกแล้ว — ธงสถานะว่าโกดังดึงใบเบิกนี้ไปทำงานแล้ว
   เขียนโดย: แอปนี้ (POST /api/mark_fetched)
   ชีทเดิม: 'ดึงข้อมูลใบเบิก'  A วันที่ B สาขา C เลขที่ใบเบิก D เวลาบันทึก

   ชีทไม่ได้เก็บ outlet_id ทำให้ใบเบิกเลขเดียวกันคนละสาขาแยกกันไม่ออก ตารางนี้เก็บไว้ด้วย
   และใช้ (outlet_id, ord_no) เป็นคีย์จริง ตรงกับคีย์ที่ฝั่งเซิร์ฟเวอร์ใช้อยู่แล้ว
--------------------------------------------------------------------------- */
CREATE TABLE IF NOT EXISTS `fetched_log` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `outlet_id`  INT             NOT NULL,
  `ord_no`     INT             NOT NULL,
  `doc_no`     VARCHAR(50)     NOT NULL DEFAULT '',
  `branch`     VARCHAR(50)     NOT NULL DEFAULT '',
  `del_date`   DATE            NULL,
  `fetched_at` DATETIME        NULL,
  `source`     VARCHAR(20)     NOT NULL DEFAULT 'app',
  `created_at` DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_fetched_order` (`outlet_id`, `ord_no`),
  KEY `idx_fetched_doc_no` (`doc_no`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='ชีท "ดึงข้อมูลใบเบิก" — ใบเบิกที่โกดังดึงไปแล้ว';


/* ---------------------------------------------------------------------------
   ยกเลิกใบเบิก — ใบที่สาขาถอนทีหลัง
   เขียนโดย: ระบบภายนอก (ยังไม่มีแอปไหนในสองโปรเจกต์นี้เขียน) จึงเป็นซิงก์ชีทอย่างเดียว
   ชีทเดิม: 'ยกเลิกใบเบิก'
     A วันที่สั่ง B สาขา C เลขที่ใบเบิก D วันที่รับ E จำนวนรายการ F ผู้บันทึก G เวลาที่ยกเลิก
--------------------------------------------------------------------------- */
CREATE TABLE IF NOT EXISTS `cancelled_doc` (
  `id`           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `doc_no`       VARCHAR(50)     NOT NULL,
  `branch`       VARCHAR(50)     NOT NULL DEFAULT '',
  `order_date`   DATE            NULL                   COMMENT 'วันที่สั่ง',
  `del_date`     DATE            NULL                   COMMENT 'วันที่รับ',
  `item_count`   INT             NOT NULL DEFAULT 0,
  `recorder`     VARCHAR(100)    NOT NULL DEFAULT '',
  `cancelled_at` DATETIME        NULL,
  `source`       VARCHAR(20)     NOT NULL DEFAULT 'sheet',
  `created_at`   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_cancelled_doc_no` (`doc_no`),
  KEY `idx_cancelled_del_date` (`del_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='ชีท "ยกเลิกใบเบิก" — ใบเบิกที่ถูกยกเลิก';


/* ---------------------------------------------------------------------------
   สิทธิ์ (ถ้าจะแยก user ออกจาก root — ทำทีหลังได้ ไม่จำเป็นตอนเปิดใช้ครั้งแรก)

   CREATE USER 'narai_store'@'%' IDENTIFIED BY '<รหัสผ่าน>';
   GRANT SELECT, INSERT, UPDATE ON `narai_store`.* TO 'narai_store'@'%';
   GRANT SELECT ON `myfbdata`.* TO 'narai_store'@'%';   -- อ่าน orderd/item/store อย่างเดียว
   FLUSH PRIVILEGES;
--------------------------------------------------------------------------- */
