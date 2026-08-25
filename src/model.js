export const PAGE_FORMATS = { A4: [210, 297], Letter: [215.9, 279.4] };
export const TEMPLATE_VERSION = 12;
const MIN_CELL_SIZE = 1;
// Keep artwork geometry nondegenerate even for imported excessive insets. This
// physical minimum is small enough to preserve requested borders as closely as
// possible, while ensuring CSS and SVG crop ratios are always finite.
export const MIN_SAFE_ARTWORK_SIZE = 0.1;
export const PDF_RASTER_DPI = 300;
const MM_PER_INCH = 25.4;
export const MM_PER_CSS_PIXEL = MM_PER_INCH / 96;
export const FONT_OPTIONS = [
  { value: 'Arial', label: 'Arial', category: 'sans', family: 'Arial, Helvetica, sans-serif' },
  { value: 'Helvetica', label: 'Helvetica', category: 'sans', family: 'Helvetica, Arial, sans-serif' },
  { value: 'Verdana', label: 'Verdana', category: 'sans', family: 'Verdana, Geneva, sans-serif' },
  { value: 'Trebuchet MS', label: 'Trebuchet MS', category: 'sans', family: '"Trebuchet MS", Arial, sans-serif' },
  { value: 'Georgia', label: 'Georgia', category: 'serif', family: 'Georgia, "Times New Roman", serif' },
  { value: 'Times New Roman', label: 'Times New Roman', category: 'serif', family: '"Times New Roman", Times, serif' },
  { value: 'Garamond', label: 'Garamond', category: 'serif', family: 'Garamond, Georgia, serif' },
  { value: 'Courier New', label: 'Courier New', category: 'mono', family: '"Courier New", Courier, monospace' },
  { value: 'Impact', label: 'Impact', category: 'display', family: 'Impact, Haettenschweiler, sans-serif' },
  { value: 'Brush Script MT', label: 'Brush Script', category: 'script', family: '"Brush Script MT", "Segoe Script", cursive' },
];
export const DEFAULT_FONT_FAMILY = FONT_OPTIONS[0].value;
const FONT_OPTION_BY_VALUE = new Map(FONT_OPTIONS.map((option) => [option.value, option]));

export function fontFamilyStack(value) {
  return (FONT_OPTION_BY_VALUE.get(value) || FONT_OPTIONS[0]).family;
}

export class SheetGeometryError extends Error {
  constructor(message = 'The sheet margins and gaps do not leave room for labels.') {
    super(message);
    this.name = 'SheetGeometryError';
  }
}

export class TemplateVersionError extends Error {
  constructor(version) {
    super(`Template version ${version} requires a newer Sticker Sheet Studio.`);
    this.name = 'TemplateVersionError';
    this.version = version;
  }
}

export function templateCompatibility(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { compatible: false, kind: 'invalid' };
  if (raw.version === undefined || raw.version === null) return Array.isArray(raw.cells) || typeof raw.format === 'string'
    ? { compatible: true, kind: 'legacy', version: 1 }
    : { compatible: false, kind: 'invalid' };
  const version = Number(raw.version);
  if (!Number.isInteger(version) || version < 1) return { compatible: false, kind: 'invalid' };
  if (version > TEMPLATE_VERSION) return { compatible: false, kind: 'future', version };
  return { compatible: true, kind: version === TEMPLATE_VERSION ? 'current' : 'legacy', version };
}

// Artwork normally reaches the cutout edge. A safety border is an opt-in
// physical reservation, not an implicit appearance shrinkage.
const defaultContentCell = () => ({ text: '', color: '#22332b', fontFamily: DEFAULT_FONT_FAMILY, fontSize: 15, textStyle: 'bold', weight: '700', align: 'center', valign: 'middle', rotation: 0 });
const defaultCell = () => ({ ...defaultContentCell(), appearanceMode: 'solid', background: '#ffffff', pattern: 'none', image: '', imageWidth: 0, imageHeight: 0, imageZoom: 1, imageX: 0, imageY: 0, safeInset: 0, printBorderEnabled: false, printBorderColor: '#22332b', printBorderWidth: .5, printBorderStyle: 'solid', contentGrid: { columns: 1, rows: 1, columnWeights: [1], rowWeights: [1], cells: [defaultContentCell()] } });
// A cleared label is deliberately unlike a new-label placeholder: it contains
// no text and uses the same white cutout background that exports already use.
// Sheet geometry lives on the sheet, not the cell, so this can safely be used
// for one label or a multi-selection without affecting placement.
export const emptyLabel = () => defaultCell();
const COLOR = /^#[0-9a-f]{6}$/i;
const CELL_PATTERNS = new Set(['none', 'dots', 'stripes']);
export const CELL_APPEARANCE_MODES = new Set(['solid', 'pattern', 'image']);
const CELL_ALIGNS = new Set(['left', 'center', 'right']);
const CELL_VALIGNS = new Set(['top', 'middle', 'bottom']);
export const CELL_ROTATIONS = new Set([0, 270]);
const TEXT_STYLES = new Set(['normal', 'bold', 'italic', 'underline']);
const PRINT_BORDER_STYLES = new Set(['solid', 'dashed', 'dotted']);

