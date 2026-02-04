# PowerShell script to run instant payout migration
# Adds instant_payout_enabled column to profiles and related fields to worker_payouts

Write-Host "Running instant payout migration..." -ForegroundColor Green
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

Write-Host "Running migration..." -ForegroundColor Yellow

# Read migration file
$migrationFile = "migrations\002_add_instant_payout_fields.sql"
if (-not (Test-Path $migrationFile)) {
    Write-Host "❌ Migration file not found: $migrationFile" -ForegroundColor Red
    exit 1
}

$migrationSql = Get-Content $migrationFile -Raw

# Run migration
try {
    $migrationSql | & $psqlPath $databaseUrl
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ Migration completed successfully!" -ForegroundColor Green
    } else {
        Write-Host "❌ Migration failed with exit code: $LASTEXITCODE" -ForegroundColor Red
        exit 1
    }
} catch {
    Write-Host "❌ Error running migration: $_" -ForegroundColor Red
    exit 1
}
