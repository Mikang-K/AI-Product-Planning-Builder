#!/usr/bin/env node
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { access, readFile, stat, writeFile } from "node:fs/promises";
import { extname, resolve } from "node:path";

import {
  buildBlockedResult,
  buildCodexExecArgs,
  createRunId,
  createRunnerConfig,
  ensureRunDir,
  parseCodexResultText,
  readJson,
  runPaths,
  validateCodexRunRequest,
  normalizeCodexResultForRunner,
  writeJson,
} from "./runner-lib.mjs";

const config = createRunnerConfig({
  workspaceRoot: process.env.WORKSPACE_ROOT || process.cwd(),
  runsDir: process.env.AGENT_RUNS_DIR,
});
const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || 4173);

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
};

const server = createServer(async (req, res) => {
  try {
    await route(req, res);
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
});

server.listen(port, host, () => {
  console.log(`Product Builder Runner listening on http://${host}:${port}`);
});

async function route(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || `${host}:${port}`}`);
  if (url.pathname === "/api/runner/health" && req.method === "GET") {
    return handleHealth(res);
  }
  if (url.pathname === "/api/codex-runs" && req.method === "POST") {
    return handleCreateCodexRun(req, res);
  }
  const runMatch = url.pathname.match(/^\/api\/codex-runs\/([^/]+)(?:\/(logs|result))?$/);
  if (runMatch && req.method === "GET") {
    return handleReadCodexRun(res, runMatch[1], runMatch[2] || "status");
  }
  if (req.method === "GET" || req.method === "HEAD") {
    return serveStatic(req, res, url);
  }
  sendJson(res, 404, { error: "Not found." });
}

async function handleHealth(res) {
  sendJson(res, 200, {
    ok: true,
    runner: "codex-local-runner",
    codexBin: config.codexBin,
    workspaceRoot: config.workspaceRoot,
  });
}

async function handleCreateCodexRun(req, res) {
  const request = validateCodexRunRequest(await readBodyJson(req));
  const runId = createRunId();
  const paths = runPaths(config, runId);
  await ensureRunDir(paths);
  await writeJson(paths.packagePath, request.codexPackage);
  await writeFile(paths.promptPath, request.prompt, "utf8");
  const status = {
    id: runId,
    projectId: request.projectId,
    workItemId: request.workItemId,
    status: "running",
    createdAt: new Date().toISOString(),
    startedAt: new Date().toISOString(),
    completedAt: null,
    error: "",
  };
  await writeJson(paths.statusPath, status);
  runCodexInBackground(request, paths, status);
  sendJson(res, 202, status);
}

async function handleReadCodexRun(res, runId, part) {
  const paths = runPaths(config, runId);
  if (part === "logs") {
    const [stdout, stderr] = await Promise.all([readOptional(paths.stdoutPath), readOptional(paths.stderrPath)]);
    return sendJson(res, 200, { id: runId, stdout, stderr });
  }
  if (part === "result") {
    return sendJson(res, 200, await readJson(paths.resultPath));
  }
  return sendJson(res, 200, await readJson(paths.statusPath));
}

function runCodexInBackground(request, paths, status) {
  const args = buildCodexExecArgs(config, paths, request.packageType);
  const commandText = `${config.codexBin} ${args.join(" ")}`;
  const child = spawn(config.codexBin, args, {
    cwd: config.workspaceRoot,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  child.stdin.end(request.prompt);
  child.stdout.pipe(createWriteStream(paths.stdoutPath, { flags: "a" }));
  child.stderr.pipe(createWriteStream(paths.stderrPath, { flags: "a" }));
  child.on("error", async (error) => {
    await finishRun(paths, status, buildBlockedResult(request.workItemId, error.message, commandText, request.agentRole), "failed", error.message);
  });
  child.on("close", async (code) => {
    try {
      const rawResult = await readFile(paths.resultPath, "utf8");
      const parsed = parseCodexResultText(rawResult);
      const normalized = normalizeCodexResultForRunner(parsed, request.workItemId, request.agentRole);
      normalized.codexEvidence ||= { commands: [], notes: [] };
      normalized.codexEvidence.commands ||= [];
      normalized.codexEvidence.notes ||= [];
      normalized.codexEvidence.commands.push({ command: commandText, status: code === 0 ? "pass" : "failed" });
      if (code !== 0) normalized.codexEvidence.notes.push(`Codex exited with code ${code}.`);
      await finishRun(paths, status, normalized, normalized.status === "blocked" || code !== 0 ? "failed" : "completed", "");
    } catch (error) {
      const blocked = buildBlockedResult(request.workItemId, error.message, commandText, request.agentRole);
      await finishRun(paths, status, blocked, "failed", error.message);
    }
  });
}

async function finishRun(paths, status, result, nextStatus, error) {
  const completedAt = new Date().toISOString();
  await writeJson(paths.resultPath, result);
  await writeJson(paths.statusPath, {
    ...status,
    status: nextStatus,
    completedAt,
    error: error || "",
  });
}

async function serveStatic(req, res, url) {
  const pathname = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  const filePath = resolve(config.workspaceRoot, `.${pathname}`);
  if (!filePath.startsWith(config.workspaceRoot)) {
    return sendText(res, 403, "Forbidden");
  }
  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) return sendText(res, 404, "Not found");
    const type = contentTypes[extname(filePath)] || "application/octet-stream";
    const body = req.method === "HEAD" ? "" : await readFile(filePath);
    res.writeHead(200, {
      "Content-Type": type,
      "Cache-Control": "no-store",
    });
    res.end(body);
  } catch {
    sendText(res, 404, "Not found");
  }
}

async function readBodyJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 5 * 1024 * 1024) throw new Error("Request body is too large.");
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

async function readOptional(filePath) {
  try {
    await access(filePath);
    return await readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

function sendJson(res, statusCode, value) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(value, null, 2));
}

function sendText(res, statusCode, value) {
  res.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
  });
  res.end(value);
}
