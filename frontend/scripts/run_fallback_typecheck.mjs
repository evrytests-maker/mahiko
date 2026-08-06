#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const rootPath = decodeURIComponent(new URL("../", import.meta.url).pathname);
const reportDir = join(rootPath, "artifacts/verification/fallback-typecheck");
const tempRoot = await mkdtemp(join(tmpdir(), "ma-hi-ko-typecheck-"));
const typeRoot = join(tempRoot, "types");
await mkdir(join(typeRoot, "react"), { recursive: true });
await mkdir(join(typeRoot, "react-dom"), { recursive: true });
await mkdir(join(typeRoot, "electron"), { recursive: true });

await writeFile(join(typeRoot, "react", "index.d.ts"), `
declare namespace React {
  type ReactNode = any;
}
declare module "react" {
  export namespace JSX {
    type Element = any;
    interface IntrinsicAttributes { key?: string | number; }
    interface IntrinsicElements { [name: string]: any; }
  }
  export type ReactNode = any;
  export type CSSProperties = Record<string, string | number | undefined>;
  export type SetStateAction<S> = S | ((previous: S) => S);
  export type Dispatch<A> = (value: A) => void;
  export interface ChangeEvent<T = Element> { currentTarget: T; target: T; }
  export interface FormEvent<T = Element> { preventDefault(): void; currentTarget: T; target: EventTarget; }
  export interface KeyboardEvent<T = Element> { key: string; preventDefault(): void; currentTarget: T; target: EventTarget; }
  export function useState<S>(initial: S | (() => S)): [S, Dispatch<SetStateAction<S>>];
  export function useState<S = undefined>(): [S | undefined, Dispatch<SetStateAction<S | undefined>>];
  export function useRef<T>(initial: T): { current: T };
  export function useRef<T>(initial: T | null): { current: T | null };
  export function useEffect(effect: () => void | (() => void) | undefined, dependencies?: readonly unknown[]): void;
  export function useLayoutEffect(effect: () => void | (() => void) | undefined, dependencies?: readonly unknown[]): void;
  export function useMemo<T>(factory: () => T, dependencies: readonly unknown[]): T;
  export function useCallback<T extends (...args: any[]) => any>(callback: T, dependencies: readonly unknown[]): T;
  export const StrictMode: any;
}
declare module "react/jsx-runtime" {
  export namespace JSX {
    type Element = any;
    interface IntrinsicAttributes { key?: string | number; }
    interface IntrinsicElements { [name: string]: any; }
  }
  export const Fragment: any;
  export const jsx: any;
  export const jsxs: any;
}
`, "utf8");

await writeFile(join(typeRoot, "react-dom", "index.d.ts"), `
declare module "react-dom/client" {
  export function createRoot(element: Element): { render(node: any): void };
}
`, "utf8");

await writeFile(join(typeRoot, "electron", "index.d.ts"), `
declare module "electron" {
  export interface NavigationEvent { preventDefault(): void; }
  export interface WebContents {
    setWindowOpenHandler(handler: (details: { url: string }) => { action: "deny" | "allow" }): void;
    on(event: "will-navigate", handler: (event: NavigationEvent, url: string) => void): void;
    getURL(): string;
  }
  export class BrowserWindow {
    constructor(options: any);
    static getAllWindows(): BrowserWindow[];
    webContents: WebContents;
    once(event: "ready-to-show", handler: () => void): void;
    on(event: "closed", handler: () => void): void;
    show(): void;
    setMenuBarVisibility(visible: boolean): void;
    loadURL(url: string): Promise<void>;
    loadFile(path: string): Promise<void>;
  }
  export const Menu: { setApplicationMenu(menu: unknown): void };
  export const app: {
    isPackaged: boolean;
    getPath(name: string): string;
    getVersion(): string;
    whenReady(): Promise<void>;
    on(event: string, handler: (...args: any[]) => void): void;
    quit(): void;
  };
  export const shell: { openExternal(url: string): Promise<void> };
  export const clipboard: { writeText(text: string): void };
  export const dialog: { showOpenDialog(options: any): Promise<{ canceled: boolean; filePaths: string[] }> };
  export const ipcMain: {
    removeHandler(channel: string): void;
    handle(channel: string, handler: (event: unknown, ...args: unknown[]) => unknown): void;
  };
  export const contextBridge: { exposeInMainWorld(key: string, value: unknown): void };
  export const ipcRenderer: { invoke(channel: string, ...args: unknown[]): Promise<any> };
}
`, "utf8");

