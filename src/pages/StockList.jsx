import React, { useState } from 'react';
import { 
  ClipboardList, 
  Search, 
  Save, 
  Send, 
  CheckCircle, 
  Package, 
  Plus, 
  Trash2, 
  Building2, 
  Calendar,
  AlertCircle
} from 'lucide-react';
import { toast } from 'react-hot-toast';

export default function StockList({ selectedBranch = 'all' }) {
  const [searchTerm, setSearchTerm] = useState('');
  const [saving, setSaving] = useState(false);

  // Sample stock items for counting
  const [stockItems, setStockItems] = useState([
    { id: '1001', name: 'แป้งพิซซ่าสำเร็จรูป 10 นิ้ว', category: 'แป้ง/วัตถุดิบหลัก', unit: 'แผ่น', onHand: 45, countQty: '', reqQty: '' },
    { id: '1002', name: 'มอสซาเรลล่าชีส 1kg', category: 'ของเย็น/ชีส', unit: 'ถุง', onHand: 12, countQty: '', reqQty: '' },
    { id: '1003', name: 'ซอสมะเขือเทศสูตรเข้มข้น', category: 'ซอส/เครื่องปรุง', unit: 'ถุง', onHand: 8, countQty: '', reqQty: '' },
    { id: '1004', name: 'เปปเปอโรนีสไลซ์ 500g', category: 'เนื้อสัตว์', unit: 'แพ็ค', onHand: 15, countQty: '', reqQty: '' },
    { id: '1005', name: 'ผักสลัดคอสสด', category: 'ห้องผัก', unit: 'กก.', onHand: 6, countQty: '', reqQty: '' },
    { id: '1006', name: 'มะเขือเทศเชอร์รี่', category: 'ห้องผัก', unit: 'กก.', onHand: 4, countQty: '', reqQty: '' },
    { id: '1007', name: 'กล่องพิซซ่า 10 นิ้ว (พิมพ์โลโก้)', category: 'บรรจุภัณฑ์', unit: 'แพ็ค', onHand: 200, countQty: '', reqQty: '' }
  ]);

  const handleQtyChange = (id, field, val) => {
    setStockItems(prev => prev.map(item => {
      if (item.id === id) {
        return { ...item, [field]: val };
      }
      return item;
    }));
  };

  const handleSaveCount = () => {
    setSaving(true);
    setTimeout(() => {
      setSaving(false);
      toast.success("บันทึกข้อมูลการนับสต๊อกเรียบร้อยแล้ว!");
    }, 800);
  };

  const filteredItems = stockItems.filter(item => 
    item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    item.id.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="glass-panel rounded-2xl p-5 border border-slate-800 bg-gradient-to-r from-slate-900 to-amber-950/20 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold text-amber-400 mb-1">
            <ClipboardList className="w-4 h-4" />
            <span>ระบบนับสต๊อกและขอเบิกสินค้า</span>
          </div>
          <h1 className="text-xl md:text-2xl font-bold text-slate-100">นับสต๊อกสินค้าประจำวัน</h1>
          <p className="text-xs text-slate-400 mt-1">กรอกจำนวนคงเหลือจริง และจำนวนที่ต้องการขอเบิกเข้าสาขา</p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleSaveCount}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs shadow-lg shadow-amber-500/20 transition-all cursor-pointer"
          >
            <Save className="w-4 h-4" />
            <span>{saving ? 'กำลังบันทึก...' : 'บันทึกข้อมูลสต๊อก'}</span>
          </button>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="glass-card rounded-2xl p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="ค้นหารหัส หรือ ชื่อสินค้า..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-10 pr-4 py-2 text-xs text-slate-200 focus:outline-none focus:border-amber-500"
          />
        </div>
        <div className="text-xs text-slate-400">
          แสดง <strong className="text-amber-400">{filteredItems.length}</strong> รายการ
        </div>
      </div>

      {/* Stock Table */}
      <div className="glass-panel rounded-2xl border border-slate-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="bg-slate-900 text-slate-400 font-semibold border-b border-slate-800">
              <tr>
                <th className="px-4 py-3">รหัสสินค้า</th>
                <th className="px-4 py-3">ชื่อสินค้า</th>
                <th className="px-4 py-3">หมวดหมู่</th>
                <th className="px-4 py-3 text-center">หน่วย</th>
                <th className="px-4 py-3 text-right">ยอดยกมา</th>
                <th className="px-4 py-3 text-center w-32">นับได้จริง</th>
                <th className="px-4 py-3 text-center w-32">ขอเบิกเพิ่ม</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {filteredItems.map(item => (
                <tr key={item.id} className="hover:bg-slate-800/40 transition-colors">
                  <td className="px-4 py-3 font-mono text-amber-400 font-bold">{item.id}</td>
                  <td className="px-4 py-3 font-medium text-slate-100">{item.name}</td>
                  <td className="px-4 py-3 text-slate-400">{item.category}</td>
                  <td className="px-4 py-3 text-center text-slate-400">{item.unit}</td>
                  <td className="px-4 py-3 text-right font-mono text-slate-400">{item.onHand}</td>
                  <td className="px-4 py-2 text-center">
                    <input
                      type="number"
                      placeholder="0"
                      value={item.countQty}
                      onChange={e => handleQtyChange(item.id, 'countQty', e.target.value)}
                      className="w-24 bg-slate-950 border border-slate-700 focus:border-amber-500 rounded-lg px-2.5 py-1 text-center font-bold text-amber-300 focus:outline-none"
                    />
                  </td>
                  <td className="px-4 py-2 text-center">
                    <input
                      type="number"
                      placeholder="0"
                      value={item.reqQty}
                      onChange={e => handleQtyChange(item.id, 'reqQty', e.target.value)}
                      className="w-24 bg-slate-950 border border-slate-700 focus:border-emerald-500 rounded-lg px-2.5 py-1 text-center font-bold text-emerald-300 focus:outline-none"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
