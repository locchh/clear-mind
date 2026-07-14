// @ts-check
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

// Flat config is a plain array of config objects, applied in order.
export default [
  // skip build output and deps
  { ignores: ["node_modules/", "dist/"] },
  // base TypeScript rule set (an array — spread it in)
  ...tseslint.configs.recommended,
  // MUST be last: turns off rules that conflict with Prettier formatting
  prettier,
];