const rendererConfig = {
  compilerOptions: {
    target: "ES2022",
    useDefineForClassFields: true,
    lib: ["ES2022", "DOM", "DOM.Iterable"],
    module: "ESNext",
    moduleResolution: "Bundler",
    resolveJsonModule: true,
    isolatedModules: true,
    esModuleInterop: true,
    jsx: "react-jsx",
    strict: true,
    noUncheckedIndexedAccess: true,
    skipLibCheck: true,
    noEmit: true,
    typeRoots: [typeRoot],
    types: ["react", "react-dom"]
  },
  include: [join(rootPath, "src/renderer/**/*.ts"), join(rootPath, "src/renderer/**/*.tsx"), join(rootPath, "src/shared/**/*.ts"), join(tempRoot, "renderer-globals.d.ts")],
  exclude: [join(rootPath, "src/**/*.test.ts"), join(rootPath, "src/**/*.test.tsx"), join(rootPath, "src/renderer/test/**")]
};
const nodeConfig = {
  compilerOptions: {
    target: "ES2022",
    lib: ["ES2022"],
    module: "CommonJS",
    moduleResolution: "Node",
    strict: true,
    esModuleInterop: true,
    skipLibCheck: true,
    noEmit: true,
    typeRoots: [typeRoot, "/usr/local/slides_js/node_modules/@types"],
    types: ["node", "electron"]
  },
  include: [join(rootPath, "src/main/**/*.ts"), join(rootPath, "src/preload/**/*.ts"), join(rootPath, "src/shared/**/*.ts")],
  exclude: [join(rootPath, "src/**/*.test.ts"), join(rootPath, "src/**/*.test.tsx")]
};
const testConfig = {
  compilerOptions: {
    target: "ES2022",
    lib: ["ES2022", "DOM", "DOM.Iterable"],
    module: "ESNext",
    moduleResolution: "Bundler",
    strict: true,
    esModuleInterop: true,
    skipLibCheck: true,
    noEmit: true,
    jsx: "react-jsx",
    noUncheckedIndexedAccess: true,
    typeRoots: [typeRoot, "/usr/local/slides_js/node_modules/@types"],
    types: ["node", "react", "react-dom", "electron"]
  },
  include: [join(rootPath, "src/**/*.test.ts"), join(rootPath, "src/**/*.test.tsx"), join(rootPath, "src/renderer/test/**/*.ts"), join(rootPath, "src/**/*.ts"), join(rootPath, "src/**/*.tsx"), join(tempRoot, "renderer-globals.d.ts"), join(tempRoot, "test-modules.d.ts")]
};
await writeFile(join(tempRoot, "renderer-globals.d.ts"), `declare module "*.css";\n`, "utf8");
await writeFile(join(tempRoot, "test-modules.d.ts"), `
declare module "vitest" {
  export const afterEach: any;
  export const beforeEach: any;
  export const describe: any;
  export const expect: any;
  export const it: any;
  export const vi: any;
}
declare module "@testing-library/react" {
  export const act: any;
  export const cleanup: any;
  export const render: any;
  export const screen: any;
  export const within: any;
}
declare module "@testing-library/user-event" {
  const userEvent: any;
  export default userEvent;
}
declare module "@testing-library/jest-dom/vitest";
`, "utf8");
await writeFile(join(tempRoot, "tsconfig.renderer.json"), JSON.stringify(rendererConfig, null, 2), "utf8");
await writeFile(join(tempRoot, "tsconfig.node.json"), JSON.stringify(nodeConfig, null, 2), "utf8");
await writeFile(join(tempRoot, "tsconfig.tests.json"), JSON.stringify(testConfig, null, 2), "utf8");

const results = [];
for (const [name, config] of [["renderer-shared", "tsconfig.renderer.json"], ["main-preload-shared", "tsconfig.node.json"], ["source-tests-with-temporary-runner-declarations", "tsconfig.tests.json"]]) {
  try {
    const output = execFileSync("tsc", ["-p", join(tempRoot, config), "--pretty", "false"], { cwd: rootPath, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    results.push({ name, status: "pass", output: output.trim() });
  } catch (error) {
    const stdout = typeof error.stdout === "string" ? error.stdout : "";
    const stderr = typeof error.stderr === "string" ? error.stderr : "";
    results.push({ name, status: "fail", output: `${stdout}${stderr}`.trim(), exitCode: error.status ?? 1 });
  }
}

await mkdir(reportDir, { recursive: true });
const report = {
  generatedAt: new Date().toISOString(),
  scope: "Dependency-independent semantic fallback using temporary React/Electron declarations; not a substitute for package-backed npm typecheck.",
  summary: { passed: results.filter((item) => item.status === "pass").length, failed: results.filter((item) => item.status === "fail").length },
  results,
};
await writeFile(join(reportDir, "fallback-typecheck.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
await writeFile(join(reportDir, "fallback-typecheck.txt"), [
  `Fallback semantic typecheck: ${report.summary.passed} passed, ${report.summary.failed} failed`,
  report.scope,
  ...results.map((item) => `${item.status === "pass" ? "PASS" : "FAIL"} ${item.name}${item.output ? `\n${item.output}` : ""}`),
].join("\n"), "utf8");
await rm(tempRoot, { recursive: true, force: true });
console.log(JSON.stringify(report.summary));
if (report.summary.failed) process.exitCode = 1;
