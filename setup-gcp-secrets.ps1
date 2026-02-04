# Google Cloud Secrets Manager Setup Script
# Run this script to enable the API and upload secrets

Write-Host "🚀 Setting up Google Cloud Secrets Manager..." -ForegroundColor Cyan
Write-Host ""

# Check if gcloud is available
try {
    $gcloudVersion = gcloud --version 2>&1
    Write-Host "✅ Google Cloud SDK found" -ForegroundColor Green
} catch {
    Write-Host "❌ Google Cloud SDK not found. Please install it first." -ForegroundColor Red
    Write-Host "   Download from: https://cloud.google.com/sdk/docs/install" -ForegroundColor Yellow
    exit 1
}

# Set project
Write-Host "📋 Setting project to: tolstoy-staffing-23032" -ForegroundColor Cyan
gcloud config set project tolstoy-staffing-23032

# Enable Secret Manager API
Write-Host ""
Write-Host "🔧 Enabling Secret Manager API..." -ForegroundColor Cyan
gcloud services enable secretmanager.googleapis.com --project=tolstoy-staffing-23032

# Authenticate for application-default credentials
Write-Host ""
Write-Host "🔐 Authenticating for application-default credentials..." -ForegroundColor Cyan
Write-Host "   (This will open a browser for authentication)" -ForegroundColor Yellow
gcloud auth application-default login

# Verify project
Write-Host ""
Write-Host "✅ Verification:" -ForegroundColor Green
$project = gcloud config get-value project
Write-Host "   Current project: $project" -ForegroundColor White

# Check if .env.production exists
Write-Host ""
if (Test-Path ".env.production") {
    Write-Host "✅ Found .env.production file" -ForegroundColor Green
    Write-Host ""
    Write-Host "📤 Ready to upload secrets!" -ForegroundColor Cyan
    Write-Host "   Run: npm run secrets:upload" -ForegroundColor Yellow
} else {
    Write-Host "⚠️  .env.production file not found" -ForegroundColor Yellow
    Write-Host "   Please create .env.production with all your secrets first" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "✨ Setup complete!" -ForegroundColor Green
