/* ============================================================================
   เมนูครัวกลาง — ตารางบน Microsoft SQL Server ฐานข้อมูล InventoryNarai
   อยู่ฐานเดียวกับ stock_item / stock_count / store_fulfillment ทั้งหมด

   รันไฟล์นี้ครั้งเดียวบนเครื่องที่ออฟฟิศ ก่อนเปิดใช้เมนูครัวกลาง

   วิธีรัน (บนเครื่องฐานข้อมูล):
     sqlcmd -S localhost\SQLEXPRESS -d InventoryNarai -U sa -P '<รหัสผ่าน>' -b -i docs\schema-kitchen-sqlserver.sql
   หรือเปิดใน SQL Server Management Studio แล้วกด Execute

   ห้าหน้าที่ตารางชุดนี้รองรับ
   ---------------------------------------------------------------------------
     รายการสั่งผลิต      -> kitchen_production_order (+ kitchen_production_plan)
     เบิกวัตถุดิบ        -> kitchen_material_issue
     วัตถุดิบคงเหลือ     -> ไม่มีตาราง คำนวณสด (ดูหัวข้อ "คงเหลือ" ข้างล่าง)
     รายการสูตรการผลิต   -> kitchen_recipe + kitchen_recipe_item
     ดูรายงานการผลิต     -> kitchen_production_run

   ครัวกลางคือ "สาขา" หนึ่งในระบบเดิม
   ---------------------------------------------------------------------------
   ตัดสินใจไว้ว่าของที่ผลิตเสร็จจะเข้าสต๊อกครัวกลาง แล้วสาขาเบิกผ่านระบบใบเบิกเดิม
   ครัวกลางจึงไม่ใช่ระบบแยก แต่เป็นสาขาหนึ่งที่มีรหัสของตัวเอง (ตั้งที่ env KITCHEN_BRANCH)
   ผลที่ตามมาซึ่งตั้งใจให้เป็นแบบนี้:

     - วัตถุดิบและสินค้าที่ผลิต ใช้ dbo.stock_item ชุดเดียวกับสาขา ไม่มี master ซ้อน
       รหัสสินค้าจึงเทียบกันได้ตรงๆ ทั้งระบบด้วย item_key ที่ normalize แล้ว
     - ครัวกลางเบิกวัตถุดิบจากโกดังผ่านใบเบิกเดิม (store_fulfillment / store_receiving)
       ตารางชุดนี้จึงไม่มีตาราง "รับวัตถุดิบเข้า" ของตัวเอง — ซ้ำกับของที่มีอยู่แล้ว
     - ครัวกลางนับสต๊อกผ่านหน้านับสต๊อกเดิม ลงที่ dbo.stock_count เหมือนทุกสาขา

   คงเหลือคำนวณยังไง ทำไมไม่เก็บเป็นตาราง
   ---------------------------------------------------------------------------
   ยอดคงเหลือที่เก็บเป็นตัวเลขนิ่งๆ จะเพี้ยนทันทีที่มีใครลืมบันทึกอะไรสักอย่าง แล้วไม่มีทาง
   รู้ว่าเพี้ยนตั้งแต่เมื่อไหร่ ตารางชุดนี้จึงเก็บแต่ "เหตุการณ์" แล้วคำนวณคงเหลือสดทุกครั้ง:

     คงเหลือ = ยอดนับล่าสุด (stock_count ของสาขาครัวกลาง)
             + รับเข้าหลังวันนับ (store_receiving ของสาขาครัวกลาง)
             - เบิกไปใช้หลังวันนับ (kitchen_material_issue)

   ตัวตั้งคือการนับจริง ไม่ใช่ยอดสะสมตั้งแต่ต้น การนับสต๊อกรอบใหม่จึงล้างความคลาดเคลื่อน
   ที่สะสมมาให้เองโดยอัตโนมัติ เหมือนที่หน้าสต๊อกสาขาทำอยู่

   ข้อตกลงร่วมกับตารางเดิม
   ---------------------------------------------------------------------------
   1) ข้อความไทยเป็น NVARCHAR ทั้งหมด วันที่เป็น DATE/DATETIME2 ปี ค.ศ. เวลาไทย
   2) จำนวนเป็น DECIMAL(18,3) เท่ากับ stock_count.remaining — สูตรครัวมีทศนิยม (0.25 กก.)
   3) รหัสสินค้าเก็บคู่กันทั้ง item_key (normalize แล้ว ใช้ JOIN) และ item_code (ตามที่พิมพ์)
      กติกาเดียวกับ stock_item / store_fulfillment
   4) ชื่อสินค้าเก็บซ้ำไว้ในแถว ทั้งที่ JOIN เอาจาก stock_item ได้ เพราะรายงานย้อนหลังต้อง
      อ่านได้เหมือนวันที่บันทึก ถ้าใครแก้ชื่อสินค้าทีหลัง ใบเก่าต้องไม่เปลี่ยนตาม
============================================================================ */

