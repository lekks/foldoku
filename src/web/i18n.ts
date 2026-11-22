import { languages, type Language } from '../core/language.ts';
import { staticEnglish } from './static-en.ts';

export const pageTranslations: Partial<Record<Language, Readonly<Record<string, string>>>> = {
  en: staticEnglish,
};

export function preferredLanguage(saved: string | null, preferences: readonly string[]): Language {
  const selected = languages.find(language => language === saved);
  if (selected) return selected;
  for (const preference of preferences) {
    const base = preference.toLowerCase().split('-')[0];
    const supported = languages.find(language => language === base);
    if (supported) return supported;
  }
  return 'ru';
}

export function translatePage(language: Language): void {
  for (const attr of [null, 'aria-label', 'title'] as const) {
    const marker = attr ? `data-i18n-${attr}` : 'data-i18n';
    for (const el of document.querySelectorAll<HTMLElement>(`[${marker}]`)) {
      const key = el.getAttribute(marker)!;
      const original = attr ? el.getAttribute(attr)! : el.textContent!;
      const russian = el.dataset.ru ?? original;
      el.dataset.ru = russian;
      const text = pageTranslations[language]?.[key] ?? russian;
      if (attr) el.setAttribute(attr, text);
      else el.textContent = text;
    }
  }
  for (const option of document.querySelectorAll<HTMLOptionElement>('[data-cell-label]')) {
    const cell = Number(option.value);
    const batch = option.dataset.cellLabel === 'batch';
    option.textContent = messages[language].cellSize(cell, batch);
  }
}

export const formatNumber = (n: number, language: Language): string =>
  n.toLocaleString(language, { useGrouping: false, maximumFractionDigits: 2 });

