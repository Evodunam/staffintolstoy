# Database Connection Setup

## Issue: "helium" hostname not found

The development database connection is trying to connect to `helium/heliumdb`, but the hostname "helium" cannot be resolved.

## Solutions

### Option 1: Use localhost (if database is running locally)

If your PostgreSQL database is running on your local machine, update `.env.development`:

```env
DATABASE_URL=postgresql://postgres:password@localhost:5432/heliumdb?sslmode=disable
```

### Option 2: Start Docker container (if using Docker)

If "helium" is a Docker container name, start it:

```bash
# Check if container exists
docker ps -a | findstr helium

# Start the container
docker start helium

# Or if you need to create it
docker run -d --name helium -e POSTGRES_PASSWORD=password -e POSTGRES_DB=heliumdb -p 5432:5432 postgres:16
```

Then update `.env.development` to use localhost:
```env
DATABASE_URL=postgresql://postgres:password@localhost:5432/heliumdb?sslmode=disable
```

### Option 3: Use a remote development database

You can use a cloud database for development (like Neon, Supabase, etc.):

```env
DATABASE_URL=postgresql://user:password@your-dev-db-host.com:5432/dbname?sslmode=require
```

### Option 4: Add to Windows hosts file

If "helium" is a custom hostname, add it to your hosts file:

1. Open Notepad as Administrator
2. Open: `C:\Windows\System32\drivers\etc\hosts`
3. Add line: `127.0.0.1 helium`
4. Save the file

Then your current DATABASE_URL should work.

## Quick Fix

The quickest solution is to update `.env.development` to use `localhost`:

```env
DATABASE_URL=postgresql://postgres:password@localhost:5432/heliumdb?sslmode=disable
```

Make sure:
- PostgreSQL is running on your machine
- Port 5432 is available
- Database "heliumdb" exists
- User "postgres" has password "password"
