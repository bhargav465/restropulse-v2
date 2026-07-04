import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DEFAULT_PORTS = getDefaultPorts();

function getDefaultPorts() {
  try {
    const configPath = resolve(process.cwd(), 'config', 'ports.json');
    const raw = readFileSync(configPath, 'utf8');
    const config = JSON.parse(raw);
    const ports = [config.web, config.api, config.publisher]
      .map((value) => Number.parseInt(String(value), 10))
      .filter((value) => Number.isInteger(value) && value > 0);

    if (ports.length > 0) {
      return [...new Set(ports)];
    }
  } catch {
  }

  return [3000, 3001, 3002];
}

function parseArgs() {
  const args = process.argv.slice(2);
  const mode = args.includes('--force') ? 'force' : 'check';

  const cliPorts = args
    .filter((value) => !value.startsWith('--'))
    .map((value) => Number.parseInt(value, 10))
    .filter((value) => Number.isInteger(value) && value > 0);

  if (cliPorts.length > 0) {
    return { mode, ports: [...new Set(cliPorts)] };
  }

  if (process.env.PORTS) {
    const envPorts = process.env.PORTS.split(',')
      .map((value) => Number.parseInt(value.trim(), 10))
      .filter((value) => Number.isInteger(value) && value > 0);

    if (envPorts.length > 0) {
      return { mode, ports: [...new Set(envPorts)] };
    }
  }

  return { mode, ports: DEFAULT_PORTS };
}

function getPidsForPortWindows(port) {
  try {
    const output = execSync(`netstat -ano -p tcp | findstr ":${port} " | findstr LISTENING`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });

    const pids = output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => line.split(/\s+/))
      .filter((parts) => parts.length >= 5)
      .map((parts) => Number.parseInt(parts[4], 10))
      .filter((pid) => Number.isInteger(pid) && pid > 0);

    return [...new Set(pids)];
  } catch {
    return [];
  }
}

function getParentPidWindows(pid) {
  // On Windows the process listening on the port is the leaf node.js server.
  // Its parent is tsx watch, which will immediately respawn the server if we
  // only kill the leaf. Kill the parent instead so tsx cannot respawn.

  // Primary: WMIC — more reliable than PowerShell .Parent on all Windows versions.
  try {
    const output = execSync(
      `wmic process where "ProcessId=${pid}" get ParentProcessId /format:value`,
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 },
    );
    const match = output.match(/ParentProcessId=(\d+)/i);
    if (match) {
      const parentPid = Number.parseInt(match[1], 10);
      // Exclude system PIDs (0, 4 = System) and self
      if (Number.isInteger(parentPid) && parentPid > 4 && parentPid !== pid) {
        return parentPid;
      }
    }
  } catch {}

  // Fallback: PowerShell .Parent.Id
  try {
    const output = execSync(
      `powershell -NoProfile -NonInteractive -Command "(Get-Process -Id ${pid} -ErrorAction Stop).Parent.Id"`,
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 },
    );
    const parentPid = Number.parseInt(output.trim(), 10);
    if (Number.isInteger(parentPid) && parentPid > 4 && parentPid !== pid) {
      return parentPid;
    }
  } catch {}

  return null;
}

function killPidWindows(pid, port) {
  // Kill the parent of the port-holding process (tsx watch) rather than
  // the leaf, so tsx cannot respawn a new server before mprocs starts.
  // Fall back to killing the leaf directly if parent lookup fails.
  const parentPid = getParentPidWindows(pid);
  const targetPid = parentPid ?? pid;

  try {
    execSync(`taskkill /PID ${targetPid} /F /T`, { stdio: 'ignore' });
    if (parentPid) {
      console.log(`[ports] Stopped PID ${targetPid} (tsx parent of server ${pid}, and children) on port ${port}`);
    } else {
      console.log(`[ports] Stopped PID ${targetPid} (and children) on port ${port}`);
    }
  } catch {
    // Parent kill failed (e.g. it already exited) — fall back to the leaf
    if (parentPid) {
      try {
        execSync(`taskkill /PID ${pid} /F /T`, { stdio: 'ignore' });
        console.log(`[ports] Stopped PID ${pid} (and children) on port ${port}`);
      } catch {
        console.log(`[ports] Failed to stop PID ${pid} on port ${port}`);
      }
    } else {
      console.log(`[ports] Failed to stop PID ${pid} on port ${port}`);
    }
  }
}

function getPidsForPortUnix(port) {
  try {
    const output = execSync(`lsof -ti tcp:${port}`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });

    return output
      .split(/\r?\n/)
      .map((line) => Number.parseInt(line.trim(), 10))
      .filter((pid) => Number.isInteger(pid) && pid > 0);
  } catch {
    return [];
  }
}

function killPidUnix(pid, port) {
  try {
    process.kill(pid, 'SIGKILL');
    console.log(`[ports] Stopped PID ${pid} on port ${port}`);
  } catch {
    console.log(`[ports] Failed to stop PID ${pid} on port ${port}`);
  }
}

function getPidsForPort(port) {
  return process.platform === 'win32'
    ? getPidsForPortWindows(port)
    : getPidsForPortUnix(port);
}

