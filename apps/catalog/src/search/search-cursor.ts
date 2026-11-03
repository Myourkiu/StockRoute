import { InvalidCursorError } from './search.errors';

// Com texto, a busca ordena por relevância (_score) e id; sem texto, por nome
// e id. O cursor guarda os valores de ordenação do último item da página.
export type SearchMode = 'text' | 'browse';
export type SortValues = [number, string] | [string, string];

const VERSION = 1;
const MAX_LENGTH = 512;
const BASE64URL = /^[A-Za-z0-9_-]+$/;

// O cursor não é assinado: ele não guarda nada que o cliente não possa ver, e
// um valor trocado só muda o ponto de partida. A validação garante que ele
// tem o formato que o `search_after` espera para a ordem da busca.
export function encodeCursor(after: SortValues): string {
  return Buffer.from(JSON.stringify({ v: VERSION, after })).toString(
    'base64url',
  );
}

export function decodeCursor(cursor: string, mode: SearchMode): SortValues {
  if (cursor.length > MAX_LENGTH || !BASE64URL.test(cursor)) {
    throw new InvalidCursorError();
  }
  const decoded = parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  if (!isRecord(decoded) || decoded.v !== VERSION) {
    throw new InvalidCursorError();
  }
  const { after } = decoded;
  if (!Array.isArray(after) || after.length !== 2) {
    throw new InvalidCursorError();
  }
  const [first, id] = after as unknown[];
  const firstMatches =
    mode === 'text'
      ? typeof first === 'number' && Number.isFinite(first)
      : typeof first === 'string';
  if (!firstMatches || typeof id !== 'string') {
    throw new InvalidCursorError();
  }
  return [first, id] as SortValues;
}

function parse(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    throw new InvalidCursorError();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
