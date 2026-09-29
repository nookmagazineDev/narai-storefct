import React, { useState, Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { Loader2 } from 'lucide-react';
import DashboardLayout from './layouts/DashboardLayout';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import PageGate, { firstAllowedPath } from './components/auth/PageGate';
import Login from './pages/Login';

const DashboardHome = lazy(() => import('./pages/DashboardHome'));
const StockTotalList = lazy(() => import('./pages/StockTotalList'));
const RequisitionCalendar = lazy(() => import('./pages/RequisitionCalendar'));
const OrderFulfillment = lazy(() => import('./pages/OrderFulfillment'));
const StatusCheck = lazy(() => import('./pages/StatusCheck'));
const DeliverySummary = lazy(() => import('./pages/DeliverySummary'));

// เมนูครัวกลาง — โหลดแยกเหมือนหน้าอื่น คนที่เข้ามาดูใบเบิกไม่ต้องโหลดโค้ดครัวติดไปด้วย
const ProductionPlan = lazy(() => import('./pages/kitchen/ProductionPlan'));
const ProductionOrders = lazy(() => import('./pages/kitchen/ProductionOrders'));
const MaterialIssue = lazy(() => import('./pages/kitchen/MaterialIssue'));
const MaterialBalance = lazy(() => import('./pages/kitchen/MaterialBalance'));
const ProductionReport = lazy(() => import('./pages/kitchen/ProductionReport'));
const Users = lazy(() => import('./pages/admin/Users'));

function RouteLoadingFallback() {
  return (
    <div className="flex items-center justify-center py-24 text-slate-400 gap-2">
      <Loader2 className="w-5 h-5 animate-spin text-amber-400" />
      <span>กำลังโหลดหน้า...</span>
    </div>
  );
}

/** path ที่ไม่รู้จัก -> ปฏิทินใบเบิกเหมือนเดิม หรือหน้าแรกที่ผู้ใช้เปิดได้ */
function FallbackRedirect() {
  const auth = useAuth();
  if (auth.loading) return null;
  const to = auth.canView('requisition-calendar') ? '/requisition-calendar' : firstAllowedPath(auth.canView) || '/';
  return <Navigate to={to} replace />;
}

export default function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}

function AppRoutes() {
  const [selectedBranch, setSelectedBranch] = useState('all');

  const handleBranchChange = (branchKey) => {
    setSelectedBranch(branchKey);
  };

  return (
    <BrowserRouter>
      <Toaster 
        position="top-right" 
        toastOptions={{
          style: {
            background: '#0f172a',
            color: '#f8fafc',
            border: '1px solid rgba(245, 158, 11, 0.3)',
            fontFamily: 'Prompt, sans-serif'
          }
        }} 
      />
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="*" element={
          <DashboardLayout currentBranch={selectedBranch} onBranchChange={handleBranchChange}>
            <Suspense fallback={<RouteLoadingFallback />}>
              <Routes>
                <Route path="/" element={<PageGate page="overview"><DashboardHome selectedBranch={selectedBranch} /></PageGate>} />
                <Route path="/stock-total" element={<PageGate page="stock-total"><StockTotalList selectedBranch={selectedBranch} /></PageGate>} />
                <Route path="/requisition-calendar" element={<PageGate page="requisition-calendar"><RequisitionCalendar selectedBranch={selectedBranch} onBranchChange={handleBranchChange} /></PageGate>} />
                <Route path="/fulfillment" element={<PageGate page="fulfillment"><OrderFulfillment selectedBranch={selectedBranch} /></PageGate>} />
                <Route path="/status-check" element={<PageGate page="status-check"><StatusCheck selectedBranch={selectedBranch} /></PageGate>} />
                <Route path="/delivery-summary" element={<PageGate page="delivery-summary"><DeliverySummary /></PageGate>} />
                <Route path="/kitchen/plan" element={<PageGate page="kitchen-plan"><ProductionPlan /></PageGate>} />
                <Route path="/kitchen/status" element={<PageGate page="kitchen-status"><ProductionOrders key="status" view="production" /></PageGate>} />
                {/* สั่งผลิต / รายการสูตรการผลิต เลิกใช้ — ข้อมูลอยู่ในแพลนผลิตแล้ว ลิงก์เก่าพาไปแพลนผลิต */}
                <Route path="/kitchen/produce" element={<Navigate to="/kitchen/plan" replace />} />
                <Route path="/kitchen/orders" element={<PageGate page="kitchen-orders"><ProductionOrders key="requests" view="requests" /></PageGate>} />
                <Route path="/kitchen/issue" element={<PageGate page="kitchen-issue"><MaterialIssue /></PageGate>} />
                <Route path="/kitchen/balance" element={<PageGate page="kitchen-balance"><MaterialBalance /></PageGate>} />
                <Route path="/kitchen/recipes" element={<Navigate to="/kitchen/plan" replace />} />
                <Route path="/kitchen/report" element={<PageGate page="kitchen-report"><ProductionReport /></PageGate>} />
                <Route path="/kitchen" element={<Navigate to="/kitchen/orders" replace />} />
                <Route path="/admin/users" element={<PageGate adminOnly><Users /></PageGate>} />
                <Route path="*" element={<FallbackRedirect />} />
              </Routes>
            </Suspense>
          </DashboardLayout>
        } />
      </Routes>
    </BrowserRouter>
  );
}