export const messages = {
  ru: {
    sheetFront: 'Лицевая сторона листа',
    sheetBack: 'Оборот листа',
    foldCount: (count: string, upper: number) => `${count} ${upper < 5 ? 'сгиба' : 'сгибов'}`,
    diagonals: ['без диагоналей', '1 диагональ', '2 диагонали', '3 диагонали'],
    techniques: ['только сгибы всех слоёв', 'сгиб части слоёв', 'задвигание'],
    cellSize: (cell: number, batch: boolean) => `${batch ? '' : 'Клетка '}${cell} мм · квадрат ${cell * 4} мм`,
    calibrationOffset: (x: string, y: string, long: boolean) => `Текущий сдвиг оборота: X ${x} мм, Y ${y} мм. Переворот по ${long ? "длинному" : "короткому"} краю.`,
    pdfReady: (name: string, single: boolean) => `Готово: ${name}. Печатайте в масштабе 100 % ${single ? "с одной стороны" : "с двух сторон"}.`,
    pdfError: (action: string, detail: string) => `Не удалось ${action}: ${detail}`,
    batchExhausted: (found: number, count: number, skipped: number) => `До номера 999999 недостаточно заданий для полного пакета. Собрано ${found} из ${count}, пропущено ${skipped}.`,
    batchProgress: (code: string, found: number, count: number, skipped: number) => `Проверяю № ${code} · собрано ${found} из ${count} · пропущено ${skipped}`,
    workerGenerate: (code: string) => `Сбой генерации задания № ${code}.`,
    batchReady: (found: number, range: string, skipped: number) => `Предпросмотр готов. Собрано ${found} заданий, номера ${range}. Пропущено ${skipped}.`,
    easy: "лёгкая",
    mid: "средняя",
    hard: "трудная",
    printFront: "лицевая сторона",
    printBack: "оборот",
    printSolution: "решение",
    printInstructions: "Вырежьте квадрат по меткам на углах. Сложите его по линиям сетки и диагоналям клеток в квадрат 4×4: одна сторона тёмная, другая светлая.",
    batchInstructions: "Вырежьте по меткам. Сложите по линиям сетки и диагоналям в квадрат 4×4 с тёмной и светлой сторонами.",
    batchSimplex: "Для пакета нужны односторонние задания.",
    batchRow: "На странице не помещается строка заданий.",
    answerLegend: "Пунктир — долина: перегнуть поверх. Штрих-пунктир — гора: подогнуть под низ. Бледным показана часть, которая сгибается. Схемы показывают стопку сверху.",
    complete: "Готово · 4×4",
    dark: "тёмная",
    light: "светлая",
    flap: " · часть слоёв",
    tuck: " · задвигание",
    calibrationFront: "Калибровка двусторонней печати · лицевая сторона",
    calibrationTarget: "Напечатайте этот файл на одном листе с двух сторон. Проколите лист иглой точно в центре креста.",
    calibrationGrid: "Ось X — вправо, ось Y — вниз. Деления по 1 мм, тонкие линии через 0,5 мм.",
    calibrationBack: "Калибровка · оборот",
    calibrationCorrection: "Найдите прокол на сетке и запишите его координаты X и Y. Прибавьте их к сдвигу оборота в генераторе и напечатайте калибровку ещё раз: прокол должен попасть в ноль.",
    step: "Шаг",
    top: "Сверху",
    bottom: "Снизу",
    number: "№",
    yellow: "Жёлтый",
    lilac: "Сиреневый",
    red: "Красный",
    orange: "Оранжевый",
    turquoise: "Бирюзовый",
    gray: "Серый",
    workerStart: "Не удалось запустить генератор. Откройте Foldopia в актуальной версии браузера.",
    generating: "Складываю лист…",
    noPuzzle: "Не удалось подобрать сгибы для этих настроек. Попробуйте другой номер или меньше диагоналей.",
    cancelled: "Отменено.",
    makingPdf: "Готовлю PDF…",
    savePdf: "сохранить PDF",
    makePreview: "подготовить предпросмотр",
    batchLimits: "Укажите от 1 до 50 заданий. Последний номер в пакете должен быть не больше 999999.",
    makingPreview: "Готовлю предпросмотр…",
    invalidCode: "Введите код задания, например D-101.",
    hideSolution: "Скрыть решение",
    showSolution: "Показать решение",
    copied: "Задание скопировано в буфер обмена.",
    clipboardError: "Браузер не дал доступ к буферу обмена. Попробуйте открыть страницу локально.",
    folds: "Сгибов",
    diagonalFolds: "Диагональных",
    partialFolds: "Частью слоёв",
    tucks: "Задвиганий",
    darkCells: "Тёмных клеток",
    lightCells: "Светлых клеток",
    rating: "Оценка",
    outOfFive: "из 5",
    check: "Проверка",
    solvable: "решаемо",
  },
  en: {
    sheetFront: 'Front of sheet',
    sheetBack: 'Back of sheet',
    foldCount: (count: string) => `${count} ${count === '1' ? 'fold' : 'folds'}`,
    diagonals: ['no diagonals', '1 diagonal', '2 diagonals', '3 diagonals'],
    techniques: ['full folds only', 'partial folds', 'tucks'],
    cellSize: (cell: number, batch: boolean) => `${batch ? '' : 'Cell '}${cell} mm · ${cell * 4} mm square`,
    calibrationOffset: (x: string, y: string, long: boolean) => `Current back offset: X ${x} mm, Y ${y} mm. Flip on the ${long ? "long" : "short"} edge.`,
    pdfReady: (name: string, single: boolean) => `Ready: ${name}. Print at 100% scale, ${single ? "single-sided" : "double-sided"}.`,
    pdfError: (action: string, detail: string) => `Could not ${action}: ${detail}`,
    batchExhausted: (found: number, count: number, skipped: number) => `There are too few puzzles through number 999999 to fill the batch. Found ${found} of ${count}, skipped ${skipped}.`,
    batchProgress: (code: string, found: number, count: number, skipped: number) => `Checking No. ${code} · found ${found} of ${count} · skipped ${skipped}`,
    workerGenerate: (code: string) => `Could not generate puzzle No. ${code}.`,
    batchReady: (found: number, range: string, skipped: number) => `Preview ready · Puzzles: ${found} · Codes: ${range} · Skipped: ${skipped}.`,
    easy: "easy",
    mid: "medium",
    hard: "hard",
    printFront: "front",
    printBack: "back",
    printSolution: "solution",
    printInstructions: "Cut out the square using the corner marks. Fold along the grid lines and cell diagonals into a 4×4 square with a dark side and a light side.",
    batchInstructions: "Cut along the marks. Fold along the grid lines and diagonals into a 4×4 square with a dark side and a light side.",
    batchSimplex: "Batch printing requires single-sided puzzles.",
    batchRow: "A row of puzzles does not fit on the page.",
    answerLegend: "Dashed lines mark valley folds: fold over. Dash-dot lines mark mountain folds: fold underneath. The pale area shows the part to fold. The diagrams show the top of the stack.",
    complete: "Finished · 4×4",
    dark: "dark",
    light: "light",
    flap: " · partial fold",
    tuck: " · tuck",
    calibrationFront: "Duplex calibration · front",
    calibrationTarget: "Print this file on both sides of one sheet. Pierce the sheet with a needle exactly at the center of the cross.",
    calibrationGrid: "X increases to the right and Y downward. Grid marks are 1 mm apart with thin lines every 0.5 mm.",
    calibrationBack: "Calibration · back",
    calibrationCorrection: "Find the hole on the grid and record its X and Y coordinates. Add them to the back offset in the generator and print the calibration sheet again. The hole should land at zero.",
    step: "Step",
    top: "Top",
    bottom: "Bottom",
    number: "No.",
    yellow: "Yellow",
    lilac: "Lilac",
    red: "Red",
    orange: "Orange",
    turquoise: "Turquoise",
    gray: "Gray",
    workerStart: "Could not start the generator. Open Foldopia in an up-to-date browser.",
    generating: "Folding the sheet…",
    noPuzzle: "No folds were found for these settings. Try a different puzzle number or fewer diagonals.",
    cancelled: "Canceled.",
    makingPdf: "Preparing PDF…",
    savePdf: "save the PDF",
    makePreview: "prepare the preview",
    batchLimits: "Enter 1 to 50 puzzles. The final puzzle number must be 999999 or lower.",
    makingPreview: "Preparing preview…",
    invalidCode: "Enter a puzzle code, for example D-101.",
    hideSolution: "Hide solution",
    showSolution: "Show solution",
    copied: "Puzzle copied to the clipboard.",
    clipboardError: "The browser denied clipboard access. Try opening the page locally.",
    folds: "Folds",
    diagonalFolds: "Diagonal folds",
    partialFolds: "Partial folds",
    tucks: "Tucks",
    darkCells: "Dark cells",
    lightCells: "Light cells",
    rating: "Rating",
    outOfFive: "out of 5",
    check: "Check",
    solvable: "solvable",
  },
} as const satisfies Record<Language, unknown>;
