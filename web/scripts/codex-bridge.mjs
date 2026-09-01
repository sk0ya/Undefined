import http from "node:http";
import { spawn } from "node:child_process";

const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const match = process.argv[i].match(/^--([^=]+)(?:=(.*))?$/);
  if (match) args.set(match[1], match[2] ?? process.argv[i + 1] ?? "");
}

const port = Number(args.get("port") || process.env.REQGAME_CODEX_PORT || 8787);
// GitHub Pages等の公開Originを使う場合は --origin=https://example.github.io を指定する。
const allowedOrigin = args.get("origin") || process.env.REQGAME_CODEX_ORIGIN || "http://localhost:5173";
const maxBodyBytes = 256 * 1024;

function responseHeaders(origin, extra = {}) {
  return {
    "Access-Control-Allow-Origin": allowedOrigin === "*" ? "*" : origin === allowedOrigin ? origin : "null",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Cache-Control": "no-store",
    Vary: "Origin",
    ...extra,
  };
}

function send(res, status, body, origin) {
  const payload = JSON.stringify(body);
  res.writeHead(status, responseHeaders(origin, { "Content-Type": "application/json; charset=utf-8" }));
  res.end(payload);
}

function isAllowed(origin) {
  return allowedOrigin === "*" || !origin || origin === allowedOrigin;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBodyBytes) {
        reject(new Error("request body is too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function parseAgentMessage(stdout) {
  let lastMessage = "";
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      if (event.type === "item.completed" && event.item?.type === "agent_message") {
        if (typeof event.item.text === "string") lastMessage = event.item.text;
      }
    } catch {
      // --json以外の行は、最後のフォールバック用に無視する。
    }
  }
  return lastMessage || stdout.trim();
}

function runCodex(prompt) {
  const command = process.platform === "win32" ? "codex.cmd" : "codex";
  const commandArgs = [
    "exec",
    "--ephemeral",
    "--sandbox",
    "read-only",
    "--json",
    "Return only the final answer to the supplied game prompt.",
  ];

  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      cwd: process.cwd(),
      env: process.env,
      // Windowsのnpmコマンドは.cmdシムなのでshell経由で起動する。
      shell: process.platform === "win32",
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => {
      if (error.code === "ENOENT") {
        reject(new Error("codex コマンドが見つかりません。Codex CLIをインストールしてログインしてください"));
      } else {
        reject(error);
      }
    });
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`codex exec が終了コード ${code} で終了しました: ${stderr.trim().slice(-1000)}`));
        return;
      }
      const response = parseAgentMessage(stdout);
      if (!response) reject(new Error("Codexの応答が空です"));
      else resolve(response);
    });
    child.stdin.end(prompt);
  });
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin || "";
  if (!isAllowed(origin)) {
    send(res, 403, { error: "origin is not allowed" }, origin);
    return;
  }
  if (req.method === "OPTIONS") {
    res.writeHead(204, responseHeaders(origin));
    res.end();
    return;
  }
  if (req.method === "GET" && req.url === "/healthz") {
    send(res, 200, { ok: true, service: "reqgame-codex-bridge" }, origin);
    return;
  }
  if (req.method !== "POST" || req.url !== "/run") {
    send(res, 404, { error: "not found" }, origin);
    return;
  }

  try {
    const body = JSON.parse(await readBody(req));
    if (typeof body.prompt !== "string" || !body.prompt.trim()) {
      send(res, 400, { error: "prompt is required" }, origin);
      return;
    }
    const response = await runCodex(body.prompt);
    send(res, 200, { response }, origin);
  } catch (error) {
    send(res, 500, { error: error instanceof Error ? error.message : String(error) }, origin);
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`ReqGame Codex bridge: http://127.0.0.1:${port}`);
  console.log(`Allowed origin: ${allowedOrigin}`);
  console.log("Stop with Ctrl+C");
});
