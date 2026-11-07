// Starts Electron with ELECTRON_RUN_AS_NODE cleared: shells spawned by VS Code / Claude Code inherit it,
// and it makes Electron behave as plain Node (no window).
import { spawn } from "node:child_process";
import electron from "electron";

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
spawn(electron, [".", ...process.argv.slice(2)], { stdio: "inherit", env }).on("exit", (code) => process.exit(code ?? 0));
