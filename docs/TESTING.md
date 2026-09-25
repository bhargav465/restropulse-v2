# RestroPulse Testing Guide

## Overview

RestroPulse uses different testing frameworks depending on the app:

| App        | Framework   | Config          | Coverage Target |
|------------|-------------|-----------------|-----------------|
| apps/web   | Vitest      | vite.config.ts  | 85%+            |
| apps/api   | Vitest      | vitest.config.ts  | 85%+            |
| apps/publisher | (planned) | vitest.config.ts | 80%+ |
| apps/content-engine | (planned) | vitest.config.ts | 80%+ |

## Running Tests

```bash
# Run all tests across the monorepo
npm run test

# Run tests for a specific app
npm run test --filter=@restropulse/web
npm run test --filter=@restropulse/api

# Run with coverage
cd apps/web && npx vitest run --coverage
cd apps/api && npx vitest run --coverage
```

## Frontend Testing (apps/web)

### Stack

- **Vitest** -- test runner (configured in vite.config.ts)
- **React Testing Library (RTL)** -- component rendering and interaction
- **jsdom** -- browser environment simulation
- **MSW** (recommended) -- API mocking

### Conventions

- Test files live in `apps/web/tests/` with `.test.tsx` or `.test.ts` extension
- Setup file: `apps/web/tests/setup.ts` (global mocks for Firebase, localStorage, etc.)
- Name tests descriptively: `describe('ComponentName', () => { it('should handle user action', ...) })`

### What to Test

- Component rendering with different props/state
- User interactions (click, type, submit)
- API call integration (mock fetch/axios)
- Error boundaries and error states
- Authentication flow states

### Example Pattern

```typescript
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import MyComponent from '../components/MyComponent';

describe('MyComponent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render default state', () => {
    render(<MyComponent />);
    expect(screen.getByText('Expected Text')).toBeInTheDocument();
  });

  it('should handle click', async () => {
    const onAction = vi.fn();
    render(<MyComponent onAction={onAction} />);

    fireEvent.click(screen.getByRole('button', { name: /submit/i }));
    await waitFor(() => expect(onAction).toHaveBeenCalledOnce());
  });
});
```

## Backend Testing (apps/api)

### Stack

- **Vitest** -- test runner
- **mongodb-memory-server** -- in-memory MongoDB for integration tests
- **supertest** -- HTTP assertion library

### Conventions

- Test files live in `apps/api/tests/`
- Subdirectories: `unit/` for isolated tests, `integration/` for API endpoint tests
- Setup file: `apps/api/tests/setup.ts` (MongoDB memory server lifecycle)
- Custom sequencer: `apps/api/tests/sequencer.cjs` (controls test execution order)

### Database Testing

The shared `@restropulse/db` package exposes `setDB()` for injecting a test database:

```typescript
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';
import { setDB } from '@restropulse/db';

let mongod: MongoMemoryServer;
let client: MongoClient;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  client = await MongoClient.connect(mongod.getUri());
  setDB(client.db('test'));
});

afterAll(async () => {
  await client.close();
  await mongod.stop();
});
```

### What to Test

- Route handlers with mocked services
- Service logic with in-memory DB
- Authentication middleware (valid/invalid/expired tokens)
- Error handling and edge cases
- Meta API integration (mock external calls)

## Test Templates

Annotated templates are available in `templates/`:

| Template                   | Purpose                           |
|----------------------------|-----------------------------------|
| unit-test.ts               | Backend unit test boilerplate     |
| integration-test.ts        | Backend API integration test      |
| component-test.tsx         | Frontend React component test     |

## Coverage Reports

Coverage output is generated in each app's `coverage/` directory. The CI pipeline enforces coverage thresholds.

```bash
# View HTML coverage report
open apps/web/coverage/index.html
open apps/api/coverage/index.html
```

## Writing New Tests Checklist

- [ ] Test file matches naming convention (*.test.ts / *.test.tsx)
- [ ] Placed in correct directory (unit/ or integration/ or tests/)
- [ ] Mocks are cleaned up in beforeEach/afterEach
- [ ] Async operations use waitFor or proper awaits
- [ ] Edge cases covered (empty data, errors, unauthorized)
- [ ] No hardcoded timeouts (use waitFor instead)
- [ ] Test descriptions are clear and behavior-focused