function killPid(pid, port) {
  if (process.platform === 'win32') {
    killPidWindows(pid, port);
  } else {
    killPidUnix(pid, port);
  }
}

function killMprocs() {
  // Kill any running mprocs instance before freeing ports so mprocs cannot
  // restart its children between the kill step and the new mprocs launch.
  try {
    if (process.platform === 'win32') {
      execSync('taskkill /IM mprocs.exe /F /T', { stdio: 'ignore' });
    } else {
      execSync('pkill -x mprocs', { stdio: 'ignore' });
    }
    console.log('[ports] Stopped running mprocs instance');
  } catch {
    // mprocs was not running — nothing to do
  }
}

function killOrphanedDevProcesses() {
  // Kill all tsx-related node.exe processes that accumulated as orphans from
  // previous dev sessions. When mprocs exits (e.g. via Ctrl+C), its child
  // processes (cmd.exe -> npm -> tsx watch -> server) are left running.
  // Multiple orphaned tsx watch instances all race to respawn API servers on
  // the same port, causing persistent EADDRINUSE even after port-based kills.
  // Wiping them all upfront — before touching ports — breaks the respawn loop.
  if (process.platform === 'win32') {
    try {
      const output = execSync(
        `wmic process where "name='node.exe' and CommandLine like '%tsx%'" get ProcessId /format:value`,
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10000 },
      );
      const pids = [...output.matchAll(/ProcessId=(\d+)/gi)]
        .map((m) => Number.parseInt(m[1], 10))
        .filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid);

      if (pids.length > 0) {
        console.log(`[ports] Killing ${pids.length} orphaned tsx process(es): ${pids.join(', ')}`);
        for (const pid of pids) {
          try {
            execSync(`taskkill /PID ${pid} /F /T`, { stdio: 'ignore' });
          } catch {}
        }
        console.log('[ports] Orphaned tsx processes cleared');
      }
    } catch {
      // WMIC unavailable or failed — port-based kill is the fallback
    }
  } else {
    try {
      execSync('pkill -f "tsx.*watch"', { stdio: 'ignore' });
      console.log('[ports] Orphaned tsx processes cleared');
    } catch {
      // pkill exits non-zero when nothing matched — not an error
    }
  }
}

function checkPorts(ports) {
  let hasConflicts = false;

  for (const port of ports) {
    const pids = getPidsForPort(port);
    if (pids.length === 0) {
      console.log(`[ports] Port ${port} is free`);
      continue;
    }

    hasConflicts = true;
    console.log(`[ports] Port ${port} is in use by PID(s): ${pids.join(', ')}`);
  }

  if (hasConflicts) {
    console.log('[ports] Conflicts found. Re-run with --force to stop listed PIDs.');
    process.exitCode = 1;
  } else {
    console.log('[ports] All requested ports are free.');
  }
}

function waitOneSecond() {
  // Cross-platform 1-second busy-wait using a synchronous ping/sleep.
  // 'ping -n 2' sends two ICMP packets ~1s apart on Windows.
  // On Unix, 'sleep 1' is available.
  try {
    if (process.platform === 'win32') {
      execSync('ping -n 2 127.0.0.1 > nul 2>&1', { stdio: 'ignore', shell: true });
    } else {
      execSync('sleep 1', { stdio: 'ignore' });
    }
  } catch {
    // ignore
  }
}

function freePorts(ports) {
  // Up to 3 rounds per port: kill, wait ~1s, re-check.
  // This catches the tsx-watch respawn case where killing the leaf process
  // causes tsx to immediately spawn a new server that re-occupies the port
  // before mprocs starts. Each round kills whoever is on the port, including
  // the freshly-respawned server.
  for (const port of ports) {
    let freed = false;

    for (let attempt = 1; attempt <= 3; attempt++) {
      const pids = getPidsForPort(port);

      if (pids.length === 0) {
        if (attempt === 1) {
          console.log(`[ports] Port ${port} is already free`);
        } else {
          console.log(`[ports] Port ${port} confirmed free after ${attempt - 1} kill round(s)`);
        }
        freed = true;
        break;
      }

      console.log(`[ports] Round ${attempt}: killing PID(s) ${pids.join(', ')} on port ${port}`);
      for (const pid of pids) {
        killPid(pid, port);
      }

      if (attempt < 3) {
        // Wait ~1s so tsx-watch has time to respawn before we re-check.
        waitOneSecond();
      }
    }

    if (!freed) {
      // Final check after the last round of kills.
      const remaining = getPidsForPort(port);
      if (remaining.length === 0) {
        console.log(`[ports] Port ${port} confirmed free after 3 kill rounds`);
      } else {
        console.log(`[ports] Warning: port ${port} still in use by PID(s) ${remaining.join(', ')} after 3 rounds`);
      }
    }
  }
}

const { mode, ports } = parseArgs();
console.log(`[ports] Mode: ${mode}`);
console.log(`[ports] Checking ports: ${ports.join(', ')}`);

if (mode === 'force') {
  killMprocs();
  killOrphanedDevProcesses();
  freePorts(ports);
} else {
  checkPorts(ports);
}