// Rotation is a constrained two-mode workflow. Imported templates created by
// earlier releases are migrated deterministically: legacy clockwise 90° maps
// to the supported counter-clockwise portrait-flow mode (270°), while 180° and
// arbitrary values map to the normal landscape mode (0°).
export function normalizeRotation(value) {
  const rotation = Number(value);
  return rotation === 270 || rotation === 90 ? 270 : 0;
}

export const defaultState = () => ({
  version: TEMPLATE_VERSION,
  name: 'My sticker sheet',
  format: 'A4',
  orientation: 'portrait',
  marginX: 12,
  marginY: 12,
  labelWidth: 60,
  labelHeight: 40,
  cornerRadius: 4,
  columns: 3,
  rows: 5,
  cells: Array.from({ length: 15 }, defaultCell),
});

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeContentCell(raw = {}) {
  const source = { ...defaultContentCell(), ...(raw && typeof raw === 'object' ? raw : {}) };
  const textStyle = TEXT_STYLES.has(raw?.textStyle) ? raw.textStyle : source.weight === '400' ? 'normal' : 'bold';
  return {
    text: typeof source.text === 'string' ? source.text : String(source.text ?? ''),
    color: COLOR.test(source.color) ? source.color : defaultContentCell().color,
    fontFamily: FONT_OPTION_BY_VALUE.has(source.fontFamily) ? source.fontFamily : DEFAULT_FONT_FAMILY,
    fontSize: clamp(finiteNumber(source.fontSize, 15), 6, 72),
    textStyle,
    weight: textStyle === 'bold' ? '700' : '400',
    align: CELL_ALIGNS.has(source.align) ? source.align : 'center',
    valign: CELL_VALIGNS.has(source.valign) ? source.valign : 'middle',
    rotation: normalizeRotation(source.rotation),
  };
}

function contentGridDimensions(raw = {}) {
  return {
    columns: clamp(Math.floor(finiteNumber(raw.columns, 1)), 1, 3),
    rows: clamp(Math.floor(finiteNumber(raw.rows, 1)), 1, 3),
  };
}

export function normalizeTrackWeights(raw, count) {
  const length = clamp(Math.floor(finiteNumber(count, 1)), 1, 3);
  const weights = Array.from({ length }, (_, index) => Math.max(.001, finiteNumber(raw?.[index], 1)));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  return weights.map((weight) => weight / total);
}

export function setTrackShare(weights, index, percent) {
  const normalized = normalizeTrackWeights(weights, weights?.length || 1);
  if (normalized.length === 1) return [1];
  const targetIndex = clamp(Math.floor(finiteNumber(index, 0)), 0, normalized.length - 1);
  const minimum = .05;
  const target = clamp(finiteNumber(percent, normalized[targetIndex] * 100) / 100, minimum, 1 - minimum * (normalized.length - 1));
  const others = normalized.map((weight, weightIndex) => weightIndex === targetIndex ? 0 : weight);
  const otherTotal = others.reduce((sum, weight) => sum + weight, 0) || normalized.length - 1;
  const distributable = 1 - target - minimum * (normalized.length - 1);
  return normalized.map((_, weightIndex) => weightIndex === targetIndex ? target : minimum + distributable * (others[weightIndex] || 1) / otherTotal);
}

export function trackWeightsToBoundaries(weights) {
  const normalized = normalizeTrackWeights(weights, weights?.length || 1);
  let position = 0;
  return normalized.slice(0, -1).map((weight) => (position += weight) * 100);
}

export function trackBoundariesToWeights(boundaries, count) {
  const length = clamp(Math.floor(finiteNumber(count, 1)), 1, 3);
  if (length === 1) return [1];
  const minimum = 5;
  const fallback = Array.from({ length: length - 1 }, (_, index) => (index + 1) / length * 100);
  const positions = Array.from({ length: length - 1 }, (_, index) => finiteNumber(boundaries?.[index], fallback[index])).sort((a, b) => a - b).map((position, index) => clamp(position, minimum * (index + 1), 100 - minimum * (length - index - 1)));
  return normalizeTrackWeights([...positions.map((position, index) => position - (positions[index - 1] || 0)), 100 - positions.at(-1)], length);
}

function resizeTrackWeights(raw, sourceCount, targetCount) {
  const source = normalizeTrackWeights(raw, sourceCount);
  if (targetCount <= sourceCount) return normalizeTrackWeights(source.slice(0, targetCount), targetCount);
  const newTrackShare = 1 / targetCount;
  const retainedShare = sourceCount / targetCount;
  return [...source.map((weight) => weight * retainedShare), ...Array.from({ length: targetCount - sourceCount }, () => newTrackShare)];
}

function withContentGrid(cell, contentGrid) {
  const first = contentGrid.cells[0] || defaultContentCell();
  return { ...cell, ...first, contentGrid };
}

