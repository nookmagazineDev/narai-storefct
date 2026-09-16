/* ============================================================================
   ตารางงานสโตร์/โกดัง บน Microsoft SQL Server — ฐานข้อมูล InventoryNarai
   อยู่ฐานเดียวกับตารางนับสต๊อกของโปรเจกต์ Narai-branch (stock_count, stock_item, ...)

   รันไฟล์นี้ครั้งเดียวบนเครื่องที่ออฟฟิศ ก่อนเปิดใช้ STORE_SOURCE=sql

   วิธีรัน (บนเครื่องฐานข้อมูล):
     sqlcmd -S localhost\SQLEXPRESS -d InventoryNarai -U sa -P '<รหัสผ่าน>' -i docs\schema-store-sqlserver.sql
   หรือเปิดใน SQL Server Management Studio แล้วกด Execute

   ที่มา: ย้ายมาจาก Google Sheets ไฟล์ 1bxohT8wK4ySAJgqGHEg9JHp0KJJKG7SVUEhJksBgBSI
     ชีท 'จัดของ'            -> store_fulfillment
     ชีท 'รับของ'            -> store_receiving
     ชีท 'ดึงข้อมูลใบเบิก'    -> store_fetched_log
     ชีท 'ยกเลิกใบเบิก'      -> store_cancelled_doc

   ทำไมมาอยู่ที่นี่ ไม่ใช่ MySQL
   ---------------------------------------------------------------------------
   MySQL (myfbdata) เป็นฐานของระบบ POS ซึ่งเป็นของผู้ขาย ส่วนข้อมูลที่แอปเราสร้างเองอยู่บน
   SQL Server อยู่แล้วทั้งหมด (ตารางนับสต๊อก/ตารางงาน/พนักงาน) — ที่สำคัญคือชีท 'รับของ' เขียนโดย
   แอป Narai-branch ซึ่งเขียน SQL Server อยู่แล้ว การย้ายมาที่นี่ทำให้สองแอปอ่านเขียนตารางเดียวกัน
   ตรงๆ ไม่ต้องมีสะพานซิงก์ชีทค้างไว้ถาวร

   ข้อแลกที่ยอมรับแล้ว: Vercel ต่อ SQL Server ตรงไม่ได้ (ไฟร์วอลล์เปิดพอร์ต 1433 ให้เฉพาะ IP
   ในไทย) ทุกอย่างจึงผ่าน office-server ถ้าเครื่องที่ออฟฟิศดับ โกดังจะบันทึกจัดของไม่ได้

   ข้อออกแบบที่ต่างจากชีทเดิม
   ---------------------------------------------------------------------------
   1) ชีททุกใบเป็น log ต่อท้าย แล้วให้ฝั่งอ่าน "เอาแถวหลังสุดชนะ" ตารางนี้เก็บผลของกติกานั้นไว้เลย
      คือหนึ่งแถวต่อหนึ่ง (ใบเบิก, สินค้า) แล้ว MERGE ทับ ฝั่งอ่านจึงไม่ต้องไล่ทั้งชีทมายุบเอง
   2) รหัสสินค้าเก็บทั้งแบบ normalize แล้ว (item_key) และแบบที่พิมพ์มา (item_code) —
      กติกาเดียวกับ stock_item/stock_count เพื่อให้ JOIN ข้ามตารางในฐานนี้ได้ตรงๆ
   3) เลขที่ใบเบิกเก็บเป็น doc_no แบบที่หน้าเว็บใช้ ('CRM-3451') พร้อมแยก outlet_id กับ ord_no
      ไว้ต่างหาก เพราะตัวใบเบิกจริงอยู่ที่ myfbdata.orderd บน MySQL คนละเครื่อง จับคู่ได้เฉพาะ
      ในแอปเท่านั้น ไม่มีทาง JOIN ข้ามให้
   4) ข้อความไทยใช้ NVARCHAR ทั้งหมด และเวลาเป็นเวลาไทย ปี ค.ศ.
      (ชีทเก็บเป็นสตริง พ.ศ. จาก toLocaleString('th-TH') ซึ่งเทียบมากกว่า/น้อยกว่าไม่ได้)
============================================================================ */

