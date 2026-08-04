// ═══════════════════════════════════════════════════════════════════════════
// src/config/animation.js — ค่าคงที่อนิเมชันทั้งหมดของหน้า Reports รวมไว้ที่เดียว
// (ปรับ duration / easing / stagger / ทิศทาง ได้จากไฟล์นี้ไฟล์เดียว)
// ═══════════════════════════════════════════════════════════════════════════

export const EASE = "cubic-bezier(0.22, 1, 0.36, 1)";   // ease-out มาตรฐานของหน้านี้

// โดนัท: หมุนวาดทีละส่วนตามเข็ม เริ่ม 12 นาฬิกา
export const DONUT = { duration: 1050, stagger: 100, ease: EASE };

// กราฟเส้น: วาดเส้นทีละช่วง
export const LINE = {
  duration: 1200, ease: EASE,
  direction: "rtl",     // 'rtl' = วาดจากขวาไปซ้าย (ตามโจทย์) · 'ltr' = ซ้ายไปขวา (ค่ามาตรฐาน time-series)
  seriesStagger: 150,   // เส้น "Lead" หน่วงจากเส้น "ลูกค้าปัจจุบัน"
  markerStagger: 60,    // จุด marker โผล่ไล่ตามเส้น
};

// count-up ตัวเลข (KPI / กลางโดนัท)
export const COUNT_UP = { duration: 900, kpiDuration: 500, ease: t=>1-Math.pow(1-t,3) };

// ผู้ใช้ที่ตั้ง prefers-reduced-motion: reduce → ข้ามอนิเมชัน แสดงผลลัพธ์สุดท้ายทันที
export const prefersReducedMotion = () =>
  typeof window!=="undefined" && window.matchMedia
  && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
