# Ayudante de Job Objects de Windows para Claude Assistant.
# Cada pestaña tiene su "job": el proceso de Claude Code entra en él y todo lo que lance
# (shells, servidores de desarrollo, ventanas abiertas con Start-Process…) queda dentro.
# Al cerrar la pestaña se termina el job entero. Si este ayudante muere (la app se cierra),
# Windows cierra los jobs y mata esos procesos (KILL_ON_JOB_CLOSE).
#
# Protocolo por stdin, una orden por línea:  add <clave> <pid>  |  kill <clave>  |  count <clave>
# Responde una línea por orden: ok | none | <número> | err <detalle>

$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public static class ClaudeJobs {
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern IntPtr CreateJobObject(IntPtr attributes, string name);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool SetInformationJobObject(IntPtr job, int infoClass, IntPtr info, uint length);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool QueryInformationJobObject(IntPtr job, int infoClass, IntPtr info, uint length, IntPtr returned);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool TerminateJobObject(IntPtr job, uint exitCode);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool CloseHandle(IntPtr handle);

  const int JobObjectBasicAccountingInformation = 1;
  const int JobObjectExtendedLimitInformation = 9;
  const int JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000;
  const uint PROCESS_SET_QUOTA = 0x0100;
  const uint PROCESS_TERMINATE = 0x0001;

  static readonly Dictionary<string, IntPtr> jobs = new Dictionary<string, IntPtr>();

  public static string Add(string key, int pid) {
    IntPtr job;
    if (!jobs.TryGetValue(key, out job)) {
      job = CreateJobObject(IntPtr.Zero, null);
      if (job == IntPtr.Zero) return "err create " + Marshal.GetLastWin32Error();
      // JOBOBJECT_EXTENDED_LIMIT_INFORMATION: 144 bytes en x64; LimitFlags está en el desplazamiento 16
      int size = IntPtr.Size == 8 ? 144 : 112;
      IntPtr info = Marshal.AllocHGlobal(size);
      try {
        for (int i = 0; i < size; i++) Marshal.WriteByte(info, i, 0);
        Marshal.WriteInt32(info, 16, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE);
        if (!SetInformationJobObject(job, JobObjectExtendedLimitInformation, info, (uint)size))
          return "err setinfo " + Marshal.GetLastWin32Error();
      } finally { Marshal.FreeHGlobal(info); }
      jobs[key] = job;
    }
    IntPtr process = OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, false, pid);
    if (process == IntPtr.Zero) return "err open " + Marshal.GetLastWin32Error();
    bool ok = AssignProcessToJobObject(job, process);
    int error = Marshal.GetLastWin32Error();
    CloseHandle(process);
    return ok ? "ok" : "err assign " + error;
  }

  // Procesos vivos dentro del job (JOBOBJECT_BASIC_ACCOUNTING_INFORMATION.ActiveProcesses, desplazamiento 40)
  public static string Count(string key) {
    IntPtr job;
    if (!jobs.TryGetValue(key, out job)) return "0";
    IntPtr info = Marshal.AllocHGlobal(48);
    try {
      if (!QueryInformationJobObject(job, JobObjectBasicAccountingInformation, info, 48, IntPtr.Zero)) return "err query " + Marshal.GetLastWin32Error();
      return Marshal.ReadInt32(info, 40).ToString();
    } finally { Marshal.FreeHGlobal(info); }
  }

  public static string Kill(string key) {
    IntPtr job;
    if (!jobs.TryGetValue(key, out job)) return "none";
    TerminateJobObject(job, 1);
    CloseHandle(job);
    jobs.Remove(key);
    return "ok";
  }
}
"@

[Console]::Out.WriteLine('ready')
[Console]::Out.Flush()

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }   # la app se ha cerrado: al salir, Windows cierra los jobs
  $parts = $line.Trim() -split '\s+'
  try {
    switch ($parts[0]) {
      'add'   { $out = [ClaudeJobs]::Add($parts[1], [int]$parts[2]) }
      'kill'  { $out = [ClaudeJobs]::Kill($parts[1]) }
      'count' { $out = [ClaudeJobs]::Count($parts[1]) }
      default { $out = 'err orden desconocida' }
    }
  } catch { $out = 'err ' + $_.Exception.Message }
  [Console]::Out.WriteLine($out)
  [Console]::Out.Flush()
}
