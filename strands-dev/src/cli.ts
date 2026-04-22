#!/usr/bin/env tsx

import { execSync } from "node:child_process";
import { existsSync, globSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { program } from "commander";
import { parse as parseTOML } from "smol-toml";

const ROOT = resolve(import.meta.dirname, "../..");
const PY = `${ROOT}/strands-py`;

process.env.PYTHONPYCACHEPREFIX ??= ".pycache";

program.name("strands-dev").description(
  `Strands monorepo development CLI

Build pipeline (each step feeds the next):
  wit/agent.wit -> strands-ts -> strands-wasm -> strands-py

Most commands accept layer flags (--ts, --rs, --py, --wasm).
No flags = run all layers.`,
);

program
  .command("setup")
  .description("Install toolchains and dependencies")
  .option("--node", "npm install")
  .option("--python", "Create venv and install ruff")
  .action((opts) => setup(opts));

program
  .command("build")
  .description("Compile one or more layers")
  .option("--ts", "TypeScript SDK")
  .option("--wasm", "WASM component (rebuilds TS first)")
  .option("--py", "Python package")
  .option("--release", "Release build")
  .action((opts) => build(opts));

program
  .command("test")
  .description("Run tests")
  .option("--py", "Python tests")
  .option("--ts", "TypeScript tests")
  .argument("[file]", "Specific Python test file")
  .action((file, opts) => test({ ...opts, file }));

program
  .command("check")
  .description("Lint and type-check without building")
  .option("--ts", "TypeScript type-check")
  .option("--py", "Python ruff")
  .action((opts) => check(opts));

program
  .command("fmt")
  .description("Format all code")
  .option("--check", "Fail if anything would change")
  .action((opts) => fmt(opts));

program
  .command("generate")
  .description("Regenerate type declarations from WIT")
  .option("--check", "Fail if generated files are out of date")
  .action((opts) => generate(opts));

program
  .command("example")
  .description("Run an example by name")
  .argument("<name>", "Example name")
  .option("--py", "Run a Python example")
  .option("--ts", "Run a TypeScript example")
  .action((name, opts) => {
    if (opts.py) py(`.venv/bin/python examples/${name}.py`);
    else if (opts.ts)
      run("npm start", { cwd: `${ROOT}/strands-ts/examples/${name}` });
  });

program
  .command("clean")
  .description("Remove all build artifacts")
  .action(() => clean());

program
  .command("ci")
  .description("Full CI pipeline")
  .action(() => {
    generate({ check: true });
    fmt({ check: true });
    check();
    build();
    test();
  });

program
  .command("bootstrap")
  .description("First-time setup, generate, build, and test")
  .action(() => {
    setup();
    generate();
    build();
    test();
  });

program
  .command("rebuild")
  .description("Clean rebuild from scratch")
  .action(() => {
    clean();
    generate();
    build();
  });

const VALIDATE_LAYERS = [
  "wit",
  "ts",
  "ts-api",
  "wasm",
  "py",
] as const;

program
  .command("validate")
  .description("Validate changes to a specific layer")
  .argument("<layer>", `Layer: ${VALIDATE_LAYERS.join(", ")}`)
  .action((layer: string) => {
    switch (layer) {
      case "wit":
        generate();
        build();
        test();
        break;
      case "ts":
        build({ ts: true });
        test({ ts: true });
        break;
      case "ts-api":
        build({ wasm: true });
        test({ ts: true });
        break;
      case "wasm":
        build({ wasm: true });
        break;
      case "py":
        check({ py: true });
        test({ py: true });
        break;
      default:
        console.error(
          `Unknown layer: ${layer}\nValid layers: ${VALIDATE_LAYERS.join(", ")}`,
        );
        process.exit(1);
    }
  });

program.parse();

function run(cmd: string, opts?: { cwd?: string; env?: Record<string, string> }): void {
  try {
    execSync(cmd, {
      stdio: "inherit",
      cwd: opts?.cwd ?? ROOT,
      env: opts?.env ? { ...process.env, ...opts.env } : undefined,
    });
  } catch (e: unknown) {
    const status = (e as { status?: number }).status ?? 1;
    console.error(`\nfailed: ${cmd} (exit ${status})`);
    process.exit(status);
  }
}

function py(cmd: string): void {
  run(cmd, {
    cwd: PY,
    env: { VIRTUAL_ENV: `${PY}/.venv`, PATH: `${PY}/.venv/bin:${process.env.PATH}` },
  });
}

function setup(opts?: {
  node?: boolean;
  python?: boolean;
}): void {
  const all = !opts?.node && !opts?.python;
  if (all || opts?.node) run("npm install");
  if (all || opts?.python) {
    py("python3 -m venv .venv");
    py(".venv/bin/pip install -e '.[test,dev]' ruff");
  }
}

function build(opts?: {
  ts?: boolean;
  wasm?: boolean;
  py?: boolean;
  release?: boolean;
}): void {
  const all = !opts?.ts && !opts?.wasm && !opts?.py;
  const rel = opts?.release ? " --release" : "";

  if (all || opts?.ts || opts?.wasm) run("npm install");
  if (all || opts?.ts) run("npm run build -w strands-ts");
  if (all || opts?.wasm) {
    if (!all && !opts?.ts) run("npm run build -w strands-ts");
    run("npm run build -w strands-wasm");
  }
}

function test(opts?: {
  py?: boolean;
  ts?: boolean;
  file?: string;
}): void {
  const all = !opts?.py && !opts?.ts;
  if (all || opts?.py)
    py(
      opts?.file
        ? `.venv/bin/pytest tests_integ/${opts.file} -v`
        : ".venv/bin/pytest",
    );
  if (all || opts?.ts) run("npm test -w strands-ts");
}

function check(opts?: {
  ts?: boolean;
  py?: boolean;
}): void {
  const all = !opts?.ts && !opts?.py;
  if (all || opts?.py) py(".venv/bin/ruff check strands/ tests_integ/");
  if (all || opts?.ts) run("npm run type-check --workspaces --if-present");
}

function fmt(opts?: { check?: boolean }): void {
  const flag = opts?.check ? " --check" : "";
  run(
    `npx prettier ${opts?.check ? "--check" : "--write"} 'strands-wasm/**/*.ts' 'strands-ts/**/*.ts' --ignore-path .gitignore`,
  );
  py(`.venv/bin/ruff format${flag} strands/ tests_integ/`);
}

function generate(opts?: { check?: boolean }): void {
  run("npm install");
  run("npx jco guest-types wit --name strands:agent --world-name agent --out-dir strands-ts/generated", { cwd: ROOT });
  run("npx jco guest-types wit --name strands:agent --world-name agent --out-dir strands-wasm/generated", { cwd: ROOT });

  // Tag generated TS/WASM type declarations.
  for (const dir of ["strands-wasm/generated", "strands-ts/generated"]) {
    for (const file of globSync("**/*.d.ts", { cwd: join(ROOT, dir) })) {
      const path = join(ROOT, dir, file);
      const content = readFileSync(path, "utf-8");
      if (!content.startsWith("// @generated")) {
        writeFileSync(
          path,
          `// @generated from wit/agent.wit -- do not edit\n\n${content}`,
        );
      }
    }
  }

  // Generate Python types from WIT.
  py("python scripts/generate_types.py");

  // Ensure TS + WASM are built first.
  if (!existsSync(join(ROOT, "strands-wasm/dist/strands-agent.wasm"))) {
    build({ ts: true, wasm: true });
  }

  if (opts?.check) {
    try {
      execSync(
        "git diff --quiet -- strands-wasm/generated/ strands-ts/generated/ strands-py/strands/_generated/",
        { cwd: ROOT },
      );
    } catch {
      console.error(
        "error: generated files are out of date -- run 'strands-dev generate' and commit",
      );
      run(
        "git diff --stat -- strands-wasm/generated/ strands-ts/generated/ strands-py/strands/_generated/",
      );
      process.exit(1);
    }
  }
}

function clean(): void {
  try {
    run("npm run clean --workspaces");
  } catch (e) {
    console.warn("workspace clean failed (continuing):", (e as Error).message);
  }
  run("rm -rf strands-py/target strands-py/.venv");
}

interface Task {
  title: string;
  status: string;
  size?: string;
  author?: string;
  notes?: string;
}

interface Group {
  description: string;
}
