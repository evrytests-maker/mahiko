#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
function loadTypeScript() {
  for (const candidate of [
    "typescript",
    "/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript",
    "/usr/local/slides_js/node_modules/typescript",
  ]) {
    try { return require(candidate); } catch { /* continue */ }
  }
  throw new Error("TypeScript compiler API is unavailable");
}

const ts = loadTypeScript();
const sourceRoot = path.resolve(process.argv[2] ?? ".");
const outDir = path.resolve(process.argv[3] ?? path.join(sourceRoot, "artifacts/verification/browser-build/current"));
const reactChunk = "/opt/pyvenv/lib/python3.13/site-packages/notebook/static/7378.df12091e8f42a5da0429.js";
const reactDomChunk = "/opt/pyvenv/lib/python3.13/site-packages/notebook/static/1542.8f0b79431f7af2f43f1e.js";

for (const file of [reactChunk, reactDomChunk]) {
  if (!fs.existsSync(file)) throw new Error(`Verification runtime asset is missing: ${file}`);
}

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(absolute) : [absolute];
  });
}

const sources = [path.join(sourceRoot, "src/renderer"), path.join(sourceRoot, "src/shared")]
  .filter(fs.existsSync)
  .flatMap(walk)
  .filter((file) => /\.(ts|tsx)$/.test(file))
  .filter((file) => !/\.test\.(ts|tsx)$/.test(file))
  .filter((file) => !file.endsWith(".d.ts"))
  .filter((file) => !file.includes(`${path.sep}test${path.sep}`));

const modules = [];
const diagnostics = [];
for (const file of sources) {
  const id = path.relative(sourceRoot, file).split(path.sep).join("/").replace(/\.(ts|tsx)$/, "");
  const source = fs.readFileSync(file, "utf8");
  const output = ts.transpileModule(source, {
    fileName: file,
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      moduleResolution: ts.ModuleResolutionKind.Node10,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
      isolatedModules: true,
      removeComments: false,
    },
  });
  for (const diagnostic of output.diagnostics ?? []) {
    if (diagnostic.category === ts.DiagnosticCategory.Error) diagnostics.push(`${file}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")}`);
  }
  modules.push(`${JSON.stringify(id)}: function(module, exports, require) {\n${output.outputText}\n//# sourceURL=${id}.js\n}`);
}

if (diagnostics.length) throw new Error(`TypeScript transpilation failed:\n${diagnostics.join("\n")}`);

const appBundle = `(() => {\n"use strict";\nconst modules = {\n${modules.join(",\n")}\n};\nconst cache = Object.create(null);\nconst normalize = (value) => {\n  const parts = [];\n  for (const part of value.split("/")) {\n    if (!part || part === ".") continue;\n    if (part === "..") parts.pop(); else parts.push(part);\n  }\n  return parts.join("/").replace(/\\.(js|jsx|ts|tsx)$/, "");\n};\nconst dirname = (value) => value.split("/").slice(0, -1).join("/");\nfunction load(id, parent = "") {\n  if (id === "react") return window.__verificationReact;\n  if (id === "react-dom/client") return window.__verificationReactDOM;\n  if (id === "react/jsx-runtime") return window.__verificationJsxRuntime;\n  if (id.endsWith(".css")) return {};\n  const resolved = id.startsWith(".") ? normalize(dirname(parent) + "/" + id) : normalize(id);\n  if (!modules[resolved]) throw new Error("Browser verification bundle cannot resolve " + id + " from " + parent + " (" + resolved + ")");\n  if (cache[resolved]) return cache[resolved].exports;\n  const module = { exports: {} };\n  cache[resolved] = module;\n  modules[resolved](module, module.exports, (request) => load(request, resolved));\n  return module.exports;\n}\nwindow.__verificationRequire = load;\nload("src/renderer/main");\n})();\n`;
fs.writeFileSync(path.join(outDir, "app.js"), appBundle);
fs.copyFileSync(path.join(sourceRoot, "src/renderer/styles.css"), path.join(outDir, "styles.css"));
fs.copyFileSync(reactChunk, path.join(outDir, "react.chunk.js"));
fs.copyFileSync(reactDomChunk, path.join(outDir, "react-dom.chunk.js"));

const html = `<!doctype html>\n<html lang="ru">\n<head>\n<meta charset="UTF-8" />\n<meta name="viewport" content="width=device-width, initial-scale=1.0" />\n<title>ma-hi-ko verification</title>\n<link rel="stylesheet" href="./styles.css" />\n</head>\n<body>\n<div id="root"></div>\n<script>\nwindow.__capturedConsoleErrors = [];\nwindow.addEventListener("error", event => window.__capturedConsoleErrors.push(String(event.error?.stack || event.message)));\nwindow.addEventListener("unhandledrejection", event => window.__capturedConsoleErrors.push(String(event.reason?.stack || event.reason)));\nconst registry = Object.create(null);\nconst chunks = [];\nchunks.push = function(payload) { Object.assign(registry, payload[1]); return Array.prototype.push.call(this, payload); };\nself.webpackChunk_JUPYTERLAB_CORE_OUTPUT = chunks;\nwindow.__verificationWebpackRegistry = registry;\n</script>\n<script src="./react.chunk.js"></script>\n<script src="./react-dom.chunk.js"></script>\n<script>\nconst cache = Object.create(null);\nfunction webpackRequire(id) {\n  if (id === 78156) id = 27378;\n  if (cache[id]) return cache[id].exports;\n  const factory = window.__verificationWebpackRegistry[id];\n  if (!factory) throw new Error("Missing verification webpack module " + id);\n  const module = { exports: {} };\n  cache[id] = module;\n  factory(module, module.exports, webpackRequire);\n  return module.exports;\n}\nconst React = webpackRequire(27378);\nconst ReactDOM = webpackRequire(31542);\nfunction jsx(type, props, key) {\n  const next = key === undefined ? props : Object.assign({}, props, { key });\n  return React.createElement(type, next);\n}\nwindow.__verificationReact = React;\nwindow.__verificationReactDOM = ReactDOM;\nwindow.__verificationJsxRuntime = { Fragment: React.Fragment, jsx, jsxs: jsx };\n</script>\n<script src="./app.js"></script>\n</body>\n</html>\n`;
fs.writeFileSync(path.join(outDir, "index.html"), html);
fs.writeFileSync(path.join(outDir, "build-meta.json"), JSON.stringify({ sourceRoot, modules: sources.length, reactRuntime: "18.2.0 JupyterLab verification asset" }, null, 2));
console.log(`Built browser verification bundle: ${outDir} (${sources.length} modules)`);
