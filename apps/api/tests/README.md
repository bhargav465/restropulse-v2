# Backend Test Suite

Comprehensive test coverage for RestroPulse Backend API.

## Test Database Strategy

### Current Approach: Hybrid Testing

**We use a combination of real MongoDB and mocked collections** for optimal reliability and speed.

#### Real MongoDB Tests
- `posts.test.ts`, `restaurant.test.ts`, `integrations.test.ts`
- Uses MongoDB Atlas test database
- **Why?** MongoDB operators (`$in`, `$or`) had compatibility issues with mocked collections
- **Result:** 100% accurate MongoDB behavior, all operators work correctly

#### Mocked Collection Tests  
- `publishing-cron.test.ts`, `token-refresh-cron.test.ts`, `publishing-service.test.ts`
- Fully mocked, no DB connection
- **Why?** Pure logic tests, faster execution, complete isolation

#### mongodb-memory-server Attempt

We tried using `mongodb-memory-server` for true isolation but encountered:
- Vitest ESM module resolution issues
- Module resolution conflicts with bundled MongoDB driver
- TypeScript source/compiled file conflicts

**Decision:** Kept Atlas approach with environment variable configuration for flexibility.

### Configuration

Override test database via environment variables:

```bash
export TEST_MONGODB_URI="mongodb://localhost:27017"
export TEST_MONGODB_DB_NAME="restropulse-ci-test"
npm run test:unit
```

## Test Structure

```
tests/
├── unit/              # Unit tests for individual routes
│   ├── auth.test.ts
│   ├── restaurant.test.ts
│   ├── posts.test.ts
│   └── strategy.test.ts
├── integration/       # Integration tests for workflows
│   └── workflows.test.ts
├── helpers/          # Test utilities
│   └── testHelper.ts
└── setup.ts          # Global test setup
```

## Running Tests

### Run all tests
```bash
npm test
```

### Run with coverage
```bash
npm run test:coverage
```

### Run in watch mode
```bash
npm run test:watch
```

### Run only unit tests
```bash
npm run test:unit
```

### Run only integration tests
```bash
npm run test:integration
```

## Test Coverage

### Unit Tests

#### Auth Routes (`auth.test.ts`)
- POST /api/auth/login
  - Valid credentials
  - Invalid email
  - Missing password
  - Missing email
  - Empty request body
  - Content type validation
- POST /api/auth/logout
  - Successful logout
  - Logout without token
- GET /api/auth/session
  - Valid token
  - Invalid token
  - Missing authorization header
  - Malformed authorization header

#### Restaurant Routes (`restaurant.test.ts`)
- GET /api/restaurant/:id
  - Valid restaurant ID
  - Non-existent restaurant
  - Complete data structure
- PUT /api/restaurant/:id
  - Update with valid data
  - Non-existent restaurant
  - ID preservation
  - Partial updates
- PATCH /api/restaurant/:id/offers
  - Add new offer
  - Delete offer by index
  - Invalid actions
  - Missing payload
- PATCH /api/restaurant/:id/specials
  - Add chef special
  - Delete chef special
  - Data validation
- PATCH /api/restaurant/:id/menu
  - Update menu timestamp
  - Date validation

#### Posts Routes (`posts.test.ts`)
- GET /api/posts
  - Retrieve all posts
  - Data structure validation
  - Content type
- GET /api/posts/:id
  - Valid post ID
  - Non-existent post
  - Complete data
- POST /api/posts
  - Create with valid data
  - Auto-generate ID
  - Posts with stats
  - Media URLs
  - Video posts
- PUT /api/posts/:id
  - Update existing post
  - Non-existent post
  - ID preservation
  - Partial updates
  - Stats updates
  - Feedback updates
- DELETE /api/posts/:id
  - Delete existing post
  - Non-existent post
  - Verify deletion
- Edge Cases
  - Empty request body
  - Long captions
  - Special characters

#### Strategy Routes (`strategy.test.ts`)
- GET /api/strategy
  - Retrieve content strategy
  - Data structure validation
  - Array fields
- PUT /api/strategy
  - Update strategy
  - Partial updates
  - Array updates
- GET /api/strategy/cycles
  - Retrieve all cycles
  - Data structure
- GET /api/strategy/cycles/:id
  - Valid cycle ID
  - Non-existent cycle
  - Complete data
- POST /api/strategy/cycles
  - Create new cycle
  - Auto-generate ID
  - Feedback handling
- PUT /api/strategy/cycles/:id
  - Update existing cycle
  - Non-existent cycle
  - ID preservation
  - Array updates
  - Feedback updates
- Edge Cases
  - Empty arrays
  - Missing fields

### Integration Tests

#### Complete Workflows (`workflows.test.ts`)
- User Authentication Flow
  - Full login-session-logout cycle
  - Protected route access
- Restaurant Management Flow
  - CRUD operations
  - Multiple offers lifecycle
- Posts Management Flow
  - Full post lifecycle (create-read-update-delete)
  - Approval workflow
  - Multiple posts handling
- Strategy Management Flow
  - Strategy and cycles management
  - Cycle approval workflow
- Cross-Entity Integration
  - Restaurant updates with content strategy
  - Concurrent operations
- Error Handling
  - Invalid routes
  - Malformed JSON
  - Field validation
- Health Check
  - Server status

## Test Statistics

- **Total Tests**: 120+
- **Unit Tests**: 90+
- **Integration Tests**: 30+
- **Coverage Target**: 90%+

## Writing New Tests

### Unit Test Template
```typescript
import { describe, test, expect } from 'vitest';
import request from 'supertest';
import { createTestApp } from '../helpers/testHelper.js';

const app = createTestApp();

describe('Feature Name', () => {
  test('should do something', async () => {
    const response = await request(app)
      .get('/api/endpoint');

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('success', true);
  });
});
```

### Integration Test Template
```typescript
describe('Workflow Name', () => {
  test('should complete full workflow', async () => {
    // Step 1: Create resource
    const createResponse = await request(app)
      .post('/api/resource')
      .send(data);

    expect(createResponse.status).toBe(201);

    // Step 2: Read resource
    const id = createResponse.body.data.id;
    const getResponse = await request(app)
      .get(`/api/resource/${id}`);

    expect(getResponse.status).toBe(200);

    // Step 3: Update resource
    // Step 4: Delete resource
  });
});
```

## Best Practices

1. **Isolation**: Each test should be independent
2. **Descriptive Names**: Use clear test descriptions
3. **Arrange-Act-Assert**: Follow AAA pattern
4. **Edge Cases**: Test boundary conditions
5. **Error Cases**: Test failure scenarios
6. **Mock Data**: Use test helpers for consistency

## Continuous Integration

These tests are designed to run in CI/CD pipelines:
- Fast execution (< 30 seconds)
- No external dependencies
- Deterministic results
- Clear failure messages

## Troubleshooting

### Tests Timeout
- Increase timeout in vitest.config.ts
- Check for async operations without await

### Tests Fail Randomly
- Check for test interdependencies
- Ensure proper cleanup between tests

### Coverage Not Generated
- Run: `npm run test:coverage`
- Check `coverage/` directory
