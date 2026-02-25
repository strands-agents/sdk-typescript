import { existsSync, lstatSync, rmSync, symlinkSync } from "node:fs";
import { resolve } from "node:path";
import { run, ROOT } from "../run.js";

export interface BuildOptions {
  ts?: boolean;
  wasm?: boolean;
  rs?: boolean;
  py?: boolean;
  release?: boolean;
}

const COMPONENTIZE_JS_LINK = resolve(
  ROOT,
  "node_modules/@bytecodealliance/componentize-js",
);
const COMPONENTIZE_JS_TARGET = "../../../../bytecodealliance/ComponentizeJS";

/**
 * Ensure the local ComponentizeJS fork is symlinked into node_modules.
 *
 * npm install overwrites the symlink with the registry version, so we
 * re-create it before every WASM build. This is a no-op if the symlink
 * already points to the right place.
 */
function ensureComponentizeJsSymlink(): void {
  const targetAbsolute = resolve(ROOT, "node_modules/@bytecodealliance", COMPONENTIZE_JS_TARGET);

  // Already a correct symlink?
  try {
    const stat = lstatSync(COMPONENTIZE_JS_LINK);
    if (stat.isSymbolicLink()) return;
  } catch {
    // doesn't exist — that's fine, we'll create it
  }

  if (!existsSync(targetAbsolute)) {
    console.warn(
      `⚠️  Local ComponentizeJS not found at ${targetAbsolute}.\n` +
        `   WASM build will use the npm registry version.\n` +
        `   Run \`strands-dev setup --node\` to set up the local fork.`,
    );
    return;
  }

  // Remove whatever is there (directory from npm, broken symlink, etc.)
  rmSync(COMPONENTIZE_JS_LINK, { recursive: true, force: true });
  symlinkSync(COMPONENTIZE_JS_TARGET, COMPONENTIZE_JS_LINK);
  console.log("🔗 Linked local ComponentizeJS fork");
}

export async function build(opts?: BuildOptions): Promise<void> {
  const all = !opts?.ts && !opts?.wasm && !opts?.rs && !opts?.py;

  if (all || opts?.ts) {
    run("npm run build -w strands-ts");
  }

  if (all || opts?.wasm) {
    if (!all && !opts?.ts) {
      run("npm run build -w strands-ts");
    }
    ensureComponentizeJsSymlink();
    run("npm run build -w strands-wasm");
  }

  if (all || opts?.rs) {
    const releaseFlag = opts?.release ? " --release" : "";
    run(`cargo build -p strands${releaseFlag}`);
  }

  if (all || opts?.py) {
    const maturinCmd = opts?.release
      ? ".venv/bin/maturin build --release --bindings pyo3"
      : ".venv/bin/maturin develop -E test --bindings pyo3";
    run(maturinCmd, { cwd: `${ROOT}/strands-py` });
    stubs();
  }
}

export function stubs(): void {
  run(
    `bash -c 'set -e; lib=$(find strands-py/strands -maxdepth 1 \\( -name "_strands*.so" -o -name "_strands*.dylib" \\) | head -1); if [ -n "$lib" ]; then cargo run -p strands --features stubs --bin strands-stubs -- "$lib" -m _strands -o strands-py/strands/; fi'`,
  );
}
