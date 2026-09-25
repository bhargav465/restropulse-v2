# RestroPulse PWA Backend

Backend API server for RestroPulse Progressive Web Application.

## Architecture

This backend provides RESTful APIs and background services for:
- User authentication and session management
- Restaurant data management
- Content studio (posts, strategies, approval workflow)
- Instagram/Facebook OAuth integration (Meta Graph API v18.0)
- Automated social media publishing (cron-based)
- Token encryption, refresh, and lifecycle management
- Meta Platform compliance (deauthorize callback, data deletion)

## Tech Stack

- **Runtime**: Node.js 18+
- **Framework**: Express.js
- **Language**: TypeScript (ESM)
- **Database**: MongoDB Atlas
- **APIs**: Meta Graph API v18.0 (Instagram + Facebook)
- **Auth**: JWT + Firebase Admin SDK
- **Security**: AES-256-GCM token encryption
- **Testing**: Vitest (ESM), 349 tests, 87.66% coverage
- **Build Tool**: TSC (TypeScript Compiler)

## Getting Started

### Installation

```bash
npm install
```

### Environment Setup

Copy `.env.example` to `.env` and configure:

```bash
cp .env.example .env
```

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | API Port | `3001` |
| `CONTENT_BASE_URL` | Base URL for images/videos | `http://localhost:3001/content/mockdata` |
| `MONGODB_URI` | MongoDB connection string | Required |
| `MONGODB_DB_NAME` | Database name | `restropulse` |
| `INSTAGRAM_APP_ID` | Meta App ID | Required for Instagram |
| `INSTAGRAM_APP_SECRET` | Meta App Secret | Required for Instagram |
| `INSTAGRAM_REDIRECT_URI` | OAuth callback URL | `http://localhost:3001/api/integrations/instagram/callback` |
| `ENCRYPTION_KEY` | 32-byte hex key for AES-256-GCM | Required for Instagram |
| `FIREBASE_SERVICE_ACCOUNT_KEY` | Firebase Admin SDK credentials | Optional |
| `FIREBASE_PROJECT_ID` | Firebase project ID | Optional |
| `CORS_ORIGIN` | Allowed CORS origin | `http://localhost:3000` |

## Database

The backend uses MongoDB for data storage. Configure your connection string in `.env`:

```env
MONGODB_URI=mongodb+srv://user:password@cluster.mongodb.net/?retryWrites=true&w=majority
MONGODB_DB_NAME=restropulsev1
```

### Collections
- `users` - User accounts
- `restaurants` - Restaurant data
- `posts` - Social media posts
- `contentStrategies` - Content strategies
- `strategyCycles` - Strategy cycles
- `sessions` - User sessions

### Database CLI

For database setup, validation, and seeding, see the `restropulse-pwa-database` project:

```bash
cd ../restropulse-pwa-database
npm run setup      # Create collections and indexes
npm run validate   # Validate database structure
npm run seed       # Seed test data
```

## Asset Management

Assets (images/videos) are served via `express.static` from the `public` directory.
- Root path: `/content`
- Local path: `./public`

To use a CDN, update `CONTENT_BASE_URL` in `.env` to point to the CDN endpoint.

### Development

```bash
npm run dev
```

Server runs on `http://localhost:3001` by default.

### Production Build

```bash
npm run build
npm start
```

## API Endpoints

### Authentication
- `POST /api/auth/login` - User login
- `POST /api/auth/logout` - User logout
- `GET /api/auth/session` - Check session status

### Restaurant
- `GET /api/restaurant/:id` - Get restaurant details
- `PUT /api/restaurant/:id` - Update restaurant details
- `PATCH /api/restaurant/:id/offers` - Manage offers
- `PATCH /api/restaurant/:id/specials` - Manage chef specials

### Content Studio
- `GET /api/posts` - Get all posts (filterable by `status`, `restaurantId`)
- `GET /api/posts/:id` - Get specific post
- `POST /api/posts` - Create new post (adhoc or strategy-generated)
- `PUT /api/posts/:id` - Update post (status changes, feedback, approval)
- `DELETE /api/posts/:id` - Delete post

### Publishing
- `POST /api/posts/:id/publish` - Publish a single SCHEDULED or MISSED_DEADLINE post
- `POST /api/posts/actions/publish-all` - Trigger manual publish run for all due posts
- `GET /api/posts/actions/publish-log` - Get recent publish attempt history

