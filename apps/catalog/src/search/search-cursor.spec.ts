import { decodeCursor, encodeCursor } from './search-cursor';
import { InvalidCursorError } from './search.errors';

const ID = '33333333-3333-4333-8333-333333333333';

function rawCursor(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

// Cursor da busca (T01): base64url de { v: 1, after }, sem estado no servidor.
// O formato do `after` depende da ordem: com texto, [score, id]; sem texto,
// [nome, id].
describe('search cursor', () => {
  it('encode seguido de decode devolve os mesmos valores, com v: 1', () => {
    const cursor = encodeCursor([1.25, ID]);

    expect(JSON.parse(Buffer.from(cursor, 'base64url').toString())).toEqual({
      v: 1,
      after: [1.25, ID],
    });
    expect(decodeCursor(cursor, 'text')).toEqual([1.25, ID]);
    expect(decodeCursor(encodeCursor(['Camiseta', ID]), 'browse')).toEqual([
      'Camiseta',
      ID,
    ]);
  });

  it.each([
    ['não é base64url', 'não+é/base64'],
    ['JSON inválido', Buffer.from('{v:1').toString('base64url')],
    ['versão 2', rawCursor({ v: 2, after: [1.25, ID] })],
    ['after com 3 posições', rawCursor({ v: 1, after: [1.25, ID, 'x'] })],
    ['after ausente', rawCursor({ v: 1 })],
    ['JSON que não é objeto', rawCursor([1.25, ID])],
    ['mais de 512 caracteres', 'a'.repeat(513)],
  ])('cursor com %s → InvalidCursorError', (_, cursor) => {
    expect(() => decodeCursor(cursor, 'text')).toThrow(InvalidCursorError);
  });

  it('cursor de busca com texto usado numa busca sem texto → InvalidCursorError', () => {
    const textCursor = encodeCursor([1.25, ID]);

    expect(() => decodeCursor(textCursor, 'browse')).toThrow(
      InvalidCursorError,
    );
  });

  it('cursor de busca sem texto usado numa busca com texto → InvalidCursorError', () => {
    const browseCursor = encodeCursor(['Camiseta', ID]);

    expect(() => decodeCursor(browseCursor, 'text')).toThrow(
      InvalidCursorError,
    );
  });
});
