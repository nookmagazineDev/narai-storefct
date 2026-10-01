import React, { useState, useEffect } from 'react';
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
  CheckSquare,
  BellRing,
  Truck,
  ChefHat,
  ClipboardList,
  PackageMinus,
  Boxes,
  CalendarDays,
  Factory,
  LogOut,
  LogIn,
  KeyRound,
  Users as UsersIcon,
  BookOpen,
} from 'lucide-react';
import { BRANCH_MAP, fetchPendingEditApprovals } from '../services/requisitionService';
import { useBranchRegistry } from '../services/branchService';
import { useAuth } from '../contexts/AuthContext';
import ChangePasswordModal from '../components/auth/ChangePasswordModal';

/* เมนูย่อยของครัวกลาง — ประกาศไว้ที่เดียว ใช้ทั้งแถบข้างและเมนูมือถือ
   เมนูสต๊อกข้างล่างเขียนซ้ำสองชุดอยู่ ซึ่งทำให้เพิ่มหน้าแล้วลืมแก้อีกชุดได้ง่าย */
const KITCHEN_LINKS = [
  // page = key ใน lib/pages.js — เมนูแสดงเฉพาะหน้าที่ผู้ใช้มีสิทธิ์
  { to: '/kitchen/plan', page: 'kitchen-plan', label: 'แพลนผลิต', Icon: CalendarDays, color: 'text-cyan-400' },
  { to: '/kitchen/status', page: 'kitchen-status', label: 'สถานะการผลิต', Icon: Factory, color: 'text-emerald-400' },
  { to: '/kitchen/orders', page: 'kitchen-orders', label: 'รายการที่สาขาเบิก', Icon: ClipboardList, color: 'text-amber-400' },
  { to: '/kitchen/issue', page: 'kitchen-issue', label: 'เบิกวัตถุดิบ', Icon: PackageMinus, color: 'text-rose-400' },
  { to: '/kitchen/balance', page: 'kitchen-balance', label: 'วัตถุดิบคงเหลือ', Icon: Boxes, color: 'text-sky-400' },
  { to: '/kitchen/report', page: 'kitchen-report', label: 'ดูรายงานการผลิต', Icon: BarChart3, color: 'text-teal-400' },
  { to: '/kitchen/menus', page: 'kitchen-menus', label: 'เมนูครัวกลาง', Icon: BookOpen, color: 'text-violet-400' },
];

