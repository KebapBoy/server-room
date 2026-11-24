// ESLint (just check): the page scripts run in the browser, the capture and perf scripts in Node
import js from "@eslint/js"
import prettier from "eslint-config-prettier"
import { defineConfig, globalIgnores } from "eslint/config"
import globals from "globals"

export default defineConfig(
    globalIgnores(["node_modules/", "vendor/"]),
    js.configs.recommended,
    prettier,
    {
        files: ["rack.js", "intro.js"],
        languageOptions: { sourceType: "script", globals: globals.browser },
    },
    {
        files: ["**/*.mjs", "*.config.js"],
        languageOptions: { sourceType: "module", globals: globals.node },
    },
)
