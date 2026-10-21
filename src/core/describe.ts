import { isDiagonal } from './geometry.ts';
import type { Move } from './types.ts';

// Russian instructions for each move. To be replaced by a translation table when the UI goes bilingual.

export function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

/** What to fold, counted relative to the shape's extent before the move. */
function part(f: Move): string {
  const b = f.box;
  if (isDiagonal(f.t)) {
    const corner = f.t === 'd' ? (f.side > 0 ? 'правую верхнюю' : 'левую нижнюю') : (f.side > 0 ? 'правую нижнюю' : 'левую верхнюю');
    return `${corner} часть по диагонали`;
  }
  if (f.t === 'v') {
    const n = f.side < 0 ? f.c - b.x0 : b.x1 + 1 - f.c;
    const adj = f.side < 0 ? plural(n, 'левый', 'левых', 'левых') : plural(n, 'правый', 'правых', 'правых');
    return n === 1 ? `${adj} столбец` : `${n} ${adj} ${plural(n, 'столбец', 'столбца', 'столбцов')}`;
  }
  const n = f.side < 0 ? f.c - b.y0 : b.y1 + 1 - f.c;
  if (n === 1) return `${f.side < 0 ? 'верхнюю' : 'нижнюю'} строку`;
  const adj = f.side < 0 ? plural(n, 'верхнюю', 'верхние', 'верхних') : plural(n, 'нижнюю', 'нижние', 'нижних');
  return `${n} ${adj} ${plural(n, 'строку', 'строки', 'строк')}`;
}

export function describe(f: Move): string {
  const what = part(f);
  if (f.kind === 'tuck') {
    const layers = `${f.depth} ${plural(f.depth, 'слой', 'слоя', 'слоёв')}`;
    const which = f.partial ? (f.dir === 'over' ? ' (только верхние слои)' : ' (только нижние слои)') : '';
    const where = f.dir === 'over'
      ? 'под ' + (f.depth === 1 ? 'верхний слой' : `верхние ${layers}`)
      : 'над ' + (f.depth === 1 ? 'нижним слоем' : `нижними ${layers}`);
    return `Перегните ${what}${which} и задвиньте внутрь: ${where}`;
  }
  if (f.kind === 'flap') {
    return `Перегните ${what}, но только ${f.dir === 'over' ? 'верхние слои' : 'нижние слои'}: ${f.dir === 'over' ? 'поверх листа' : 'под лист'}`;
  }
  return `Перегните ${what} ${f.dir === 'over' ? 'поверх листа' : 'под лист'}`;
}
