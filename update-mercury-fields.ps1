# PowerShell script to bulk replace Modern Treasury field references with Mercury fields
# This updates all mt* field names to mercury* field names in routes.ts

$routesFile = "server\routes.ts"

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "Mercury Field Name Replacement Script" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan

# Read the file
$content = Get-Content $routesFile -Raw

# Backup original
$backupFile = "server\routes.ts.backup-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
$content | Out-File -FilePath $backupFile -Encoding UTF8 -NoNewline
Write-Host "✅ Backup created: $backupFile" -ForegroundColor Green

# Count occurrences before
$countBefore = ([regex]::Matches($content, "mt[A-Z]")).Count
Write-Host "`n📊 Before: $countBefore mt* field references" -ForegroundColor Yellow

# Field name replacements (order matters - do longer names first to avoid partial matches)
$replacements = @(
    # Profile/CompanyPaymentMethod fields
    @{ Old = "\.mtCounterpartyId"; New = ".mercuryRecipientId" }
    @{ Old = "\.mtExternalAccountId"; New = ".mercuryExternalAccountId" }
    @{ Old = "\.mtPaymentOrderId"; New = ".mercuryPaymentId" }
    @{ Old = "\.mtPaymentStatus"; New = ".mercuryPaymentStatus" }
    @{ Old = "\.mtBankVerified"; New = ".mercuryBankVerified" }
    
    # Object property names
    @{ Old = "mtCounterpartyId:"; New = "mercuryRecipientId:" }
    @{ Old = "mtExternalAccountId:"; New = "mercuryExternalAccountId:" }
    @{ Old = "mtPaymentOrderId:"; New = "mercuryPaymentId:" }
    @{ Old = "mtPaymentStatus:"; New = "mercuryPaymentStatus:" }
    @{ Old = "mtBankVerified:"; New = "mercuryBankVerified:" }
    
    # Conditional checks (standalone variables)
    @{ Old = " mtCounterpartyId "; New = " mercuryRecipientId " }
    @{ Old = " mtExternalAccountId "; New = " mercuryExternalAccountId " }
    @{ Old = " mtPaymentOrderId "; New = " mercuryPaymentId " }
    @{ Old = " mtPaymentStatus "; New = " mercuryPaymentStatus " }
    @{ Old = " mtBankVerified "; New = " mercuryBankVerified " }
    
    # Parentheses usage (in conditionals)
    @{ Old = "\(mtCounterpartyId"; New = "(mercuryRecipientId" }
    @{ Old = "\(mtExternalAccountId"; New = "(mercuryExternalAccountId" }
    @{ Old = "\(mtPaymentOrderId"; New = "(mercuryPaymentId" }
    @{ Old = "\(mtPaymentStatus"; New = "(mercuryPaymentStatus" }
    @{ Old = "\(mtBankVerified"; New = "(mercuryBankVerified" }
    
    # Comma usage (in object literals)
    @{ Old = "mtCounterpartyId,"; New = "mercuryRecipientId," }
    @{ Old = "mtExternalAccountId,"; New = "mercuryExternalAccountId," }
    @{ Old = "mtPaymentOrderId,"; New = "mercuryPaymentId," }
    @{ Old = "mtPaymentStatus,"; New = "mercuryPaymentStatus," }
    @{ Old = "mtBankVerified,"; New = "mercuryBankVerified," }
)

# Apply replacements
foreach ($replacement in $replacements) {
    $oldPattern = $replacement.Old
    $newValue = $replacement.New
    $matchCount = ([regex]::Matches($content, $oldPattern)).Count
    if ($matchCount -gt 0) {
        $content = $content -replace $oldPattern, $newValue
        Write-Host "  • Replaced $matchCount occurrences: $oldPattern → $newValue" -ForegroundColor White
    }
}

# Count occurrences after
$countAfter = ([regex]::Matches($content, "mt[A-Z]")).Count
$replaced = $countBefore - $countAfter

Write-Host "`n📊 After: $countAfter mt* field references remaining" -ForegroundColor Yellow
Write-Host "✅ Replaced: $replaced field references" -ForegroundColor Green

# Save the updated file
$content | Out-File -FilePath $routesFile -Encoding UTF8 -NoNewline

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "✅ Field Replacement Complete!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "`nUpdated file: $routesFile" -ForegroundColor White
Write-Host "Backup: $backupFile" -ForegroundColor Gray
Write-Host "`nNext: Continue updating Modern Treasury API calls" -ForegroundColor Yellow
