declare module "solc" {
  /** Standard JSON in, standard JSON out. Both are JSON strings. */
  export function compile(input: string): string;
  export function version(): string;
  const solc: { compile: typeof compile; version: typeof version };
  export default solc;
}
