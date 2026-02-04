# Quick Start Guide

## Setup Development Environment

### 1. Install Dependencies
```bash
npm install
```

### 2. Create Environment Files

Create `.env.development` and `.env.production` files in the project root.

**For Development (Port 2000):**
```bash
# Copy the example and edit
cp .env.development.example .env.development
```

Then edit `.env.development` and set:
```env
PORT=2000
DATABASE_URL=postgresql://postgres:password@helium/heliumdb?sslmode=disable
BASE_URL=http://localhost:2000
```

**For Production (Port 1000):**
```bash
# Copy the example and edit
cp .env.production.example .env.production
```

Then edit `.env.production` and set:
```env
PORT=1000
DATABASE_URL=postgresql://neondb_owner:npg_mle9iX3YCMBd@ep-delicate-scene-ahzpamqy.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require
BASE_URL=https://your-production-domain.com
```

### 3. Run Development Server

```bash
npm run dev
```

This will:
- Start server on **port 2000**
- Connect to **development database**
- Enable hot-reload
- Access at: http://localhost:2000

### 4. Run Production Server

```bash
# Build first
npm run build

# Then start
npm run start
```

This will:
- Start server on **port 1000**
- Connect to **production database**
- Access at: http://localhost:1000

## Available Commands

| Command | Description | Port | Database |
|---------|-------------|------|----------|
| `npm run dev` | Development mode | 2000 | Development |
| `npm run start` | Production mode | 1000 | Production |
| `npm run dev:prod` | Dev mode with prod config | 2000 | Production |
| `npm run start:dev` | Prod build with dev config | 1000 | Development |
| `npm run db:push:dev` | Push migrations to dev DB | - | Development |
| `npm run db:push:prod` | Push migrations to prod DB | - | Production |

## Port Summary

- **Port 1000**: Production/Live environment
- **Port 2000**: Development environment

## Database Summary

- **Development**: `postgresql://postgres:password@helium/heliumdb`
- **Production**: `postgresql://neondb_owner:...@ep-delicate-scene-ahzpamqy.c-3.us-east-1.aws.neon.tech/neondb`

## Next Steps

1. Update `.env.development` with all your development API keys
2. Update `.env.production` with all your production API keys
3. Run `npm run dev` to start development
4. Test your setup at http://localhost:2000

See `DEVELOPMENT_SETUP.md` for detailed information.