USE InventoryNarai;
GO


/* ---------------------------------------------------------------------------
   สูตรการผลิต — หัวสูตร
   หนึ่งสินค้าที่ผลิตได้ = หนึ่งสูตร (แก้สูตรคือแก้แถวเดิม ไม่ทำเวอร์ชัน)

   yield_qty คือ "สูตรนี้ทำได้กี่หน่วย" ซึ่งต้องมี ไม่งั้นคำนวณวัตถุดิบตามจำนวนสั่งผลิตไม่ได้
   เช่น สูตรซอส 1 หม้อ = 20 กก. ใช้มะเขือเทศ 15 กก. สั่งผลิต 60 กก. ต้องใช้มะเขือเทศ 45 กก.
--------------------------------------------------------------------------- */
IF OBJECT_ID(N'dbo.kitchen_recipe', N'U') IS NULL
CREATE TABLE dbo.kitchen_recipe (
    recipe_id     INT            IDENTITY(1,1) NOT NULL,
    product_key   NVARCHAR(50)   NOT NULL,   -- item_key ของสินค้าที่ผลิตได้ (อยู่ใน stock_item)
    product_code  NVARCHAR(50)   NOT NULL CONSTRAINT DF_kitchen_recipe_code DEFAULT (N''),
    product_name  NVARCHAR(255)  NOT NULL CONSTRAINT DF_kitchen_recipe_name DEFAULT (N''),
    yield_qty     DECIMAL(18,3)  NOT NULL CONSTRAINT DF_kitchen_recipe_yield DEFAULT (1),
    yield_unit    NVARCHAR(50)   NULL,       -- หน่วยของผลผลิต เช่น กก. / ถุง / หม้อ
    is_active     BIT            NOT NULL CONSTRAINT DF_kitchen_recipe_active DEFAULT (1),
    note          NVARCHAR(500)  NULL,       -- วิธีทำโดยย่อ / ข้อควรระวัง
    updated_by    NVARCHAR(255)  NULL,
    created_at    DATETIME2(0)   NOT NULL CONSTRAINT DF_kitchen_recipe_created DEFAULT (SYSDATETIME()),
    updated_at    DATETIME2(0)   NOT NULL CONSTRAINT DF_kitchen_recipe_updated DEFAULT (SYSDATETIME()),
    CONSTRAINT PK_kitchen_recipe PRIMARY KEY (recipe_id),
    -- หนึ่งสินค้ามีได้สูตรเดียว กันคนเผลอสร้างสูตรซ้ำแล้วคำนวณวัตถุดิบจากสูตรผิดใบ
    CONSTRAINT UQ_kitchen_recipe_product UNIQUE (product_key),
    CONSTRAINT CK_kitchen_recipe_yield CHECK (yield_qty > 0)
);
GO


