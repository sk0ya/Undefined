import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const webDir = resolve(scriptDir, "..");
const viteBin = resolve(webDir, "node_modules", ".bin", process.platform === "win32" ? "vite.cmd" : "vite");
const hostPort = Number(process.env.REQGAME_HOST_PORT || 5173);
if (!Number.isInteger(hostPort) || hostPort < 1 || hostPort > 65_535) {
  console.error("[host] REQGAME_HOST_PORT は1〜65535の整数で指定してください");
  process.exit(1);
}

const children = [
  spawn(viteBin, ["--host", "localhost", "--port", String(hostPort), "--strictPort"], {
    cwd: webDir,
    stdio: "inherit",
    windowsHide: true,
    shell: process.platform === "win32",
  }),
  spawn(process.execPath, [resolve(scriptDir, "codex-bridge.mjs"), `--origin=http://localhost:${hostPort}`], {
    cwd: webDir,
    stdio: "inherit",
    windowsHide: true,
  }),
];

let shuttingDown = false;
function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (child.killed || child.exitCode !== null) continue;
    if (process.platform === "win32") {
      try {
        execFileSync(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", `taskkill /PID ${child.pid} /T /F`], {
          stdio: "ignore",
        });
      } catch {
        // 終了済みの子プロセスならtaskkillが失敗しても問題ない。
      }
    } else {
      child.kill("SIGTERM");
    }
  }
  process.exitCode = code;
}

for (const child of children) {
  child.once("error", (error) => {
    console.error(`[host] 起動に失敗しました: ${error.message}`);
    shutdown(1);
  });
  child.once("exit", (code, signal) => {
    if (shuttingDown) return;
    const reason = signal ? `signal ${signal}` : `exit ${code ?? 1}`;
    console.error(`[host] 子プロセスが終了しました(${reason})`);
    shutdown(code ?? 1);
  });
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => shutdown(0));
}