export function contentCellCoordinate(contentGrid, index) {
  const { columns } = contentGridDimensions(contentGrid);
  const safeIndex = Math.max(0, Math.floor(finiteNumber(index, 0)));
  return { row: Math.floor(safeIndex / columns), column: safeIndex % columns };
}

export function resizeContentGrid(cell, columns, rows) {
  const source = cell.contentGrid || { columns: 1, rows: 1, cells: [normalizeContentCell(cell)] };
  const sourceDimensions = contentGridDimensions(source);
  const targetDimensions = contentGridDimensions({ columns, rows });
  const cells = Array.from({ length: targetDimensions.columns * targetDimensions.rows }, (_, index) => {
    const row = Math.floor(index / targetDimensions.columns);
    const column = index % targetDimensions.columns;
    if (row >= sourceDimensions.rows || column >= sourceDimensions.columns) return defaultContentCell();
    return normalizeContentCell(source.cells?.[row * sourceDimensions.columns + column]);
  });
  return withContentGrid(cell, {
    ...targetDimensions,
    columnWeights: resizeTrackWeights(source.columnWeights, sourceDimensions.columns, targetDimensions.columns),
    rowWeights: resizeTrackWeights(source.rowWeights, sourceDimensions.rows, targetDimensions.rows),
    cells,
  });
}

export function setContentGridProportions(cell, columnWeights, rowWeights) {
  const grid = cell.contentGrid || { columns: 1, rows: 1, cells: [normalizeContentCell(cell)] };
  const dimensions = contentGridDimensions(grid);
  return withContentGrid(cell, {
    ...grid,
    ...dimensions,
    columnWeights: normalizeTrackWeights(columnWeights, dimensions.columns),
    rowWeights: normalizeTrackWeights(rowWeights, dimensions.rows),
  });
}

export function copyContentLayout(source, target) {
  const resized = resizeContentGrid(target, source.contentGrid.columns, source.contentGrid.rows);
  return setContentGridProportions(resized, source.contentGrid.columnWeights, source.contentGrid.rowWeights);
}

export function patchContentAtCoordinate(cells, selection, sourceLabelIndex, sourceContentIndex, patch) {
  const sourceGrid = cells[sourceLabelIndex]?.contentGrid || { columns: 1, rows: 1 };
  const { row, column } = contentCellCoordinate(sourceGrid, sourceContentIndex);
  return patchSelectedCells(cells, selection, (label) => {
    const grid = label.contentGrid || { columns: 1, rows: 1, cells: [normalizeContentCell(label)] };
    const dimensions = contentGridDimensions(grid);
    if (row >= dimensions.rows || column >= dimensions.columns) return {};
    const index = row * dimensions.columns + column;
    const contentCells = grid.cells.map((contentCell, contentIndex) => contentIndex === index ? { ...contentCell, ...patch(contentCell, contentIndex) } : contentCell);
    return withContentGrid(label, { ...grid, ...dimensions, cells: contentCells });
  });
}

export function copyContentAtCoordinate(source, target, sourceContentIndex, copy) {
  const sourceGrid = source.contentGrid || { columns: 1, rows: 1, cells: [normalizeContentCell(source)] };
  const targetGrid = target.contentGrid || { columns: 1, rows: 1, cells: [normalizeContentCell(target)] };
  const { row, column } = contentCellCoordinate(sourceGrid, sourceContentIndex);
  const dimensions = contentGridDimensions(targetGrid);
  if (row >= dimensions.rows || column >= dimensions.columns) return target;
  const sourceContent = sourceGrid.cells[row * sourceGrid.columns + column];
  const targetIndex = row * dimensions.columns + column;
  const cells = targetGrid.cells.map((contentCell, index) => index === targetIndex ? copy(sourceContent, contentCell) : contentCell);
  return withContentGrid(target, { ...targetGrid, ...dimensions, cells });
}

// A rounded rectangle cannot have a radius larger than half its shortest side.
// The same cap remains valid after a uniform safe inset: (radius - inset) is
// never larger than half of the correspondingly smaller inner dimension.
export function maxCornerRadius(width, height) {
  return Math.max(0, Math.min(width, height) / 2);
}

export function pageSize(state) {
  const [short, long] = PAGE_FORMATS[state.format] || PAGE_FORMATS.A4;
  return state.orientation === 'landscape' ? [long, short] : [short, long];
}

// Keep the SVG's millimetre viewBox, the PDF page, and the raster fallback in one coordinate system.
// jsPDF receives both an explicit millimetre page size and an image destination in millimetres;
// raster pixels only control image quality, never its printed dimensions.
export function pdfExportGeometry(state, dpi = PDF_RASTER_DPI) {
  const [width, height] = pageSize(normalizeSheet(state));
  const rasterDpi = Math.max(1, finiteNumber(dpi, PDF_RASTER_DPI));
  return {
    width,
    height,
    format: [width, height],
    orientation: width > height ? 'landscape' : 'portrait',
    rasterWidth: Math.round(width / MM_PER_INCH * rasterDpi),
    rasterHeight: Math.round(height / MM_PER_INCH * rasterDpi),
  };
}