USE InventoryNarai;
GO


/* ---------------------------------------------------------------------------
   จัดของ — โกดังบันทึกว่าจัดของให้สาขาไปเท่าไหร่ต่อรายการ
   เขียนโดย: หน้า "จัดของ" ของแอป storefct ผ่าน action saveFulfillment
   ชีทเดิม: 'จัดของ' (gid 0)
     A วันที่ B สาขา C รหัส D ชื่อ E จำนวนเบิก F จำนวนส่ง G เลขที่ใบเบิก
     H สถานะ I เวลาบันทึก J หมายเหตุ
--------------------------------------------------------------------------- */
IF OBJECT_ID('dbo.store_fulfillment', 'U') IS NULL
CREATE TABLE dbo.store_fulfillment (
    fulfillment_id BIGINT         IDENTITY(1,1) NOT NULL,
    doc_no         NVARCHAR(50)   NOT NULL,   -- เลขที่ใบเบิกแบบที่หน้าเว็บใช้ เช่น CRM-3451
    outlet_id      INT            NULL,       -- Ord_StrID ฝั่ง POS
    ord_no         INT            NULL,       -- Ord_No (ส่วนตัวเลขของ doc_no)
    branch         NVARCHAR(50)   NOT NULL CONSTRAINT DF_store_fulfillment_branch DEFAULT (N''),
    del_date       DATE           NULL,       -- วันที่ส่งของ (ตรงกับ Ord_DelDate)
    item_key       NVARCHAR(50)   NOT NULL,   -- รหัสสินค้าที่ normalize แล้ว
    item_code      NVARCHAR(50)   NOT NULL CONSTRAINT DF_store_fulfillment_code DEFAULT (N''),
    item_name      NVARCHAR(255)  NULL,
    req_qty        DECIMAL(18,3)  NOT NULL CONSTRAINT DF_store_fulfillment_req DEFAULT (0),
    del_qty        DECIMAL(18,3)  NOT NULL CONSTRAINT DF_store_fulfillment_del DEFAULT (0),
    status         NVARCHAR(50)   NULL,       -- ยืนยัน / แก้ไข / ไม่ได้จัดส่ง
    note           NVARCHAR(500)  NULL,       -- หมายเหตุ (มีเฉพาะแถวแก้ไข/ไม่ได้จัดส่ง)
    recorded_at    DATETIME2(0)   NULL,       -- เวลาที่โกดังกดบันทึก (เวลาไทย)
    source         NVARCHAR(20)   NOT NULL CONSTRAINT DF_store_fulfillment_src DEFAULT (N'app'),
    updated_at     DATETIME2(0)   NOT NULL CONSTRAINT DF_store_fulfillment_upd DEFAULT (SYSDATETIME()),
    CONSTRAINT PK_store_fulfillment PRIMARY KEY (fulfillment_id),
    /* หนึ่งแถวต่อหนึ่ง (ใบเบิก, สินค้า) — บันทึกซ้ำ/แก้ไขคือ MERGE ทับแถวเดิม
       ทำให้ย้ายข้อมูลจากชีทซ้ำกี่รอบก็ไม่เกิดแถวซ้ำ */
    CONSTRAINT UQ_store_fulfillment UNIQUE (doc_no, item_key)
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_store_fulfillment_del_date')
CREATE INDEX IX_store_fulfillment_del_date ON dbo.store_fulfillment (del_date);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_store_fulfillment_order')
CREATE INDEX IX_store_fulfillment_order ON dbo.store_fulfillment (outlet_id, ord_no);
GO


/* ---------------------------------------------------------------------------
   รับของ — สาขายืนยันว่ารับของครบ/ไม่ครบ
   เขียนโดย: หน้า "รับสินค้า" ของแอป Narai-branch (ต้องย้ายมาเขียนตารางนี้แทนชีท)
             + หน้า "ตรวจสอบสถานะ" ของ storefct ที่มาเติมคอลัมน์อนุมัติ
   ชีทเดิม: 'รับของ' (gid 1358423318)
     A วันที่รับ B สาขา C เลขที่ใบเบิก D รหัส E ชื่อ F จำนวนเบิก G จำนวนส่ง
     H จำนวนที่รับจริง I สถานะ J หมายเหตุ K รูปภาพ L ผู้บันทึก M เวลาบันทึก
     N อนุมัติจากโกดัง O เวลาอนุมัติ

   นี่คือตารางที่เป็นเหตุผลหลักของการย้ายมา SQL Server: สองแอปเขียนอ่านที่เดียวกัน
   ไม่ต้องมีสะพานซิงก์ชีทค้างไว้ถาวรอีกต่อไป
--------------------------------------------------------------------------- */
IF OBJECT_ID('dbo.store_receiving', 'U') IS NULL
CREATE TABLE dbo.store_receiving (
    receiving_id   BIGINT         IDENTITY(1,1) NOT NULL,
    doc_no         NVARCHAR(50)   NOT NULL,
    branch         NVARCHAR(50)   NOT NULL CONSTRAINT DF_store_receiving_branch DEFAULT (N''),
    receive_date   DATE           NULL,       -- วันที่สาขารับของ
    item_key       NVARCHAR(50)   NOT NULL,
    item_code      NVARCHAR(50)   NOT NULL CONSTRAINT DF_store_receiving_code DEFAULT (N''),
    item_name      NVARCHAR(255)  NULL,
    req_qty        DECIMAL(18,3)  NOT NULL CONSTRAINT DF_store_receiving_req DEFAULT (0),
    del_qty        DECIMAL(18,3)  NOT NULL CONSTRAINT DF_store_receiving_del DEFAULT (0),
    qty_received   DECIMAL(18,3)  NOT NULL CONSTRAINT DF_store_receiving_rcv DEFAULT (0),
    status         NVARCHAR(50)   NULL,       -- ปกติ / แก้ไข
    note           NVARCHAR(500)  NULL,
    photo_url      NVARCHAR(500)  NULL,
    recorder       NVARCHAR(255)  NULL,       -- ผู้บันทึกฝั่งสาขา
    recorded_at    DATETIME2(0)   NULL,
    approved_by    NVARCHAR(255)  NULL,       -- ผู้อนุมัติฝั่งโกดัง (NULL = ยังไม่อนุมัติ)
    approved_at    DATETIME2(0)   NULL,
    source         NVARCHAR(20)   NOT NULL CONSTRAINT DF_store_receiving_src DEFAULT (N'app'),
    updated_at     DATETIME2(0)   NOT NULL CONSTRAINT DF_store_receiving_upd DEFAULT (SYSDATETIME()),
    CONSTRAINT PK_store_receiving PRIMARY KEY (receiving_id),
    CONSTRAINT UQ_store_receiving UNIQUE (doc_no, item_key)
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_store_receiving_date')
CREATE INDEX IX_store_receiving_date ON dbo.store_receiving (receive_date);
GO
/* หน้า "ตรวจสอบสถานะ" ถามว่า "มีรายการแก้ไขที่ยังไม่อนุมัติไหม" ทุกครั้งที่เปิดหน้า
   ดัชนีนี้ทำให้ตอบได้โดยไม่ต้องอ่านทั้งตาราง */
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_store_receiving_pending_edit')
CREATE INDEX IX_store_receiving_pending_edit ON dbo.store_receiving (status, approved_by);
GO


/* ---------------------------------------------------------------------------
   ดึงข้อมูลใบเบิกแล้ว — ธงสถานะว่าโกดังดึงใบเบิกนี้ไปทำงานแล้ว
   เขียนโดย: storefct ผ่าน action markFetched
   ชีทเดิม: 'ดึงข้อมูลใบเบิก'  A วันที่ B สาขา C เลขที่ใบเบิก D เวลาบันทึก

   ชีทไม่ได้เก็บรหัสสาขาที่เป็นตัวเลข ทำให้ใบเบิกเลขเดียวกันคนละสาขาแยกกันไม่ออก
   ตารางนี้ใช้ (outlet_id, ord_no) เป็นคีย์จริง ตรงกับคีย์ที่ฝั่งเซิร์ฟเวอร์ใช้อยู่แล้ว
--------------------------------------------------------------------------- */
IF OBJECT_ID('dbo.store_fetched_log', 'U') IS NULL
CREATE TABLE dbo.store_fetched_log (
    fetched_id  BIGINT        IDENTITY(1,1) NOT NULL,
    outlet_id   INT           NOT NULL,
    ord_no      INT           NOT NULL,
    doc_no      NVARCHAR(50)  NOT NULL CONSTRAINT DF_store_fetched_doc DEFAULT (N''),
    branch      NVARCHAR(50)  NOT NULL CONSTRAINT DF_store_fetched_branch DEFAULT (N''),
    del_date    DATE          NULL,
    fetched_at  DATETIME2(0)  NULL,
    source      NVARCHAR(20)  NOT NULL CONSTRAINT DF_store_fetched_src DEFAULT (N'app'),
    updated_at  DATETIME2(0)  NOT NULL CONSTRAINT DF_store_fetched_upd DEFAULT (SYSDATETIME()),
    CONSTRAINT PK_store_fetched_log PRIMARY KEY (fetched_id),
    CONSTRAINT UQ_store_fetched_log UNIQUE (outlet_id, ord_no)
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_store_fetched_doc_no')
CREATE INDEX IX_store_fetched_doc_no ON dbo.store_fetched_log (doc_no);
GO


/* ---------------------------------------------------------------------------
   ยกเลิกใบเบิก — ใบที่สาขาถอนทีหลัง
   เขียนโดย: ระบบภายนอก (ยังไม่มีแอปไหนในสองโปรเจกต์นี้เขียน) — ปัจจุบันยังอยู่ที่ชีท
   ชีทเดิม: 'ยกเลิกใบเบิก'
     A วันที่สั่ง B สาขา C เลขที่ใบเบิก D วันที่รับ E จำนวนรายการ F ผู้บันทึก G เวลาที่ยกเลิก
--------------------------------------------------------------------------- */
IF OBJECT_ID('dbo.store_cancelled_doc', 'U') IS NULL
CREATE TABLE dbo.store_cancelled_doc (
    cancelled_id BIGINT        IDENTITY(1,1) NOT NULL,
    doc_no       NVARCHAR(50)  NOT NULL,
    branch       NVARCHAR(50)  NOT NULL CONSTRAINT DF_store_cancelled_branch DEFAULT (N''),
    order_date   DATE          NULL,       -- วันที่สั่ง
    del_date     DATE          NULL,       -- วันที่รับ
    item_count   INT           NOT NULL CONSTRAINT DF_store_cancelled_count DEFAULT (0),
    recorder     NVARCHAR(255) NULL,
    cancelled_at DATETIME2(0)  NULL,
    source       NVARCHAR(20)  NOT NULL CONSTRAINT DF_store_cancelled_src DEFAULT (N'sheet'),
    updated_at   DATETIME2(0)  NOT NULL CONSTRAINT DF_store_cancelled_upd DEFAULT (SYSDATETIME()),
    CONSTRAINT PK_store_cancelled_doc PRIMARY KEY (cancelled_id),
    CONSTRAINT UQ_store_cancelled_doc UNIQUE (doc_no)
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_store_cancelled_del_date')
CREATE INDEX IX_store_cancelled_del_date ON dbo.store_cancelled_doc (del_date);
GO


/* ---------------------------------------------------------------------------
   สิทธิ์ — login ที่ office-server ใช้ต้องเขียนสี่ตารางนี้ได้
   (ถ้าใช้ login เดียวกับที่ตารางนับสต๊อกใช้อยู่แล้ว มักได้สิทธิ์ระดับฐานมาแล้ว ข้ามได้)

   GRANT SELECT, INSERT, UPDATE ON dbo.store_fulfillment  TO [<ชื่อ login>];
   GRANT SELECT, INSERT, UPDATE ON dbo.store_receiving    TO [<ชื่อ login>];
   GRANT SELECT, INSERT, UPDATE ON dbo.store_fetched_log  TO [<ชื่อ login>];
   GRANT SELECT, INSERT, UPDATE ON dbo.store_cancelled_doc TO [<ชื่อ login>];
--------------------------------------------------------------------------- */
