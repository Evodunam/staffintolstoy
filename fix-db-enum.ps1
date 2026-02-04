# PowerShell script to fix database enum for worker_payouts status

Write-Host "Fixing database enum for worker_payouts.status..." -ForegroundColor Green
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
    Write-Host "❌ PostgreSQL psql not found." -ForegroundColor Red
    exit 1
}

# Get DATABASE_URL from .env.development
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

Write-Host "Finding enum type name..." -ForegroundColor Yellow

# Find the enum type used by worker_payouts.status
$findEnumQuery = @"
SELECT 
    t.typname as enum_name
FROM pg_type t 
JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
WHERE t.typname IN (
    SELECT 
        SUBSTRING(udt_name FROM '^(.+)_status$') as enum_name
    FROM information_schema.columns 
    WHERE table_name = 'worker_payouts' 
    AND column_name = 'status'
    AND udt_name LIKE '%enum%'
)
LIMIT 1;
"@

$enumName = $findEnumQuery | & $psqlPath $databaseUrl -t -A 2>&1 | Where-Object { $_.Trim() -and $_ -notmatch 'enum_name' -and $_ -notmatch '---' } | Select-Object -First 1

if (-not $enumName -or $enumName.Trim() -eq '') {
    # Try alternative query
    $altQuery = @"
SELECT 
    pg_type.typname
FROM pg_type
JOIN pg_attribute ON pg_attribute.atttypid = pg_type.oid
JOIN pg_class ON pg_class.oid = pg_attribute.attrelid
WHERE pg_class.relname = 'worker_payouts'
AND pg_attribute.attname = 'status'
AND pg_type.typtype = 'e';
"@
    $enumName = $altQuery | & $psqlPath $databaseUrl -t -A 2>&1 | Where-Object { $_.Trim() -and $_ -notmatch 'typname' -and $_ -notmatch '---' } | Select-Object -First 1
}

if (-not $enumName -or $enumName.Trim() -eq '') {
    Write-Host "⚠️ Could not find enum type. Status column might be TEXT (which is fine)." -ForegroundColor Yellow
    Write-Host "Checking column type directly..." -ForegroundColor Yellow
    
    $checkTypeQuery = @"
SELECT data_type, udt_name 
FROM information_schema.columns 
WHERE table_name = 'worker_payouts' 
AND column_name = 'status';
"@
    $typeInfo = $checkTypeQuery | & $psqlPath $databaseUrl -t -A 2>&1
    Write-Host "Column type info: $typeInfo" -ForegroundColor Cyan
    
    if ($typeInfo -match 'text|character varying') {
        Write-Host "✅ Status column is TEXT - no enum update needed!" -ForegroundColor Green
        exit 0
    }
    
    Write-Host "❌ Could not determine column type. Please check manually." -ForegroundColor Red
    exit 1
}

$enumName = $enumName.Trim()
Write-Host "Found enum type: $enumName" -ForegroundColor Cyan
Write-Host ""

# Check if pending_w9 already exists
$checkValueQuery = @"
SELECT EXISTS (
    SELECT 1 FROM pg_enum 
    WHERE enumlabel = 'pending_w9' 
    AND enumtypid = (SELECT oid FROM pg_type WHERE typname = '$enumName')
);
"@

$exists = $checkValueQuery | & $psqlPath $databaseUrl -t -A 2>&1 | Where-Object { $_.Trim() -match '^t|^f' } | Select-Object -First 1

if ($exists -match '^t') {
    Write-Host "✅ 'pending_w9' already exists in enum $enumName" -ForegroundColor Green
    exit 0
}

Write-Host "Adding 'pending_w9' to enum $enumName..." -ForegroundColor Yellow

# Add the enum value
$addEnumQuery = "ALTER TYPE $enumName ADD VALUE IF NOT EXISTS 'pending_w9';"

try {
    $addEnumQuery | & $psqlPath $databaseUrl 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ Successfully added 'pending_w9' to enum $enumName" -ForegroundColor Green
    } else {
        Write-Host "⚠️ Command completed with exit code $LASTEXITCODE" -ForegroundColor Yellow
        Write-Host "This might be okay if the value already exists." -ForegroundColor Yellow
    }
} catch {
    Write-Host "❌ Error: $_" -ForegroundColor Red
    exit 1
}