/* ---------------------------------------------------------------------------
   สูตรการผลิต — บรรทัดวัตถุดิบ
   qty คือจำนวนวัตถุดิบที่ใช้ "ต่อ yield_qty หนึ่งชุด" ไม่ใช่ต่อหนึ่งหน่วย
--------------------------------------------------------------------------- */
IF OBJECT_ID(N'dbo.kitchen_recipe_item', N'U') IS NULL
CREATE TABLE dbo.kitchen_recipe_item (
    recipe_id   INT            NOT NULL,
    item_key    NVARCHAR(50)   NOT NULL,   -- วัตถุดิบ (อยู่ใน stock_item)
    item_code   NVARCHAR(50)   NOT NULL CONSTRAINT DF_kitchen_recipe_item_code DEFAULT (N''),
    item_name   NVARCHAR(255)  NOT NULL CONSTRAINT DF_kitchen_recipe_item_name DEFAULT (N''),
    qty         DECIMAL(18,3)  NOT NULL,
    unit        NVARCHAR(50)   NULL,
    sort_order  INT            NOT NULL CONSTRAINT DF_kitchen_recipe_item_sort DEFAULT (0),
    note        NVARCHAR(255)  NULL,
    CONSTRAINT PK_kitchen_recipe_item PRIMARY KEY (recipe_id, item_key),
    CONSTRAINT FK_kitchen_recipe_item_recipe FOREIGN KEY (recipe_id)
        REFERENCES dbo.kitchen_recipe (recipe_id) ON DELETE CASCADE,
    CONSTRAINT CK_kitchen_recipe_item_qty CHECK (qty > 0)
);
GO


/* ---------------------------------------------------------------------------
   แผนผลิตประจำรอบ — "ทุกวันอังคารทำซอส 40 กก."
   ไม่ใช่คำสั่งผลิต เป็นแม่แบบที่กดสร้างคำสั่งผลิตของวันนั้นออกมาทีเดียวหลายรายการ

   weekday: 0=อาทิตย์ ... 6=เสาร์ ตรงกับ JavaScript getDay()
            รอบรายวัน (cycle='daily') ไม่สนค่านี้ ให้เป็น NULL
--------------------------------------------------------------------------- */
IF OBJECT_ID(N'dbo.kitchen_production_plan', N'U') IS NULL
CREATE TABLE dbo.kitchen_production_plan (
    plan_id       INT            IDENTITY(1,1) NOT NULL,
    product_key   NVARCHAR(50)   NOT NULL,
    product_code  NVARCHAR(50)   NOT NULL CONSTRAINT DF_kitchen_plan_code DEFAULT (N''),
    product_name  NVARCHAR(255)  NOT NULL CONSTRAINT DF_kitchen_plan_name DEFAULT (N''),
    cycle         NVARCHAR(20)   NOT NULL CONSTRAINT DF_kitchen_plan_cycle DEFAULT (N'weekly'),
    weekday       TINYINT        NULL,
    planned_qty   DECIMAL(18,3)  NOT NULL,
    unit          NVARCHAR(50)   NULL,
    is_active     BIT            NOT NULL CONSTRAINT DF_kitchen_plan_active DEFAULT (1),
    note          NVARCHAR(500)  NULL,
    created_at    DATETIME2(0)   NOT NULL CONSTRAINT DF_kitchen_plan_created DEFAULT (SYSDATETIME()),
    updated_at    DATETIME2(0)   NOT NULL CONSTRAINT DF_kitchen_plan_updated DEFAULT (SYSDATETIME()),
    CONSTRAINT PK_kitchen_production_plan PRIMARY KEY (plan_id),
    -- สินค้าหนึ่งตัวมีได้หนึ่งแผนต่อรอบ/วันในสัปดาห์ กันแผนซ้ำที่จะสร้างคำสั่งผลิตซ้ำตามไปด้วย
    CONSTRAINT UQ_kitchen_plan UNIQUE (product_key, cycle, weekday),
    CONSTRAINT CK_kitchen_plan_cycle CHECK (cycle IN (N'daily', N'weekly')),
    CONSTRAINT CK_kitchen_plan_weekday CHECK (weekday IS NULL OR weekday BETWEEN 0 AND 6),
    CONSTRAINT CK_kitchen_plan_qty CHECK (planned_qty > 0)
);
GO


