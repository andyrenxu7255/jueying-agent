$ErrorActionPreference = "Stop"

$repoRoot = "D:\sourcecode\opencode"
$fixRoot = "d:\teamclaw\docs-fix"

$fileMap = @{
    "README.md" = "README.md"
    "README.zh.md" = "README.zh.md"
    "STATS.md" = "STATS.md"
    "packages\app\README.md" = "packages\app\README.md"
    "packages\console\app\README.md" = "packages\console\app\README.md"
    "packages\enterprise\README.md" = "packages\enterprise\README.md"
    "packages\web\README.md" = "packages\web\README.md"
    "packages\docs\README.md" = "packages\docs\README.md"
    "packages\containers\README.md" = "packages\containers\README.md"
    "packages\desktop-electron\README.md" = "packages\desktop-electron\README.md"
    "packages\desktop-electron\AGENTS.md" = "packages\desktop-electron\AGENTS.md"
    "packages\slack\README.md" = "packages\slack\README.md"
    "packages\opencode\README.md" = "packages\opencode\README.md"
    "packages\opencode\AGENTS.md" = "packages\opencode\AGENTS.md"
    "packages\opencode\BUN_SHELL_MIGRATION_PLAN.md" = "packages\opencode\BUN_SHELL_MIGRATION_PLAN.md"
    "packages\opencode\src\acp\README.md" = "packages\opencode\src\acp\README.md"
    "packages\opencode\src\sync\README.md" = "packages\opencode\src\sync\README.md"
    "packages\opencode\src\provider\sdk\copilot\README.md" = "packages\opencode\src\provider\sdk\copilot\README.md"
    "packages\opencode\specs\effect\migration.md" = "packages\opencode\specs\effect\migration.md"
    "packages\opencode\specs\effect\loose-ends.md" = "packages\opencode\specs\effect\loose-ends.md"
    "specs\project.md" = "specs\project.md"
    "specs\v2\session.md" = "specs\v2\session.md"
    "github\README.md" = "github\README.md"
}

$applied = 0
$failed = 0

foreach ($entry in $fileMap.GetEnumerator()) {
    $src = Join-Path $fixRoot $entry.Key
    $dst = Join-Path $repoRoot $entry.Value

    if (Test-Path $src) {
        $dstDir = Split-Path $dst -Parent
        if (-not (Test-Path $dstDir)) {
            New-Item -ItemType Directory -Path $dstDir -Force | Out-Null
        }
        Copy-Item -Path $src -Destination $dst -Force
        Write-Host "OK: $($entry.Value)" -ForegroundColor Green
        $applied++
    } else {
        Write-Host "SKIP: $($entry.Value) (source not found)" -ForegroundColor Yellow
        $failed++
    }
}

Write-Host ""
Write-Host "Applied: $applied, Skipped: $failed" -ForegroundColor Cyan
