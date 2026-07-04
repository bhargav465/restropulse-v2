# RestroPulse PWA (Front-End)

A Progressive Web Application for restaurant social media management powered by AI.

## Overview

This is the front-end client for RestroPulse, built with React, TypeScript, and Vite. It provides a responsive, mobile-first interface for restaurant owners to manage their social media presence.

## Tech Stack

- **Framework**: React 19
- **Language**: TypeScript
- **Build Tool**: Vite
- **Styling**: Tailwind CSS (via utility classes)
- **Icons**: Lucide React
- **Charts**: Recharts

## Prerequisites

- Node.js 18+ and npm
- restropulse-pwa-backend running on port 3001

## Getting Started

### Installation

```bash
npm install
```

### Environment Setup

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

The default API URL is `http://localhost:3001/api`. Update if needed.

### Development

Make sure the backend is running first, then:

```bash
npm run dev
```

The app will be available at `http://localhost:3000`

### Build for Production

```bash
npm run build
npm run preview
```

## Features

- **Dashboard**: Overview of restaurant metrics and recent posts
- **Content Studio**: Manage social media posts across platforms
- **Inputs**: Update offers, chef specials, and menu information
- **Strategy**: View and manage content strategy cycles
- **Settings**: Account and preferences management

## Architecture

- Pure front-end UI with no business logic
- All data operations via REST API calls to backend
- State management using React hooks
- Client-side routing with browser history API
- PWA-ready with offline support (future enhancement)

## API Integration

The app communicates with the backend through the `api.ts` service layer:

- **Authentication** - Login, logout, session management
- **Restaurant** - Profile CRUD, offers, chef specials
- **Posts** - CRUD, approval workflow, manual publish, publish log
- **Strategy** - Cycles management, approval flow
- **Instagram** - OAuth flow, connect/disconnect, account selection, status

All API calls include proper error handling, loading states, and retry logic.

### Instagram OAuth Flow

The Settings component manages the Instagram connection lifecycle:
1. User clicks "Connect" to open the Setup Guide modal
2. Chooses standard or guided OAuth flow
3. OAuth popup opens to Facebook Login
4. Popup posts message back with success/error
5. On success: connected state, restaurant data refresh
6. On error: error modal with specific help links per error type

## Development Guidelines

- Components are in `/components`
- Shared types are in `types.ts`
- API service layer is in `api.ts`
- Mock assets are served by the backend via the `CONTENT_BASE_URL` configuration.

## Testing

```bash
# Run all tests
npm test -- --run

# Run with coverage
npx vitest --run --coverage

# Run specific test file
npx vitest --run tests/Settings.test.tsx
```

**Coverage Summary (301 tests, 10 suites):**
| Area | Statements | Branches | Functions | Lines |
|------|-----------|----------|-----------|-------|
| Overall | 82.70% | 74.22% | 82.20% | 84.56% |
| ContentStudio.tsx | 75.79% | 64.42% | 70.93% | 80.21% |
| Settings.tsx | 77.07% | 75.83% | 72.91% | 78.35% |
| Dashboard.tsx | 98.11% | 90.24% | 94.11% | 98.03% |

## Future Enhancements

- Service worker for offline functionality
- Push notifications
- Image upload and optimization
- Real-time updates via WebSockets
- Progressive image loading
- Advanced caching strategies

---

For detailed functional requirements and specifications, see [README-DETAILED.md](README-DETAILED.md)
