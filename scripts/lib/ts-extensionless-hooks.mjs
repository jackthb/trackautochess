// Module hooks so plain `node` can run the TypeScript in shared/ directly.
// Node strips the types itself; it just refuses to resolve the extensionless
// relative imports those files use ("./game-utils"). Retry those as `.ts`.
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    if (specifier.startsWith(".") && !/\.[cm]?[jt]sx?$/.test(specifier)) {
      return nextResolve(`${specifier}.ts`, context);
    }
    throw error;
  }
}
