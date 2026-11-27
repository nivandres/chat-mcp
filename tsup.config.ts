import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";

const { version } = JSON.parse(readFileSync("package.json", "utf8")) as {
  version: string;
};

export default defineConfig({
  entry: { index: "src/index.ts", config: "src/config.ts", cli: "src/cli.ts" },
  format: ["esm"],
  target: "node20",
  platform: "node",
  // tsup strips the `node:` prefix by default, which makes bundlers reach for
  // a browser crypto polyfill.
  removeNodeProtocol: false,
  define: { __VERSION__: JSON.stringify(version) },
  dts: true,
  clean: true,
});
