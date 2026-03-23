#!/usr/bin/env tsx

import { execSync } from "node:child_process";
import { globSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { program } from "commander";
import { parse as parseTOML } from "smol-toml";

const ROOT = resolve(import.meta.dirname, "../..");
const PY = `${ROOT}/strands-py`;

process.env.PYTHONPYCACHEPREFIX ??= ".pycache";

program.name("strands-dev").description(
  `Strands monorepo development CLI

Build pipeline (each step feeds the next):
  wit/agent.wit -> strands-ts -> strands-wasm -> strands-rs -> strands-py

Most commands accept layer flags (--ts, --rs, --py, --wasm).
No flags = run all layers.`,
);

program
  .command("setup")
  .description("Install toolchains and dependencies")
  .option("--rust", "Rust stable, wasm32-wasip2, cargo tools")
  .option("--node", "npm install")
  .option("--python", "Create venv, install maturin and ruff")
  .action((opts) => setup(opts));

program
  .command("build")
  .description("Compile one or more layers")
  .option("--ts", "TypeScript SDK")
  .option("--wasm", "WASM component (rebuilds TS first)")
  .option("--rs", "Rust host")
  .option("--py", "Python package (maturin + UniFFI)")
  .option("--kt", "Kotlin/Java SDK (UniFFI bindings + Gradle)")
  .option("--release", "Release build")
  .action((opts) => build(opts));

program
  .command("test")
  .description("Run tests")
  .option("--rs", "Rust tests")
  .option("--py", "Python tests")
  .option("--ts", "TypeScript tests")
  .option("--kt", "Kotlin/Java tests")
  .argument("[file]", "Specific Python test file")
  .action((file, opts) => test({ ...opts, file }));

program
  .command("check")
  .description("Lint and type-check without building")
  .option("--rs", "Rust clippy")
  .option("--ts", "TypeScript type-check")
  .option("--py", "Python ruff")
  .option("--kt", "Kotlin/Java compile check")
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
  .option("--rs", "Run a Rust example (default)")
  .option("--py", "Run a Python example")
  .option("--ts", "Run a TypeScript example")
  .option("--kt", "Run the Kotlin example")
  .option("--java", "Run the Java example")
  .action((name, opts) => {
    if (opts.py) py(`.venv/bin/python examples/${name}.py`);
    else if (opts.ts)
      run("npm start", { cwd: `${ROOT}/strands-ts/examples/${name}` });
    else if (opts.kt) gradle(":examples-kt:run");
    else if (opts.java) gradle(":examples-java:run");
    else run(`cargo run -p strands --example ${name}`);
  });

program
  .command("clean")
  .description("Remove all build artifacts")
  .action(() => clean());

program
  .command("upgrade")
  .description("Bump Rust dependencies to latest compatible versions")
  .option("--incompatible", "Include major version bumps")
  .action((opts) =>
    run(`cargo upgrade${opts.incompatible ? " --incompatible" : ""}`),
  );

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
  "rs",
  "py-bindings",
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
        test({ rs: true });
        test({ ts: true });
        break;
      case "wasm":
        build({ wasm: true });
        test({ rs: true });
        break;
      case "rs":
        check({ rs: true });
        build({ rs: true });
        test({ rs: true });
        break;
      case "py-bindings":
        check({ rs: true });
        build({ py: true });
        test({ py: true });
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

program
  .command("report")
  .description("Generate a status report from tasks.toml")
  .option("--full", "Include full task breakdown")
  .action((opts) => report(opts));

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

function gradle(tasks: string): void {
  run(`./strands-kt/gradlew -p strands-kt ${tasks}`);
}

function setup(opts?: {
  rust?: boolean;
  node?: boolean;
  python?: boolean;
}): void {
  const all = !opts?.rust && !opts?.node && !opts?.python;
  if (all || opts?.rust) {
    run("rustup update stable");
    run("rustup target add wasm32-wasip2");
    run("cargo install cargo-machete cargo-upgrade");
  }
  if (all || opts?.node) run("npm install");
  if (all || opts?.python) {
    py("python3 -m venv .venv");
    py(".venv/bin/pip install maturin ruff");
  }
}

function build(opts?: {
  ts?: boolean;
  wasm?: boolean;
  rs?: boolean;
  py?: boolean;
  kt?: boolean;
  release?: boolean;
}): void {
  const all = !opts?.ts && !opts?.wasm && !opts?.rs && !opts?.py && !opts?.kt;
  const rel = opts?.release ? " --release" : "";

  if (all || opts?.ts || opts?.wasm) run("npm install");
  if (all || opts?.ts) run("npm run build -w strands-ts");
  if (all || opts?.wasm) {
    if (!all && !opts?.ts) run("npm run build -w strands-ts");
    run("npm run build -w strands-wasm");
  }
  if (all || opts?.rs) run(`cargo build -p strands${rel}`);
  if (all || opts?.kt) {
    const profile = opts?.release ? "release" : "debug";
    run(`cargo rustc -p strands --crate-type cdylib${rel}`);
    run("rm -f strands-kt/lib/src/main/kotlin/uniffi/strands/strands.kt");
    run(
      `cargo run -p uniffi-bindgen -- generate --library target/${profile}/${cdylibName()} --language kotlin --out-dir strands-kt/lib/src/main/kotlin/ --no-format`,
    );
    gradle(
      ":lib:compileKotlin :examples-kt:compileKotlin :examples-java:compileJava",
    );
  }
  if (all || opts?.py) {
    const maturinCmd = opts?.release
      ? ".venv/bin/maturin build --release --bindings uniffi"
      : ".venv/bin/maturin develop -E test --bindings uniffi";
    py(maturinCmd);
  }
}

function test(opts?: {
  rs?: boolean;
  py?: boolean;
  ts?: boolean;
  kt?: boolean;
  file?: string;
}): void {
  const all = !opts?.rs && !opts?.py && !opts?.ts && !opts?.kt;
  if (all || opts?.rs) run("cargo test -p strands");
  if (all || opts?.py)
    py(
      opts?.file
        ? `.venv/bin/pytest tests_integ/${opts.file} -v`
        : ".venv/bin/pytest",
    );
  if (all || opts?.ts) run("npm test -w strands-ts");
  if (all || opts?.kt) gradle(":lib:test");
}

function check(opts?: {
  rs?: boolean;
  ts?: boolean;
  py?: boolean;
  kt?: boolean;
}): void {
  const all = !opts?.rs && !opts?.ts && !opts?.py && !opts?.kt;
  if (all || opts?.rs) {
    run("cargo clippy --workspace -- -D warnings");
  }
  if (all || opts?.py) py(".venv/bin/ruff check strands/ tests_integ/");
  if (all || opts?.ts) run("npm run type-check --workspaces --if-present");
  if (all || opts?.kt)
    gradle(
      ":lib:compileKotlin :examples-kt:compileKotlin :examples-java:compileJava",
    );
}

function fmt(opts?: { check?: boolean }): void {
  const flag = opts?.check ? " --check" : "";
  run(`cargo fmt --all${flag}`);
  run(
    `npx prettier ${opts?.check ? "--check" : "--write"} 'strands-wasm/**/*.ts' 'strands-ts/**/*.ts' --ignore-path .gitignore`,
  );
  py(`.venv/bin/ruff format${flag} strands/ tests_integ/`);
}

function cdylibName(): string {
  const ext =
    process.platform === "win32"
      ? "dll"
      : process.platform === "darwin"
        ? "dylib"
        : "so";
  return process.platform === "win32" ? `strands.${ext}` : `libstrands.${ext}`;
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

  // Generate Python UniFFI bindings from the compiled cdylib.
  const lib = `target/debug/${cdylibName()}`;
  run(`cargo rustc -p strands --crate-type cdylib`);
  run(
    `cargo run -p uniffi-bindgen -- generate --library ${lib} --language python --out-dir strands-py/strands/_generated/ --no-format`,
  );

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
  run("cargo clean");
  try {
    run("npm run clean --workspaces");
  } catch {}
  run("rm -rf strands-py/target strands-py/.venv");
  try {
    gradle("clean");
  } catch {}
  run("rm -f strands-kt/lib/src/main/kotlin/uniffi/strands/strands.kt");
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

function report(opts?: { full?: boolean }): void {
  const SIZE_WEIGHT: Record<string, number> = {
    xs: 1, s: 2, m: 3, l: 5, xl: 8,
  };
  const SIZE_RANK: Record<string, number> = {
    xs: 1, s: 2, m: 3, l: 4, xl: 5,
  };

  const raw = readFileSync(join(ROOT, "tasks.toml"), "utf-8");
  const doc = parseTOML(raw) as Record<string, unknown>;
  const meta = doc.meta as Record<string, unknown>;
  const groupDefs = doc.groups as Record<string, Group>;

  const reserved = new Set(["meta", "groups"]);
  const tasksByGroup = new Map<string, Map<string, Task>>();

  for (const [key, value] of Object.entries(doc)) {
    if (reserved.has(key) || typeof value !== "object" || value === null)
      continue;
    const groupTasks = new Map<string, Task>();
    for (const [taskId, taskValue] of Object.entries(
      value as Record<string, unknown>,
    )) {
      if (
        typeof taskValue === "object" &&
        taskValue !== null &&
        "status" in taskValue
      ) {
        groupTasks.set(taskId, taskValue as Task);
      }
    }
    if (groupTasks.size > 0) tasksByGroup.set(key, groupTasks);
  }

  const all: Task[] = [];
  for (const tasks of tasksByGroup.values()) {
    for (const task of tasks.values()) all.push(task);
  }

  const done = all.filter((t) => t.status === "done");
  const inProgress = all.filter((t) => t.status === "in-progress");
  const blocked = all.filter((t) => t.status === "blocked");
  const remaining = all.filter((t) => t.status !== "done");

  const sizeSummary = (tasks: Task[]) =>
    ["xs", "s", "m", "l", "xl"]
      .map((s) => {
        const n = tasks.filter((t) => t.size === s).length;
        return n > 0 ? `${n}${s.toUpperCase()}` : null;
      })
      .filter(Boolean)
      .join(" ");

  const effort = (tasks: Task[]) =>
    tasks.reduce((sum, t) => sum + (SIZE_WEIGHT[t.size ?? "m"] ?? 3), 0);

  const taskGroup = (task: Task): string => {
    for (const [g, tasks] of tasksByGroup) {
      for (const t of tasks.values()) {
        if (t === task) return g;
      }
    }
    return "";
  };

  // === Summary ===
  console.log(`# ${meta.title}`);
  console.log();
  const summary = meta.summary as string | undefined;
  if (summary) {
    console.log(summary);
    console.log();
  }
  console.log(
    `**${done.length}** done, **${inProgress.length}** in progress, **${remaining.length - inProgress.length}** todo, **${blocked.length}** blocked — **${all.length}** total`,
  );
  console.log();
  console.log(
    `Remaining effort: **${sizeSummary(remaining) || "none"}** (${effort(remaining)} points)`,
  );
  console.log(
    `Completed effort: ${sizeSummary(done) || "none"} (${effort(done)} points)`,
  );
  console.log();

  // === In progress ===
  if (inProgress.length > 0) {
    console.log("## In progress");
    console.log();
    for (const task of inProgress) {
      console.log(
        `- **${task.title}** (${(task.size ?? "m").toUpperCase()}, ${taskGroup(task)})${task.author ? ` — ${task.author}` : ""}`,
      );
    }
    console.log();
  }

  // === Blocked ===
  if (blocked.length > 0) {
    console.log("## Blocked");
    console.log();
    for (const task of blocked) {
      console.log(
        `- **${task.title}** (${(task.size ?? "m").toUpperCase()}, ${taskGroup(task)})${task.notes ? ` — ${task.notes}` : ""}`,
      );
    }
    console.log();
  }

  // === By group (only groups with remaining work) ===
  console.log("## By group");
  console.log();
  console.log("| Group | Description | Remaining | Effort |");
  console.log("| ----- | ----------- | --------- | ------ |");
  for (const [groupName, tasks] of tasksByGroup) {
    const arr = [...tasks.values()];
    const rem = arr.filter((t) => t.status !== "done");
    if (rem.length === 0) continue;
    const desc = groupDefs[groupName]?.description ?? "";
    console.log(
      `| ${groupName} | ${desc} | ${sizeSummary(rem)} | ${effort(rem)}pt |`,
    );
  }
  console.log();

  // === Completed summary (always shown) ===
  if (done.length > 0) {
    console.log("## Completed");
    console.log();
    for (const [groupName, tasks] of tasksByGroup) {
      const groupDone = [...tasks.values()].filter((t) => t.status === "done");
      if (groupDone.length === 0) continue;
      const titles = groupDone.map((t) => t.title).join(", ");
      console.log(
        `- **${groupName}** (${groupDone.length}): ${titles}`,
      );
    }
    console.log();
  }

  if (!opts?.full) return;

  // === Remaining (--full) ===
  if (remaining.length > 0) {
    console.log("---");
    console.log();
    console.log("## Remaining (detail)");
    console.log();
    console.log("| Size | Group | Task | Status | Notes |");
    console.log("| ---- | ----- | ---- | ------ | ----- |");
    remaining
      .sort(
        (a, b) =>
          (SIZE_RANK[b.size ?? "m"] ?? 3) - (SIZE_RANK[a.size ?? "m"] ?? 3),
      )
      .forEach((task) => {
        console.log(
          `| ${(task.size ?? "m").toUpperCase()} | ${taskGroup(task)} | ${task.title} | ${task.status} | ${task.notes ?? ""} |`,
        );
      });
    console.log();
  }

  // === Completed (--full) ===
  if (done.length > 0) {
    console.log("## Completed (detail)");
    console.log();
    console.log("| Size | Group | Task | Author |");
    console.log("| ---- | ----- | ---- | ------ |");
    for (const [groupName, tasks] of tasksByGroup) {
      for (const task of tasks.values()) {
        if (task.status === "done") {
          console.log(
            `| ${(task.size ?? "m").toUpperCase()} | ${groupName} | ${task.title} | ${task.author ?? ""} |`,
          );
        }
      }
    }
  }
}
