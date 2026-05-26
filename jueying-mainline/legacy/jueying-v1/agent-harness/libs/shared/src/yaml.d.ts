declare module 'yaml' {
  export function parse(str: string): unknown;
  export function stringify(obj: unknown): string;
  const YAML: {
    parse: typeof parse;
    stringify: typeof stringify;
  };
  export default YAML;
}
