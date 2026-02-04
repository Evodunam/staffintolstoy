# Create Your Own PostgreSQL Database

## Quick Setup

### Option 1: Using pgAdmin (GUI - Easiest)

1. Open **pgAdmin**
2. Connect to your PostgreSQL server
3. Right-click on "Databases" → "Create" → "Database"
4. Name: `tolstoy_staffing_dev`
5. Owner: `postgres` (or create a new user)
6. Click "Save"

### Option 2: Using psql (Command Line)

1. Open PowerShell or Command Prompt
2. Connect to PostgreSQL:
   ```bash
   psql -U postgres
   ```
   (Enter your postgres password when prompted)

3. Run these commands:
   ```sql
   CREATE DATABASE tolstoy_staffing_dev;
   CREATE USER tolstoy_user WITH PASSWORD 'your_secure_password';
   GRANT ALL PRIVILEGES ON DATABASE tolstoy_staffing_dev TO tolstoy_user;
   \c tolstoy_staffing_dev
   ALTER DATABASE tolstoy_staffing_dev OWNER TO tolstoy_user;
   GRANT ALL ON SCHEMA public TO tolstoy_user;
   \q
   ```

### Option 3: Using SQL File

1. Run the SQL file:
   ```bash
   psql -U postgres -f setup-database.sql
   ```

## Update .env.development

After creating the database, update your `.env.development` file:

```env
DATABASE_URL=postgresql://tolstoy_user:your_secure_password@localhost:5432/tolstoy_staffing_dev?sslmode=disable
```

Replace `your_secure_password` with the password you set.

## Initialize the Database Schema

After updating `.env.development`, run migrations:

```bash
npm run db:push:dev
```

This will create all the tables, indexes, and schema in your new database.

## Verify It Works

1. Start the server:
   ```bash
   npm run dev
   ```

2. Check for any database errors - there should be none!

## Database Connection String Format

```
postgresql://[username]:[password]@[host]:[port]/[database]?sslmode=disable
```

Example:
```
postgresql://tolstoy_user:mypassword@localhost:5432/tolstoy_staffing_dev?sslmode=disable
```

## You Now Own This Database!

- ✅ Full control over the database
- ✅ Can backup/restore anytime
- ✅ Can modify schema as needed
- ✅ No external dependencies
- ✅ Runs on your local machine
