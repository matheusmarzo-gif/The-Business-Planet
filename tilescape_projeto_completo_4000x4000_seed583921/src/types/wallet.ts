export const STARTING_BALANCE = 10000;

const currency = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });

export function formatMoney(amount: number): string {
  return `C$ ${currency.format(amount)}`;
}
