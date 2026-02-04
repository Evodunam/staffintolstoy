# PowerShell script to add pending_w9 to enum

$pgPath = "C:\Program Files\PostgreSQL\16\bin\psql.exe"

# Get DATABASE_URL
$envFile = ".env.development"
$databaseUrl = $null
Get-Content $envFile | ForEach-Object {
    if ($_ -match '^DATABASE_URL=(.+)$') {
        $databaseUrl = $matches[1].Trim() -replace '^"|"$', ''
    }
}

if (-not $databaseUrl) {
    Write-Host "❌ DATABASE_URL not found" -ForegroundColor Red
    exit 1
}

Write-Host "Running migration to add pending_w9 to enum..." -ForegroundColor Green

$migrationFile = "migrations\003_add_pending_w9_enum.sql"
$sql = Get-Content $migrationFile -Raw

$sql | & $pgPath $databaseUrl 2>&1

if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ Migration completed!" -ForegroundColor Green
} else {
    Write-Host "⚠️ Migration completed with exit code: $LASTEXITCODE" -ForegroundColor Yellow
}