export function deriveGrid({ format = 'A4', orientation = 'portrait', marginX, marginY, margin = 0, labelWidth = MIN_CELL_SIZE, labelHeight = MIN_CELL_SIZE }) {
  const [width, height] = pageSize({ format, orientation });
  const mx = finiteNumber(marginX, finiteNumber(margin, 0));
  const my = finiteNumber(marginY, finiteNumber(margin, 0));
  // Count every full label that fits inside the configured sheet edges. Remaining
  // interior space is distributed evenly between labels by getLabelLayout().
  const fittedColumns = Math.floor(Math.max(MIN_CELL_SIZE, width - mx * 2) / Number(labelWidth));
  const fittedRows = Math.floor(Math.max(MIN_CELL_SIZE, height - my * 2) / Number(labelHeight));
  return { columns: Math.max(1, fittedColumns), rows: Math.max(1, fittedRows) };
}

export function normalizeSheet(raw, { rejectInvalidGeometry = false } = {}) {
  const base = defaultState();
  const source = raw && typeof raw === 'object' ? raw : {};
  const compatibility = templateCompatibility(source);
  if (compatibility.kind === 'future') throw new TemplateVersionError(compatibility.version);
  const { gap: legacyGap, gapX: legacyGapX, gapY: legacyGapY, gridMode: legacyGridMode, ...sourceWithoutLegacySpacing } = source;
  const format = PAGE_FORMATS[source.format] ? source.format : base.format;
  const orientation = source.orientation === 'landscape' ? 'landscape' : 'portrait';
  const [width, height] = pageSize({ format, orientation });
  // Legacy gaps are used only once to infer missing legacy label dimensions. They
  // are deliberately omitted from the normalized v4 template and never affect a
  // new layout.
  const requestedMarginX = finiteNumber(source.marginX, finiteNumber(source.margin, base.marginX));
  const requestedMarginY = finiteNumber(source.marginY, finiteNumber(source.margin, base.marginY));
  const migrationGapX = Math.max(0, finiteNumber(legacyGapX, finiteNumber(legacyGap, 0)));
  const migrationGapY = Math.max(0, finiteNumber(legacyGapY, finiteNumber(legacyGap, 0)));
  const marginX = clamp(requestedMarginX, 0, width / 2 - MIN_CELL_SIZE / 2);
  const marginY = clamp(requestedMarginY, 0, height / 2 - MIN_CELL_SIZE / 2);
  const hasLabelDimensions = Number.isFinite(Number(source.labelWidth)) && Number.isFinite(Number(source.labelHeight));
  const legacyWidth = (width - marginX * 2 - migrationGapX * (Math.max(1, Number(source.columns) || base.columns) - 1)) / Math.max(1, Number(source.columns) || base.columns);
  const legacyHeight = (height - marginY * 2 - migrationGapY * (Math.max(1, Number(source.rows) || base.rows) - 1)) / Math.max(1, Number(source.rows) || base.rows);
  const requestedLabelWidth = finiteNumber(source.labelWidth, hasLabelDimensions ? base.labelWidth : legacyWidth);
  const requestedLabelHeight = finiteNumber(source.labelHeight, hasLabelDimensions ? base.labelHeight : legacyHeight);
  let labelWidth = clamp(requestedLabelWidth, MIN_CELL_SIZE, width - marginX * 2);
  let labelHeight = clamp(requestedLabelHeight, MIN_CELL_SIZE, height - marginY * 2);
  if (rejectInvalidGeometry && (requestedMarginX !== marginX || requestedMarginY !== marginY || requestedLabelWidth !== labelWidth || requestedLabelHeight !== labelHeight)) throw new SheetGeometryError();
  let derived = deriveGrid({ format, orientation, marginX, marginY, labelWidth, labelHeight });
  // Old manual grids can contain more cells than the new fitted layout. Convert
  // those populated templates to equivalent fitted dimensions before truncating
  // anything, so importing them does not silently discard label artwork.
  const legacyColumns = Math.max(1, Math.floor(finiteNumber(source.columns, 0)));
  const legacyRows = Math.max(1, Math.floor(finiteNumber(source.rows, 0)));
  if (legacyGridMode === 'manual' && Array.isArray(source.cells) && source.cells.length > derived.columns * derived.rows) {
    labelWidth = (width - marginX * 2) / legacyColumns;
    labelHeight = (height - marginY * 2) / legacyRows;
    derived = deriveGrid({ format, orientation, marginX, marginY, labelWidth, labelHeight });
  }
  const columns = derived.columns;
  const rows = derived.rows;
  const cornerRadius = clamp(finiteNumber(source.cornerRadius, base.cornerRadius), 0, maxCornerRadius(labelWidth, labelHeight));
  const count = columns * rows;
  const cells = Array.from({ length: count }, (_, index) => {
    const sourceCell = source.cells?.[index] || {};
    const cell = { ...defaultCell(), ...sourceCell };
    const normalized = {
      ...cell,
      text: typeof cell.text === 'string' ? cell.text : String(cell.text ?? ''),
      background: COLOR.test(cell.background) ? cell.background : base.cells[0].background,
      color: COLOR.test(cell.color) ? cell.color : base.cells[0].color,
      fontFamily: FONT_OPTION_BY_VALUE.has(cell.fontFamily) ? cell.fontFamily : DEFAULT_FONT_FAMILY,
      pattern: CELL_PATTERNS.has(cell.pattern) ? cell.pattern : 'none',
      // Templates before v5 layered all artwork types. Migrate them to exactly
      // one deterministic active mode while retaining inactive settings so a
      // person can switch back without losing their configured artwork.
      appearanceMode: Object.hasOwn(sourceCell, 'appearanceMode')
        ? (CELL_APPEARANCE_MODES.has(sourceCell.appearanceMode) ? sourceCell.appearanceMode : 'solid')
        : cell.image ? 'image' : CELL_PATTERNS.has(cell.pattern) && cell.pattern !== 'none' ? 'pattern' : 'solid',
      fontSize: clamp(finiteNumber(cell.fontSize, 15), 6, 72),
      textStyle: TEXT_STYLES.has(sourceCell.textStyle) ? sourceCell.textStyle : cell.weight === '400' ? 'normal' : 'bold',
      weight: TEXT_STYLES.has(sourceCell.textStyle) ? (sourceCell.textStyle === 'bold' ? '700' : '400') : cell.weight === '400' ? '400' : '700',
      align: CELL_ALIGNS.has(cell.align) ? cell.align : 'center',
      valign: CELL_VALIGNS.has(cell.valign) ? cell.valign : 'middle',
      image: typeof cell.image === 'string' ? cell.image : '',
      // Preserve configured template values exactly (subject to the existing
      // physical bound). Missing legacy values were never an explicit border,
      // so they use the opt-in default rather than creating a white gap.
      safeInset: clamp(finiteNumber(cell.safeInset, 0), 0, Math.max(0, (Math.min(labelWidth, labelHeight) - MIN_SAFE_ARTWORK_SIZE) / 2)),
      printBorderEnabled: cell.printBorderEnabled === true,
      printBorderColor: COLOR.test(cell.printBorderColor) ? cell.printBorderColor : defaultCell().printBorderColor,
      printBorderWidth: clamp(finiteNumber(cell.printBorderWidth, .5), .1, Math.min(10, Math.min(labelWidth, labelHeight) / 2)),
      printBorderStyle: PRINT_BORDER_STYLES.has(cell.printBorderStyle) ? cell.printBorderStyle : 'solid',
      imageZoom: clamp(finiteNumber(cell.imageZoom, 1), 1, 4),
      imageX: clamp(finiteNumber(cell.imageX, 0), -100, 100),
      imageY: clamp(finiteNumber(cell.imageY, 0), -100, 100),
      imageWidth: Math.max(0, finiteNumber(cell.imageWidth, 0)),
      imageHeight: Math.max(0, finiteNumber(cell.imageHeight, 0)),
      rotation: normalizeRotation(cell.rotation),
    };
    const rawGrid = sourceCell.contentGrid && typeof sourceCell.contentGrid === 'object'
      ? sourceCell.contentGrid
      : { columns: 1, rows: 1, cells: [sourceCell] };
    const dimensions = contentGridDimensions(rawGrid);
    const contentCells = Array.from({ length: dimensions.columns * dimensions.rows }, (_, contentIndex) => normalizeContentCell(rawGrid.cells?.[contentIndex]));
    return withContentGrid(normalized, {
      ...dimensions,
      columnWeights: normalizeTrackWeights(rawGrid.columnWeights, dimensions.columns),
      rowWeights: normalizeTrackWeights(rawGrid.rowWeights, dimensions.rows),
      cells: contentCells,
    });
  });
  return { ...base, ...sourceWithoutLegacySpacing, version: TEMPLATE_VERSION, format, orientation, marginX, marginY, labelWidth, labelHeight, cornerRadius, columns, rows, cells };
}

