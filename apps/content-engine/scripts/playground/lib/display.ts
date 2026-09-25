export function hr(label: string): void {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  ${label}`);
  console.log('─'.repeat(60));
}

export function banner(text: string): void {
  console.log(`\n◆ ${text}`);
}

export function field(label: string, value: string | undefined | null): void {
  if (value) console.log(`  ${label.padEnd(18)} ${value}`);
}

export function table(rows: Array<[string, string | number]>): void {
  rows.forEach(([label, value]) => console.log(`  ${String(label).padEnd(24)} ${value}`));
}

export function success(msg: string): void {
  console.log(`\n✓ ${msg}`);
}

export function warn(msg: string): void {
  console.log(`\n⚠ ${msg}`);
}
