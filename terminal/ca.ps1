# Claude Assistant en la terminal: los presets de la app, pero con el `claude` de siempre (sin SDK).
#   ca                  menú de presets
#   ca trabajo          abre el preset directamente
#   ca trabajo -Resume  retoma una conversación de ese preset (selector de Claude Code)
param(
  [Parameter(Position = 0)][string]$Preset,
  [switch]$Resume,
  [switch]$Continue,
  [string]$Model,
  [string]$Effort,
  [switch]$DryRun  # solo muestra el comando
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$OutputEncoding = [Text.Encoding]::UTF8

$HOMEDIR = $env:USERPROFILE
$DATA = Join-Path $env:APPDATA 'claude-assistant'
$TMP = Join-Path $env:TEMP 'claude-assistant-terminal'
New-Item -ItemType Directory -Force $TMP | Out-Null

# Mismas notas que main.mjs
$LANGUAGE_NOTE = 'Responde siempre en castellano (español de España), en todas las conversaciones, aunque te escriban, citen o pasen material en otro idioma. El código, los comandos y los nombres técnicos se quedan como son.'
$DESKTOP_NOTE = 'Windows-MCP gasta mucho contexto: úsalo solo cuando no haya otra forma. Antes de un Snapshot, prueba con App, Click o Type; si lo necesitas, limítalo con region a la zona que te interesa y usa use_vision solo si el árbol de la interfaz no basta.'
$CHROME_ASK_NOTE = 'Usa Claude in Chrome (el navegador) solo si el usuario lo pide expresamente o después de preguntarle.'

$MODELS = @(
  @{ id = ''; label = 'Por defecto (el del preset o el general)' },
  @{ id = 'claude-opus-5-5'; label = 'Opus 5.5' },
  @{ id = 'claude-sonnet-5-5'; label = 'Sonnet 5.5' },
  @{ id = 'claude-fable-5-1'; label = 'Fable 5.1' },
  @{ id = 'claude-haiku-4-5-20251001'; label = 'Haiku 4.5' }
)
$EFFORTS = @('', 'low', 'medium', 'high', 'xhigh', 'max')

# ---------- Configuración de la app (solo lectura) ----------
function Read-Json($file) {
  if (-not (Test-Path $file)) { return $null }
  try { return Get-Content -Raw -Encoding UTF8 $file | ConvertFrom-Json } catch { return $null }
}
$config = Read-Json (Join-Path $DATA 'config.json')
if (-not $config) {
  $config = [pscustomobject]@{ cwd = $HOMEDIR; model = ''; effort = ''; permissionMode = 'bypassPermissions'; compactWindow = 200; systemPrompt = ''; presets = @() }
}
$blank = [pscustomobject]@{ id = 'blank'; name = 'En blanco'; emoji = '＋'; color = '#888888'; description = 'Pestaña sin preset'; cwd = $config.cwd; addDirs = @() }
$presets = @($blank) + @($config.presets)

function Get-Prop($obj, $name, $default = '') {
  $v = $obj.PSObject.Properties[$name]
  if ($v -and $null -ne $v.Value -and "$($v.Value)" -ne '') { return $v.Value } else { return $default }
}

# ---------- Cuentas (las de la app) ----------
function Invoke-Accounts([string[]]$cmd) {
  $out = & node (Join-Path $PSScriptRoot 'accounts-cli.mjs') @cmd 2>&1
  if ($LASTEXITCODE -ne 0) { throw ($out -join "`n") }
  return ($out -join '') | ConvertFrom-Json
}
function Get-ActiveAccount {
  try { return @(Invoke-Accounts @('list')) | Where-Object { $_.active } | Select-Object -First 1 } catch { return $null }
}

# ---------- Lanzar una sesión ----------
function Write-Temp($name, $text) {
  $f = Join-Path $TMP $name
  [IO.File]::WriteAllText($f, $text, (New-Object Text.UTF8Encoding $false))
  return $f
}

function Get-ClaudeArgs($p) {
  $a = New-Object System.Collections.Generic.List[string]
  $m = if ($script:Model) { $script:Model } else { Get-Prop $p 'model' (Get-Prop $config 'model') }
  $e = if ($script:Effort) { $script:Effort } else { Get-Prop $p 'effort' (Get-Prop $config 'effort') }
  $perm = Get-Prop $p 'permissionMode' (Get-Prop $config 'permissionMode')
  if ($m) { $a.Add('--model'); $a.Add($m) }
  if ($e) { $a.Add('--effort'); $a.Add($e) }
  if ($perm) { $a.Add('--permission-mode'); $a.Add($perm) }

  # Como la app: la parte fija del prompt de sistema igual en todas las pestañas (se lee de caché)
  $a.Add('--exclude-dynamic-system-prompt-sections')
  $notes = @($LANGUAGE_NOTE, (Get-Prop $config 'systemPrompt'), (Get-Prop $p 'instructions'))
  if ($p.desktop) { $notes += $DESKTOP_NOTE }
  if ($p.chrome -and $p.chromeAsk) { $notes += $CHROME_ASK_NOTE }
  # PowerShell 5.1 rompe las comillas dobles al pasarlas a un .exe
  $append = (($notes | ForEach-Object { "$_".Trim() } | Where-Object { $_ }) -join "`n`n") -replace '"', "'"
  if ($append) { $a.Add('--append-system-prompt'); $a.Add($append) }

  foreach ($d in @(Get-Prop $p 'addDirs' @())) { if ($d -and (Test-Path $d)) { $a.Add('--add-dir'); $a.Add($d) } }
  if ($p.chrome) { $a.Add('--chrome') }

  if ($p.desktop) {
    $uvx = Join-Path $HOMEDIR '.local\bin\uvx.exe'
    if (-not (Test-Path $uvx)) { $uvx = 'uvx' }
    $mcp = @{ mcpServers = @{ 'windows-mcp' = @{ type = 'stdio'; command = $uvx
          args = @('windows-mcp', 'serve', '--exclude-tools', 'Registry,PowerShell,FileSystem,Screenshot')
          env = @{ ANONYMIZED_TELEMETRY = 'false' } } } }
    $a.Add('--mcp-config'); $a.Add((Write-Temp 'windows-mcp.json' ($mcp | ConvertTo-Json -Depth 6)))
  }

  # Presets que no son de programación: sin los plugins de usuario
  if ($p.PSObject.Properties['plugins'] -and $p.plugins -eq $false) {
    $us = Read-Json (Join-Path $HOMEDIR '.claude\settings.json')
    $off = @{}
    if ($us -and $us.enabledPlugins) { foreach ($k in $us.enabledPlugins.PSObject.Properties.Name) { $off[$k] = $false } }
    if ($off.Count) { $a.Add('--settings'); $a.Add((Write-Temp "settings-$($p.id).json" (@{ enabledPlugins = $off } | ConvertTo-Json))) }
  }

  if ($script:Resume) { $a.Add('--resume') } elseif ($script:Continue) { $a.Add('--continue') }
  return , $a
}

# Variables de entorno de la sesión: compactación y cuenta de GitHub del preset
function Get-SessionEnv($p) {
  $envs = @{}
  $cw = [int](Get-Prop $config 'compactWindow' 0)
  if ($cw -gt 0) { $envs['CLAUDE_CODE_AUTO_COMPACT_WINDOW'] = [string]($cw * 1000) }
  $gh = Get-Prop $p 'github'
  if ($gh) {
    $n = [int]("0$env:GIT_CONFIG_COUNT")
    $envs['GIT_CONFIG_COUNT'] = [string]($n + 1)
    $envs["GIT_CONFIG_KEY_$n"] = 'credential.https://github.com.username'
    $envs["GIT_CONFIG_VALUE_$n"] = $gh
    try { $t = (& gh auth token -u $gh 2>$null); if ($LASTEXITCODE -eq 0 -and $t) { $envs['GH_TOKEN'] = "$t".Trim() } } catch {}
  }
  return $envs
}

function Start-Here($p) {
  $cwd = Get-Prop $p 'cwd' $HOMEDIR
  if (-not (Test-Path $cwd)) { Write-Host "No existe $cwd; se abre en $HOMEDIR" -ForegroundColor Yellow; $cwd = $HOMEDIR }
  $claudeArgs = Get-ClaudeArgs $p
  $envs = Get-SessionEnv $p
  $saved = @{}
  foreach ($k in $envs.Keys) { $saved[$k] = [Environment]::GetEnvironmentVariable($k); [Environment]::SetEnvironmentVariable($k, $envs[$k]) }
  $oldTitle = $Host.UI.RawUI.WindowTitle
  $Host.UI.RawUI.WindowTitle = "$($p.emoji) $($p.name)"
  Push-Location $cwd
  try {
    if ($DryRun) { $envs.Keys | ForEach-Object { Write-Host "  $_=$(if ($_ -eq 'GH_TOKEN') { '***' } else { $envs[$_] })" }; Write-Host "[$cwd] claude"; $claudeArgs | ForEach-Object { Write-Host "  $_" } }
    else { & claude @claudeArgs }
  }
  finally {
    Pop-Location
    $Host.UI.RawUI.WindowTitle = $oldTitle
    foreach ($k in $saved.Keys) { [Environment]::SetEnvironmentVariable($k, $saved[$k]) }
  }
}

# Pestaña nueva de Windows Terminal (o ventana nueva si no hay)
function Start-Tab($p) {
  $cwd = Get-Prop $p 'cwd' $HOMEDIR
  if (-not (Test-Path $cwd)) { $cwd = $HOMEDIR }
  $ps = @('powershell', '-NoLogo', '-NoExit', '-ExecutionPolicy', 'Bypass', '-File', $PSCommandPath, $p.id)
  if ($script:Model) { $ps += @('-Model', $script:Model) }
  if ($script:Effort) { $ps += @('-Effort', $script:Effort) }
  if ($script:Resume) { $ps += '-Resume' } elseif ($script:Continue) { $ps += '-Continue' }
  if (Get-Command wt -ErrorAction SilentlyContinue) {
    $color = Get-Prop $p 'color' '#c96442'
    & wt -w 0 nt --title "$($p.emoji) $($p.name)" --suppressApplicationTitle --tabColor $color -d $cwd @ps
  } else {
    Start-Process powershell -WorkingDirectory $cwd -ArgumentList ($ps[1..($ps.Count - 1)] | ForEach-Object { if ($_ -match '\s') { "`"$_`"" } else { $_ } })
  }
}

# ---------- Menús (flechas, números, Enter, Esc) ----------
function Select-Option($title, [string[]]$labels, [int]$index = 0) {
  while ($true) {
    Clear-Host
    Write-Host " $title" -ForegroundColor White
    Write-Host ''
    for ($i = 0; $i -lt $labels.Count; $i++) {
      if ($i -eq $index) { Write-Host (" ❯ {0}. {1}" -f ($i + 1), $labels[$i]) -ForegroundColor Cyan }
      else { Write-Host ("   {0}. {1}" -f ($i + 1), $labels[$i]) }
    }
    Write-Host ''
    Write-Host ' ↑↓ elegir · Enter aceptar · Esc volver' -ForegroundColor DarkGray
    $k = [Console]::ReadKey($true)
    switch ($k.Key) {
      'UpArrow' { $index = ($index - 1 + $labels.Count) % $labels.Count }
      'DownArrow' { $index = ($index + 1) % $labels.Count }
      'Tab' { $index = ($index + 1) % $labels.Count }
      'Enter' { return $index }
      'Escape' { return -1 }
      default {
        $n = [int][char]$k.KeyChar - 48
        if ($n -ge 1 -and $n -le $labels.Count) { return $n - 1 }
      }
    }
  }
}

function Show-Accounts {
  try { $list = @(Invoke-Accounts @('list')) } catch { Write-Host $_ -ForegroundColor Red; [void][Console]::ReadKey($true); return }
  $labels = @($list | ForEach-Object { '{0}{1}{2}{3}' -f $_.email, $(if ($_.plan) { " · $($_.plan)" }), $(if ($_.active) { '  ✔' }), $(if ($_.locked) { '  (volver a iniciar sesión)' }) })
  $labels += 'Iniciar sesión con otra cuenta…'
  $start = [Math]::Max(0, [Array]::FindIndex([object[]]$list, [Predicate[object]] { param($a) $a.active }))
  $i = Select-Option 'Cuenta de Claude' $labels $start
  if ($i -lt 0) { return }
  if ($i -eq $list.Count) {
    # La activa ya quedó guardada al listar; la nueva se guarda la próxima vez que se abra este menú
    & claude auth login --claudeai
    return
  }
  try { $a = Invoke-Accounts @('use', $list[$i].key); Write-Host "Cuenta activa: $($a.email)" -ForegroundColor Green }
  catch { Write-Host $_ -ForegroundColor Red; [void][Console]::ReadKey($true) }
}

function Show-Menu {
  $index = 1
  $account = Get-ActiveAccount
  while ($true) {
    Clear-Host
    $who = if ($account) { "$($account.email)$(if ($account.plan) { " · $($account.plan)" })" } else { 'sin cuenta guardada' }
    Write-Host ' ✻ Claude Assistant · terminal' -ForegroundColor DarkYellow -NoNewline
    Write-Host "   $who" -ForegroundColor DarkGray
    Write-Host ''
    for ($i = 0; $i -lt $presets.Count; $i++) {
      $p = $presets[$i]
      $tags = @()
      $m = Get-Prop $p 'model'; if ($m) { $tags += $m }
      if ($p.chrome) { $tags += $(if ($p.chromeAsk) { 'Chrome · pregunta' } else { 'Chrome' }) }
      if ($p.desktop) { $tags += 'Apps' }
      $gh = Get-Prop $p 'github'; if ($gh) { $tags += "gh:$gh" }
      $line = '{0}. {1} {2}' -f ($i + 1), $p.emoji, $p.name
      if ($i -eq $index) { Write-Host " ❯ $line" -ForegroundColor Cyan -NoNewline } else { Write-Host "   $line" -NoNewline }
      Write-Host ("  {0}{1}" -f (Get-Prop $p 'description'), $(if ($tags) { "  [$($tags -join ', ')]" })) -ForegroundColor DarkGray
    }
    Write-Host ''
    $opts = @()
    $opts += "modelo: $(if ($script:Model) { $script:Model } else { 'del preset' })"
    $opts += "effort: $(if ($script:Effort) { $script:Effort } else { 'del preset' })"
    $opts += "retomar: $(if ($script:Resume) { 'elegir conversación' } elseif ($script:Continue) { 'la última' } else { 'no' })"
    Write-Host " $($opts -join ' · ')" -ForegroundColor DarkGray
    Write-Host ' ↑↓/número elegir · Enter aquí · T pestaña nueva · M modelo · E effort · R retomar · C cuenta · Esc salir' -ForegroundColor DarkGray
    $k = [Console]::ReadKey($true)
    switch ($k.Key) {
      'UpArrow' { $index = ($index - 1 + $presets.Count) % $presets.Count; continue }
      'DownArrow' { $index = ($index + 1) % $presets.Count; continue }
      'Tab' { $index = ($index + 1) % $presets.Count; continue }
      'Escape' { Clear-Host; return }
      'Enter' { Clear-Host; Start-Here $presets[$index]; $account = Get-ActiveAccount; continue }
      'T' { Start-Tab $presets[$index]; continue }
      'M' { $i = Select-Option 'Modelo' ($MODELS | ForEach-Object { $_.label }); if ($i -ge 0) { $script:Model = $MODELS[$i].id }; continue }
      'E' { $i = Select-Option 'Effort' ($EFFORTS | ForEach-Object { if ($_) { $_ } else { 'Por defecto' } }); if ($i -ge 0) { $script:Effort = $EFFORTS[$i] }; continue }
      'R' {
        if ($script:Resume) { $script:Resume = $false; $script:Continue = $true }
        elseif ($script:Continue) { $script:Continue = $false }
        else { $script:Resume = $true }
        continue
      }
      'C' { Show-Accounts; $account = Get-ActiveAccount; continue }
      default {
        $n = [int][char]$k.KeyChar - 48
        if ($n -ge 1 -and $n -le $presets.Count) { $index = $n - 1 }
      }
    }
  }
}

if ($Preset) {
  $p = $presets | Where-Object { $_.id -eq $Preset -or $_.name -eq $Preset } | Select-Object -First 1
  if (-not $p) { Write-Host "No hay ningún preset «$Preset». Hay: $(($presets | ForEach-Object { $_.id }) -join ', ')" -ForegroundColor Red; exit 1 }
  Start-Here $p
} else {
  Show-Menu
}

