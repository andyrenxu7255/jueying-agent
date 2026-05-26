param(
  [int]$Hours = 6,
  [int]$CycleSeconds = 600,
  [int]$RunTimeoutSeconds = 900,
  [int]$HeartbeatSeconds = 60
)

$ErrorActionPreference = 'Stop'

$root = 'D:\teamclaw\agent-harness'
$opsDir = Join-Path $root 'ops'
$activeTaskPath = Join-Path $opsDir 'ACTIVE_TASK.json'
$statusPath = Join-Path $opsDir 'm2-autonomous-status.json'
$lockPath = Join-Path $opsDir 'm2-autonomous-loop.lock'
$nodePath = 'C:\Program Files\nodejs\node.exe'
$cmdPath = Join-Path $env:SystemRoot 'System32\cmd.exe'
$runId = Get-Date -Format 'yyyyMMdd-HHmmss'
$logPath = Join-Path $opsDir "m2-autonomous-$runId.log"
$selfPid = $PID
$pollSeconds = 5

function Now-IsoUtc {
  return (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.000Z')
}

function Write-Log([string]$Message) {
  $line = "[$((Get-Date).ToString('s'))] $Message"
  Add-Content -Path $logPath -Value $line
}

function Write-Status(
  [string]$State,
  [int]$Cycle,
  [string]$Detail,
  [nullable[int]]$ChildPid = $null,
  [nullable[int]]$ChildExitCode = $null,
  [nullable[int]]$SleepRemainingSeconds = $null,
  [string]$ChildStdoutLog = '',
  [string]$ChildStderrLog = ''
) {
  $status = [ordered]@{
    run_id = $runId
    pid = $selfPid
    status = $State
    cycle = $Cycle
    detail = $Detail
    current_log = $logPath
    started_at = $script:startedAtIso
    last_heartbeat_at = Now-IsoUtc
    timeout_seconds = $RunTimeoutSeconds
    cycle_seconds = $CycleSeconds
  }

  if ($null -ne $ChildPid) {
    $status.child_pid = $ChildPid
  }
  if ($null -ne $ChildExitCode) {
    $status.child_exit_code = $ChildExitCode
  }
  if ($null -ne $SleepRemainingSeconds) {
    $status.sleep_remaining_seconds = $SleepRemainingSeconds
  }
  if ($ChildStdoutLog) {
    $status.child_stdout_log = $ChildStdoutLog
  }
  if ($ChildStderrLog) {
    $status.child_stderr_log = $ChildStderrLog
  }

  $status | ConvertTo-Json -Depth 10 | Set-Content -Path $statusPath
}

function Update-ActiveTask([string]$Stage, [string]$Focus, [string]$Target) {
  if (-not (Test-Path $activeTaskPath)) {
    return
  }

  $task = Get-Content -Path $activeTaskPath -Raw | ConvertFrom-Json
  $now = Now-IsoUtc
  $task.status = 'in_progress'
  $task.current_stage = $Stage
  $task.current_focus = $Focus
  $task.latest_user_visible_target = $Target
  $task.last_auto_progress_report_at = $now
  $task.last_progress_report_at = $now
  $task | ConvertTo-Json -Depth 20 | Set-Content -Path $activeTaskPath
}

function Acquire-Lock {
  if (Test-Path $lockPath) {
    try {
      $lock = Get-Content -Path $lockPath -Raw | ConvertFrom-Json
      if ($lock.pid -and (Get-Process -Id ([int]$lock.pid) -ErrorAction SilentlyContinue)) {
        throw "m2 autonomous loop already running with pid=$($lock.pid)"
      }
    } catch {
      if (-not $_.Exception.Message.StartsWith('m2 autonomous loop already running')) {
        Remove-Item -Path $lockPath -Force -ErrorAction SilentlyContinue
      } else {
        throw
      }
    }
  }

  [ordered]@{
    run_id = $runId
    pid = $selfPid
    started_at = $script:startedAtIso
    log_path = $logPath
  } | ConvertTo-Json -Depth 5 | Set-Content -Path $lockPath
}

function Release-Lock {
  Remove-Item -Path $lockPath -Force -ErrorAction SilentlyContinue
}

function Prune-OldLogs {
  $threshold = (Get-Date).AddHours(-24)
  Get-ChildItem -Path $opsDir -Filter 'm2-autonomous-*.log' |
    Where-Object { $_.LastWriteTime -lt $threshold } |
    ForEach-Object {
      Remove-Item -Path $_.FullName -Force -ErrorAction SilentlyContinue
    }
}

function Invoke-Cycle([int]$Cycle) {
  Write-Log "cycle#$Cycle start: node tests/poc/start-m2-services.js"
  Write-Status -State 'running_cycle' -Cycle $Cycle -Detail 'running autonomous runner'
  Update-ActiveTask -Stage 'phase_e_watchdog_cycle' -Focus "watchdog cycle $Cycle running start-m2-services.js" -Target 'Autonomous watchdog is executing the current M2 validation cycle'

  $childStdoutPath = Join-Path $opsDir "m2-autonomous-$runId-cycle$Cycle.stdout.log"
  $childStderrPath = Join-Path $opsDir "m2-autonomous-$runId-cycle$Cycle.stderr.log"
  Write-Log "cycle#$Cycle child stdout log: $childStdoutPath"
  Write-Log "cycle#$Cycle child stderr log: $childStderrPath"
  $proc = Start-Process -FilePath $nodePath -ArgumentList 'tests/poc/start-m2-services.js' -WorkingDirectory $root -PassThru -WindowStyle Hidden -RedirectStandardOutput $childStdoutPath -RedirectStandardError $childStderrPath
  $cycleStart = Get-Date
  $nextHeartbeatAt = (Get-Date).AddSeconds($HeartbeatSeconds)
  Write-Status -State 'running_cycle' -Cycle $Cycle -Detail 'child process started' -ChildPid $proc.Id -ChildStdoutLog $childStdoutPath -ChildStderrLog $childStderrPath

  while ($true) {
    Start-Sleep -Seconds $pollSeconds
    $proc.Refresh()

    if ($proc.HasExited) {
      $proc.WaitForExit()
      $proc.Refresh()
      $exitCode = if ($null -eq $proc.ExitCode) { -1 } else { [int]$proc.ExitCode }
      Write-Log "cycle#$Cycle finished; exit_code=$exitCode"
      Write-Status -State 'cycle_finished' -Cycle $Cycle -Detail 'cycle finished' -ChildPid $proc.Id -ChildExitCode $exitCode -ChildStdoutLog $childStdoutPath -ChildStderrLog $childStderrPath
      Update-ActiveTask -Stage 'phase_e_watchdog_sleep' -Focus "watchdog cycle $Cycle completed with exit code $exitCode" -Target 'Autonomous watchdog finished one M2 validation cycle and is entering the sleep window'
      return
    }

    $elapsedSeconds = [int]((Get-Date) - $cycleStart).TotalSeconds
    if ((Get-Date) -ge $nextHeartbeatAt) {
      Write-Log "cycle#$Cycle heartbeat; child_pid=$($proc.Id); elapsed_seconds=$elapsedSeconds"
      Write-Status -State 'running_cycle' -Cycle $Cycle -Detail 'child still running' -ChildPid $proc.Id -ChildStdoutLog $childStdoutPath -ChildStderrLog $childStderrPath
      Update-ActiveTask -Stage 'phase_e_watchdog_cycle' -Focus "watchdog cycle $Cycle still running; elapsed ${elapsedSeconds}s" -Target 'Autonomous watchdog is still executing the current M2 validation cycle'
      $nextHeartbeatAt = (Get-Date).AddSeconds($HeartbeatSeconds)
    }

    if ($elapsedSeconds -ge $RunTimeoutSeconds) {
      try {
        Stop-Process -Id $proc.Id -Force
      } catch {
      }
      Write-Log "cycle#$Cycle watchdog timeout; killed child_pid=$($proc.Id) after ${elapsedSeconds}s"
      Write-Status -State 'cycle_timeout' -Cycle $Cycle -Detail 'child timed out and was killed' -ChildPid $proc.Id -ChildStdoutLog $childStdoutPath -ChildStderrLog $childStderrPath
      Update-ActiveTask -Stage 'phase_e_watchdog_timeout' -Focus "watchdog cycle $Cycle timed out and killed child pid $($proc.Id)" -Target 'Autonomous watchdog detected a stuck cycle, killed it, and will continue with the next cycle'
      return
    }
  }
}

function Invoke-SleepWindow([int]$Cycle, [datetime]$EndAt) {
  $remaining = $CycleSeconds
  while ($remaining -gt 0 -and (Get-Date) -lt $EndAt) {
    Write-Log "cycle#$Cycle sleep heartbeat; remaining_seconds=$remaining"
    Write-Status -State 'sleeping' -Cycle $Cycle -Detail 'between cycles' -SleepRemainingSeconds $remaining
    Update-ActiveTask -Stage 'phase_e_watchdog_sleep' -Focus "watchdog between cycles; next run in ${remaining}s" -Target 'Autonomous watchdog is idle between validation cycles and will auto-start the next run'
    $slice = [Math]::Min($HeartbeatSeconds, $remaining)
    Start-Sleep -Seconds $slice
    $remaining -= $slice
  }
}

$script:startedAtIso = Now-IsoUtc
$endAt = (Get-Date).AddHours($Hours)
$cycle = 0

try {
  Acquire-Lock
  Prune-OldLogs
  Write-Log "autonomous loop started; hours=$Hours cycle=$CycleSeconds timeout=$RunTimeoutSeconds heartbeat=$HeartbeatSeconds"
  Write-Status -State 'started' -Cycle 0 -Detail 'watchdog booted'
  Update-ActiveTask -Stage 'phase_e_watchdog_boot' -Focus 'detached M2 watchdog booted successfully' -Target 'Autonomous watchdog is online and preparing the first validation cycle'

  while ((Get-Date) -lt $endAt) {
    $cycle += 1
    Invoke-Cycle -Cycle $cycle
    if ((Get-Date) -ge $endAt) {
      break
    }
    Invoke-SleepWindow -Cycle $cycle -EndAt $endAt
  }

  Write-Log 'autonomous loop completed'
  Write-Status -State 'completed' -Cycle $cycle -Detail 'watchdog finished planned run window'
  Update-ActiveTask -Stage 'phase_e_watchdog_done' -Focus 'detached M2 watchdog completed the planned run window' -Target 'Autonomous watchdog completed the planned M2 unattended run window'
}
catch {
  Write-Log "autonomous loop fatal: $($_.Exception.Message)"
  Write-Status -State 'fatal' -Cycle $cycle -Detail $_.Exception.Message
  Update-ActiveTask -Stage 'phase_e_watchdog_fatal' -Focus "detached M2 watchdog fatal error: $($_.Exception.Message)" -Target 'Autonomous watchdog hit a fatal error and needs manual restart'
  throw
}
finally {
  Release-Lock
}
