# Development Environment Setup

## Overview

This project uses separate environments for development and production:

- **Development**: Port 2000, Development Database
- **Production**: Port 1000, Production Database (Neon)

## Prerequisites

Install `dotenv-cli` to load environment-specific `.env` files:

```bash
npm install -g dotenv-cli
# OR
npm install --save-dev dotenv-cli
```

## Environment Files

### `.env.development`
- Port: **2000**
- Database: Development database (helium/heliumdb)
- Base URL: `http://localhost:2000`
- Uses test/sandbox API keys where available

### `.env.production`
- Port: **1000**
- Database: Production database (Neon)
- Base URL: Your production domain
- Uses live API keys

## Running the Application

### Development Mode (Port 2000)
```bash
npm run dev
```
This will:
- Load `.env.development`
- Start server on port 2000
- Connect to development database
- Enable hot-reload and Vite dev server

### Production Mode (Port 1000)
```bash
# Build first
npm run build

# Then start
npm run start
```
This will:
- Load `.env.production`
- Start server on port 1000
- Connect to production database
- Serve built static files

### Development with Production Config (for testing)
```bash
npm run dev:prod
```
This runs in development mode but uses production environment variables.

## Database Migrations

### Development Database
```bash
npm run db:push:dev
```

### Production Database
```bash
npm run db:push:prod
```

## Environment Variables

### Required for Both Environments

1. **Database**
   - `DATABASE_URL` - PostgreSQL connection string

2. **Server**
   - `PORT` - Server port (2000 for dev, 1000 for prod)
   - `SESSION_SECRET` - Session encryption secret
   - `BASE_URL` or `APP_URL` - Application base URL

3. **Object Storage**
   - `PUBLIC_OBJECT_SEARCH_PATHS` - Public files path
   - `PRIVATE_OBJECT_DIR` - Private files path
   - `GCS_PROJECT_ID` - Google Cloud project ID
   - `GOOGLE_APPLICATION_CREDENTIALS` - Path to service account JSON

### Development-Specific Recommendations

- Use **test/sandbox** API keys for:
  - Stripe (test keys)
  - Modern Treasury (sandbox)
  - Other services with test modes

- Use **separate** resources:
  - Development database
  - Development storage bucket (optional)
  - Development Firebase project (optional)

## Quick Start

1. **Copy environment files** (if not already created):
   ```bash
   cp .env.development.example .env.development
   cp .env.production.example .env.production
   ```

2. **Update `.env.development`** with your development database:
   ```env
   DATABASE_URL=postgresql://postgres:password@helium/heliumdb?sslmode=disable
   PORT=2000
   BASE_URL=http://localhost:2000
   ```

3. **Update `.env.production`** with your production database:
   ```env
   DATABASE_URL=postgresql://neondb_owner:npg_mle9iX3YCMBd@ep-delicate-scene-ahzpamqy.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require
   PORT=1000
   BASE_URL=https://your-production-domain.com
   ```

4. **Start development server**:
   ```bash
   npm run dev
   ```

5. **Access the app**:
   - Development: http://localhost:2000
   - Production: http://localhost:1000 (after `npm run build && npm run start`)

## Troubleshooting

### Port Already in Use
If port 2000 or 1000 is already in use:
1. Find the process: `lsof -i :2000` (Linux/Mac) or `netstat -ano | findstr :2000` (Windows)
2. Kill the process or change the port in `.env.development` or `.env.production`

### Database Connection Issues
- Verify `DATABASE_URL` is correct
- Check database is running and accessible
- Verify network/firewall settings

### Environment Variables Not Loading
- Ensure `dotenv-cli` is installed
- Check `.env.development` or `.env.production` exists
- Verify file is in project root

## Notes

- Never commit `.env.development` or `.env.production` to git
- Keep production secrets secure
- Use different session secrets for dev and prod
- Test database migrations on development first
