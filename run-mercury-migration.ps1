# PowerShell script to run Mercury Bank database migration
# Migrates from Modern Treasury fields to Mercury Bank fields

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Mercury Bank Database Migration" -ForegroundColor Cyan
Write-Host "Modern Treasury → Mercury Bank" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Find PostgreSQL installation
$pgPaths = @(
    "C:\Program Files\PostgreSQL\16\bin\psql.exe",
    "C:\Program Files\PostgreSQL\18\bin\psql.exe",
    "C:\Program Files\PostgreSQL\17\bin\psql.exe",
    "C:\Program Files\PostgreSQL\15\bin\psql.exe",
    "$env:ProgramFiles\PostgreSQL\*\bin\psql.exe"
)

$psqlPath = $null
foreach ($path in $pgPaths) {
    $found = Get-ChildItem -Path $path -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($found) {
        $psqlPath = $found.FullName
        break
    }
}

if (-not $psqlPath) {
    Write-Host "❌ PostgreSQL psql not found." -ForegroundColor Red
    Write-Host ""
    Write-Host "Please run the migration manually:" -ForegroundColor Yellow
    Write-Host "1. Open pgAdmin 4" -ForegroundColor Yellow
    Write-Host "2. Connect to your database: tolstoy_staffing_dev" -ForegroundColor Yellow
    Write-Host "3. Tools → Query Tool" -ForegroundColor Yellow
    Write-Host "4. File → Open: migrations/001_modern_treasury_to_mercury.sql" -ForegroundColor Yellow
    Write-Host "5. Click Execute (F5)" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "OR install PostgreSQL and add psql to your PATH" -ForegroundColor Yellow
    exit 1
}

Write-Host "Found PostgreSQL at: $psqlPath" -ForegroundColor Green
Write-Host ""

# Database credentials
$dbName = "tolstoy_staffing_dev"
$dbUser = "tolstoy_user"

Write-Host "Connecting to database: $dbName" -ForegroundColor Cyan
Write-Host "User: $dbUser" -ForegroundColor Cyan
Write-Host ""

# Migration file
$migrationFile = "migrations\001_modern_treasury_to_mercury.sql"

if (-not (Test-Path $migrationFile)) {
    Write-Host "❌ Migration file not found: $migrationFile" -ForegroundColor Red
    Write-Host ""
    Write-Host "Make sure you're running this script from the project root directory." -ForegroundColor Yellow
    exit 1
}

Write-Host "Running migration: $migrationFile" -ForegroundColor Yellow
Write-Host ""

# Run migration
try {
    $env:PGPASSWORD = "tolstoy_dev_2024"  # Set password environment variable
    & $psqlPath -U $dbUser -d $dbName -f $migrationFile
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host ""
        Write-Host "========================================" -ForegroundColor Green
        Write-Host "✅ Migration Successful!" -ForegroundColor Green
        Write-Host "========================================" -ForegroundColor Green
        Write-Host ""
        Write-Host "Database fields updated:" -ForegroundColor Cyan
        Write-Host "  • mt_counterparty_id → mercury_recipient_id" -ForegroundColor White
        Write-Host "  • mt_external_account_id → mercury_external_account_id" -ForegroundColor White
        Write-Host "  • mt_payment_order_id → mercury_payment_id" -ForegroundColor White
        Write-Host "  • mt_payment_status → mercury_payment_status" -ForegroundColor White
        Write-Host "  • mt_bank_verified → mercury_bank_verified" -ForegroundColor White
        Write-Host "  • Removed: mt_virtual_account_id, mt_ledger_account_id" -ForegroundColor White
        Write-Host ""
        Write-Host "Next steps:" -ForegroundColor Yellow
        Write-Host "1. Add Mercury sandbox token to .env.development" -ForegroundColor Yellow
        Write-Host "2. Restart dev server: npm run dev" -ForegroundColor Yellow
        Write-Host "3. Test Mercury API connection" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "See: NEXT_STEPS.md for detailed instructions" -ForegroundColor Cyan
    } else {
        Write-Host ""
        Write-Host "❌ Migration failed with exit code: $LASTEXITCODE" -ForegroundColor Red
        Write-Host ""
        Write-Host "Check the error messages above for details." -ForegroundColor Yellow
        Write-Host ""
        Write-Host "If fields already exist (migration already run):" -ForegroundColor Yellow
        Write-Host "  • This is normal if you've already migrated" -ForegroundColor White
        Write-Host "  • Check columns: SELECT column_name FROM information_schema.columns WHERE table_name='profiles' AND column_name LIKE 'mercury%';" -ForegroundColor White
        exit 1
    }
} catch {
    Write-Host ""
    Write-Host "❌ Error running migration: $_" -ForegroundColor Red
    Write-Host ""
    Write-Host "Try running manually with pgAdmin" -ForegroundColor Yellow
    exit 1
} finally {
    Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
}
