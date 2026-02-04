-- Create a new PostgreSQL database for Tolstoy Staffing Development
-- Run this file with: psql -U postgres -f setup-database.sql

-- Create database
CREATE DATABASE tolstoy_staffing_dev;

-- Create user
CREATE USER tolstoy_user WITH PASSWORD 'tolstoy_dev_secure_password_2024';

-- Grant privileges
GRANT ALL PRIVILEGES ON DATABASE tolstoy_staffing_dev TO tolstoy_user;

-- Connect to the new database and set ownership
\c tolstoy_staffing_dev

-- Make the user the owner
ALTER DATABASE tolstoy_staffing_dev OWNER TO tolstoy_user;

-- Grant schema privileges
GRANT ALL ON SCHEMA public TO tolstoy_user;

-- Success message
\echo 'Database tolstoy_staffing_dev created successfully!'
\echo 'User tolstoy_user created with full privileges!'
\echo ''
\echo 'Connection string:'
\echo 'postgresql://tolstoy_user:tolstoy_dev_secure_password_2024@localhost:5432/tolstoy_staffing_dev?sslmode=disable'
