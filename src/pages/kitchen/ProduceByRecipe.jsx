import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ChefHat, CheckCircle2 } from 'lucide-react';
import { kitchenCall, formatQty } from '../../services/kitchenService';
import { fetchQcrdRecipe } from '../../services/qcrdService';
import QcrdMenuPicker from '../../components/kitchen/QcrdMenuPicker';
import RecipeRunForm from '../../components/kitchen/RecipeRunForm';
import { isKitchenItemCode } from '../../../lib/kitchenRequests';

// ของที่ครัวกลางผลิต = กติการหัสเดียวกับแผง "รายการที่สาขาสั่งเบิก" ในหน้ารายการสั่งผลิต
const isKitchenMenu = (menu) => isKitchenItemCode(menu.code);

/**
 * สั่งผลิต — เลือกเมนูจาก QC/RD ดูสูตร BOM แล้วออกคำสั่งผลิตเป็นสถานะ "กำลังผลิต"
 * ผลิตเสร็จแล้วค่อยกรอกยอดใช้จริง/ที่ได้ ด้วยปุ่มดินสอในหน้ารายการสั่งผลิต
 * ตัวฟอร์มอยู่ที่ components/kitchen/RecipeRunForm.jsx (ตัวเดียวกับที่ดินสอเปิด)
 */
export default function ProduceByRecipe() {
  const [stockItems, setStockItems] = useState([]);
  const [picked, setPicked] = useState(null); // { menu, lines }
  const [pickLoading, setPickLoading] = useState(false);
  const [summary, setSummary] = useState(null);

  useEffect(() => {
    kitchenCall('getKitchenItems')
      .then((res) => setStockItems(res.items || []))
      .catch((err) => toast.error(err.message));
  }, []);

  const reset = () => { setPicked(null); setSummary(null); };

  const pick = async (menu) => {
    setPickLoading(true);
    try {
      const res = await fetchQcrdRecipe(menu.code);
      setSummary(null);
      setPicked({ menu: res.menu, lines: res.lines || [] });
    } catch (err) {
      toast.error(err.message);
    } finally {
      setPickLoading(false);
    }
  };

  return (
    <div className="p-4 md:p-6 space-y-5">
      <header>
        <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2">
          <ChefHat className="w-5 h-5 text-amber-400" />
          สั่งผลิต
        </h1>
        <p className="text-xs text-slate-500 mt-0.5">
          เลือกเมนูจาก QC/RD เพื่อดูสูตร BOM แล้วสั่งผลิต · คำสั่งขึ้นเป็น "กำลังผลิต" ทันที · ผลิตเสร็จแล้วกรอกยอดใช้จริงและจำนวนที่ได้ที่หน้ารายการสั่งผลิต
        </p>
      </header>

      {!picked ? (
        <section className="bg-slate-900/60 border border-slate-800 rounded-xl p-4">
          <h2 className="text-sm font-semibold text-slate-200 mb-3">เลือกเมนูที่จะผลิต</h2>
          <QcrdMenuPicker
            onPick={pick}
            disabled={pickLoading}
            listClassName="max-h-[60vh]"
            only={isKitchenMenu}
            onlyLabel="เฉพาะรหัส 10xxxxx / 010xxxx ของครัวกลาง"
          />
        </section>
      ) : summary ? (
        <section className="bg-slate-900/60 border border-emerald-500/30 rounded-xl p-6 space-y-4">
          <div className="flex items-center gap-2 text-emerald-300 font-semibold">
            <CheckCircle2 className="w-5 h-5" /> สั่งผลิต {picked.menu.name} แล้ว
          </div>
          <p className="text-sm text-slate-300">
            คำสั่งผลิต <span className="font-mono text-slate-100">{summary.docNo}</span>
            {' · '}{formatQty(summary.orderQty)} {summary.unit}
            {' · '}สถานะ <span className="text-amber-300">{summary.status}</span>
          </p>
          <p className="text-xs text-slate-500">
            ผลิตเสร็จแล้วไปที่รายการสั่งผลิต แท็บสถานะการผลิต กดรูปดินสอที่คำสั่งนี้เพื่อกรอกยอดวัตถุดิบที่ใช้จริงและจำนวนที่ได้
          </p>
          <div className="flex flex-wrap gap-2">
            <Link
              to="/kitchen/orders?tab=production"
              className="px-4 py-2 rounded-lg text-xs font-semibold bg-slate-800 text-slate-200 hover:bg-slate-700 border border-slate-700"
            >
              ดูสถานะการผลิต
            </Link>
            <button
              onClick={reset}
              className="px-4 py-2 rounded-lg text-xs font-semibold bg-amber-500 text-slate-950 hover:bg-amber-400"
            >
              สั่งผลิตเมนูอื่น
            </button>
          </div>
        </section>
      ) : (
        <RecipeRunForm
          key={picked.menu.code}
          menu={picked.menu}
          lines={picked.lines}
          stockItems={stockItems}
          onChangeMenu={reset}
          onSaved={setSummary}
        />
      )}
    </div>
  );
}
