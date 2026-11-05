export function getDairyFarmEfficiency(month: number): number {
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new RangeError('O mês da produção leiteira precisa estar entre 1 e 12.');
  }
  if (month <= 3) return 0.4;
  if (month <= 6) return 1;
  if (month <= 9) return 0.8;
  return 0.6;
}