### Instagram/Facebook Integration
- `GET /api/integrations/instagram/oauth-url` - Get OAuth URL for Instagram connection
- `GET /api/integrations/instagram/callback` - OAuth callback (browser redirect)
- `POST /api/integrations/instagram/callback` - OAuth callback (API mode)
- `GET /api/integrations/instagram/pending-accounts/:selectionId` - Get pending accounts for selection
- `POST /api/integrations/instagram/select-account` - Select Instagram account
- `DELETE /api/integrations/instagram/disconnect/:restaurantId` - Disconnect Instagram
- `GET /api/integrations/instagram/status/:restaurantId` - Get connection status
- `POST /api/integrations/instagram/refresh/:restaurantId` - Force token refresh
- `POST /api/integrations/instagram/validate/:restaurantId` - Validate token and permissions
- `GET /api/integrations/instagram/profile/:restaurantId` - Get Instagram profile info
- `POST /api/integrations/instagram/deauthorize` - Meta deauthorize callback
- `POST /api/integrations/instagram/data-deletion` - Meta data deletion request
- `GET /api/integrations/instagram/data-deletion-status` - Data deletion status check
- `GET /api/integrations/config` - Get public integration config (app ID, redirect URI)

### Strategy
- `GET /api/strategy/cycles` - Get strategy cycles
- `GET /api/strategy/cycles/:id` - Get specific cycle
- `POST /api/strategy/cycles` - Create new cycle
- `PUT /api/strategy/cycles/:id` - Update cycle

## Project Structure

```
src/
├── server.ts                  # Entry point, middleware, cron startup
├── db/
│   ├── connection.ts          # MongoDB Atlas connection
│   ├── posts.ts               # Posts collection operations
│   ├── restaurants.ts         # Restaurants collection operations
│   ├── strategy.ts            # Strategy collection operations
│   └── users.ts               # Users collection operations
├── routes/
│   ├── auth.ts                # Authentication (login, logout, session)
│   ├── posts.ts               # Posts CRUD + publishing endpoints
│   ├── restaurant.ts          # Restaurant management
│   ├── strategy.ts            # Strategy cycles
│   └── integrations.ts        # Instagram OAuth, Meta compliance
├── services/
│   ├── publishing-service.ts  # Instagram + Facebook Graph API publishing
│   ├── publishing-cron.ts     # Scheduled post publishing (every 5 min)
│   ├── token-refresh-cron.ts  # Daily token refresh for long-lived tokens
│   ├── instagram-api.ts       # Instagram Graph API client (OAuth, posting)
│   ├── encryption.ts          # AES-256-GCM token encryption
│   ├── firebase-admin.ts      # Firebase Admin SDK initialization
│   └── jwt.ts                 # JWT token management
├── models/                    # TypeScript interfaces
└── data/                      # Seed/mock data
```

## Background Services

### Publishing Cron (`publishing-cron.ts`)
- Runs every **5 minutes**
- Finds posts with `status: SCHEDULED` and `scheduledFor <= now`
- Publishes via Instagram/Facebook Graph API
- Rate-limits at 2 seconds between posts
- Updates post status to `POSTED` or `MISSED_DEADLINE`
- Retries failed posts up to 3 times

### Token Refresh Cron (`token-refresh-cron.ts`)
- Runs **daily at 3:00 AM**
- Refreshes Instagram long-lived tokens expiring within 7 days
- Tokens are encrypted at rest with AES-256-GCM

## Development Workflow

1. Make changes in `src/`
2. The dev server auto-reloads on file changes
3. Test API endpoints using tools like Postman or curl
4. Build for production using `npm run build`

## Testing

```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Run specific test file
npx vitest run --testPathPattern="posts"
```

**Coverage Summary (349 tests, 14 suites):**
| Area | Statements | Branches | Functions | Lines |
|------|-----------|----------|-----------|-------|
| Overall | 87.66% | 72.97% | 85.38% | 88.13% |
| routes/posts.ts | 98.90% | 95.12% | 100% | 98.90% |
| services/publishing-service.ts | 86.20% | 57.95% | 100% | 86.04% |
| services/instagram-api.ts | 90.90% | 67.05% | 100% | 90.64% |

## Future Enhancements

- [ ] File upload for media (Azure Blob Storage)
- [ ] WebSocket for real-time updates
- [ ] Rate limiting and security middleware
- [ ] API documentation with Swagger
- [ ] WhatsApp Business API integration
