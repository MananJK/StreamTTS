# Quick Performance Validation Script
# This script validates that all optimizations are in place

Write-Host "🚀 RusEcho Performance Validation" -ForegroundColor Green
Write-Host "=================================" -ForegroundColor Green

# Check if optimized files exist
$checks = @()

# 1. Check if optimized app exists
if (Test-Path "electron-build-fresh\win-unpacked\RusEcho.exe") {
    $checks += "✅ Optimized app build exists"
} else {
    $checks += "❌ Optimized app build missing - run: npm run build:installer"
}

# 2. Check if performance scripts exist
if (Test-Path "scripts\optimize-startup.js") {
    $checks += "✅ Startup optimization script ready"
} else {
    $checks += "❌ Startup optimization script missing"
}

# 3. Check if performance optimizer exists
if (Test-Path "electron\performance-optimizer.js") {
    $checks += "✅ Electron performance optimizer ready"
} else {
    $checks += "❌ Electron performance optimizer missing"
}

# 4. Check Vite config optimizations
$viteConfig = Get-Content "vite.config.ts" -Raw
if ($viteConfig -match "manualChunks" -and $viteConfig -match "terser") {
    $checks += "✅ Vite build optimizations configured"
} else {
    $checks += "❌ Vite build optimizations missing"
}

# 5. Check package.json scripts
$packageJson = Get-Content "package.json" -Raw
if ($packageJson -match "test:performance" -and $packageJson -match "start:optimized") {
    $checks += "✅ Performance scripts available"
} else {
    $checks += "❌ Performance scripts missing"
}

# 6. Check lazy loading implementation
if (Test-Path "src\lib\lazy-loading.tsx") {
    $checks += "✅ React lazy loading implemented"
} else {
    $checks += "❌ React lazy loading missing"
}

# Display results
Write-Host "`nValidation Results:" -ForegroundColor Yellow
foreach ($check in $checks) {
    if ($check.StartsWith("✅")) {
        Write-Host $check -ForegroundColor Green
    } else {
        Write-Host $check -ForegroundColor Red
    }
}

# Performance recommendations
Write-Host "`n💡 Performance Recommendations:" -ForegroundColor Cyan
Write-Host "1. Use .\start-optimized.bat for fastest startup" -ForegroundColor White
Write-Host "2. Keep the app running to avoid restart delays" -ForegroundColor White
Write-Host "3. Run npm run test:performance to measure improvements" -ForegroundColor White
Write-Host "4. Use the portable version for distribution" -ForegroundColor White

# Quick startup test
Write-Host "`n🧪 Quick Startup Test:" -ForegroundColor Yellow
Write-Host "Starting app to measure startup time..."

$startTime = Get-Date
try {
    $process = Start-Process -FilePath "electron-build-fresh\win-unpacked\RusEcho.exe" -PassThru -WindowStyle Minimized
    Start-Sleep -Seconds 3
    
    if (!$process.HasExited) {
        Stop-Process -Id $process.Id -Force
        $endTime = Get-Date
        $startupTime = ($endTime - $startTime).TotalMilliseconds
        
        if ($startupTime -lt 5000) {
            Write-Host "✅ Excellent startup time: $([math]::Round($startupTime))ms" -ForegroundColor Green
        } elseif ($startupTime -lt 15000) {
            Write-Host "✅ Good startup time: $([math]::Round($startupTime))ms" -ForegroundColor Yellow
        } else {
            Write-Host "⚠️  Slow startup time: $([math]::Round($startupTime))ms" -ForegroundColor Red
            Write-Host "   Consider running optimization scripts" -ForegroundColor White
        }
    } else {
        Write-Host "❌ App failed to start properly" -ForegroundColor Red
    }
} catch {
    Write-Host "❌ Could not test startup: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host "`n🎉 Performance validation complete!" -ForegroundColor Green
Write-Host "Run '.\start-optimized.bat' for the best experience!" -ForegroundColor Cyan
