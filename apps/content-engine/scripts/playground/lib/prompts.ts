import * as readline from 'node:readline/promises';
import { emitKeypressEvents } from 'node:readline';
import { stdin as input, stdout as output } from 'node:process';

const rl = readline.createInterface({ input, output });

// Esc to quit on interactive terminals
if (input.isTTY) {
  emitKeypressEvents(input);
  input.on('keypress', (_str: string, key: { name?: string } | undefined) => {
    if (key?.name === 'escape') {
      console.log('\n  Exiting...');
      rl.close();
      // Emit SIGTERM so db-setup's gracefulShutdown handler can stop MongoMemoryServer
      // before the process exits. process.exit(0) here would skip async cleanup.
      process.emit('SIGTERM');
    }
  });
}

export async function ask(question: string): Promise<string> {
  return rl.question(question);
}

export async function selectFromList<T>(
  items: T[],
  display: (item: T, index: number) => string,
  prompt: string,
): Promise<T> {
  console.log('');
  items.forEach((item, i) => console.log(`  ${i + 1}) ${display(item, i)}`));
  while (true) {
    const answer = await ask(`\n${prompt} (1-${items.length}): `);
    const index = parseInt(answer.trim(), 10) - 1;
    if (index >= 0 && index < items.length) return items[index];
    console.log(`  Please enter a number between 1 and ${items.length}`);
  }
}

export async function multiSelect(options: string[], prompt: string): Promise<string[]> {
  console.log('');
  options.forEach((opt, i) => console.log(`  ${i + 1}) ${opt}`));
  console.log('\n  Enter numbers separated by commas (e.g. 1,3,4), or press Enter to skip:');
  const answer = await ask(`${prompt}: `);
  if (!answer.trim()) return [];
  return answer
    .split(',')
    .map(s => parseInt(s.trim(), 10) - 1)
    .filter(i => i >= 0 && i < options.length)
    .map(i => options[i]);
}

export async function confirm(prompt: string, defaultYes = true): Promise<boolean> {
  const hint = defaultYes ? '[Y/n]' : '[y/N]';
  const answer = await ask(`${prompt} ${hint}: `);
  const trimmed = answer.trim().toLowerCase();
  if (!trimmed) return defaultYes;
  return trimmed === 'y' || trimmed === 'yes';
}

export function closePrompts(): void {
  rl.close();
}
