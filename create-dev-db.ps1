# PowerShell script to create a new PostgreSQL database for development

$dbName = "tolstoy_staffing_dev"
$dbUser = "tolstoy_user"
$dbPassword = "tolstoy_dev_password_$(Get-Random -Minimum 1000 -Maximum 9999)"

Write-Host "Creating new PostgreSQL database: $dbName" -ForegroundColor Green
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
    Write-Host ""
    Write-Host "Alternative: Create database manually:" -ForegroundColor Yellow
    Write-Host "1. Open pgAdmin or psql" -ForegroundColor Yellow
    Write-Host "2. Connect to PostgreSQL" -ForegroundColor Yellow
    Write-Host "3. Run: CREATE DATABASE $dbName;" -ForegroundColor Yellow
    Write-Host "4. Run: CREATE USER $dbUser WITH PASSWORD '$dbPassword';" -ForegroundColor Yellow
    Write-Host "5. Run: GRANT ALL PRIVILEGES ON DATABASE $dbName TO $dbUser;" -ForegroundColor Yellow
    exit 1
}

Write-Host "Found PostgreSQL at: $psqlPath" -ForegroundColor Cyan
Write-Host ""

# Try to connect and create database
Write-Host "Creating database and user..." -ForegroundColor Yellow

# Create database (connect to postgres database first)
$createDbCmd = "CREATE DATABASE $dbName;"
$createUserCmd = "CREATE USER $dbUser WITH PASSWORD '$dbPassword';"
$grantCmd = "GRANT ALL PRIVILEGES ON DATABASE $dbName TO $dbUser;"
$alterDbCmd = "ALTER DATABASE $dbName OWNER TO $dbUser;"

# Execute commands
try {
    & $psqlPath -U postgres -d postgres -c $createDbCmd 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Database might already exist, continuing..." -ForegroundColor Yellow
    } else {
        Write-Host "✅ Database created" -ForegroundColor Green
    }
    
    & $psqlPath -U postgres -d postgres -c $createUserCmd 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "User might already exist, continuing..." -ForegroundColor Yellow
    } else {
        Write-Host "✅ User created" -ForegroundColor Green
    }
    
    & $psqlPath -U postgres -d postgres -c $grantCmd 2>&1 | Out-Null
    & $psqlPath -U postgres -d $dbName -c $alterDbCmd 2>&1 | Out-Null
    
    Write-Host "✅ Permissions granted" -ForegroundColor Green
    Write-Host ""
    
    # Generate connection string
    $connectionString = "postgresql://$dbUser`:$dbPassword@localhost:5432/$dbName?sslmode=disable"
    
    Write-Host "========================================" -ForegroundColor Green
    Write-Host "✅ Database Created Successfully!" -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "Database Name: $dbName" -ForegroundColor Cyan
    Write-Host "Database User: $dbUser" -ForegroundColor Cyan
    Write-Host "Database Password: $dbPassword" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Connection String:" -ForegroundColor Yellow
    Write-Host $connectionString -ForegroundColor White
    Write-Host ""
    Write-Host "Next steps:" -ForegroundColor Yellow
    Write-Host "1. Update .env.development with the connection string above" -ForegroundColor Yellow
    Write-Host "2. Run: npm run db:push:dev" -ForegroundColor Yellow
    Write-Host "3. Run: npm run dev" -ForegroundColor Yellow
    
} catch {
    Write-Host "❌ Error: $_" -ForegroundColor Red
    Write-Host ""
    Write-Host "Please create the database manually using pgAdmin or psql" -ForegroundColor Yellow
}
