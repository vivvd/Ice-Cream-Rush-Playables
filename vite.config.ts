import { defineConfig } from "vitest/config";
import { sites } from "@openai/sites-vite-plugin";

export default defineConfig(async () => {
  const hostingBuild = process.env.SITES_BUILD === "1";
  const plugins = [];
  if (hostingBuild) {
    const { cloudflare } = await import("@cloudflare/vite-plugin");
    plugins.push(
      sites(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: [] },
        config: {
          main: "./worker/index.ts",
          compatibility_date: "2026-08-21",
          assets: { not_found_handling: "single-page-application" },
        },
      }),
    );
  }

  return {
    base: "./",
    plugins,
    build: {
      target: "es2020",
      assetsInlineLimit: 4_096,
      cssCodeSplit: false,
      sourcemap: false,
    },
    test: {
      environment: "node",
      include: ["tests/**/*.test.ts"],
      coverage: {
        reporter: ["text", "json-summary"],
      },
    },
  };
});