export function serializeTemplate(state) {
  return JSON.stringify(normalizeSheet(state), null, 2);
}

export function parseTemplateJson(json, options = {}) {
  const raw = JSON.parse(json);
  const compatibility = templateCompatibility(raw);
  if (!compatibility.compatible) {
    if (compatibility.kind === 'future') throw new TemplateVersionError(compatibility.version);
    throw new TypeError('Invalid Sticker Sheet Studio template.');
  }
  return normalizeSheet(raw, { ...options, rejectInvalidGeometry: true });
}

export function copyTextSettings(source, target) {
  return { ...target, text: source.text, color: source.color, fontFamily: source.fontFamily, fontSize: source.fontSize, textStyle: source.textStyle, weight: source.weight, align: source.align, valign: source.valign };
}

export function copyStyleSettings(source, target) {
  return { ...target, color: source.color, fontFamily: source.fontFamily, fontSize: source.fontSize, textStyle: source.textStyle, weight: source.weight, align: source.align, valign: source.valign, rotation: source.rotation };
}

export function copyAppearanceSettings(source, target) {
  return { ...target, appearanceMode: source.appearanceMode, background: source.background, pattern: source.pattern, image: source.image, imageWidth: source.imageWidth, imageHeight: source.imageHeight, imageZoom: source.imageZoom, imageX: source.imageX, imageY: source.imageY, safeInset: source.safeInset, printBorderEnabled: source.printBorderEnabled, printBorderColor: source.printBorderColor, printBorderWidth: source.printBorderWidth, printBorderStyle: source.printBorderStyle };
}

