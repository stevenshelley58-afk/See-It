# GCS Setup Script for See It
# Run this script to configure your GCS bucket

$BUCKET_NAME = "see-it-room"
$PROJECT_ID = "see-it-production"
$CORS_FILE = Join-Path $PSScriptRoot "..\gcs-cors.json"

Write-Host "=== See It GCS Setup ===" -ForegroundColor Cyan

# Check if gsutil is available
if (-not (Get-Command gsutil -ErrorAction SilentlyContinue)) {
    Write-Host "ERROR: gsutil not found. Please install Google Cloud SDK." -ForegroundColor Red
    Write-Host "Download from: https://cloud.google.com/sdk/docs/install" -ForegroundColor Yellow
    exit 1
}

# Check if bucket exists
Write-Host "`nChecking if bucket exists..." -ForegroundColor Yellow
$bucketExists = gsutil ls "gs://$BUCKET_NAME" 2>$null
if (-not $bucketExists) {
    Write-Host "Bucket does not exist. Creating..." -ForegroundColor Yellow
    gsutil mb -p $PROJECT_ID "gs://$BUCKET_NAME"
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERROR: Failed to create bucket" -ForegroundColor Red
        exit 1
    }
    Write-Host "Bucket created successfully" -ForegroundColor Green
} else {
    Write-Host "Bucket exists" -ForegroundColor Green
}

# Apply CORS configuration
Write-Host "`nApplying CORS configuration..." -ForegroundColor Yellow
gsutil cors set $CORS_FILE "gs://$BUCKET_NAME"
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Failed to apply CORS" -ForegroundColor Red
    exit 1
}
Write-Host "CORS applied successfully" -ForegroundColor Green

# Verify CORS
Write-Host "`nVerifying CORS configuration..." -ForegroundColor Yellow
gsutil cors get "gs://$BUCKET_NAME"

Write-Host "`n=== Setup Complete ===" -ForegroundColor Cyan
Write-Host "Your GCS bucket is now configured for browser uploads." -ForegroundColor Green
Write-Host "`nNext steps:" -ForegroundColor Yellow
Write-Host "1. Ensure Railway has GCS_BUCKET=$BUCKET_NAME" -ForegroundColor White
Write-Host "2. Ensure Railway has GOOGLE_CREDENTIALS_JSON set" -ForegroundColor White
Write-Host "3. Redeploy your Railway app" -ForegroundColor White

