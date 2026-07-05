import path from 'node:path';
import { config } from 'dotenv';
config({ path: path.resolve(process.cwd(), '.env'), override: false });

import { bootPlaygroundDB } from './lib/db-setup.js';

const MENU = `
RestroPulse Content Engine Playground
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Commands:
  strategy    Draft a content cycle for a restaurant
  post        Generate a post (ad-hoc or from a cycle)
  feedback    Approve or request changes on a generated post
  help        Show this menu

Usage:
  npm run playground -- <command>

Examples:
  npm run playground -- strategy
  npm run playground -- post
  npm run playground -- feedback
`;

const command = process.argv[2];

if (!command || command === 'help' || command === '--help') {
  console.log(MENU);
  process.exit(0);
}

// Boot DB + seed fixtures before running any command
await bootPlaygroundDB();

switch (command) {
  case 'strategy': {
    const { runStrategyCommand } = await import('./commands/strategy.js');
    await runStrategyCommand();
    break;
  }
  case 'post': {
    const { runPostCommand } = await import('./commands/post.js');
    await runPostCommand();
    break;
  }
  case 'feedback': {
    const { runFeedbackCommand } = await import('./commands/feedback.js');
    await runFeedbackCommand();
    break;
  }
  default:
    console.error(`Unknown command: "${command}"\n${MENU}`);
    process.exit(1);
}

process.exit(0);