export function copyEntireLabel(source) {
  return {
    ...source,
    contentGrid: {
      ...source.contentGrid,
      columnWeights: [...source.contentGrid.columnWeights],
      rowWeights: [...source.contentGrid.rowWeights],
      cells: source.contentGrid.cells.map((cell) => ({ ...cell })),
    },
  };
}

export function normalizeSelection(selection, cellCount, fallback = 0) {
  const valid = [...new Set(selection || [])].filter((index) => Number.isInteger(index) && index >= 0 && index < cellCount);
  return valid.length ? valid : (cellCount ? [Math.min(Math.max(0, fallback), cellCount - 1)] : []);
}

export function patchSelectedCells(cells, selection, patch) {
  const selected = new Set(normalizeSelection(selection, cells.length));
  return cells.map((cell, index) => selected.has(index) ? { ...cell, ...patch(cell, index) } : cell);
}

export function resetSelectedCells(cells, selection) {
  return patchSelectedCells(cells, selection, () => emptyLabel());
}

export function hasLabelContent(cell) {
  const label = { ...emptyLabel(), ...(cell || {}) };
  return JSON.stringify(label) !== JSON.stringify(emptyLabel());
}

export function getLabelLayout(state) {
  const sheet = normalizeSheet(state);
  const [width, height] = pageSize(sheet);
  const printableWidth = width - sheet.marginX * 2;
  const printableHeight = height - sheet.marginY * 2;
  // This is the single canonical placement contract: distribute remaining
  // interior space between labels so multi-label grids touch both configured
  // sheet-edge margins exactly. A single-label axis starts at its leading edge;
  // its remaining interior space stays after the label.
  const gapX = sheet.columns > 1 ? (printableWidth - sheet.columns * sheet.labelWidth) / (sheet.columns - 1) : 0;
  const gapY = sheet.rows > 1 ? (printableHeight - sheet.rows * sheet.labelHeight) / (sheet.rows - 1) : 0;
  return {
    width,
    height,
    cellWidth: sheet.labelWidth,
    cellHeight: sheet.labelHeight,
    x: sheet.marginX,
    y: sheet.marginY,
    gapX,
    gapY,
    unusedWidth: sheet.columns === 1 ? printableWidth - sheet.labelWidth : 0,
    unusedHeight: sheet.rows === 1 ? printableHeight - sheet.labelHeight : 0,
  };
}

export function pdfRasterLabelGeometry(state, dpi = PDF_RASTER_DPI) {
  const sheet = normalizeSheet(state);
  const layout = getLabelLayout(sheet);
  const pixelsPerMm = Math.max(1, finiteNumber(dpi, PDF_RASTER_DPI)) / MM_PER_INCH;
  return {
    pixelsPerMm,
    page: pdfExportGeometry(sheet, dpi),
    labels: sheet.cells.map((_, index) => {
      const column = index % sheet.columns;
      const row = Math.floor(index / sheet.columns);
      return {
        x: (layout.x + column * (layout.cellWidth + layout.gapX)) * pixelsPerMm,
        y: (layout.y + row * (layout.cellHeight + layout.gapY)) * pixelsPerMm,
        width: layout.cellWidth * pixelsPerMm,
        height: layout.cellHeight * pixelsPerMm,
      };
    }),
  };
}