/* ---------------------------------------------------------------------------
   คำสั่งผลิต

   source บอกว่าคำสั่งนี้มาจากไหน — เก็บไว้เพราะเวลาตัวเลขดูแปลก คำถามแรกเสมอคือ
   "ใครสั่ง" ถ้าไม่เก็บก็ต้องเดาเอาจากเวลาที่บันทึก
     'manual' ครัวกลางกรอกเองในหน้าสั่งผลิต
     'demand' ระบบรวมยอดที่สาขาเบิกในวันนั้นแล้วเสนอมา
     'plan'   สร้างจาก kitchen_production_plan

   produced_qty เป็นยอดสะสมจาก kitchen_production_run ไม่ได้ให้คนกรอกตรงๆ
   (เก็บซ้ำไว้ตรงนี้เพื่อให้หน้ารายการโชว์ความคืบหน้าได้โดยไม่ต้อง JOIN นับทุกครั้ง)
--------------------------------------------------------------------------- */
IF OBJECT_ID(N'dbo.kitchen_production_order', N'U') IS NULL
CREATE TABLE dbo.kitchen_production_order (
    order_id      BIGINT         IDENTITY(1,1) NOT NULL,
    doc_no        NVARCHAR(50)   NOT NULL,   -- PRD-YYYYMMDD-NNN
    produce_date  DATE           NOT NULL,   -- วันที่ต้องผลิต
    product_key   NVARCHAR(50)   NOT NULL,
    product_code  NVARCHAR(50)   NOT NULL CONSTRAINT DF_kitchen_order_code DEFAULT (N''),
    product_name  NVARCHAR(255)  NOT NULL CONSTRAINT DF_kitchen_order_name DEFAULT (N''),
    order_qty     DECIMAL(18,3)  NOT NULL,
    produced_qty  DECIMAL(18,3)  NOT NULL CONSTRAINT DF_kitchen_order_produced DEFAULT (0),
    unit          NVARCHAR(50)   NULL,
    status        NVARCHAR(50)   NOT NULL CONSTRAINT DF_kitchen_order_status DEFAULT (N'รอผลิต'),
    source        NVARCHAR(20)   NOT NULL CONSTRAINT DF_kitchen_order_source DEFAULT (N'manual'),
    plan_id       INT            NULL,       -- มาจากแผนไหน (ถ้า source='plan')
    note          NVARCHAR(500)  NULL,
    recorder      NVARCHAR(255)  NULL,
    created_at    DATETIME2(0)   NOT NULL CONSTRAINT DF_kitchen_order_created DEFAULT (SYSDATETIME()),
    updated_at    DATETIME2(0)   NOT NULL CONSTRAINT DF_kitchen_order_updated DEFAULT (SYSDATETIME()),
    CONSTRAINT PK_kitchen_production_order PRIMARY KEY (order_id),
    CONSTRAINT UQ_kitchen_order_doc UNIQUE (doc_no),
    -- กดปุ่ม "สร้างจากแผน" หรือ "สร้างจากยอดสาขา" ซ้ำในวันเดียวกันต้องไม่ได้ใบซ้ำ
    CONSTRAINT UQ_kitchen_order_day UNIQUE (produce_date, product_key, source),
    CONSTRAINT CK_kitchen_order_status CHECK (status IN (N'รอผลิต', N'กำลังผลิต', N'ผลิตเสร็จ', N'ยกเลิก')),
    CONSTRAINT CK_kitchen_order_source CHECK (source IN (N'manual', N'demand', N'plan')),
    CONSTRAINT CK_kitchen_order_qty CHECK (order_qty > 0)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_kitchen_order_date')
CREATE INDEX IX_kitchen_order_date
    ON dbo.kitchen_production_order (produce_date DESC, status) INCLUDE (product_key, order_qty, produced_qty);
GO


/* ---------------------------------------------------------------------------
   บันทึกการผลิตจริง — หนึ่งแถวต่อหนึ่งครั้งที่กดบันทึกว่าผลิตได้เท่าไหร่
   แยกจากคำสั่งผลิตเพราะของจริงทยอยผลิตหลายรอบต่อใบ และรายงานต้องบอกได้ว่า
   ผลิตตอนกี่โมง ใครเป็นคนทำ

   qty_produced ติดลบไม่ได้ ถ้าบันทึกเกินต้องแก้ด้วยการลบแถวนั้นแล้วบันทึกใหม่
   (ยอมให้ติดลบเมื่อไหร่ รายงานย้อนหลังจะอ่านไม่รู้เรื่องทันที)
--------------------------------------------------------------------------- */
IF OBJECT_ID(N'dbo.kitchen_production_run', N'U') IS NULL
CREATE TABLE dbo.kitchen_production_run (
    run_id        BIGINT         IDENTITY(1,1) NOT NULL,
    order_id      BIGINT         NULL,       -- ผลิตนอกคำสั่งได้ จึงเป็น NULL ได้
    produce_date  DATE           NOT NULL,
    product_key   NVARCHAR(50)   NOT NULL,
    product_code  NVARCHAR(50)   NOT NULL CONSTRAINT DF_kitchen_run_code DEFAULT (N''),
    product_name  NVARCHAR(255)  NOT NULL CONSTRAINT DF_kitchen_run_name DEFAULT (N''),
    qty_produced  DECIMAL(18,3)  NOT NULL,
    qty_waste     DECIMAL(18,3)  NOT NULL CONSTRAINT DF_kitchen_run_waste DEFAULT (0),
    unit          NVARCHAR(50)   NULL,
    note          NVARCHAR(500)  NULL,
    recorder      NVARCHAR(255)  NULL,
    recorded_at   DATETIME2(0)   NOT NULL CONSTRAINT DF_kitchen_run_recorded DEFAULT (SYSDATETIME()),
    CONSTRAINT PK_kitchen_production_run PRIMARY KEY (run_id),
    CONSTRAINT FK_kitchen_run_order FOREIGN KEY (order_id)
        REFERENCES dbo.kitchen_production_order (order_id),
    CONSTRAINT CK_kitchen_run_qty CHECK (qty_produced >= 0 AND qty_waste >= 0)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_kitchen_run_date')
CREATE INDEX IX_kitchen_run_date
    ON dbo.kitchen_production_run (produce_date DESC) INCLUDE (product_key, qty_produced, qty_waste);
GO


/* ---------------------------------------------------------------------------
   เบิกวัตถุดิบ — ครัวกลางเบิกของจากสต๊อกตัวเองไปใช้ผลิต
   หนึ่งใบเบิกมีหลายรายการ เก็บแบนหนึ่งแถวต่อหนึ่ง (ใบ, วัตถุดิบ) เหมือน store_fulfillment
   ไม่ทำตารางหัวใบแยก เพราะหัวใบมีแค่วันที่กับคนเบิกซึ่งซ้ำกันทุกแถวอยู่แล้ว

   order_id ผูกกับคำสั่งผลิตได้ (เบิกเพื่อผลิตใบไหน) หรือเว้นว่างถ้าเบิกใช้ทั่วไป
--------------------------------------------------------------------------- */
IF OBJECT_ID(N'dbo.kitchen_material_issue', N'U') IS NULL
CREATE TABLE dbo.kitchen_material_issue (
    issue_id     BIGINT         IDENTITY(1,1) NOT NULL,
    doc_no       NVARCHAR(50)   NOT NULL,   -- MI-YYYYMMDD-NNN
    issue_date   DATE           NOT NULL,
    order_id     BIGINT         NULL,
    item_key     NVARCHAR(50)   NOT NULL,
    item_code    NVARCHAR(50)   NOT NULL CONSTRAINT DF_kitchen_issue_code DEFAULT (N''),
    item_name    NVARCHAR(255)  NOT NULL CONSTRAINT DF_kitchen_issue_name DEFAULT (N''),
    qty          DECIMAL(18,3)  NOT NULL,
    unit         NVARCHAR(50)   NULL,
    note         NVARCHAR(500)  NULL,
    recorder     NVARCHAR(255)  NULL,
    recorded_at  DATETIME2(0)   NOT NULL CONSTRAINT DF_kitchen_issue_recorded DEFAULT (SYSDATETIME()),
    CONSTRAINT PK_kitchen_material_issue PRIMARY KEY (issue_id),
    CONSTRAINT UQ_kitchen_issue_line UNIQUE (doc_no, item_key),
    CONSTRAINT FK_kitchen_issue_order FOREIGN KEY (order_id)
        REFERENCES dbo.kitchen_production_order (order_id),
    CONSTRAINT CK_kitchen_issue_qty CHECK (qty > 0)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_kitchen_issue_date_item')
CREATE INDEX IX_kitchen_issue_date_item
    ON dbo.kitchen_material_issue (issue_date DESC, item_key) INCLUDE (qty);
GO