export default function DashboardLayout({ children, currentBranch, onBranchChange }) {
  // เติมทะเบียนสาขาจากทะเบียนแม่ แล้วสั่งวาดใหม่ — เรียกที่นี่เพราะ layout ครอบทุกหน้า
  // ทุกหน้าที่ใช้ BRANCH_MAP จึงได้รายชื่อชุดเดียวกันโดยไม่ต้องไปเรียกเองทีละหน้า
  useBranchRegistry();

  const location = useLocation();
  const navigate = useNavigate();
  const [isStockMenuOpen, setIsStockMenuOpen] = useState(true);
  const [isKitchenMenuOpen, setIsKitchenMenuOpen] = useState(() => location.pathname.startsWith('/kitchen'));
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [selectedBranch, setSelectedBranch] = useState(currentBranch || 'all');
  const [pendingApprovalCount, setPendingApprovalCount] = useState(0);
  const [showPassword, setShowPassword] = useState(false);
  const auth = useAuth();
  const see = auth.canView;
  const kitchenLinks = KITCHEN_LINKS.filter((l) => see(l.page));
  const storeKeys = ['requisition-calendar', 'stock-total', 'fulfillment', 'status-check', 'delivery-summary'];
  const seeStore = storeKeys.some(see);
  const seeApprovals = see('status-check');

  const handleBranchSelect = (e) => {
    const bKey = e.target.value;
    setSelectedBranch(bKey);
    if (onBranchChange) onBranchChange(bKey);
  };

  // Live count of branch-reported receiving edits still awaiting warehouse approval — shown as
  // a badge on the "ตรวจสอบสถานะ" menu link and the header bell, so it surfaces immediately
  // instead of requiring a warehouse staffer to open every requisition to notice it.
  useEffect(() => {
    // คนที่ไม่มีสิทธิ์หน้าตรวจสอบสถานะไม่ต้องดึง (API จะตอบ 403 อยู่ดี)
    if (auth.loading || !seeApprovals) return undefined;
    let isMounted = true;
    const load = () => {
      fetchPendingEditApprovals()
        .then(res => { if (isMounted) setPendingApprovalCount(res.count || 0); })
        .catch(err => console.warn("Failed to load pending edit approvals count:", err));
    };
    load();
    const interval = setInterval(load, 2 * 60 * 1000);
    return () => { isMounted = false; clearInterval(interval); };
  }, [auth.loading, seeApprovals]);

  const isStockActive =
    location.pathname === '/stock-total' ||
    location.pathname === '/requisition-calendar' ||
    location.pathname === '/fulfillment' ||
    location.pathname === '/status-check' ||
    location.pathname === '/delivery-summary';

  // เมนูครัวกลางทุกหน้าอยู่ใต้ /kitchen/ — เช็คด้วย prefix จะได้ไม่ต้องไล่เพิ่มทีละ path
  // ทุกครั้งที่มีหน้าใหม่ (เมนูสต๊อกข้างบนเป็นตัวอย่างของสิ่งที่เกิดขึ้นเมื่อไล่เพิ่มเอง)
  const isKitchenActive = location.pathname.startsWith('/kitchen');

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
          {see('overview') && <Link
            to="/"
            className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all ${
              location.pathname === '/'
                ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20 shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <Layers className="w-4 h-4" />
            <span>ภาพรวมระบบ (Overview)</span>
          </Link>}

          {/* Sub-menu Group: Stock & Requisitions */}
          {seeStore && <div className="pt-2">
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
                {see('requisition-calendar') && <Link
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
                </Link>}

                {/* SUB-MENU: Stock Summary */}
                {see('stock-total') && <Link
                  to="/stock-total"
                  className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                    location.pathname === '/stock-total'
                      ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
                  }`}
                >
                  <BarChart3 className="w-3.5 h-3.5 text-sky-400" />
                  <span>สรุปสต๊อกรวม</span>
                </Link>}

                {/* SUB-MENU: Order Fulfillment (จัดของ) */}
                {see('fulfillment') && <Link
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
                </Link>}

                {/* SUB-MENU: Status Check (ตรวจสอบสถานะ) */}
                {see('status-check') && <Link
                  to="/status-check"
                  className={`flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                    location.pathname === '/status-check'
                      ? 'bg-sky-500 text-slate-950 font-semibold shadow-md shadow-sky-500/20'
                      : 'text-sky-400/90 hover:text-sky-300 hover:bg-sky-500/10 border border-sky-500/20'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <BellRing className="w-3.5 h-3.5" />
                    <span>ตรวจสอบสถานะ</span>
                  </div>
                  {pendingApprovalCount > 0 && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500 text-slate-950 font-bold animate-pulse">
                      {pendingApprovalCount}
                    </span>
                  )}
                </Link>}

                {/* SUB-MENU: Delivery Summary (สรุปส่งของ) */}
                {see('delivery-summary') && <Link
                  to="/delivery-summary"
                  className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                    location.pathname === '/delivery-summary'
                      ? 'bg-teal-500 text-slate-950 font-semibold shadow-md shadow-teal-500/20'
                      : 'text-teal-400/90 hover:text-teal-300 hover:bg-teal-500/10 border border-teal-500/20'
                  }`}
                >
                  <Truck className="w-3.5 h-3.5" />
                  <span>สรุปส่งของ</span>
                </Link>}
              </div>
            )}
          </div>}

          {/* Sub-menu Group: Central Kitchen */}
          {kitchenLinks.length > 0 && <div className="pt-2">
            <button
              onClick={() => setIsKitchenMenuOpen(!isKitchenMenuOpen)}
              className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all ${
                isKitchenActive
                  ? 'text-purple-300 bg-slate-800/70 border border-slate-700/50'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
            >
              <div className="flex items-center gap-3">
                <ChefHat className="w-4 h-4 text-purple-400" />
                <span>ครัวกลาง (Kitchen)</span>
              </div>
              {isKitchenMenuOpen ? (
                <ChevronDown className="w-4 h-4 text-slate-400 transition-transform" />
              ) : (
                <ChevronRight className="w-4 h-4 text-slate-400 transition-transform" />
              )}
            </button>

            {isKitchenMenuOpen && (
              <div className="mt-1 ml-4 pl-3 border-l-2 border-slate-800 space-y-1">
                {kitchenLinks.map(({ to, label, Icon, color }) => (
                  <Link
                    key={to}
                    to={to}
                    className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                      location.pathname === to
                        ? 'bg-purple-500/15 text-purple-300 border border-purple-500/30'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
                    }`}
                  >
                    <Icon className={`w-3.5 h-3.5 ${color}`} />
                    <span>{label}</span>
                  </Link>
                ))}
              </div>
            )}
          </div>}

          {auth.user?.isAdmin && (
            <div className="pt-2">
              <Link
                to="/admin/users"
                className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all ${
                  location.pathname === '/admin/users'
                    ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                }`}
              >
                <UsersIcon className="w-4 h-4" />
                <span>จัดการผู้ใช้</span>
              </Link>
            </div>
          )}
        </div>

        {/* User Footer */}
        <div className="p-4 border-t border-slate-800/80 bg-slate-950/60">
          {auth.user ? (
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-slate-800 border border-amber-500/30 flex items-center justify-center text-amber-400 font-bold text-xs uppercase">
                {(auth.user.name || auth.user.username).slice(0, 1)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-slate-200 truncate">{auth.user.name || auth.user.username}</p>
                <p className="text-[10px] text-amber-400/80 truncate">{auth.user.username}{auth.user.isAdmin ? ' · แอดมิน' : ''}</p>
              </div>
              <button onClick={() => setShowPassword(true)} title="เปลี่ยนรหัสผ่าน"
                className="p-1.5 rounded-lg text-slate-500 hover:text-slate-200 hover:bg-slate-800">
                <KeyRound className="w-4 h-4" />
              </button>
              <button onClick={async () => { await auth.logout(); navigate('/login'); }} title="ออกจากระบบ"
                className="p-1.5 rounded-lg text-slate-500 hover:text-rose-300 hover:bg-slate-800">
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <Link to="/login" className="flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs text-amber-300 border border-amber-500/30 hover:bg-amber-500/10">
              <LogIn className="w-4 h-4" /> เข้าสู่ระบบ
            </Link>
          )}
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

            {seeApprovals && <button
              onClick={() => navigate('/status-check')}
              className="relative p-2 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-xl transition-colors"
              title={pendingApprovalCount > 0 ? `${pendingApprovalCount} รายการรออนุมัติ` : 'ตรวจสอบสถานะ'}
            >
              <Bell className="w-4 h-4" />
              {pendingApprovalCount > 0 && (
                <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
              )}
            </button>}
          </div>
        </header>

        {/* Mobile Navigation Menu */}
        {isMobileMenuOpen && (
          <div className="md:hidden bg-slate-900 border-b border-slate-800 p-4 space-y-2 animate-in slide-in-from-top duration-200">
            {see('overview') && <Link
              to="/"
              onClick={() => setIsMobileMenuOpen(false)}
              className="block px-3 py-2 rounded-lg text-sm font-medium text-slate-300 hover:bg-slate-800"
            >
              หน้าแรก (Overview)
            </Link>}
            <div className="pl-3 border-l-2 border-amber-500/40 space-y-1 pt-1">
              {see('requisition-calendar') && <Link
                to="/requisition-calendar"
                onClick={() => setIsMobileMenuOpen(false)}
                className="block px-3 py-2 rounded-lg text-xs font-semibold bg-amber-500 text-slate-950"
              >
                📅 ปฏิทินใบเบิกสินค้า
              </Link>}
              {see('stock-total') && <Link
                to="/stock-total"
                onClick={() => setIsMobileMenuOpen(false)}
                className="block px-3 py-2 rounded-lg text-xs font-medium text-slate-300 hover:bg-slate-800"
              >
                📊 สรุปสต๊อกรวม
              </Link>}
              {see('fulfillment') && <Link
                to="/fulfillment"
                onClick={() => setIsMobileMenuOpen(false)}
                className="block px-3 py-2 rounded-lg text-xs font-semibold bg-emerald-500 text-slate-950"
              >
                📦 จัดของ (Fulfillment - ชีท: จัดของ)
              </Link>}
              {see('status-check') && <Link
                to="/status-check"
                onClick={() => setIsMobileMenuOpen(false)}
                className="flex items-center justify-between px-3 py-2 rounded-lg text-xs font-semibold bg-sky-500 text-slate-950"
              >
                <span>🔔 ตรวจสอบสถานะ</span>
                {pendingApprovalCount > 0 && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500 text-slate-950 font-bold">
                    {pendingApprovalCount}
                  </span>
                )}
              </Link>}
              {see('delivery-summary') && <Link
                to="/delivery-summary"
                onClick={() => setIsMobileMenuOpen(false)}
                className="block px-3 py-2 rounded-lg text-xs font-semibold bg-teal-500 text-slate-950"
              >
                🚚 สรุปส่งของ
              </Link>}
            </div>
            <div className="pl-3 border-l-2 border-purple-500/40 space-y-1 pt-1">
              {kitchenLinks.map(({ to, label }) => (
                <Link
                  key={to}
                  to={to}
                  onClick={() => setIsMobileMenuOpen(false)}
                  className="block px-3 py-2 rounded-lg text-xs font-medium text-slate-300 hover:bg-slate-800"
                >
                  {label}
                </Link>
              ))}
            </div>
            {auth.user?.isAdmin && (
              <Link to="/admin/users" onClick={() => setIsMobileMenuOpen(false)}
                className="block px-3 py-2 rounded-lg text-sm font-medium text-slate-300 hover:bg-slate-800">
                จัดการผู้ใช้
              </Link>
            )}
            {auth.user ? (
              <div className="flex items-center justify-between pt-2 mt-2 border-t border-slate-800 text-xs text-slate-400">
                <span>{auth.user.name || auth.user.username}</span>
                <div className="flex gap-3">
                  <button onClick={() => { setIsMobileMenuOpen(false); setShowPassword(true); }} className="hover:text-slate-200">เปลี่ยนรหัสผ่าน</button>
                  <button onClick={async () => { await auth.logout(); navigate('/login'); }} className="text-rose-300">ออกจากระบบ</button>
                </div>
              </div>
            ) : (
              <Link to="/login" className="block px-3 py-2 rounded-lg text-sm text-amber-300">เข้าสู่ระบบ</Link>
            )}
          </div>
        )}

        <main className="flex-1 overflow-y-auto p-4 md:p-6 bg-slate-950/60">
          {children}
        </main>
        {showPassword && <ChangePasswordModal onClose={() => setShowPassword(false)} />}
      </div>
    </div>
  );
}
