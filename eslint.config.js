// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    // "Project Proposal" holds the business plan and its Word generator, not app code.
    // supabase/functions is Deno code for Edge Functions (npm: imports), outside the app's toolchain.
    // solana/ is the escrow program (Rust, with Anchor's own TypeScript tests), built in WSL.
    ignores: ["dist/*", "Project Proposal/**", "supabase/functions/**", "solana/**"],
  }
]);
