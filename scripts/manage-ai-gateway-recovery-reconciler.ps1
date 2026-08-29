[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [ValidateSet("Install", "Uninstall", "Status", "RunOnce")]
    [string]$Mode = "Install",

    [string]$TaskName = "ClassroomAnswerToolkit-AiGatewayRecovery",

    [switch]$StartNow
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$reconcilerPath = Join-Path $repositoryRoot "tools\ai-gateway\recovery-reconciler.mjs"
$envFile = Join-Path $repositoryRoot ".env"

function Get-NodeExecutable {
    $command = Get-Command node -CommandType Application -ErrorAction Stop | Select-Object -First 1
    if (-not (Test-Path -LiteralPath $command.Source -PathType Leaf)) {
        throw "Node executable does not exist: $($command.Source)"
    }
    return $command.Source
}

function Assert-ReconcilerInputs {
    if (-not (Test-Path -LiteralPath $reconcilerPath -PathType Leaf)) {
        throw "Recovery reconciler was not found: $reconcilerPath"
    }
    if (-not (Test-Path -LiteralPath $envFile -PathType Leaf)) {
        throw "Local gateway configuration was not found: $envFile"
    }
}

function Get-ReconcilerTask {
    return Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
}

function Show-TaskStatus {
    $task = Get-ReconcilerTask
    if ($null -eq $task) {
        [pscustomobject]@{
            taskName = $TaskName
            installed = $false
            state = "absent"
        }
        return
    }

    $info = Get-ScheduledTaskInfo -TaskName $TaskName
    # A pinned node.exe path breaks silently after an nvm version switch; the
    # recurring 0x1 result then looks like a gateway failure instead.
    $nodeExecutablePath = ($task.Actions | Select-Object -First 1).Execute
    $nodeExecutablePresent = [string]::IsNullOrEmpty($nodeExecutablePath) -or (Test-Path -LiteralPath $nodeExecutablePath -PathType Leaf)
    [pscustomobject]@{
        taskName = $TaskName
        installed = $true
        state = $task.State.ToString()
        nextRunTime = $info.NextRunTime
        lastRunTime = $info.LastRunTime
        lastTaskResult = $info.LastTaskResult
        nodeExecutable = $nodeExecutablePath
        nodeExecutablePresent = $nodeExecutablePresent
    }
    if (-not $nodeExecutablePresent) {
        Write-Warning "Configured node.exe no longer exists: $nodeExecutablePath. Reinstall the task (e.g. -Mode Install) after switching Node versions."
    }
}

switch ($Mode) {
    "Status" {
        Show-TaskStatus | Format-List
        return
    }
    "Uninstall" {
        $existing = Get-ReconcilerTask
        if ($null -eq $existing) {
            Write-Host "Recovery reconciler task is already absent: $TaskName"
            return
        }
        if ($PSCmdlet.ShouldProcess($TaskName, "Unregister scheduled recovery reconciler")) {
            Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
            Write-Host "Recovery reconciler task removed: $TaskName"
        }
        return
    }
    "RunOnce" {
        Assert-ReconcilerInputs
        $nodeExecutable = Get-NodeExecutable
        & $nodeExecutable $reconcilerPath "--config-env-file" $envFile "--allow-cloud-egress" "--once" "--json"
        if ($LASTEXITCODE -ne 0) {
            throw "Recovery reconciler exited with code $LASTEXITCODE."
        }
        return
    }
    "Install" {
        Assert-ReconcilerInputs
        $nodeExecutable = Get-NodeExecutable
        & $nodeExecutable "--check" $reconcilerPath
        if ($LASTEXITCODE -ne 0) {
            throw "Recovery reconciler syntax validation exited with code $LASTEXITCODE."
        }

        $arguments = '"{0}" --config-env-file "{1}" --allow-cloud-egress --once --json' -f $reconcilerPath, $envFile
        $action = New-ScheduledTaskAction -Execute $nodeExecutable -Argument $arguments -WorkingDirectory $repositoryRoot
        $trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1) -RepetitionDuration (New-TimeSpan -Days 365)
        # A probe round is bounded by connection count x RECOVERY_PROBE_TIMEOUT_MS
        # (the timeout allows up to 120s each), so a 2-minute limit would start
        # killing legitimate rounds once a fallback connection is configured.
        # IgnoreNew already prevents overlap while a long round is running.
        $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 10) -MultipleInstances IgnoreNew -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
        $currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
        # S4U (batch logon) keeps the per-minute node.exe console out of the
        # interactive desktop; the reconciler only needs local state + egress.
        $principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType S4U -RunLevel Limited

        if ($PSCmdlet.ShouldProcess($TaskName, "Install or update current-user recovery reconciler task")) {
            Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description "Runs Classroom Answer Toolkit Sol recovery reconciliation once per minute; outbound probe cadence remains gateway-controlled." -Force | Out-Null
            Write-Host "Recovery reconciler task installed: $TaskName"
        }
        if ($StartNow -and $PSCmdlet.ShouldProcess($TaskName, "Start recovery reconciler task now")) {
            Start-ScheduledTask -TaskName $TaskName
            Write-Host "Recovery reconciler task started: $TaskName"
        }
        Show-TaskStatus | Format-List
    }
}
