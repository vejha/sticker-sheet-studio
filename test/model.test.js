import test from 'node:test';
import assert from 'node:assert/strict';
import { contentDimensions, copyAppearanceSettings, copyStyleSettings, copyTextSettings, cropLocalPointToScreen, cropScreenDeltaToLocal, defaultState, deriveGrid, emptyLabel, getLabelLayout, getSvg, hasLabelContent, imageCropBox, imageCropSourceRect, maxCornerRadius, MIN_SAFE_ARTWORK_SIZE, normalizeSelection, normalizeSheet, pageSize, patchSelectedCells, pdfExportGeometry, pdfRasterLabelGeometry, resetSelectedCells, safeArea, safeCornerRadius, SheetGeometryError } from '../src/model.js';

test('normalizes grid dimensions and supplies all needed cells', () => {
  const sheet = normalizeSheet({ columns: 2, rows: 3, cells: [{ text: 'First' }] });
  assert.equal(sheet.cells.length, 6);
  assert.equal(sheet.cells[0].text, 'First');
  assert.equal(sheet.cells[5].text, '');
});

test('uses the selected orientation for page dimensions', () => {
  assert.deepEqual(pageSize(defaultState()), [210, 297]);
  assert.deepEqual(pageSize({ ...defaultState(), orientation: 'landscape' }), [297, 210]);
});

test('defaults labels to blank rounded rectangles and clamps shared corner radius to valid label geometry', () => {
  assert.equal(defaultState().cornerRadius, 4);
  assert.equal(defaultState().labelWidth, 60);
  assert.equal(defaultState().labelHeight, 40);
  assert.equal(defaultState().cells[0].text, '');
  assert.equal(defaultState().cells[0].background, '#ffffff');
  assert.equal(maxCornerRadius(60, 40), 20);
  assert.equal(normalizeSheet({ labelWidth: 60, labelHeight: 40, cornerRadius: 999 }).cornerRadius, 20);
  assert.equal(normalizeSheet({ labelWidth: 60, labelHeight: 40, cornerRadius: -1 }).cornerRadius, 0);
});

test('makes the print-safe border opt-in without changing explicitly saved inset values', () => {
  const defaults = defaultState();
  assert.equal(defaults.cells[0].safeInset, 0);
  assert.equal(normalizeSheet({ columns: 1, rows: 1, cells: [{}] }).cells[0].safeInset, 0);
  assert.equal(normalizeSheet({ columns: 1, rows: 1, cells: [{ safeInset: 2 }] }).cells[0].safeInset, 2);
  const svg = getSvg(normalizeSheet({ columns: 1, rows: 1, labelWidth: 60, labelHeight: 40, cornerRadius: 8, cells: [{ appearanceMode: 'solid', background: '#123456' }] }));
  assert.match(svg, /<rect x="12" y="12" width="60" height="40" rx="8" fill="white"\/><g clip-path="url\(#labelSafe0\)"><g[^>]*><rect x="0" y="0" width="60" height="40" rx="8" fill="#123456"/);
});

test('exports matching outer and inset-adjusted rounded geometry for solid, pattern, and image artwork', () => {
  const sheet = normalizeSheet({ columns: 1, rows: 1, labelWidth: 60, labelHeight: 40, cornerRadius: 12, cells: [{ safeInset: 4, appearanceMode: 'image', image: 'data:image/svg+xml;base64,PHN2Zy8+', imageWidth: 1, imageHeight: 1 }] });
  const svg = getSvg(sheet);
  assert.equal(safeCornerRadius(sheet.cornerRadius, 4), 8);
  assert.match(svg, /<rect x="12" y="12" width="60" height="40" rx="12" fill="white"/);
  assert.match(svg, /<clipPath id="labelSafe0"><rect x="16" y="16" width="52" height="32" rx="8"/);
  assert.match(svg, /<clipPath id="safe0"><rect x="4" y="4" width="52" height="32" rx="8"/);
  assert.match(svg, /<image\b[^>]*clip-path="url\(#safe0\)"/);
});

test('preserves and migrates the shared corner radius in templates without changing cutout dimensions', () => {
  const rounded = normalizeSheet({ labelWidth: 55, labelHeight: 37, cornerRadius: 8, cells: [{ text: 'Rounded' }] });
  assert.equal(normalizeSheet(JSON.parse(JSON.stringify(rounded))).cornerRadius, 8);
  assert.equal(normalizeSheet({ labelWidth: 55, labelHeight: 37 }).cornerRadius, 4);
  assert.match(getSvg(rounded), /width="55" height="37" rx="8" fill="white"/);
});

