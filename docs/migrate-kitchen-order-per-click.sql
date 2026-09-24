/* ============================================================================
   ครัวกลาง: ให้คำสั่งผลิตแบบกรอกเอง (manual) สั่งซ้ำสินค้าเดิมในวันเดิมได้ — แยกใบทุกครั้งที่กดสั่ง

   เดิม: UQ_kitchen_order_day = UNIQUE (produce_date, product_key, source) ครอบทุก source
         กดสั่งผลิตสินค้าเดิมวันเดิมเป็นครั้งที่สองจึงชน (หน้าเว็บถามรวมเข้าใบเดิมแทน)
   ใหม่: เอาข้อจำกัดนั้นออก แล้วสร้าง unique index แบบกรองเฉพาะ source = demand / plan
         ปุ่ม "สร้างจากยอดสาขา" / "สร้างจากแผน" ยังกันใบซ้ำได้เหมือนเดิม (เหตุผลเดิมของข้อจำกัดนี้)
         ส่วน manual ออกใบใหม่ได้ทุกครั้ง แยกกันด้วยเลขใบและเวลาที่สั่ง (created_at)

   รันครั้งเดียวบนเครื่องที่ออฟฟิศ รันซ้ำได้ ไม่พัง:
     sqlcmd -S localhost\SQLEXPRESS -d InventoryNarai -U sa -P '<รหัสผ่าน>' -I -b -i docs\migrate-kitchen-order-per-click.sql
   (-I = เปิด QUOTED_IDENTIFIER ซึ่ง filtered index ต้องใช้ — ในไฟล์ตั้งไว้ให้แล้วด้วย)
   หรือเปิดใน SQL Server Management Studio แล้วกด Execute

   ไม่ต้องรีสตาร์ต office-server — หน้าเว็บรู้เองว่าฐานรองรับแล้ว (ลองสร้างใบใหม่ก่อน ชนค่อยถามรวมใบ)
============================================================================ */

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

USE InventoryNarai;
GO

IF EXISTS (
    SELECT 1 FROM sys.key_constraints
     WHERE name = N'UQ_kitchen_order_day'
       AND parent_object_id = OBJECT_ID(N'dbo.kitchen_production_order')
)
    ALTER TABLE dbo.kitchen_production_order DROP CONSTRAINT UQ_kitchen_order_day;
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
     WHERE name = N'UX_kitchen_order_day_auto'
       AND object_id = OBJECT_ID(N'dbo.kitchen_production_order')
)
    CREATE UNIQUE INDEX UX_kitchen_order_day_auto
        ON dbo.kitchen_production_order (produce_date, product_key, source)
        WHERE source IN (N'demand', N'plan');
GO

PRINT N'เสร็จ: คำสั่งผลิตแบบกรอกเองสั่งซ้ำวันเดิมได้แล้ว (demand/plan ยังกันซ้ำเหมือนเดิม)';
GO
