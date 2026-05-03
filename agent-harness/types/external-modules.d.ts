declare module 'yaml' {
  export function parse(text: string): any;
  export function stringify(obj: any): string;
}

declare module 'pdf-parse' {
  interface PDFData {
    numpages: number;
    numrender: number;
    info: Record<string, unknown>;
    metadata: unknown;
    text: string;
    version: string;
  }
  function pdfParse(dataBuffer: Buffer): Promise<PDFData>;
  export default pdfParse;
}

declare module 'mammoth' {
  interface ExtractResult {
    value: string;
    messages: Array<{ type: string; message: string }>;
  }
  export function extractRawText(options: { buffer: Buffer }): Promise<ExtractResult>;
  export function convertToHtml(options: { buffer: Buffer }): Promise<ExtractResult>;
}

declare module 'xlsx' {
  interface WorkBook {
    SheetNames: string[];
    Sheets: Record<string, unknown>;
  }
  const utils: {
    sheet_to_csv(sheet: unknown): string;
    sheet_to_json(sheet: unknown): unknown[];
  };
  export function read(data: Buffer, opts: { type: string }): WorkBook;
  export { utils };
}

declare module 'officeparser' {
  export function parseOffice(buffer: Buffer): Promise<string>;
  const mod: {
    parseOffice: typeof parseOffice;
    default?: { parseOffice: typeof parseOffice };
  };
  export default mod;
}

declare module 'redis' {
  export interface RedisClientType {
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    quit(): Promise<void>;
    set(key: string, value: string): Promise<string | null>;
    get(key: string): Promise<string | null>;
    del(key: string | string[]): Promise<number>;
    expire(key: string, seconds: number): Promise<boolean>;
    keys(pattern: string): Promise<string[]>;
    hGet(key: string, field: string): Promise<string | undefined>;
    hSet(key: string, field: string, value: string): Promise<number>;
    hDel(key: string, field: string | string[]): Promise<number>;
    incr(key: string): Promise<number>;
    decr(key: string): Promise<number>;
    ping(): Promise<string>;
  }
  export function createClient(options?: { url?: string; socket?: { host?: string; port?: number } }): RedisClientType;
}