export function escapeXml(value = '') {
  return String(value).replace(/[<>&"']/g, (char) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[char]));
}

// The safety border is a uniform physical millimetre inset from each cutout
// edge. Every artwork layer uses this rectangle; text intentionally keeps the
// full content layout. `width`/`height` may be the swapped content axes used by
// a quarter-turn rotation, but the inset stays physically uniform.
export function safeArea(cell, x, y, width, height) {
  const maxInset = Math.max(0, (Math.min(width, height) - MIN_SAFE_ARTWORK_SIZE) / 2);
  const inset = clamp(finiteNumber(cell.safeInset, 0), 0, maxInset);
  return { x: x + inset, y: y + inset, width: width - inset * 2, height: height - inset * 2, inset };
}

// Insetting a rounded cutout reduces the inner artwork radius by the same
// physical amount. At a square/fully-round cutout this cleanly reaches zero
// instead of producing an invalid negative SVG/CSS radius.
export function safeCornerRadius(cornerRadius, inset) {
  return Math.max(0, finiteNumber(cornerRadius, 0) - finiteNumber(inset, 0));
}

export function imageCropBox(cell, x, y, width, height) {
  const inner = safeArea(cell, x, y, width, height);
  const ratio = cell.imageWidth > 0 && cell.imageHeight > 0 ? cell.imageWidth / cell.imageHeight : inner.width / inner.height;
  const scale = Math.max(inner.width / ratio, inner.height) * cell.imageZoom;
  const imageWidth = scale * ratio;
  const imageHeight = scale;
  return {
    ...inner,
    imageWidth,
    imageHeight,
    imageX: inner.x - (imageWidth - inner.width) * ((cell.imageX + 100) / 200),
    imageY: inner.y - (imageHeight - inner.height) * ((cell.imageY + 100) / 200),
    backgroundSize: `${imageWidth / inner.width * 100}% ${imageHeight / inner.height * 100}%`,
    backgroundPosition: `${(cell.imageX + 100) / 2}% ${(cell.imageY + 100) / 2}%`,
  };
}

// Rotation is content-only: its coordinate system is swapped for quarter turns,
// then centered and clipped back to the fixed physical print-safe area.
export function contentDimensions(cell, width, height) {
  return cell.rotation === 270 ? { width: height, height: width } : { width, height };
}

// Crop state is always stored in the unrotated content coordinate system. These
// two conversions are the sole bridge between that coordinate system and what a
// person sees on the physical label/crop dialog. At 270°, local right points up
// on screen and local down points right on screen.
export function cropScreenDeltaToLocal(cell, deltaX, deltaY) {
  return cell.rotation === 270
    ? { x: deltaY === 0 ? 0 : -deltaY, y: deltaX }
    : { x: deltaX, y: deltaY };
}

export function cropLocalPointToScreen(cell, x, y, contentWidth) {
  return cell.rotation === 270
    ? { x: y, y: contentWidth - x }
    : { x, y };
}

// Return the normalized source-image rectangle exposed by a crop. It makes the
// marker/fixture tests independent of CSS percentage-position semantics while
// also documenting the exact SVG, preview, and dialog crop contract.
export function imageCropSourceRect(crop) {
  return {
    x: (crop.x - crop.imageX) / crop.imageWidth,
    y: (crop.y - crop.imageY) / crop.imageHeight,
    width: crop.width / crop.imageWidth,
    height: crop.height / crop.imageHeight,
  };
}

export function getSvg(state) {
  const sheet = normalizeSheet(state);
  const layout = getLabelLayout(sheet);
  const { width, height, cellWidth, cellHeight, x: gridX, y: gridY } = layout;
  const dotTile = 4 * MM_PER_CSS_PIXEL;
  const dotRadius = MM_PER_CSS_PIXEL;
  const stripeWidth = 3 * MM_PER_CSS_PIXEL;
  const stripePeriod = 6 * MM_PER_CSS_PIXEL;
  const defs = `<pattern id="dots" width="${dotTile}" height="${dotTile}" patternUnits="userSpaceOnUse"><circle cx="${dotRadius}" cy="${dotRadius}" r="${dotRadius}" fill="rgba(0,0,0,.18)"/></pattern><pattern id="stripes" width="${stripePeriod}" height="${stripePeriod}" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="${stripePeriod}" height="${stripePeriod}" fill="rgba(255,255,255,.25)"/><rect width="${stripeWidth}" height="${stripePeriod}" fill="rgba(0,0,0,.1)"/></pattern>`;
  const content = sheet.cells.map((cell, index) => {
    const col = index % sheet.columns;
    const row = Math.floor(index / sheet.columns);
    const x = gridX + col * (cellWidth + layout.gapX);
    const y = gridY + row * (cellHeight + layout.gapY);
    const contentSize = contentDimensions(cell, cellWidth, cellHeight);
    const crop = imageCropBox(cell, 0, 0, contentSize.width, contentSize.height);
    const innerRadius = safeCornerRadius(sheet.cornerRadius, crop.inset);
    const contentClip = `<clipPath id="safe${index}"><rect x="${crop.x}" y="${crop.y}" width="${crop.width}" height="${crop.height}" rx="${innerRadius}"/></clipPath>`;
    const physicalSafe = safeArea(cell, x, y, cellWidth, cellHeight);
    const safeClip = `<clipPath id="labelSafe${index}"><rect x="${physicalSafe.x}" y="${physicalSafe.y}" width="${physicalSafe.width}" height="${physicalSafe.height}" rx="${safeCornerRadius(sheet.cornerRadius, physicalSafe.inset)}"/></clipPath>`;
    const image = cell.appearanceMode === 'image' && cell.image ? `<image href="${escapeXml(cell.image)}" x="${crop.imageX}" y="${crop.imageY}" width="${crop.imageWidth}" height="${crop.imageHeight}" preserveAspectRatio="none" clip-path="url(#safe${index})"/>` : '';
    const solid = cell.appearanceMode === 'solid' || cell.appearanceMode === 'pattern' ? `<rect x="${crop.x}" y="${crop.y}" width="${crop.width}" height="${crop.height}" rx="${innerRadius}" fill="${escapeXml(cell.background)}"/>` : '';
    const pattern = cell.appearanceMode === 'pattern' && cell.pattern !== 'none' ? `<rect x="${crop.x}" y="${crop.y}" width="${crop.width}" height="${crop.height}" rx="${innerRadius}" fill="url(#${cell.pattern})"/>` : '';
    const borderInset = cell.printBorderWidth / 2;
    const borderDash = cell.printBorderStyle === 'dashed'
      ? ` stroke-dasharray="${cell.printBorderWidth * 4} ${cell.printBorderWidth * 2}"`
      : cell.printBorderStyle === 'dotted'
        ? ` stroke-dasharray="0 ${cell.printBorderWidth * 2.5}" stroke-linecap="round"`
        : '';
    const printableBorder = cell.printBorderEnabled ? `<rect x="${x + borderInset}" y="${y + borderInset}" width="${cellWidth - cell.printBorderWidth}" height="${cellHeight - cell.printBorderWidth}" rx="${Math.max(0, sheet.cornerRadius - borderInset)}" fill="none" stroke="${escapeXml(cell.printBorderColor)}" stroke-width="${cell.printBorderWidth}"${borderDash}/>` : '';
    const grid = cell.contentGrid;
    const columnWidths = grid.columnWeights.map((weight) => cellWidth * weight);
    const rowHeights = grid.rowWeights.map((weight) => cellHeight * weight);
    const text = grid.cells.map((contentCell, contentIndex) => {
      const contentColumn = contentIndex % grid.columns;
      const contentRow = Math.floor(contentIndex / grid.columns);
      const subcellWidth = columnWidths[contentColumn];
      const subcellHeight = rowHeights[contentRow];
      const subcellX = x + columnWidths.slice(0, contentColumn).reduce((sum, value) => sum + value, 0);
      const subcellY = y + rowHeights.slice(0, contentRow).reduce((sum, value) => sum + value, 0);
      const subcellSize = contentDimensions(contentCell, subcellWidth, subcellHeight);
      const horizontalInset = grid.columns === 1 && grid.rows === 1 ? 4 : Math.min(4, subcellSize.width * .08);
      const topInset = grid.columns === 1 && grid.rows === 1 ? 8 : Math.min(8, subcellSize.height * .15);
      const bottomInset = grid.columns === 1 && grid.rows === 1 ? 7 : topInset;
      const lines = escapeXml(contentCell.text).split('\n');
      const anchor = contentCell.align === 'left' ? 'start' : contentCell.align === 'right' ? 'end' : 'middle';
      const tx = contentCell.align === 'left' ? horizontalInset : contentCell.align === 'right' ? subcellSize.width - horizontalInset : subcellSize.width / 2;
      const exportFontSize = Number(contentCell.fontSize) * MM_PER_CSS_PIXEL;
      const lineHeight = exportFontSize * 1.18;
      const firstLineY = contentCell.valign === 'top'
        ? topInset + exportFontSize / 2
        : contentCell.valign === 'bottom'
          ? subcellSize.height - bottomInset - exportFontSize / 2 - lineHeight * (lines.length - 1)
          : subcellSize.height / 2 - lineHeight * (lines.length - 1) / 2;
      const fontWeight = contentCell.textStyle === 'bold' ? '700' : '400';
      const fontStyle = contentCell.textStyle === 'italic' ? 'italic' : 'normal';
      const textDecoration = contentCell.textStyle === 'underline' ? 'underline' : 'none';
      const textLines = lines.map((line, lineIndex) => `<text x="${tx}" y="${firstLineY + lineIndex * lineHeight}" dominant-baseline="middle" text-anchor="${anchor}" font-family="${escapeXml(fontFamilyStack(contentCell.fontFamily))}" font-size="${exportFontSize}" font-weight="${fontWeight}" font-style="${fontStyle}" text-decoration="${textDecoration}" fill="${escapeXml(contentCell.color)}">${line || ' '}</text>`).join('');
      const textClipId = `content${index}-${contentIndex}`;
      const textClip = `<clipPath id="${textClipId}"><rect x="0" y="0" width="${subcellSize.width}" height="${subcellSize.height}"/></clipPath>`;
      const textTransform = `translate(${subcellX + subcellWidth / 2} ${subcellY + subcellHeight / 2}) rotate(${contentCell.rotation}) translate(${-subcellSize.width / 2} ${-subcellSize.height / 2})`;
      return `<defs>${textClip}</defs><g clip-path="url(#labelSafe${index})"><g transform="${textTransform}" clip-path="url(#${textClipId})">${textLines}</g></g>`;
    }).join('');
    // This is the SVG counterpart of cropLocalPointToScreen(): content is
    // centered in the fixed label and then quarter-turned around that center.
    const transform = `translate(${x + cellWidth / 2} ${y + cellHeight / 2}) rotate(${cell.rotation}) translate(${-contentSize.width / 2} ${-contentSize.height / 2})`;
    return `<g><defs>${contentClip}${safeClip}</defs><rect x="${x}" y="${y}" width="${cellWidth}" height="${cellHeight}" rx="${sheet.cornerRadius}" fill="white"/><g clip-path="url(#labelSafe${index})"><g transform="${transform}">${solid}${image}${pattern}</g></g>${text}${printableBorder}</g>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}mm" height="${height}mm" viewBox="0 0 ${width} ${height}"><defs>${defs}</defs><rect width="${width}" height="${height}" fill="white"/>${content}</svg>`;
}
