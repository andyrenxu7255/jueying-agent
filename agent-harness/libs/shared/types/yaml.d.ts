declare module 'yaml' {
  export function parse(str: string): unknown
  export function stringify(value: unknown): string
}
