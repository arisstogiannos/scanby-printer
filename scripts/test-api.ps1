# Smoke test for local HTTP API (app must be running)
$base = "http://127.0.0.1:47821"

Write-Host "GET /status"
Invoke-RestMethod -Uri "$base/status" -Method Get | ConvertTo-Json

$pairBody = @{
  businessId = "test-business-id"
  businessName = "Test Venue"
  supabaseUrl = "https://example.supabase.co"
  supabasePublishableKey = "test-key"
} | ConvertTo-Json

Write-Host "POST /pair (expect 403 without Origin)"
try {
  Invoke-RestMethod -Uri "$base/pair" -Method Post -Body $pairBody -ContentType "application/json"
} catch {
  Write-Host $_.Exception.Message
}

Write-Host "POST /pair with Origin"
$headers = @{ Origin = "http://localhost:3000" }
Invoke-RestMethod -Uri "$base/pair" -Method Post -Body $pairBody -ContentType "application/json" -Headers $headers | ConvertTo-Json
