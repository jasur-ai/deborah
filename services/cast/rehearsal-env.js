/**
 * Deborah — Cast Rehearsal env konstantalari (LEAF modul).
 * ---------------------------------------------------------
 * rehearsal-service ↔ bot-simulator aylanma import'i (cycle) tufayli
 * REHEARSAL_ENV top-level'da o'qilganda TDZ ReferenceError berardi —
 * bu quality-lab/results/replay route'larini buzgan edi.
 * Bu fayl hech narsa import qilmaydi, shuning uchun cycle-safe.
 */
export const REHEARSAL_ENV = 'simulation';
export const PRODUCTION_ENV = 'production';
