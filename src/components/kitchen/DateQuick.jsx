import React from 'react';
import { todayYmd } from '../../services/kitchenService';
import { quickRange, QUICK_LABEL } from '../../services/dateQuick';

const btn = (active) => `px-2.5 py-1 rounded-md text-xs whitespace-nowrap border ${active
  ? 'bg-sky-500/15 text-sky-300 border-sky-500/30'
  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 border-transparent'}`;

/**
 * ปุ่มลัดช่วงวันที่ (ตั้งแต่–ถึง) — วางคู่กับช่องวันที่เดิมของแต่ละหน้า ปุ่มที่ตรงกับช่วงปัจจุบันจะไฮไลต์
 * @param {{ from: string, to: string, onChange: (from: string, to: string) => void, presets?: string[], className?: string }} props
 */
export function RangeQuick({ from, to, onChange, presets = ['today', 'tomorrow', 'week', 'month'], className = '' }) {
  const today = todayYmd();
  return (
    <div className={`flex flex-wrap gap-1 p-1 bg-slate-950/60 border border-slate-800 rounded-lg w-fit ${className}`} role="group" aria-label="ช่วงวันที่ลัด">
      {presets.map((k) => {
        const [f, t] = quickRange(k, today);
        return (
          <button key={k} type="button" onClick={() => onChange(f, t)} className={btn(f === from && t === to)}>
            {QUICK_LABEL[k]}
          </button>
        );
      })}
    </div>
  );
}

/**
 * ปุ่มลัดวันที่เดียว (วันนี้ / พรุ่งนี้ …) — ใต้หรือข้างช่องวันที่
 * @param {{ value: string, onChange: (ymd: string) => void, presets?: string[], max?: string, className?: string }} props
 */
export function DayQuick({ value, onChange, presets = ['today', 'tomorrow'], max, className = '' }) {
  const today = todayYmd();
  return (
    <div className={`flex flex-wrap gap-1 ${className}`} role="group" aria-label="วันที่ลัด">
      {presets.map((k) => {
        const [d] = quickRange(k, today);
        if (max && d > max) return null;
        return (
          <button key={k} type="button" onClick={() => onChange(d)} className={btn(d === value)}>
            {QUICK_LABEL[k]}
          </button>
        );
      })}
    </div>
  );
}
