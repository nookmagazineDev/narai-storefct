import React, { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { 
  Package, 
  Calendar, 
  BarChart3, 
  ChevronDown, 
  ChevronRight, 
  Store, 
  Bell, 
  User, 
  Layers, 
  Menu, 
  X, 
  Building2, 
  CalendarCheck,
  CheckSquare 
} from 'lucide-react';
import { BRANCH_MAP } from '../services/requisitionService';

export default function DashboardLayout({ children, currentBranch, onBranchChange }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [isStockMenuOpen, setIsStockMenuOpen] = useState(true);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [selectedBranch, setSelectedBranch] = useState(currentBranch || 'all');

  const handleBranchSelect = (e) => {
    const bKey = e.target.value;
    setSelectedBranch(bKey);
    if (onBranchChange) onBranchChange(bKey);
  };

  const isStockActive = 
    location.pathname === '/stock-total' || 
    location.pathname === '/requisition-calendar' ||
    location.pathname === '/fulfillment';

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col md:flex-row font-['Prompt',sans-serif]">
      {/* Sidebar - Desktop */}
      <aside className="hidden md:flex flex-col w-72 bg-slate-900/90 backdrop-blur-xl border-r border-slate-800/80 z-30 select-none">
        {/* Brand Header */}
        <div className="h-16 px-6 flex items-center gap-3 border-b border-slate-800/80 bg-slate-950/40">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-amber-500 to-orange-500 flex items-center justify-center shadow-lg shadow-amber-500/20">
            <Store className="w-5 h-5 text-slate-950 stroke-[2.5]" />
          </div>
          <div>
            <h1 className="font-bold text-base bg-gradient-to-r from-amber-400 to-orange-300 bg-clip-text text-transparent">
              STORE SYSTEM
            </h1>
            <p className="text-[11px] text-slate-400">ระบบบริหารคลัง & ใบเบิกสินค้า</p>
          </div>
        </div>

        {/* Navigation Items */}
        <div className="flex-1 py-4 px-3 space-y-1.5 overflow-y-auto">
          {/* Main Dashboard */}
          <Link
            to="/"
            className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all ${
              location.pathname === '/'
                ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20 shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <Layers className="w-4 h-4" />
            <span>ภาพรวมระบบ (Overview)</span>
          </Link>

          {/* Sub-menu Group: Stock & Requisitions */}
          <div className="pt-2">
            <button
              onClick={() => setIsStockMenuOpen(!isStockMenuOpen)}
              className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all ${
                isStockActive
                  ? 'text-amber-400 bg-slate-800/70 border border-slate-700/50'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
            >
              <div className="flex items-center gap-3">
                <Package className="w-4 h-4 text-amber-500" />
                <span>ระบบคลังสินค้า (Stock)</span>
              </div>
              {isStockMenuOpen ? (
                <ChevronDown className="w-4 h-4 text-slate-400 transition-transform" />
              ) : (
                <ChevronRight className="w-4 h-4 text-slate-400 transition-transform" />
              )}
            </button>

            {/* Sub-menu Items (Removed Stock Count) */}
            {isStockMenuOpen && (
              <div className="mt-1 ml-4 pl-3 border-l-2 border-slate-800 space-y-1">
                {/* SUB-MENU: Requisition Calendar */}
                <Link
                  to="/requisition-calendar"
                  className={`flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                    location.pathname === '/requisition-calendar'
                      ? 'bg-amber-500 text-slate-950 font-semibold shadow-md shadow-amber-500/20'
                      : 'text-amber-300/90 hover:text-amber-300 hover:bg-amber-500/10 border border-amber-500/20'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <CalendarCheck className="w-3.5 h-3.5" />
                    <span>ปฏิทินใบเบิกสินค้า</span>
                  </div>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-400/20 text-amber-300 font-normal">
                    ปฏิทิน
                  </span>
                </Link>

                {/* SUB-MENU: Stock Summary */}
                <Link
                  to="/stock-total"
                  className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                    location.pathname === '/stock-total'
                      ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
                  }`}
                >
                  <BarChart3 className="w-3.5 h-3.5 text-sky-400" />
                  <span>สรุปสต๊อกรวม</span>
                </Link>

                {/* SUB-MENU: Order Fulfillment (จัดของ) */}
                <Link
                  to="/fulfillment"
                  className={`flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                    location.pathname === '/fulfillment'
                      ? 'bg-emerald-500 text-slate-950 font-semibold shadow-md shadow-emerald-500/20'
                      : 'text-emerald-400/90 hover:text-emerald-300 hover:bg-emerald-500/10 border border-emerald-500/20'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <CheckSquare className="w-3.5 h-3.5" />
                    <span>จัดของ (Fulfillment)</span>
                  </div>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-400/20 text-emerald-300 font-normal">
                    ชีท: จัดของ
                  </span>
                </Link>
              </div>
            )}
          </div>
        </div>

        {/* User Footer */}
        <div className="p-4 border-t border-slate-800/80 bg-slate-950/60">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-slate-800 border border-amber-500/30 flex items-center justify-center text-amber-400 font-bold text-xs">
              M
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-slate-200 truncate">คุณ magazine</p>
              <p className="text-[10px] text-amber-400/80 truncate">Store Manager</p>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top Navbar */}
        <header className="h-16 px-4 md:px-6 bg-slate-900/80 backdrop-blur-xl border-b border-slate-800/80 flex items-center justify-between gap-4 sticky top-0 z-20">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              className="md:hidden p-2 text-slate-400 hover:text-slate-200 rounded-lg hover:bg-slate-800"
            >
              {isMobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
            <div className="hidden sm:flex items-center gap-2 text-xs text-slate-400">
              <Building2 className="w-4 h-4 text-amber-500" />
              <span>เลือกสาขาทำรายการ:</span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="relative">
              <select
                value={selectedBranch}
                onChange={handleBranchSelect}
                className="bg-slate-950 border border-slate-700/80 text-amber-300 text-xs rounded-xl px-3 py-2 pr-8 focus:outline-none focus:border-amber-500 appearance-none font-medium shadow-inner cursor-pointer"
              >
                {Object.entries(BRANCH_MAP).map(([key, info]) => (
                  <option key={key} value={key} className="bg-slate-900 text-slate-200">
                    {info.name}
                  </option>
                ))}
              </select>
              <ChevronDown className="w-3.5 h-3.5 text-amber-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>

            <div className="w-px h-6 bg-slate-800 hidden sm:block" />

            <button className="relative p-2 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-xl transition-colors">
              <Bell className="w-4 h-4" />
              <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
            </button>
          </div>
        </header>

        {/* Mobile Navigation Menu */}
        {isMobileMenuOpen && (
          <div className="md:hidden bg-slate-900 border-b border-slate-800 p-4 space-y-2 animate-in slide-in-from-top duration-200">
            <Link
              to="/"
              onClick={() => setIsMobileMenuOpen(false)}
              className="block px-3 py-2 rounded-lg text-sm font-medium text-slate-300 hover:bg-slate-800"
            >
              หน้าแรก (Overview)
            </Link>
            <div className="pl-3 border-l-2 border-amber-500/40 space-y-1 pt-1">
              <Link
                to="/requisition-calendar"
                onClick={() => setIsMobileMenuOpen(false)}
                className="block px-3 py-2 rounded-lg text-xs font-semibold bg-amber-500 text-slate-950"
              >
                📅 ปฏิทินใบเบิกสินค้า
              </Link>
              <Link
                to="/stock-total"
                onClick={() => setIsMobileMenuOpen(false)}
                className="block px-3 py-2 rounded-lg text-xs font-medium text-slate-300 hover:bg-slate-800"
              >
                📊 สรุปสต๊อกรวม
              </Link>
              <Link
                to="/fulfillment"
                onClick={() => setIsMobileMenuOpen(false)}
                className="block px-3 py-2 rounded-lg text-xs font-semibold bg-emerald-500 text-slate-950"
              >
                📦 จัดของ (Fulfillment - ชีท: จัดของ)
              </Link>
            </div>
          </div>
        )}

        <main className="flex-1 overflow-y-auto p-4 md:p-6 bg-slate-950/60">
          {children}
        </main>
      </div>
    </div>
  );
}
