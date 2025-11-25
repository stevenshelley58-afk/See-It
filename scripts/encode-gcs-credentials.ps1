# Script to encode GCS credentials for Railway
# Railway may truncate long JSON strings, so base64 encoding is safer

$keyFile = Join-Path $PSScriptRoot "..\image-service\gcs-key.json"

if (-not (Test-Path $keyFile)) {
    Write-Host "ERROR: gcs-key.json not found at $keyFile" -ForegroundColor Red
    exit 1
}

Write-Host "Reading credentials from: $keyFile" -ForegroundColor Cyan

# Read and minify JSON
$json = Get-Content $keyFile -Raw | ConvertFrom-Json | ConvertTo-Json -Compress

# Encode to base64
$bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
$base64 = [Convert]::ToBase64String($bytes)

Write-Host "`n=== BASE64 ENCODED VALUE FOR RAILWAY ===" -ForegroundColor Green
Write-Host $base64 -ForegroundColor White
Write-Host "`n=== COPY THE ABOVE VALUE ===" -ForegroundColor Yellow
Write-Host "Paste this into Railway → Variables → GOOGLE_CREDENTIALS_JSON" -ForegroundColor Cyan
Write-Host "`nLength: $($base64.Length) characters" -ForegroundColor Gray

# Also save to file for easy copy
$outputFile = Join-Path $PSScriptRoot "..\gcs-credentials-base64.txt"
$base64 | Out-File -FilePath $outputFile -Encoding ASCII -NoNewline
Write-Host "`nAlso saved to: $outputFile" -ForegroundColor Gray

