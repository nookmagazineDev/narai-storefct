import React from 'react';
import { Link } from 'react-router-dom';
import { 
  Store, 
  CalendarCheck, 
  BarChart3, 
  ArrowRight, 
  PackageCheck, 
  Clock, 
  Building2, 
  CheckCircle2,
  Database
} from 'lucide-react';
import { BRANCH_MAP } from '../services/requisitionService';

export default function DashboardHome({ selectedBranch = 'all' }) {
  const currentBranchName = BRANCH_MAP[selectedBranch]?.name || 'ทุกสาขา';

  return (
    <div className="space-y-6">
      {/* Hero Welcome Banner */}
      <div className="glass-panel rounded-2xl p-6 border border-slate-800 bg-gradient-to-r from-amber-950/30 via-slate-900 to-slate-900 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
        <div>
          <span className="px-3 py-1 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/30 text-xs font-semibold">
            ระบบบริหารคลังสินค้า Store System
          </span>
          <h1 className="text-2xl md:text-3xl font-bold text-slate-100 mt-2">
            ยินดีต้อนรับ คุณ magazine 👋
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            สาขาทำรายการปัจจุบัน: <strong className="text-amber-400 font-medium">{currentBranchName}</strong>
          </p>
        </div>

        <Link
          to="/requisition-calendar"
          className="px-5 py-3 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 text-slate-950 font-bold text-xs shadow-lg shadow-amber-500/20 hover:scale-105 transition-all flex items-center gap-2"
        >
          <CalendarCheck className="w-4 h-4" />
          <span>เข้าสู่ "ปฏิทินใบเบิกสินค้า"</span>
          <ArrowRight className="w-4 h-4 ml-1" />
        </Link>
      </div>

      {/* Quick Navigation Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        
        {/* Card 1: Requisition Calendar */}
        <Link
          to="/requisition-calendar"
          className="glass-card rounded-2xl p-6 border border-amber-500/30 flex flex-col justify-between group cursor-pointer"
        >
          <div>
            <div className="flex items-center justify-between mb-4">
              <div className="p-3.5 rounded-xl bg-amber-500/20 text-amber-400 border border-amber-500/40">
                <CalendarCheck className="w-7 h-7" />
              </div>
              <span className="text-[10px] px-2.5 py-1 rounded-full bg-amber-500/20 text-amber-300 font-bold">
                SUB-MENU หลัก
              </span>
            </div>
            <h2 className="text-xl font-bold text-slate-100 group-hover:text-amber-400 transition-colors">
              ปฏิทินใบเบิกสินค้า (Requisition Calendar)
            </h2>
            <p className="text-xs text-slate-400 mt-2 leading-relaxed">
              แสดงปฏิทินและรายการใบเบิกสินค้าประจำวัน แยกตามวันที่รับของ (Receive Date) และสาขา พร้อมระบบคลิกดูรายละเอียดรายการสินค้าในใบเบิก
            </p>
          </div>

          <div className="mt-8 flex items-center text-xs font-bold text-amber-400 gap-1 group-hover:translate-x-1 transition-transform">
            <span>เปิดหน้าปฏิทินใบเบิก</span>
            <ArrowRight className="w-4 h-4" />
          </div>
        </Link>

        {/* Card 2: Stock Summary */}
        <Link
          to="/stock-total"
          className="glass-card rounded-2xl p-6 border border-slate-800 flex flex-col justify-between group cursor-pointer"
        >
          <div>
            <div className="flex items-center justify-between mb-4">
              <div className="p-3.5 rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/40">
                <BarChart3 className="w-7 h-7" />
              </div>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-bold">
                รายงานคลัง
              </span>
            </div>
            <h2 className="text-xl font-bold text-slate-100 group-hover:text-emerald-400 transition-colors">
              สรุปสต๊อกรวม (Stock Total)
            </h2>
            <p className="text-xs text-slate-400 mt-2 leading-relaxed">
              ดูภาพรวมมูลค่าสต๊อกสินค้า ปริมาณคงเหลือจากการปิดรอบ คำนวณจากยอดยกมา + ยอดรับเข้า (TRF/RCV) - การใช้งาน (Usage)
            </p>
          </div>

          <div className="mt-8 flex items-center text-xs font-bold text-emerald-400 gap-1 group-hover:translate-x-1 transition-transform">
            <span>ดูรายงานสรุปสต๊อก</span>
            <ArrowRight className="w-4 h-4" />
          </div>
        </Link>

      </div>
    </div>
  );
}
