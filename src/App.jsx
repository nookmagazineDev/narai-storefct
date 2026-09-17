import React, { useState, Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { Loader2 } from 'lucide-react';
import DashboardLayout from './layouts/DashboardLayout';

const DashboardHome = lazy(() => import('./pages/DashboardHome'));
const StockTotalList = lazy(() => import('./pages/StockTotalList'));
const RequisitionCalendar = lazy(() => import('./pages/RequisitionCalendar'));
const OrderFulfillment = lazy(() => import('./pages/OrderFulfillment'));
const StatusCheck = lazy(() => import('./pages/StatusCheck'));
const DeliverySummary = lazy(() => import('./pages/DeliverySummary'));

// เมนูครัวกลาง — โหลดแยกเหมือนหน้าอื่น คนที่เข้ามาดูใบเบิกไม่ต้องโหลดโค้ดครัวติดไปด้วย
const ProductionOrders = lazy(() => import('./pages/kitchen/ProductionOrders'));
const MaterialIssue = lazy(() => import('./pages/kitchen/MaterialIssue'));
const MaterialBalance = lazy(() => import('./pages/kitchen/MaterialBalance'));
const RecipeList = lazy(() => import('./pages/kitchen/RecipeList'));
const ProductionReport = lazy(() => import('./pages/kitchen/ProductionReport'));

function RouteLoadingFallback() {
  return (
    <div className="flex items-center justify-center py-24 text-slate-400 gap-2">
      <Loader2 className="w-5 h-5 animate-spin text-amber-400" />
      <span>กำลังโหลดหน้า...</span>
    </div>
  );
}

export default function App() {
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
      <DashboardLayout currentBranch={selectedBranch} onBranchChange={handleBranchChange}>
        <Suspense fallback={<RouteLoadingFallback />}>
          <Routes>
            <Route path="/" element={<DashboardHome selectedBranch={selectedBranch} />} />
            <Route path="/stock-total" element={<StockTotalList selectedBranch={selectedBranch} />} />
            <Route path="/requisition-calendar" element={<RequisitionCalendar selectedBranch={selectedBranch} onBranchChange={handleBranchChange} />} />
            <Route path="/fulfillment" element={<OrderFulfillment selectedBranch={selectedBranch} />} />
            <Route path="/status-check" element={<StatusCheck selectedBranch={selectedBranch} />} />
            <Route path="/delivery-summary" element={<DeliverySummary />} />
            <Route path="/kitchen/orders" element={<ProductionOrders />} />
            <Route path="/kitchen/issue" element={<MaterialIssue />} />
            <Route path="/kitchen/balance" element={<MaterialBalance />} />
            <Route path="/kitchen/recipes" element={<RecipeList />} />
            <Route path="/kitchen/report" element={<ProductionReport />} />
            <Route path="/kitchen" element={<Navigate to="/kitchen/orders" replace />} />
            <Route path="*" element={<Navigate to="/requisition-calendar" replace />} />
          </Routes>
        </Suspense>
      </DashboardLayout>
    </BrowserRouter>
  );
}
