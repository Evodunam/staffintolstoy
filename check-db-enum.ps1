# PowerShell script to check and fix database enum for worker_payouts status

Write-Host "Checking database enum for worker_payouts.status..." -ForegroundColor Green
Write-Host ""

# Find PostgreSQL installation
$pgPaths = @(
    "C:\Program Files\PostgreSQL\16\bin\psql.exe",
    "C:\Program Files\PostgreSQL\18\bin\psql.exe",
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
    Write-Host "❌ PostgreSQL psql not found. Please install PostgreSQL or add it to PATH." -ForegroundColor Red
    exit 1
}

Write-Host "Found PostgreSQL at: $psqlPath" -ForegroundColor Cyan
Write-Host ""

# Get DATABASE_URL from .env.development
$envFile = ".env.development"
if (-not (Test-Path $envFile)) {
    Write-Host "❌ .env.development not found" -ForegroundColor Red
    exit 1
}

$databaseUrl = $null
Get-Content $envFile | ForEach-Object {
    if ($_ -match '^DATABASE_URL=(.+)$') {
        $databaseUrl = $matches[1].Trim()
    }
}

if (-not $databaseUrl) {
    Write-Host "❌ DATABASE_URL not found in .env.development" -ForegroundColor Red
    exit 1
}

Write-Host "Checking if status column uses ENUM type..." -ForegroundColor Yellow

# Check if status column is an ENUM type
$checkEnumQuery = @"
SELECT 
    t.typname as enum_name,
    e.enumlabel as enum_value
FROM pg_type t 
JOIN pg_enum e ON t.oid = e.enumtypid  
JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
WHERE t.typname LIKE '%payout%status%' OR t.typname LIKE '%worker%payout%status%'
ORDER BY t.typname, e.enumsortorder;
"@

$enumResult = $checkEnumQuery | & $psqlPath $databaseUrl -t -A 2>&1

if ($LASTEXITCODE -eq 0 -and $enumResult -match 'enum') {
    Write-Host "⚠️ Found ENUM type. Checking if 'pending_w9' exists..." -ForegroundColor Yellow
    if ($enumResult -notmatch 'pending_w9') {
        Write-Host "❌ 'pending_w9' not found in enum. Need to add it." -ForegroundColor Red
        Write-Host ""
        Write-Host "To fix, run this SQL:" -ForegroundColor Yellow
        Write-Host "ALTER TYPE <enum_name> ADD VALUE IF NOT EXISTS 'pending_w9';" -ForegroundColor White
    } else {
        Write-Host "✅ 'pending_w9' found in enum" -ForegroundColor Green
    }
} else {
    Write-Host "✅ Status column is TEXT (not ENUM type) - 'pending_w9' should work" -ForegroundColor Green
}

Write-Host ""
Write-Host "Checking current status values in worker_payouts table..." -ForegroundColor Yellow

$checkValuesQuery = @"
SELECT DISTINCT status FROM worker_payouts ORDER BY status;
"@

$valuesResult = $checkValuesQuery | & $psqlPath $databaseUrl -t -A 2>&1

if ($LASTEXITCODE -eq 0) {
    Write-Host "Current status values:" -ForegroundColor Cyan
    $valuesResult | ForEach-Object { if ($_.Trim()) { Write-Host "  - $_" -ForegroundColor White } }
} else {
    Write-Host "⚠️ Could not query status values: $valuesResult" -ForegroundColor Yellow
}
