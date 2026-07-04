const SYMBOLS: Record<string, string> = {
  INR: '₹',
  USD: '$',
  EUR: '€',
  GBP: '£',
};

export function formatMoney(value: number, currency = 'INR'): string {
  const symbol = SYMBOLS[currency] ?? `${currency} `;
  const rounded = Math.round((value + Number.EPSILON) * 100) / 100;
  const str = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
  return `${symbol}${str}`;
}

export function formatDate(iso: string | Date): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}