test('generates an SVG with a cell and escaped label text', () => {
  const sheet = normalizeSheet({ columns: 1, rows: 1, cells: [{ text: '<safe & sound>' }] });
  const svg = getSvg(sheet);
  assert.match(svg, /<svg/);
  assert.match(svg, /&lt;safe &amp; sound&gt;/);
});

test('migrates legacy layered artwork deterministically to one appearance mode', () => {
  const sheet = normalizeSheet({ labelWidth: 50, labelHeight: 50, cells: [
    { background: '#123456', pattern: 'dots', image: 'data:image/png;base64,legacy' },
    { background: '#123456', pattern: 'stripes' },
    { background: '#123456', pattern: 'none' },
    { appearanceMode: 'unknown', image: 'data:image/png;base64,ignored' },
  ] });
  assert.deepEqual(sheet.cells.slice(0, 4).map((cell) => cell.appearanceMode), ['image', 'pattern', 'solid', 'solid']);
});

test('renders only the active appearance layer while retaining inactive settings for reversible switching', () => {
  const base = { background: '#123456', pattern: 'dots', image: 'data:image/png;base64,fixture', imageWidth: 20, imageHeight: 20 };
  const solid = getSvg(normalizeSheet({ columns: 1, rows: 1, cells: [{ ...base, appearanceMode: 'solid' }] }));
  const pattern = getSvg(normalizeSheet({ columns: 1, rows: 1, cells: [{ ...base, appearanceMode: 'pattern' }] }));
  const image = getSvg(normalizeSheet({ columns: 1, rows: 1, cells: [{ ...base, appearanceMode: 'image' }] }));
  assert.doesNotMatch(solid, /<image\b|url\(#dots\)/);
  assert.match(pattern, /fill="#123456"/);
  assert.match(pattern, /url\(#dots\)/);
  assert.doesNotMatch(pattern, /<image\b/);
  assert.match(image, /<image\b/);
  assert.doesNotMatch(image, /fill="#123456"|url\(#dots\)/);
  const restored = normalizeSheet({ columns: 1, rows: 1, cells: [{ ...base, appearanceMode: 'solid' }] }).cells[0];
  assert.equal(restored.image, base.image);
  assert.equal(restored.pattern, 'dots');
});

test('normalizes content rotation to normal or 270 degrees and preserves fixed cutout geometry', () => {
  const sheet = normalizeSheet({ columns: 1, rows: 1, labelWidth: 60, labelHeight: 40, cells: [{ rotation: 90 }, { rotation: 180 }, { rotation: 45 }] });
  assert.equal(sheet.cells[0].rotation, 270);
  assert.equal(sheet.cells[1].rotation, 0);
  assert.equal(sheet.cells[2].rotation, 0);
  const svg = getSvg(sheet);
  assert.match(svg, /<rect x="12" y="12" width="60" height="40" rx="4" fill="white"/);
  assert.match(svg, /rotate\(270\)/);
  assert.match(svg, /translate\(-20 -30\)/);
});

test('keeps label guide borders out of SVG, PDF, and print export sources', () => {
  const sheet = normalizeSheet({ columns: 1, rows: 1, cells: [{ background: '#123456', safeInset: 4 }] });
  const svg = getSvg(sheet);

  assert.doesNotMatch(svg, /#c8c4bb/i);
  assert.doesNotMatch(svg, /stroke="#c8c4bb"/i);
  assert.match(svg, /fill="#123456"/i);
});

test('clamps sheet edges so every automatically derived label has positive geometry', () => {
  const sheet = normalizeSheet({ format: 'A4', columns: 12, rows: 20, margin: 500, gap: 20 });
  const layout = getLabelLayout(sheet);
  assert.ok(layout.cellWidth >= 1);
  assert.ok(layout.cellHeight >= 1);
  assert.doesNotMatch(getSvg({ ...sheet, margin: 500, gap: 20 }), /width="-/);
});

test('rejects imported templates with invalid geometry', () => {
  assert.throws(
    () => normalizeSheet({ columns: 12, rows: 5, margin: 12, gap: 20 }, { rejectInvalidGeometry: true }),
    SheetGeometryError,
  );
});

test('derives grid count solely from label dimensions and sheet edges', () => {
  assert.deepEqual(deriveGrid({ format: 'A4', margin: 10, labelWidth: 60, labelHeight: 50 }), { columns: 3, rows: 5 });
  const sheet = normalizeSheet({ margin: 10, gap: 999, gapX: 999, gapY: 999, labelWidth: 60, labelHeight: 50 });
  assert.equal(sheet.columns, 3);
  assert.equal(sheet.rows, 5);
  assert.equal(sheet.cells.length, 15);
  assert.equal('gapX' in sheet, false);
  assert.equal('gapY' in sheet, false);
});

test('exports configured label dimensions at configured sheet margins', () => {
  const sheet = normalizeSheet({ margin: 10, gap: 5, labelWidth: 60, labelHeight: 50, cells: [{ background: '#123456' }] });
  const svg = getSvg(sheet);
  assert.match(svg, /<rect x="10" y="10" width="60" height="50" rx="4" fill="white"/);
  assert.doesNotMatch(svg, /width="60" height="51\.4/);
});

test('uses one edge-aligned canonical geometry for portrait and landscape SVG/PDF sources', () => {
  for (const orientation of ['portrait', 'landscape']) {
    const sheet = normalizeSheet({
      format: 'A4', orientation, marginX: 8, marginY: 14,
      labelWidth: 60, labelHeight: 40,
    });
    const layout = getLabelLayout(sheet);
    const [width, height] = pageSize(sheet);
    assert.equal(layout.x, 8);
    assert.equal(layout.y, 14);
    assert.ok(layout.gapX >= 0);
    assert.ok(layout.gapY >= 0);
    assert.equal(layout.x + (sheet.columns - 1) * (layout.cellWidth + layout.gapX) + layout.cellWidth, width - 8);
    assert.equal(layout.y + (sheet.rows - 1) * (layout.cellHeight + layout.gapY) + layout.cellHeight, height - 14);
    const svg = getSvg(sheet);
    assert.match(svg, new RegExp(`<rect x="8" y="14" width="60" height="40" rx="4" fill="white"`));
    assert.deepEqual(pdfExportGeometry(sheet).format, [width, height]);
  }
});

test('ignores legacy manual counts so grid geometry cannot overflow', () => {
  const sheet = normalizeSheet({ gridMode: 'manual', columns: 12, rows: 20, marginX: 12, marginY: 12, labelWidth: 55, labelHeight: 50 });
  assert.deepEqual([sheet.columns, sheet.rows], [3, 5]);
  assert.equal('gridMode' in sheet, false);
});

test('migrates populated legacy manual grids without dropping their labels', () => {
  const cells = Array.from({ length: 20 }, (_, index) => ({ text: `Legacy ${index + 1}` }));
  const sheet = normalizeSheet({ gridMode: 'manual', columns: 4, rows: 5, labelWidth: 55, labelHeight: 50, cells });
  assert.deepEqual([sheet.columns, sheet.rows], [4, 5]);
  assert.equal(sheet.cells.length, 20);
  assert.equal(sheet.cells[19].text, 'Legacy 20');
  assert.equal('gridMode' in sheet, false);
});

test('uses matching millimetre SVG, PDF page, and 300 DPI raster geometry for custom labels', () => {
  const portrait = normalizeSheet({ format: 'A4', orientation: 'portrait', labelWidth: 55, labelHeight: 37, columns: 1, rows: 1, cells: [{ safeInset: 4 }] });
  const portraitPdf = pdfExportGeometry(portrait);
  assert.deepEqual(portraitPdf.format, [210, 297]);
  assert.equal(portraitPdf.orientation, 'portrait');
  assert.deepEqual([portraitPdf.rasterWidth, portraitPdf.rasterHeight], [2480, 3508]);
  assert.match(getSvg(portrait), /width="210mm" height="297mm" viewBox="0 0 210 297"/);
  assert.match(getSvg(portrait), /width="55" height="37" rx="4" fill="white"/);
  assert.match(getSvg(portrait), /width="47" height="29"/);

  const landscape = normalizeSheet({ format: 'A4', orientation: 'landscape', labelWidth: 55, labelHeight: 37, columns: 1, rows: 1 });
  const landscapePdf = pdfExportGeometry(landscape);
  assert.deepEqual(landscapePdf.format, [297, 210]);
  assert.equal(landscapePdf.orientation, 'landscape');
  assert.match(getSvg(landscape), /width="297mm" height="210mm" viewBox="0 0 297 210"/);
});

test('migrates legacy gaps into missing dimensions then removes them from the canonical template', () => {
  const sheet = normalizeSheet({ columns: 3, rows: 5, margin: 12, gap: 3 });
  assert.equal(sheet.columns, 3);
  assert.equal(sheet.rows, 5);
  assert.equal(sheet.marginX, 12);
  assert.equal(sheet.marginY, 12);
  assert.equal('gapX' in sheet, false);
  assert.equal('gapY' in sheet, false);
});

test('uses independent horizontal and vertical margins for layout', () => {
  const sheet = normalizeSheet({ marginX: 8, marginY: 14, labelWidth: 60, labelHeight: 50 });
  assert.deepEqual(deriveGrid(sheet), { columns: 3, rows: 5 });
  const layout = getLabelLayout(sheet);
  assert.notEqual(layout.x, layout.y);
  assert.match(getSvg(sheet), /x="8"|x="11"/);
});

test('provides deterministic A4 300 DPI PDF raster geometry for known sheet edges and labels', () => {
  const sheet = normalizeSheet({ format: 'A4', marginX: 10, marginY: 15, labelWidth: 60, labelHeight: 50 });
  const artifact = pdfRasterLabelGeometry(sheet);
  assert.deepEqual([artifact.page.rasterWidth, artifact.page.rasterHeight], [2480, 3508]);
  assert.equal(artifact.labels.length, 15);
  assert.ok(Math.abs(artifact.labels[0].x - 118.11) < .02);
  assert.ok(Math.abs(artifact.labels[0].y - 177.17) < .02);
  assert.ok(Math.abs(artifact.labels[0].width - 708.66) < .02);
  assert.ok(Math.abs(artifact.labels[0].height - 590.55) < .02);
  assert.ok(Math.abs(artifact.labels[1].x - 885.83) < .02);
  assert.ok(Math.abs(artifact.labels[3].y - 817.91) < .02);
  assert.doesNotMatch(getSvg(sheet), /preview-ruler|verification ruler|<foreignObject/i);
});

test('contains background decorations in the print-safe inset while retaining normal text layout', () => {
  const sheet = normalizeSheet({ columns: 1, rows: 1, labelWidth: 60, labelHeight: 50, cells: [{ safeInset: 4, background: '#123456', pattern: 'dots', text: 'Normal text' }] });
  const svg = getSvg(sheet);
  assert.match(svg, /fill="white"/);
  assert.match(svg, /width="52" height="42"/);
  assert.match(svg, /<text x="/);
});

test('centers middle-aligned export text in the full label content area', () => {
  const sheet = normalizeSheet({ columns: 1, rows: 1, labelWidth: 60, labelHeight: 40, cells: [{ text: 'Centered', valign: 'middle', safeInset: 4 }] });
  const svg = getSvg(sheet);
  assert.match(svg, /<text x="30" y="20" dominant-baseline="middle"/);
  assert.match(svg, /<clipPath id="labelSafe0"><rect x="16" y="16" width="52" height="32"/);
});

test('converts editor CSS pixel text size to physical SVG units', () => {
  const sheet = normalizeSheet({ columns: 1, rows: 1, labelWidth: 60, labelHeight: 40, cells: [{ text: 'Scale', fontSize: 11 }] });
  const svg = getSvg(sheet);
  assert.match(svg, /font-size="2\.91041666666666[0-9]*"/);
  assert.doesNotMatch(svg, /font-size="[^\"]*mm"/);
});

test('converts preview pattern tile sizes to SVG user units', () => {
  const svg = getSvg(defaultState());
  assert.match(svg, /pattern id="dots" width="1\.0583333333333333" height="1\.0583333333333333"/);
  assert.match(svg, /circle cx="0\.26458333333333334" cy="0\.26458333333333334" r="0\.26458333333333334"/);
  assert.match(svg, /pattern id="stripes" width="1\.5875" height="1\.5875"/);
});

test('exports multiline text as explicit centered SVG lines', () => {
  const sheet = normalizeSheet({ columns: 1, rows: 1, labelWidth: 60, labelHeight: 40, cells: [{ text: 'FIRST\nSECOND', fontSize: 11, valign: 'middle' }] });
  const svg = getSvg(sheet);
  assert.match(svg, />FIRST<\/text><text[^>]*>SECOND<\/text>/);
  assert.doesNotMatch(svg, /<tspan/);
});

test('maps image zoom and pan into a safe crop box for SVG and PDF source', () => {
  const cell = normalizeSheet({ columns: 1, rows: 1, labelWidth: 60, labelHeight: 50, cells: [{ image: 'data:image/svg+xml,x', imageWidth: 200, imageHeight: 100, imageZoom: 2, imageX: 100, imageY: -100, safeInset: 3 }] }).cells[0];
  const crop = imageCropBox(cell, 0, 0, 60, 50);
  assert.equal(crop.width, 54);
  assert.equal(crop.height, 44);
  assert.ok(crop.imageWidth > crop.width);
  assert.ok(crop.imageX < crop.x);
});

test('exports background images at full opacity with the safe crop clip retained', () => {
  const sheet = normalizeSheet({
    columns: 1,
    rows: 1,
    labelWidth: 60,
    labelHeight: 50,
    cells: [{
      image: 'data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Crect%20width%3D%221%22%20height%3D%221%22%20fill%3D%22%23c65336%22%2F%3E%3C%2Fsvg%3E',
      imageWidth: 1,
      imageHeight: 1,
      safeInset: 4,
    }],
  });
  const svg = getSvg(sheet);

  assert.match(svg, /<image\b[^>]*clip-path="url\(#safe0\)"/);
  assert.doesNotMatch(svg, /<image\b[^>]*\bopacity=/);
});

test('uses identical cover geometry for CSS previews and SVG/PDF crops across image ratios, zooms, and extreme pans', () => {
  const cases = [
    { imageWidth: 800, imageHeight: 500, imageZoom: 1, imageX: -100, imageY: 100 },
    { imageWidth: 800, imageHeight: 500, imageZoom: 4, imageX: 100, imageY: -100 },
    { imageWidth: 500, imageHeight: 800, imageZoom: 1, imageX: 100, imageY: -100 },
    { imageWidth: 500, imageHeight: 800, imageZoom: 4, imageX: -100, imageY: 100 },
  ];
  for (const values of cases) {
    const cell = normalizeSheet({ columns: 1, rows: 1, labelWidth: 55, labelHeight: 42, cells: [{ safeInset: 4, ...values }] }).cells[0];
    const crop = imageCropBox(cell, 0, 0, 55, 42);
    const [sizeX, sizeY] = crop.backgroundSize.match(/[\d.]+/g).map(Number);
    const [positionX, positionY] = crop.backgroundPosition.match(/[\d.]+/g).map(Number);
    assert.ok(Math.abs(sizeX / 100 * crop.width - crop.imageWidth) < 1e-10);
    assert.ok(Math.abs(sizeY / 100 * crop.height - crop.imageHeight) < 1e-10);
    assert.equal(positionX, (cell.imageX + 100) / 2);
    assert.equal(positionY, (cell.imageY + 100) / 2);
    assert.ok(Math.abs(crop.imageX - (crop.x - (crop.imageWidth - crop.width) * positionX / 100)) < 1e-10);
    assert.ok(Math.abs(crop.imageY - (crop.y - (crop.imageHeight - crop.height) * positionY / 100)) < 1e-10);
  }
});

test('canonical crop matrix exposes the same asymmetric marker region for previews and SVG at 0/270', () => {
  // Treat this four-corner fixture as a local SVG/image with distinct marker
  // colours: TL red, TR green, BL blue, BR yellow. The source rectangle is the
  // semantic result shared by CSS background positioning, SVG image placement,
  // PDF rasterisation, and print (which all originate from getSvg()).
  const markerAt = (source, x, y) => `${y < .5 ? 'T' : 'B'}${x < .5 ? 'L' : 'R'}`;
  const cases = [
    { label: [70, 30], image: [800, 300], zoom: 1, pan: [-100, 100] },
    { label: [30, 70], image: [300, 800], zoom: 4, pan: [100, -100] },
    { label: [70, 30], image: [300, 800], zoom: 2.5, pan: [35, -45] },
  ];
  for (const { label: [labelWidth, labelHeight], image: [imageWidth, imageHeight], zoom, pan } of cases) {
    for (const rotation of [0, 270]) {
      const cell = normalizeSheet({ columns: 1, rows: 1, labelWidth, labelHeight, cells: [{ image: 'data:image/svg+xml;base64,PHN2Zy8+', rotation, safeInset: 2, imageWidth, imageHeight, imageZoom: zoom, imageX: pan[0], imageY: pan[1] }] }).cells[0];
      const dimensions = contentDimensions(cell, labelWidth, labelHeight);
      const crop = imageCropBox(cell, 0, 0, dimensions.width, dimensions.height);
      const source = imageCropSourceRect(crop);
      assert.ok(source.x >= 0 && source.y >= 0 && source.x + source.width <= 1 && source.y + source.height <= 1);
      assert.equal(markerAt(source, source.x, source.y), `${source.y < .5 ? 'T' : 'B'}${source.x < .5 ? 'L' : 'R'}`);
      // The physical top-left maps to local top-left normally, and to local
      // top-right after a 270° clockwise content turn.
      const localTopLeft = rotation === 270 ? { x: dimensions.width, y: 0 } : { x: 0, y: 0 };
      assert.deepEqual(cropLocalPointToScreen(cell, localTopLeft.x, localTopLeft.y, dimensions.width), { x: 0, y: 0 });
      const svg = getSvg({ ...normalizeSheet({ columns: 1, rows: 1, labelWidth, labelHeight, cells: [cell] }) });
      assert.match(svg, /<image\b[^>]*clip-path="url\(#safe0\)"/);
      assert.match(svg, new RegExp(`x="${crop.imageX}" y="${crop.imageY}" width="${crop.imageWidth}" height="${crop.imageHeight}"`));
    }
  }
});

test('screen drag axes map predictably into stored local pan coordinates at 0 and 270', () => {
  assert.deepEqual(cropScreenDeltaToLocal({ rotation: 0 }, 12, 8), { x: 12, y: 8 });
  assert.deepEqual(cropScreenDeltaToLocal({ rotation: 270 }, 12, 8), { x: -8, y: 12 });
  // A rightward physical drag at 270° changes local Y, while a downward drag
  // changes local X. This prevents the former wide/tall axis inversion.
  assert.deepEqual(cropScreenDeltaToLocal({ rotation: 270 }, 20, 0), { x: 0, y: 20 });
  assert.deepEqual(cropScreenDeltaToLocal({ rotation: 270 }, 0, 20), { x: -20, y: 0 });
});

test('uses one physical safe area for wide and tall labels in each supported rotation', () => {
  for (const [labelWidth, labelHeight] of [[70, 30], [30, 70]]) {
    for (const rotation of [0, 270]) {
      for (const [imageWidth, imageHeight] of [[800, 300], [300, 800]]) {
        for (const [imageZoom, imageX, imageY] of [[1, -100, 100], [4, 100, -100]]) {
          const sheet = normalizeSheet({
            columns: 1, rows: 1, labelWidth, labelHeight,
            cells: [{ safeInset: 4, rotation, imageWidth, imageHeight, imageZoom, imageX, imageY }],
          });
          const cell = sheet.cells[0];
          const dimensions = contentDimensions(cell, labelWidth, labelHeight);
          const crop = imageCropBox(cell, 0, 0, dimensions.width, dimensions.height);
          const physical = safeArea(cell, 12, 12, labelWidth, labelHeight);
          assert.equal(crop.inset, 4);
          assert.deepEqual([physical.x, physical.y, physical.width, physical.height], [16, 16, labelWidth - 8, labelHeight - 8]);
          assert.ok(crop.imageWidth >= crop.width);
          assert.ok(crop.imageHeight >= crop.height);
          const svg = getSvg(sheet);
          assert.match(svg, new RegExp(`<clipPath id="labelSafe0"><rect x="16" y="16" width="${labelWidth - 8}" height="${labelHeight - 8}"`));
          assert.match(svg, new RegExp(`<clipPath id="safe0"><rect x="4" y="4" width="${dimensions.width - 8}" height="${dimensions.height - 8}"`));
        }
      }
    }
  }
});

test('keeps local image crop geometry finite for zero, normal, high, and excessive safe insets', () => {
  for (const [labelWidth, labelHeight, rotation, imageWidth, imageHeight] of [[60, 30, 0, 400, 100], [30, 60, 270, 100, 400]]) {
    for (const requestedInset of [0, 2, 14, 999]) {
      const cell = normalizeSheet({
        columns: 1, rows: 1, labelWidth, labelHeight,
        cells: [{ image: 'data:image/svg+xml;base64,PHN2Zy8+', imageWidth, imageHeight, imageZoom: 4, imageX: 100, imageY: -100, rotation, safeInset: requestedInset }],
      }).cells[0];
      const dimensions = contentDimensions(cell, labelWidth, labelHeight);
      const crop = imageCropBox(cell, 0, 0, dimensions.width, dimensions.height);
      assert.ok(crop.width >= MIN_SAFE_ARTWORK_SIZE);
      assert.ok(crop.height >= MIN_SAFE_ARTWORK_SIZE);
      assert.ok(Object.values(crop).every((value) => typeof value !== 'number' || Number.isFinite(value)));
      assert.doesNotMatch(crop.backgroundSize, /Infinity|NaN/);
      assert.doesNotMatch(getSvg({ ...normalizeSheet({ columns: 1, rows: 1, labelWidth, labelHeight, cells: [cell] }) }), /Infinity|NaN/);
    }
  }
});

test('copies only the requested text or appearance fields', () => {
  const source = { text: 'Copied', color: '#111111', fontSize: 22, weight: '700', align: 'left', valign: 'top', background: '#ffffff', pattern: 'dots', image: 'data:image/png;base64,x' };
  const target = { text: 'Keep', color: '#222222', fontSize: 10, weight: '400', align: 'right', valign: 'bottom', background: '#000000', pattern: 'none', image: '' };
  const textCopy = copyTextSettings(source, target);
  assert.equal(textCopy.text, 'Copied');
  assert.equal(textCopy.background, '#000000');
  const appearanceCopy = copyAppearanceSettings(source, target);
  assert.equal(appearanceCopy.background, '#ffffff');
  assert.equal(appearanceCopy.text, 'Keep');
  const styleCopy = copyStyleSettings(source, target);
  assert.equal(styleCopy.fontSize, 22);
  assert.equal(styleCopy.rotation, undefined);
  assert.equal(styleCopy.text, 'Keep');
});

test('copies content rotation with style settings', () => {
  const copied = copyStyleSettings({ color: '#111111', fontSize: 22, weight: '700', align: 'left', valign: 'top', rotation: 270 }, { rotation: 0 });
  assert.equal(copied.rotation, 270);
});

test('normalizes multi-selection to unique in-range labels and retains a primary fallback', () => {
  assert.deepEqual(normalizeSelection([2, 2, -1, 8, 1], 3, 0), [2, 1]);
  assert.deepEqual(normalizeSelection([], 3, 2), [2]);
  assert.deepEqual(normalizeSelection([4], 0, 0), []);
});

test('patches only selected labels without mutating unselected cells', () => {
  const cells = [{ text: 'One', color: '#111111' }, { text: 'Two', color: '#222222' }, { text: 'Three', color: '#333333' }];
  const patched = patchSelectedCells(cells, [0, 2], () => ({ text: 'Shared', color: '#abcdef' }));
  assert.deepEqual(patched.map((cell) => cell.text), ['Shared', 'Two', 'Shared']);
  assert.deepEqual(patched.map((cell) => cell.color), ['#abcdef', '#222222', '#abcdef']);
  assert.equal(cells[0].text, 'One');
});

test('clears selected labels to deliberate blank defaults without changing other labels', () => {
  const source = [
    { text: 'One', background: '#123456', pattern: 'dots', image: 'data:image/png;base64,x', imageWidth: 10, imageHeight: 10, imageZoom: 4, imageX: 20, imageY: -20, safeInset: 5, rotation: 270, color: '#abcdef', fontSize: 40, weight: '400', align: 'left', valign: 'top' },
    { text: 'Keep' },
    { text: 'Three', pattern: 'stripes' },
  ];
  const reset = resetSelectedCells(source, [0, 2]);
  assert.deepEqual(reset[0], emptyLabel());
  assert.deepEqual(reset[2], emptyLabel());
  assert.equal(reset[1].text, 'Keep');
  assert.equal(hasLabelContent(reset[0]), false);
  assert.equal(hasLabelContent(source[0]), true);
});
