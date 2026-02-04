# Run company onboarding reminder migration (005)
# Adds company_onboarding_reminder_sent_at to profiles. Works without psql by using Node.
#
# Usage:
#   .\run-company-onboarding-reminder-migration.ps1
#   .\run-company-onboarding-reminder-migration.ps1 "postgresql://user:pass@localhost:5432/dbname?sslmode=disable"

$ErrorActionPreference = "Stop"
Write-Host "Running company onboarding reminder migration (005)..." -ForegroundColor Green
Write-Host ""

$migrationFile = "migrations\005_add_company_onboarding_reminder_sent_at.sql"
if (-not (Test-Path $migrationFile)) {
    Write-Host "❌ Migration file not found: $migrationFile" -ForegroundColor Red
    exit 1
}

# Use DATABASE_URL from argument (set env so it's not mangled by shell), or load via dotenv
if ($args[0]) {
    Write-Host "Using DATABASE_URL from command line." -ForegroundColor Gray
    $env:DATABASE_URL = $args[0]
    npx tsx script/run-sql-migration.ts $migrationFile
} else {
    Write-Host "Using DATABASE_URL from .env.development (via dotenv)..." -ForegroundColor Gray
    npx dotenv -e .env.development -- tsx script/run-sql-migration.ts $migrationFile
}

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "✅ Company onboarding reminder migration completed!" -ForegroundColor Green
} else {
    Write-Host ""
    Write-Host "If you see ENOTFOUND/base, fix DATABASE_URL. Example for local PostgreSQL:" -ForegroundColor Yellow
    Write-Host '  .\run-company-onboarding-reminder-migration.ps1 "postgresql://postgres:YOUR_PASSWORD@localhost:5432/YOUR_DB_NAME?sslmode=disable"' -ForegroundColor Cyan
    exit 1
}
