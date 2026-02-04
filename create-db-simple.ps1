# Simple script to create PostgreSQL database
# This will prompt for your postgres password

$psqlPath = "C:\Program Files\PostgreSQL\16\bin\psql.exe"

Write-Host "Creating database: tolstoy_staffing_dev" -ForegroundColor Green
Write-Host "You will be prompted for the postgres user password" -ForegroundColor Yellow
Write-Host ""

# Create database
& $psqlPath -U postgres -c "CREATE DATABASE tolstoy_staffing_dev;" 2>&1

Write-Host ""
Write-Host "Creating user: tolstoy_user" -ForegroundColor Green
& $psqlPath -U postgres -c "CREATE USER tolstoy_user WITH PASSWORD 'tolstoy_dev_2024';" 2>&1

Write-Host ""
Write-Host "Granting privileges..." -ForegroundColor Green
& $psqlPath -U postgres -c "GRANT ALL PRIVILEGES ON DATABASE tolstoy_staffing_dev TO tolstoy_user;" 2>&1

& $psqlPath -U postgres -d tolstoy_staffing_dev -c "ALTER DATABASE tolstoy_staffing_dev OWNER TO tolstoy_user; GRANT ALL ON SCHEMA public TO tolstoy_user;" 2>&1

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "✅ Database Setup Complete!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Connection String:" -ForegroundColor Cyan
Write-Host "postgresql://tolstoy_user:tolstoy_dev_2024@localhost:5432/tolstoy_staffing_dev?sslmode=disable" -ForegroundColor White
Write-Host ""
Write-Host "Next: Update .env.development with the connection string above" -ForegroundColor Yellow
