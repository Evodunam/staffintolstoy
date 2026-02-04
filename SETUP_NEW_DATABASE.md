# Setup Your Own PostgreSQL Database

## Quick Steps

### Step 1: Create the Database

**Option A: Using pgAdmin (Easiest)**
1. Open pgAdmin
2. Connect to PostgreSQL server
3. Right-click "Databases" → "Create" → "Database"
4. Name: `tolstoy_staffing_dev`
5. Owner: `postgres`
6. Click "Save"

**Option B: Using PowerShell Script**
```powershell
powershell -ExecutionPolicy Bypass -File create-db-simple.ps1
```
(You'll be prompted for postgres password)

**Option C: Manual SQL Commands**
1. Open PowerShell
2. Run:
```powershell
& "C:\Program Files\PostgreSQL\16\bin\psql.exe" -U postgres
```
3. Enter your postgres password
4. Run these SQL commands:
```sql
CREATE DATABASE tolstoy_staffing_dev;
CREATE USER tolstoy_user WITH PASSWORD 'tolstoy_dev_2024';
GRANT ALL PRIVILEGES ON DATABASE tolstoy_staffing_dev TO tolstoy_user;
\c tolstoy_staffing_dev
ALTER DATABASE tolstoy_staffing_dev OWNER TO tolstoy_user;
GRANT ALL ON SCHEMA public TO tolstoy_user;
\q
```

### Step 2: Update .env.development

Update your `.env.development` file with:

```env
DATABASE_URL=postgresql://tolstoy_user:tolstoy_dev_2024@localhost:5432/tolstoy_staffing_dev?sslmode=disable
```

### Step 3: Initialize Schema

Run migrations to create all tables:

```bash
npm run db:push:dev
```

### Step 4: Start Development Server

```bash
npm run dev
```

## You Now Own This Database! 🎉

- ✅ Full control
- ✅ Can backup/restore
- ✅ Can modify schema
- ✅ No external dependencies
- ✅ Runs locally

## Database Details

- **Database Name**: `tolstoy_staffing_dev`
- **Username**: `tolstoy_user`
- **Password**: `tolstoy_dev_2024` (change this if you want)
- **Host**: `localhost`
- **Port**: `5432`

## Change Password (Optional)

If you want a different password:

```sql
ALTER USER tolstoy_user WITH PASSWORD 'your_new_password';
```

Then update `.env.development` with the new password.
