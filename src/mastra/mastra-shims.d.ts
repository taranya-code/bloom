/** Ambient module shims for @mastra/core.
 *
 * @mastra/core@1.55.0's package.json declares "types": "dist/index.d.ts" and matching
 * per-subpath .d.ts entries under "exports", but the published package does not actually
 * ship any .d.ts files in dist/ (verified: only .js/.cjs + sourcemaps are present). That's
 * an upstream packaging gap in this version, not a local misconfiguration -- `skipLibCheck`
 * doesn't help because it only skips *validating* declaration files that exist, not filling
 * in ones that are missing entirely.
 *
 * Without this shim, every import from these subpaths trips noImplicitAny (TS7016) and
 * cascades into "implicitly has an any type" errors on every destructured parameter derived
 * from them -- which is misleading, since the actual bug is "no types shipped", not "this
 * code is untyped". Declaring exactly the named exports this codebase actually imports (as
 * `any`) makes that gap explicit and scoped, instead of suppressing it file-by-file with
 * inline @ts-ignore comments. Remove this shim once @mastra/core ships working declaration
 * files for this subpath set. */
declare module "@mastra/core" {
  export const Mastra: any;
}
declare module "@mastra/core/agent" {
  export const Agent: any;
}
declare module "@mastra/core/tools" {
  export const createTool: any;
}
