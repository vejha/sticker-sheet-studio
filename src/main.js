import './style.css';
import 'antd/dist/reset.css';
import { jsPDF } from 'jspdf';
import React from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { App as AntApp, Button, Collapse, ColorPicker, ConfigProvider, Dropdown, Flex, Form, Input, InputNumber, Layout, Menu, Modal, Radio, Select, Slider, Space, Tabs, Tooltip, Typography, Upload, message } from 'antd';
import { AlignCenterOutlined, AlignLeftOutlined, AlignRightOutlined, BgColorsOutlined, BlockOutlined, ColumnHeightOutlined, ColumnWidthOutlined, CopyOutlined, ExportOutlined, FileImageOutlined, FolderOpenOutlined, FullscreenOutlined, MenuOutlined, PlusCircleOutlined, ZoomInOutlined, ZoomOutOutlined } from '@ant-design/icons';
import { contentDimensions, copyAppearanceSettings, copyStyleSettings, copyTextSettings, cropScreenDeltaToLocal, defaultState, deriveGrid, getLabelLayout, getSvg, hasLabelContent, imageCropBox, normalizeSelection, normalizeSheet, pageSize, patchSelectedCells, pdfExportGeometry, resetSelectedCells } from './model.js';

const STORAGE_KEY = 'sticker-sheet-studio.current.v1';
let state = loadState(); let selected = 0; let selection = [0]; let selectionMode = false; let activeTab = 'sheet'; let skipPointerCopyClick = false;
// Preview zoom is deliberately view-only: it is not written to the local sheet
// template and never participates in SVG, PDF, or print geometry.
let previewZoom = 1;
const PREVIEW_ZOOM_MIN = .5;
const PREVIEW_ZOOM_MAX = 3;
let reactRoot;
const h = React.createElement;
let ui = { export: false, import: false, templates: false, crop: false, sheetSetup: false, labelEditor: false, confirm: null };
// React owns the application boundary and Ant Design provides the application
// shell. The label designer's physical preview remains a deliberately
// imperative island because it needs exact SVG/PDF coordinates and pointer-crop
// behaviour independent from UI framework layout.
const mountNode = document.querySelector('#app');
function ApplicationShell() {
  return React.createElement(ConfigProvider, { theme: { token: { colorPrimary: '#8d2945', borderRadius: 8 } } },
    React.createElement(AntApp, null,
      React.createElement(Layout, { className: 'ant-sticker-shell' },
        React.createElement(Layout.Header, { className: 'topbar' },
          React.createElement('div', { className: 'brand' },
            React.createElement('img', { className: 'brand-mark', src: './icon.svg', alt: '' }),
            React.createElement('div', null,
              React.createElement(Typography.Text, { strong: true }, 'Sticker Sheet Studio'),
              React.createElement(Typography.Text, { className: 'brand-subtitle' }, 'print-ready, local-first'),
            ),
          ),
          React.createElement(Space, { className: 'actions desktop-actions' },
            React.createElement(Button, { id: 'new-sheet', icon: React.createElement(PlusCircleOutlined), onClick: startNewSheet }, 'New'),
            React.createElement(Button, { id: 'import-sheet', icon: React.createElement(FolderOpenOutlined), onClick: openImportDialog }, 'Import'),
            React.createElement(Button, { id: 'export-sheet', type: 'primary', icon: React.createElement(ExportOutlined), onClick: openExportDialog }, 'Export'),
          ),
          React.createElement(Dropdown, { className: 'mobile-actions', trigger: ['click'], menu: { items: [
            { key: 'new', icon: React.createElement(PlusCircleOutlined), label: 'New sheet', onClick: startNewSheet },
            { key: 'import', icon: React.createElement(FolderOpenOutlined), label: 'Import template', onClick: openImportDialog },
            { key: 'export', icon: React.createElement(ExportOutlined), label: 'Export sheet', onClick: openExportDialog },
          ] } }, React.createElement(Button, { id: 'sheet-actions-menu', type: 'primary', icon: React.createElement(MenuOutlined), 'aria-label': 'Sheet actions' }, 'Actions')),
        ),
        React.createElement(Layout.Content, null, React.createElement(StickerDesigner)),
      ),
    ),
  );
}
flushSync(() => {
  reactRoot = createRoot(mountNode);
  reactRoot.render(
  React.createElement(ApplicationShell),
  );
});
const app = document.querySelector('#legacy-host');
function escapeHtml(value = '') { const span = document.createElement('span'); span.textContent = value; return span.innerHTML; }

function requestRender() { reactRoot?.render(h(ApplicationShell)); }
function setUi(patch) { ui = { ...ui, ...patch }; requestRender(); }
function fieldValue(value) { return value === null || value === undefined ? undefined : value; }
function setSheet(key, value) { state = { ...state, [key]: value }; updateGrid(); requestRender(); }
function setCells(patch) { patchSelected(() => patch); requestRender(); }
function colorValue(value) { return typeof value === 'string' ? value : value?.toHexString?.(); }
function IconButton(props) { return h(Tooltip, { title: props.title }, h(Button, { ...props, type: props.active ? 'primary' : 'default', className: `icon-button ${props.className || ''}`, 'aria-label': props['aria-label'] || props.title, 'aria-pressed': props.active, onClick: props.onClick }, props.children)); }
function Help({ title, children }) { return h(Tooltip, { title: children }, h(Button, { className: 'context-help', type: 'text', shape: 'circle', 'aria-label': `More information about ${title}` }, h('span', { className: 'context-help-glyph', 'aria-hidden': true }, '?'))); }
function CopyButton({ group }) {
  return h(Tooltip, { title: `Copy ${group} settings from label ${selected + 1} to all labels` }, h(Button, { className: 'icon-button copy', onClick: () => {
    const source = state.cells[selected]; const copy = group === 'text' ? copyTextSettings : group === 'style' ? copyStyleSettings : copyAppearanceSettings;
    state.cells = state.cells.map((item) => copy(source, item)); persist(); requestRender();
  }, 'data-copy': group, 'aria-label': `Copy ${group} settings from label ${selected + 1} to all labels` }, h(CopyOutlined)));
}
function Preview() {
  const [pageW, pageH] = pageSize(state); const layout = getLabelLayout(state);
  const markup = `${state.cells.map((item, index) => previewLabel(item, index, layout, pageW, pageH)).join('')}`;
  return h('section', { className: 'workspace' },
    h(Flex, { className: 'preview-controls', justify: 'space-between', wrap: true },
      h(Space, { className: 'selection-controls' }, h(Button, { id: 'selection-mode', type: selectionMode ? 'primary' : 'default', 'aria-pressed': selectionMode, onClick: () => { selectionMode = !selectionMode; requestRender(); } }, selectionMode ? 'Multi-select mode: on' : 'Multi-select mode'), h(Help, { title: 'multi-select' }, selectionMode ? 'Tap labels to add or remove them.' : 'Use Ctrl/Cmd-click to add labels, or enable multi-select mode for touch.')),
      h(Space, { className: 'preview-zoom-controls' }, h('span', { id: 'preview-zoom-status', 'aria-live': 'polite' }, `Zoom ${Math.round(previewZoom * 100)}%`), h(IconButton, { className: 'preview-zoom-button', title: 'Zoom out', 'data-preview-zoom': 'out', onClick: () => { previewZoom = clampPreviewZoom(previewZoom / 1.2); requestRender(); } }, h(ZoomOutOutlined)), h(IconButton, { className: 'preview-zoom-button', title: 'Zoom in', 'data-preview-zoom': 'in', onClick: () => { previewZoom = clampPreviewZoom(previewZoom * 1.2); requestRender(); } }, h(ZoomInOutlined)), h(IconButton, { className: 'preview-zoom-button', title: 'Fit preview', 'data-preview-zoom': 'fit', onClick: () => { previewZoom = 1; requestRender(); } }, h(FullscreenOutlined)), h(Help, { title: 'preview zoom' }, 'Hold Ctrl (or ⌘ on macOS) while scrolling to zoom. Zoom is view-only and never affects SVG, PDF, or print geometry.'))),
    h('div', { className: 'canvas-wrap', id: 'preview-viewport', tabIndex: 0, 'aria-label': 'Zoomable sticker sheet preview', style: { '--ratio': pageW / pageH }, onWheel: (event) => { if (event.ctrlKey || event.metaKey) { event.preventDefault(); previewZoom = clampPreviewZoom(previewZoom * Math.exp(-event.deltaY * .0015)); requestRender(); } }, onKeyDown: (event) => { if (event.key === '+' || event.key === '=') { event.preventDefault(); previewZoom = clampPreviewZoom(previewZoom * 1.2); requestRender(); } if (event.key === '-') { event.preventDefault(); previewZoom = clampPreviewZoom(previewZoom / 1.2); requestRender(); } if (event.key === '0') { event.preventDefault(); previewZoom = 1; requestRender(); } }, onClick: (event) => { const label = event.target.closest('[data-select]'); if (label) selectLabel(Number(label.dataset.select), event.ctrlKey || event.metaKey || selectionMode); } }, h('div', { className: 'preview-stage' }, h('div', { className: 'sheet', id: 'sheet-preview', role: 'listbox', 'aria-label': 'Sticker labels', 'aria-multiselectable': true, style: { '--ratio': pageW / pageH, '--preview-width': `${previewZoom * 100}%`, '--preview-height': `${previewZoom * 54}vh`, '--preview-text-zoom': previewZoom }, dangerouslySetInnerHTML: { __html: markup } }))));
}
function SheetForm() {
  const derived = deriveGrid(state); const layout = getLabelLayout(state); const [pageW, pageH] = pageSize(state);
  const number = (label, key, min, max, step = .5) => h(Form.Item, { label }, h(InputNumber, { value: fieldValue(state[key]), min, max, step, onChange: (value) => setSheet(key, value), 'data-sheet': key, style: { width: '100%' } }));
  return h(Form, { layout: 'vertical' },
    h('div', { className: 'sheet-setup-summary' }, h('h2', null, `${state.name || 'Sticker sheet'} · ${pageW.toFixed(0)} × ${pageH.toFixed(0)} mm`), h('p', null, `${state.columns} columns × ${state.rows} rows · ${state.cells.length} labels`)),
    h(Form.Item, { label: 'Sheet name' }, h(Input, { value: state.name, onChange: (e) => setSheet('name', e.target.value), 'data-sheet': 'name' })),
    h(Flex, { gap: 8 }, h(Form.Item, { label: 'Format', style: { flex: 1 } }, h(Select, { value: state.format, onChange: (value) => setSheet('format', value), 'data-sheet': 'format', options: ['A4', 'Letter'].map((value) => ({ value })) })), h(Form.Item, { label: 'Orientation', style: { flex: 1 } }, h('div', { className: 'orientation-switch', role: 'group', 'aria-label': 'Sheet orientation', 'data-sheet': 'orientation' }, h(IconButton, { title: 'Portrait orientation', active: state.orientation === 'portrait', 'data-orientation': 'portrait', onClick: () => setSheet('orientation', 'portrait') }, h('svg', { viewBox: '0 0 16 20', 'aria-hidden': true }, h('rect', { x: 2, y: 1, width: 12, height: 18, rx: 1.5, fill: 'none', stroke: 'currentColor', strokeWidth: 2 }))), h(IconButton, { title: 'Landscape orientation', active: state.orientation === 'landscape', 'data-orientation': 'landscape', onClick: () => setSheet('orientation', 'landscape') }, h('svg', { viewBox: '0 0 20 16', 'aria-hidden': true }, h('rect', { x: 1, y: 2, width: 18, height: 12, rx: 1.5, fill: 'none', stroke: 'currentColor', strokeWidth: 2 })))))),
    h('div', { className: 'group' }, h('h3', null, 'Sheet edges'), h(Flex, { gap: 8 }, h('div', { style: { flex: 1 } }, number('Left / right (mm)', 'marginX', 0, 100)), h('div', { style: { flex: 1 } }, number('Top / bottom (mm)', 'marginY', 0, 100)))),
    h(Flex, { gap: 8 }, h('div', { style: { flex: 1 } }, number('Label width (mm)', 'labelWidth', 1)), h('div', { style: { flex: 1 } }, number('Label height (mm)', 'labelHeight', 1))),
    h(Form.Item, { label: h(Space, null, 'Corner radius (mm)', h(Help, { title: 'corner radius' }, 'One radius applies to every label cutout and its print-safe artwork.')) }, h(InputNumber, { value: state.cornerRadius, min: 0, max: Math.min(state.labelWidth, state.labelHeight) / 2, step: .1, onChange: (value) => setSheet('cornerRadius', value), 'data-sheet': 'cornerRadius', style: { width: '100%' } })),
    h('p', { className: 'derived-grid', 'aria-live': 'polite' }, h('strong', null, `${derived.columns} columns × ${derived.rows} rows fit`), h(Help, { title: 'automatic layout' }, `Interior gaps: ${layout.gapX.toFixed(2)} mm horizontal × ${layout.gapY.toFixed(2)} mm vertical.`)));
}
function LabelForm({ compact = false } = {}) {
  const cell = state.cells[selected];
  const patch = (key, value, redraw = false) => setCells({ [key]: value }, redraw);
  const number = (label, key, min, max, step = 1) => h(Form.Item, { label }, h(InputNumber, { value: fieldValue(cell[key]), min, max, step, onChange: (value) => patch(key, value), 'data-cell': key, style: { width: '100%' } }));
  const color = (label, key) => h(Form.Item, { label }, h(ColorPicker, { value: cell[key], onChange: (value) => patch(key, colorValue(value)), 'data-cell': key, showText: true }));
  const modeChange = (mode) => { if (mode === 'image' && !cell.image) { patch('appearanceMode', mode, true); return; } patch('appearanceMode', mode, true); };
  const rotationControls = h(Space, null, [0, 270].map((rotation) => h(IconButton, { key: rotation, title: rotation ? 'Vertical content flow' : 'Horizontal content flow', active: cell.rotation === rotation, 'data-editor-rotation': rotation, onClick: () => patch('rotation', rotation, true) }, h(rotation ? ColumnHeightOutlined : ColumnWidthOutlined))));
  const textGroup = h('div', { className: 'editor-section-content' }, h(Form.Item, { label: 'Text' }, h(Input.TextArea, { value: cell.text, rows: 3, onChange: (e) => patch('text', e.target.value), 'data-cell': 'text' })));
  const alignmentIcons = { left: AlignLeftOutlined, center: AlignCenterOutlined, right: AlignRightOutlined };
  const styleGroup = h('div', { className: 'editor-section-content' }, h(Flex, { gap: 8, align: 'center' }, h('div', { style: { flex: 1 } }, number('Size', 'fontSize', 6, 72)), h(IconButton, { title: 'Bold text', active: cell.weight === '700', 'data-toggle-weight': true, onClick: () => patch('weight', cell.weight === '700' ? '400' : '700', true) }, h('b', null, 'B')), ...['left', 'center', 'right'].map((align) => h(IconButton, { key: align, title: `Align ${align}`, active: cell.align === align, 'data-align': align, onClick: () => patch('align', align, true) }, h(alignmentIcons[align])))), h(Flex, { gap: 8 }, h('div', { style: { flex: 1 } }, h(Form.Item, { label: 'Vertical' }, h(Select, { value: cell.valign, onChange: (value) => patch('valign', value), 'data-cell': 'valign', options: ['top', 'middle', 'bottom'].map((value) => ({ value })) }))), color('Text color', 'color')));
  const uploader = h(Upload, { accept: 'image/*', showUploadList: false, beforeUpload: (file) => { const reader = new FileReader(); reader.onload = () => { const image = new Image(); image.onload = () => { patchSelected(() => ({ appearanceMode: 'image', image: reader.result, imageWidth: image.naturalWidth, imageHeight: image.naturalHeight, imageZoom: 1, imageX: 0, imageY: 0 })); setUi({ crop: true }); }; image.src = reader.result; }; reader.readAsDataURL(file); return false; } }, h(Button, { id: 'image-input' }, cell.image ? 'Replace background image' : 'Choose background image'));
  const appearanceIcons = { solid: BgColorsOutlined, pattern: BlockOutlined, image: FileImageOutlined };
  const appearanceChildren = [h(Radio.Group, { key: 'mode', value: cell.appearanceMode, onChange: (e) => modeChange(e.target.value), 'aria-label': 'Sticker background type' }, h(Space, { wrap: true }, ['solid', 'pattern', 'image'].map((mode) => h(Radio.Button, { value: mode, key: mode }, h(appearanceIcons[mode]), h('span', null, mode[0].toUpperCase() + mode.slice(1)))))), cell.appearanceMode !== 'image' ? color('Background color', 'background') : null, cell.appearanceMode === 'pattern' ? h(Form.Item, { label: 'Pattern', key: 'pattern' }, h(Select, { value: cell.pattern, onChange: (value) => patch('pattern', value), 'data-cell': 'pattern', options: ['dots', 'stripes'].map((value) => ({ value })) })) : null, cell.appearanceMode === 'image' ? h(Space, { direction: 'vertical', key: 'upload' }, uploader, cell.image && h(Space, null, h(Button, { id: 'position-image', onClick: () => setUi({ crop: true }) }, 'Position image'), h(Button, { id: 'remove-image', danger: true, onClick: () => { patchSelected(() => ({ appearanceMode: 'solid', image: '', imageWidth: 0, imageHeight: 0 })); requestRender(); } }, 'Remove image'))) : null, number('Print-safe border (mm)', 'safeInset', 0, 20, .5)];
  const heading = h(React.Fragment, null, h('div', { className: 'section-heading' }, h('h2', null, `Label ${selected + 1}`), h('span', null, `${selection.length} selected · of ${state.cells.length}`)), h('p', { className: 'selection-summary' }, `Editing ${selection.length === 1 ? 'label' : 'labels'} ${selection.map((index) => index + 1).join(', ')}`), h(Flex, { className: 'label-editor-actions', align: 'center', gap: 6 }, rotationControls, h(IconButton, { id: 'clear-label', className: 'clear-label', title: `Clear ${selection.length === 1 ? 'label' : `${selection.length} labels`}`, onClick: () => selection.some((index) => hasLabelContent(state.cells[index])) ? setUi({ confirm: 'clear' }) : (state.cells = resetSelectedCells(state.cells, selection), persist(), requestRender()) }, '×')));
  const appearanceGroup = h('div', { className: 'editor-section-content' }, ...appearanceChildren);
  const panelLabel = (label, group) => h('span', { className: 'editor-panel-label' }, h('span', null, label), h(CopyButton, { group }));
  const sections = [{ key: 'text', label: panelLabel('Text', 'text'), children: textGroup }, { key: 'style', label: panelLabel('Style', 'style'), children: styleGroup }, { key: 'appearance', label: panelLabel('Appearance', 'appearance'), children: appearanceGroup }];
  return h(Form, { layout: 'vertical', className: `label-editor-form ${compact ? 'compact-label-form' : ''}` }, heading, h(Collapse, { className: 'editor-sections', size: 'small', defaultActiveKey: compact ? ['text'] : ['text', 'style', 'appearance'], items: sections }));
}

function focusSheetPreview() {
  requestAnimationFrame(() => document.querySelector('#preview-viewport')?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
}
function FocusedLabelPreview() {
  const [pageW, pageH] = pageSize(state); const layout = getLabelLayout(state);
  return h('section', { className: 'focused-label-preview', 'aria-label': `Selected label ${selected + 1} preview` },
    h('div', { className: 'focused-label-canvas', style: { aspectRatio: `${layout.cellWidth} / ${layout.cellHeight}` }, dangerouslySetInnerHTML: { __html: previewLabel(state.cells[selected], selected, layout, pageW, pageH) } }),
  );
}
function MobileWorkflow() {
  return h('section', { className: 'mobile-workflow', 'aria-label': 'Mobile designer workflow' },
    h(Flex, { gap: 8 },
      h(Button, { block: true, onClick: () => setUi({ sheetSetup: true }) }, 'Sheet setup'),
      h(Button, { block: true, type: 'primary', onClick: () => setUi({ labelEditor: true }) }, `Edit label ${selected + 1}`),
    ),
  );
}
function MobileDesignDialogs() {
  return h(React.Fragment, null,
    h(Modal, { open: ui.sheetSetup, destroyOnHidden: true, title: 'Sheet setup', footer: h(Button, { type: 'primary', onClick: () => { setUi({ sheetSetup: false }); focusSheetPreview(); } }, 'Choose a label on sheet'), onCancel: () => setUi({ sheetSetup: false }), className: 'mobile-design-dialog', id: 'sheet-setup-dialog' }, h(SheetForm)),
    h(Modal, { open: ui.labelEditor, destroyOnHidden: true, title: `Edit label ${selected + 1}`, footer: h(Button, { onClick: () => { setUi({ labelEditor: false }); focusSheetPreview(); } }, 'Back to sheet'), onCancel: () => { setUi({ labelEditor: false }); focusSheetPreview(); }, className: 'mobile-design-dialog label-editor-dialog', id: 'label-editor-dialog' }, h(FocusedLabelPreview), h(LabelForm, { compact: true })),
  );
}
function CropModal() {
  const cell = state.cells[selected]; const [crop, setCrop] = React.useState({ rotation: cell.rotation, imageZoom: cell.imageZoom, imageX: cell.imageX, imageY: cell.imageY });
  const drag = React.useRef(null);
  if (!cell.image) return null;
  const clampCrop = (value) => Math.min(100, Math.max(-100, value));
  const zoomCrop = (delta) => setCrop((current) => ({ ...current, imageZoom: Math.min(4, Math.max(1, current.imageZoom * Math.exp(-delta * .0015))) }));
  const dragStart = (event) => { drag.current = { x: event.clientX, y: event.clientY, crop }; event.currentTarget.setPointerCapture?.(event.pointerId); };
  const dragMove = (event) => { if (!drag.current) return; const dx = (event.clientX - drag.current.x) / 2; const dy = (event.clientY - drag.current.y) / 2; const delta = cropScreenDeltaToLocal({ rotation: drag.current.crop.rotation }, dx, dy); setCrop({ ...drag.current.crop, imageX: clampCrop(drag.current.crop.imageX - delta.x), imageY: clampCrop(drag.current.crop.imageY - delta.y) }); };
  const dimensions = contentDimensions(cell, state.labelWidth, state.labelHeight);
  return h(Modal, { open: ui.crop, title: 'Position background image', onCancel: () => setUi({ crop: false }), onOk: () => { patchSelected(() => crop); setUi({ crop: false }); }, okText: 'Apply position', cancelText: 'Cancel', id: 'image-dialog' }, h('p', { className: 'crop-instructions' }, 'Drag to position. Scroll to zoom.'), h('div', { id: 'crop-preview', className: 'crop-preview', 'aria-label': 'Drag image to set its position; scroll to zoom', onPointerDown: dragStart, onPointerMove: dragMove, onPointerUp: () => { drag.current = null; }, onWheel: (event) => { event.preventDefault(); zoomCrop(event.deltaY); }, style: { '--crop-ratio': `${dimensions.width} / ${dimensions.height}`, backgroundImage: `url('${cell.image}')`, backgroundSize: `${crop.imageZoom * 100}%`, backgroundPosition: `${50 + crop.imageX / 2}% ${50 + crop.imageY / 2}%` } }), h(Space, null, [0, 270].map((rotation) => h(IconButton, { key: rotation, title: `${rotation} degree rotation`, active: crop.rotation === rotation, 'data-crop-rotation': rotation, onClick: () => setCrop({ ...crop, rotation }) }, rotation ? '↻' : '↔'))), h(Collapse, { size: 'small', className: 'crop-fine-tune', items: [{ key: 'fine-tune', label: 'Fine tune numerically', children: [['Zoom', 'imageZoom', 1, 4, .05, 'crop-zoom'], ['Horizontal position', 'imageX', -100, 100, 1, 'crop-x'], ['Vertical position', 'imageY', -100, 100, 1, 'crop-y']].map(([label, key, min, max, step, id]) => h(Form.Item, { label, key }, h(InputNumber, { id, min, max, step, value: crop[key], 'aria-label': label, onChange: (value) => setCrop({ ...crop, [key]: value ?? crop[key] }), style: { width: '100%' } }))) }] }));
}
function ExportModal() { const run = async (kind) => { if (kind === 'svg') download(`${safeName()}.svg`, new Blob([getSvg(state)], { type: 'image/svg+xml' })); if (kind === 'json') download(`${safeName()}.json`, new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' })); if (kind === 'pdf') await exportPdf(); setUi({ export: false }); }; const preview = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(getSvg(state))}`; return h(Modal, { open: ui.export, title: 'Export sheet', footer: null, onCancel: () => setUi({ export: false }), id: 'export-dialog' }, h('p', null, 'Choose a format for the current prepared sheet.'), h('div', { className: 'export-preview', 'aria-label': 'Print preview without guides' }, h('img', { src: preview, alt: 'White print preview of the sticker sheet' })), h(Flex, { className: 'export-actions', gap: 10, wrap: true }, ['svg', 'pdf', 'json'].map((kind) => h(Button, { key: kind, className: 'export-action', 'data-export': kind, onClick: () => run(kind) }, kind === 'json' ? 'Template JSON' : kind.toUpperCase())), h(Button, { id: 'print-sheet', className: 'export-action', onClick: () => { printSheet(); setUi({ export: false }); } }, 'Print')), h(Button, { id: 'template-workflow', block: true, onClick: () => setUi({ export: false, templates: true }) }, 'Template library…'));
}
function ImportModal() { return h(Modal, { open: ui.import, title: 'Import', footer: null, onCancel: () => setUi({ import: false }), id: 'import-dialog' }, h(Upload, { accept: 'application/json,.json', showUploadList: false, beforeUpload: (file) => { const reader = new FileReader(); reader.onload = () => { try { state = normalizeSheet(JSON.parse(reader.result), { rejectInvalidGeometry: true }); selected = 0; selection = [0]; persist(); setUi({ import: false }); } catch { message.error('This file is not a valid Sticker Sheet Studio template.'); } }; reader.readAsText(file); return false; } }, h(Button, { id: 'import-template' }, 'Choose template JSON')), h('p', null, 'Imports stay on this device.'));
}
function TemplatesModal() {
  const templates = savedTemplates();
  const list = templates.length ? templates.map((template, index) => h(Flex, { className: 'template', key: `${template.name}-${index}`, justify: 'space-between' }, h('div', null, h('strong', null, template.name), h('small', null, `${template.columns} × ${template.rows} · ${template.format}`)), h(Space, null, h(Button, { 'data-template-load': index, onClick: () => { state = normalizeSheet(template); selected = 0; selection = [0]; persist(); setUi({ templates: false }); } }, 'Use'), h(Button, { danger: true, 'data-template-delete': index, onClick: () => { templates.splice(index, 1); localStorage.setItem('sticker-sheet-studio.templates.v1', JSON.stringify(templates)); requestRender(); } }, 'Delete')))) : h('p', { className: 'empty' }, 'No templates saved yet.');
  return h(Modal, { open: ui.templates, title: 'Template library', footer: null, onCancel: () => setUi({ templates: false }), id: 'templates' }, h(Button, { id: 'save-template', onClick: () => setUi({ confirm: 'saveTemplate' }) }, 'Save current sheet as template'), h('div', { id: 'template-list' }, list));
}
function StickerDesigner() { const tabs = [{ key: 'sheet', label: 'Sheet setup', children: h(SheetForm) }, { key: 'label', label: 'Label editor', children: h(LabelForm) }]; const confirmation = ui.confirm === 'newSheet' ? 'Start a new sheet? This replaces the current local sheet.' : ui.confirm === 'saveTemplate' ? `Save “${state.name || 'Sticker sheet'}” as a local template?` : `Clear ${selection.length === 1 ? 'this label' : `${selection.length} selected labels`}? This removes their text, image, pattern, and formatting.`; return h(React.Fragment, null, h('main', null, h('aside', { className: 'sidebar', 'aria-label': 'Designer settings' }, h(Tabs, { className: 'tabs', type: 'card', activeKey: activeTab, onChange: (key) => { activeTab = key; requestRender(); }, items: tabs })), h('div', { className: 'mobile-designer' }, h(MobileWorkflow)), h(Preview)), h(MobileDesignDialogs), h(CropModal), h(ExportModal), h(ImportModal), h(TemplatesModal), h(Modal, { open: !!ui.confirm, title: ui.confirm === 'saveTemplate' ? 'Save template' : ui.confirm === 'newSheet' ? 'New sheet' : 'Clear labels', onCancel: () => setUi({ confirm: null }), onOk: () => { if (ui.confirm === 'newSheet') { state = defaultState(); selected = 0; selection = [0]; activeTab = 'sheet'; persist(); } if (ui.confirm === 'clear') { state.cells = resetSelectedCells(state.cells, selection); persist(); } if (ui.confirm === 'saveTemplate') { const name = state.name || 'Sticker sheet'; const templates = savedTemplates(); templates.push({ ...state, name }); localStorage.setItem('sticker-sheet-studio.templates.v1', JSON.stringify(templates)); setUi({ confirm: null, templates: true }); return; } setUi({ confirm: null }); } }, confirmation)); }

function loadState() { try { return normalizeSheet(JSON.parse(localStorage.getItem(STORAGE_KEY))); } catch { return defaultState(); } }
function persist() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
function safeName() { return state.name.trim().replace(/[^a-z0-9]+/gi, '-').replace(/(^-|-$)/g, '') || 'sticker-sheet'; }
function download(name, blob) { const url = URL.createObjectURL(blob); const link = Object.assign(document.createElement('a'), { href: url, download: name }); link.click(); URL.revokeObjectURL(url); }
function startNewSheet() { setUi({ confirm: 'newSheet' }); }
function openImportDialog() { setUi({ import: true }); }
function openExportDialog() { setUi({ export: true }); }
function updateGrid() {
  state = normalizeSheet(state);
  selection = normalizeSelection(selection, state.cells.length, selected);
  selected = selection.includes(selected) ? selected : selection[0];
  persist();
  requestRender();
}
function iconCopy(group) { return `<button class="icon-button copy" type="button" data-copy="${group}" aria-label="Copy ${group} settings from label ${selected + 1} to all labels" title="Copy ${group} settings from label ${selected + 1} to all labels">⧉</button>`; }
function groupIcon(name) {
  const paths = {
    text: '<path d="M4 4h16M12 4v16M8 20h8"/>',
    style: '<path d="M5 19 18 6l2 2L7 21H5v-2Z"/><path d="m14 5 2-2 3 3-2 2"/>',
    appearance: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m5 18 5-5 3 3 2-2 4 4"/>',
  };
  return `<svg class="group-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths[name]}</svg>`;
}
function alignIcon(align) {
  const bars = align === 'left' ? 'M5 6h14M5 10h9M5 14h14M5 18h9' : align === 'right' ? 'M5 6h14M10 10h9M5 14h14M10 18h9' : 'M5 6h14M7 10h10M5 14h14M7 18h10';
  return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 2h18M3 2l3 3M3 2l3-3M21 2l-3 3M21 2l-3-3" transform="translate(0 3)"/><path d="${bars}"/></svg>`;
}
function rotationIcon(rotation) {
  const content = rotation === 270
    ? '<path d="M8 4v16M12 4v16M16 4v16"/><path d="M5 7 3 5l2-2M3 5h12"/>'
    : '<path d="M5 7h14M5 12h10M5 17h14"/><path d="m18 4 3 3-3 3M21 7V3"/>';
  return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${content}</svg>`;
}
function rotationControls(rotation, scope) {
  return `<fieldset class="rotation-control"><legend>Content rotation</legend>${[0, 270].map((value) => `<button type="button" class="icon-button ${rotation === value ? 'is-active' : ''}" data-${scope}-rotation="${value}" aria-pressed="${rotation === value}" aria-label="${value === 0 ? 'Normal landscape content' : 'Rotate content 270 degrees'}" title="${value === 0 ? 'Normal landscape content' : 'Rotated portrait-flow content (270°)'}">${rotationIcon(value)}</button>`).join('')}</fieldset>`;
}
function exportActionIcon(action) {
  const paths = {
    svg: '<path d="M5 3h10l4 4v14H5z"/><path d="M15 3v5h5M8 14h8M8 18h5"/>',
    pdf: '<path d="M5 3h10l4 4v14H5z"/><path d="M15 3v5h5M8 16h2.5a1.5 1.5 0 0 0 0-3H15v5M8 13v5"/>',
    json: '<path d="M9 4C7 4 7 6 7 8v2c0 1.5-.8 2-2 2 1.2 0 2 .5 2 2v2c0 2 0 4 2 4M15 4c2 0 2 2 2 4v2c0 1.5.8 2 2 2-1.2 0-2 .5-2 2v2c0 2 0 4-2 4"/>',
    print: '<path d="M7 8V3h10v5M7 17H4V9h16v8h-3M7 14h10v7H7z"/><path d="M17 12h.01"/>',
    template: '<path d="M4 5h16v14H4z"/><path d="M8 9h8M8 13h5M8 17h8"/>',
  };
  return `<svg class="export-action-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths[action]}</svg>`;
}
function contextHelp(label, message) {
  const accessibleLabel = `More information about ${label}`;
  return `<button class="context-help" type="button" data-context-help="${escapeHtml(message)}" aria-label="${accessibleLabel}" aria-controls="context-tooltip" aria-expanded="false" title="${accessibleLabel}">?</button>`;
}

function legacyRender() {
  const cell = state.cells[selected]; const [pageW, pageH] = pageSize(state); const derived = deriveGrid(state); const layout = getLabelLayout(state);
  app.innerHTML = `
    <main>
      <aside class="sidebar" aria-label="Designer settings">
        <div class="tabs" role="tablist" aria-label="Designer workflow">
          <button role="tab" id="sheet-tab" aria-controls="sheet-panel" aria-selected="${activeTab === 'sheet'}" tabindex="${activeTab === 'sheet' ? 0 : -1}" data-tab="sheet">Sheet setup</button>
          <button role="tab" id="label-tab" aria-controls="label-panel" aria-selected="${activeTab === 'label'}" tabindex="${activeTab === 'label' ? 0 : -1}" data-tab="label">Label editor</button>
        </div>
        <section role="tabpanel" id="sheet-panel" aria-labelledby="sheet-tab" ${activeTab !== 'sheet' ? 'hidden' : ''}>
          <label>Sheet name<input data-sheet="name" value="${escapeHtml(state.name)}"></label>
          <div class="two"><label>Format<select data-sheet="format"><option ${state.format === 'A4' ? 'selected' : ''}>A4</option><option ${state.format === 'Letter' ? 'selected' : ''}>Letter</option></select></label><label>Orientation<select data-sheet="orientation"><option value="portrait" ${state.orientation === 'portrait' ? 'selected' : ''}>Portrait</option><option value="landscape" ${state.orientation === 'landscape' ? 'selected' : ''}>Landscape</option></select></label></div>
          <div class="group"><h3>Sheet edges</h3><div class="two"><label>Left / right (mm)<input data-sheet="marginX" type="number" min="0" max="100" step=".5" value="${state.marginX}"></label><label>Top / bottom (mm)<input data-sheet="marginY" type="number" min="0" max="100" step=".5" value="${state.marginY}"></label></div></div>
          <div class="two"><label>Label width (mm)<input data-sheet="labelWidth" type="number" min="1" step=".5" value="${state.labelWidth}"></label><label>Label height (mm)<input data-sheet="labelHeight" type="number" min="1" step=".5" value="${state.labelHeight}"></label></div>
          <label>Corner radius (mm)${contextHelp('corner radius', `One radius applies to every label cutout and its print-safe artwork. It is limited to ${Math.min(state.labelWidth, state.labelHeight) / 2} mm by the current label size.`)}<input data-sheet="cornerRadius" type="number" min="0" max="${Math.min(state.labelWidth, state.labelHeight) / 2}" step=".1" value="${state.cornerRadius}"></label>
          <p class="derived-grid" aria-live="polite"><strong>${derived.columns} columns × ${derived.rows} rows fit</strong>${contextHelp('automatic layout', `Interior gaps: ${layout.gapX.toFixed(2)} mm horizontal × ${layout.gapY.toFixed(2)} mm vertical.${state.columns === 1 || state.rows === 1 ? ' A single-label axis starts at the leading sheet edge and leaves remaining space after the label.' : ''}`)}</p>
        </section>
        <section role="tabpanel" id="label-panel" aria-labelledby="label-tab" ${activeTab !== 'label' ? 'hidden' : ''}><div class="section-heading"><h2>Label ${selected + 1}</h2><span>${selection.length} selected · of ${state.cells.length}</span></div>
          <p class="selection-summary" aria-live="polite">Editing ${selection.length === 1 ? 'label' : 'labels'} ${selection.map((index) => index + 1).join(', ')}${contextHelp('selection and copy source', `Label ${selected + 1} is the copy source for the group copy buttons.`)}</p>
          <div class="label-editor-actions"><div class="label-editor-rotation">${rotationControls(cell.rotation, 'editor')}</div><button class="quiet clear-label" id="clear-label" type="button" aria-label="Clear selected labels" title="Clear selected labels">Clear ${selection.length === 1 ? 'label' : `${selection.length} labels`}</button></div>
          <div class="group"><h3><span class="group-title">${groupIcon('text')}Text</span>${iconCopy('text')}</h3><label>Text<textarea data-cell="text" rows="3">${escapeHtml(cell.text)}</textarea></label></div>
          <div class="group"><h3><span class="group-title">${groupIcon('style')}Style</span>${iconCopy('style')}</h3><div class="text-toolbar"><label>Size<input data-cell="fontSize" type="number" min="6" max="72" value="${cell.fontSize}"></label><button class="icon-button ${cell.weight === '700' ? 'is-active' : ''}" type="button" data-toggle-weight aria-label="Bold text" title="Bold text" aria-pressed="${cell.weight === '700'}"><b>B</b></button><span class="alignment-controls" role="group" aria-label="Horizontal alignment"><button class="icon-button ${cell.align === 'left' ? 'is-active' : ''}" type="button" data-align="left" aria-label="Align left" title="Align left">${alignIcon('left')}</button><button class="icon-button ${cell.align === 'center' ? 'is-active' : ''}" type="button" data-align="center" aria-label="Align center" title="Align center">${alignIcon('center')}</button><button class="icon-button ${cell.align === 'right' ? 'is-active' : ''}" type="button" data-align="right" aria-label="Align right" title="Align right">${alignIcon('right')}</button></span></div><div class="two"><label>Vertical<select data-cell="valign"><option value="top" ${cell.valign === 'top' ? 'selected' : ''}>Top</option><option value="middle" ${cell.valign === 'middle' ? 'selected' : ''}>Middle</option><option value="bottom" ${cell.valign === 'bottom' ? 'selected' : ''}>Bottom</option></select></label><label>Text color<input data-cell="color" type="color" value="${cell.color}"></label></div></div>
          <div class="group"><h3><span class="group-title">${groupIcon('appearance')}Appearance</span>${iconCopy('appearance')}</h3><fieldset class="appearance-mode"><legend>Appearance mode</legend>${[['solid', 'Solid color'], ['pattern', 'Pattern'], ['image', 'Image']].map(([mode, label]) => `<label><input type="radio" name="appearance-mode" data-appearance-mode="${mode}" value="${mode}" ${cell.appearanceMode === mode ? 'checked' : ''}>${label}</label>`).join('')}</fieldset>${cell.appearanceMode === 'solid' ? `<label>Background color<input data-cell="background" type="color" value="${cell.background}"></label>` : ''}${cell.appearanceMode === 'pattern' ? `<div class="two"><label>Background color<input data-cell="background" type="color" value="${cell.background}"></label><label>Pattern<select data-cell="pattern"><option value="dots" ${cell.pattern === 'dots' ? 'selected' : ''}>Dots</option><option value="stripes" ${cell.pattern === 'stripes' ? 'selected' : ''}>Stripes</option></select></label></div>` : ''}${cell.appearanceMode === 'image' ? `<label>Background image<input id="image-input" type="file" accept="image/*"></label>${cell.image ? '<div class="inline-actions"><button class="tiny" id="position-image">Position image</button><button class="tiny" id="remove-image">Remove image</button></div>' : '<small>Choose an image to activate Image mode.</small>'}` : '<input id="image-input" type="file" accept="image/*" hidden>'}<label>Print-safe border (mm)${contextHelp('print-safe border', 'This uniform inset reserves space from every cutout edge. Appearance artwork uses the inner area in preview and exports; text keeps its normal layout. Very large values retain at least 0.1 mm of artwork area on each axis.')}<input data-cell="safeInset" type="number" min="0" max="20" step=".5" value="${cell.safeInset}"></label></div>
        </section>
      </aside>
      <section class="workspace"><div class="workspace-title"><div><span>LIVE PREVIEW</span><h1>${pageW.toFixed(1)} × ${pageH.toFixed(1)} mm · ${state.columns} × ${state.rows} labels</h1></div></div>
        <section class="preview-controls" aria-label="Preview controls"><div class="selection-controls"><button type="button" class="quiet" id="selection-mode" aria-pressed="${selectionMode}">${selectionMode ? 'Multi-select mode: on' : 'Multi-select mode'}</button>${contextHelp('multi-select', selectionMode ? 'Tap labels to add or remove them.' : 'Use Ctrl/Cmd-click to add labels, or enable multi-select mode for touch.')}</div><div class="preview-zoom-controls" aria-label="Preview zoom controls"><span id="preview-zoom-status" aria-live="polite">Zoom ${Math.round(previewZoom * 100)}%</span><button class="icon-button" type="button" data-preview-zoom="out" aria-label="Zoom out" title="Zoom out">−</button><button class="icon-button" type="button" data-preview-zoom="in" aria-label="Zoom in" title="Zoom in">+</button><button class="quiet" type="button" data-preview-zoom="fit" title="Fit preview to its normal size">Fit</button>${contextHelp('preview zoom', 'Scroll over the preview to zoom at the pointer. Use +, −, or Fit; when the preview has focus, +, −, and 0 work too. Zoom changes display size only.')}</div></section>
        <div class="canvas-wrap" id="preview-viewport" tabindex="0" aria-label="Zoomable sticker sheet preview" aria-describedby="preview-zoom-status" style="--ratio:${pageW / pageH}"><div class="preview-stage" id="preview-stage"><div class="sheet" id="sheet-preview" role="listbox" aria-label="Sticker labels" aria-multiselectable="true" style="--ratio:${pageW / pageH}">
          ${state.cells.map((item, index) => previewLabel(item, index, layout, pageW, pageH)).join('')}
        </div></div></div>
      </section>
    </main>
    <dialog id="image-dialog" aria-labelledby="crop-title"><form method="dialog"><div class="dialog-head"><h2 id="crop-title">Position background image</h2><button aria-label="Close" value="cancel">×</button></div><div id="crop-preview" class="crop-preview" aria-label="Drag image to set its position"><span class="crop-local"><i aria-hidden="true"></i></span></div>${rotationControls(cell.rotation, 'crop')}<label>Zoom<input id="crop-zoom" type="range" min="1" max="4" step=".05" value="${cell.imageZoom}"></label><label>Horizontal position<input id="crop-x" type="range" min="-100" max="100" value="${cell.imageX}"></label><label>Vertical position<input id="crop-y" type="range" min="-100" max="100" value="${cell.imageY}"></label><div class="dialog-help">${contextHelp('image positioning', `Drag the image, choose its orientation, or use the position sliders. Changes remain tentative until you apply them to all ${selection.length} selected labels.`)}</div><div class="dialog-actions"><button type="button" class="quiet" id="cancel-crop">Cancel</button><button type="submit" class="primary" value="apply" id="apply-crop">Apply position</button></div></form></dialog>
    <dialog id="export-dialog" aria-labelledby="export-title"><form method="dialog"><div class="dialog-head"><h2 id="export-title">Export sheet</h2><button aria-label="Close">×</button></div><p>Choose a format for the current prepared sheet.</p><div class="dialog-actions export-actions"><button type="button" class="export-action" data-export="svg">${exportActionIcon('svg')}<span>SVG</span></button><button type="button" class="export-action" data-export="pdf">${exportActionIcon('pdf')}<span>PDF</span></button><button type="button" class="export-action" data-export="json">${exportActionIcon('json')}<span>Template JSON</span></button><button type="button" class="quiet export-action" id="print-sheet">${exportActionIcon('print')}<span>Print</span></button></div><hr><button type="button" class="quiet export-action export-template-action" id="template-workflow">${exportActionIcon('template')}<span>Template library…</span></button></form></dialog>
    <dialog id="import-dialog" aria-labelledby="import-title"><form method="dialog"><div class="dialog-head"><h2 id="import-title">Import</h2><button aria-label="Close">×</button></div><label class="button quiet">Choose template JSON<input id="import-template" type="file" accept="application/json,.json" hidden></label><p>Imports stay on this device.</p></form></dialog>
    <dialog id="templates" aria-labelledby="templates-title"><form method="dialog"><div class="dialog-head"><h2 id="templates-title">Template library</h2><button aria-label="Close">×</button></div><button type="button" id="save-template" class="quiet">Save current sheet as template</button><div id="template-list">${templateList()}</div></form></dialog><div id="context-tooltip" class="context-tooltip" role="tooltip" hidden></div>`;
  wireEvents();
}
function previewLabel(item, index, layout, pageW, pageH) { const col = index % state.columns; const row = Math.floor(index / state.columns); const x = layout.x + col * (layout.cellWidth + layout.gapX); const y = layout.y + row * (layout.cellHeight + layout.gapY); const dimensions = contentDimensions(item, layout.cellWidth, layout.cellHeight); const crop = imageCropBox(item, 0, 0, dimensions.width, dimensions.height); const innerRadius = Math.max(0, state.cornerRadius - crop.inset); const image = item.appearanceMode === 'image' && item.image ? `<i class="label-image-wrap" aria-hidden="true" style="--image:url('${item.image}');--image-size:${crop.backgroundSize};--image-position:${crop.backgroundPosition}"></i>` : ''; const isSelected = selection.includes(index); return `<button class="label ${isSelected ? 'selected' : ''} ${index === selected ? 'primary-selection' : ''}" role="option" aria-selected="${isSelected}" aria-label="Label ${index + 1}${isSelected ? ', selected' : ''}" data-select="${index}" style="--left:${x / pageW * 100}%;--top:${y / pageH * 100}%;--width:${layout.cellWidth / pageW * 100}%;--height:${layout.cellHeight / pageH * 100}%;--safe:${crop.inset / dimensions.width * 100}%;--safe-y:${crop.inset / dimensions.height * 100}%;--radius-x:${state.cornerRadius / layout.cellWidth * 100}%;--radius-y:${state.cornerRadius / layout.cellHeight * 100}%;--inner-radius-x:${innerRadius / dimensions.width * 100}%;--inner-radius-y:${innerRadius / dimensions.height * 100}%;--bg:${item.background};--ink:${item.color};--size:${item.fontSize}px;--weight:${item.weight};--align:${item.align};--valign:${item.valign === 'top' ? 'flex-start' : item.valign === 'bottom' ? 'flex-end' : 'center'};" data-pattern="${item.appearanceMode === 'pattern' ? item.pattern : 'none'}" data-active-appearance-mode="${item.appearanceMode}"><span class="label-content" style="--rotation:${item.rotation}deg;--content-width:${dimensions.width / layout.cellWidth * 100}%;--content-height:${dimensions.height / layout.cellHeight * 100}%;">${image}<span class="label-text">${escapeHtml(item.text)}</span></span><span class="label-selection-overlay" aria-hidden="true"></span></button>`; }
function templateList() {
  const templates = savedTemplates();
  if (!templates.length) return '<p class="empty">No templates saved yet.</p>';
  return templates.map((template, index) => `<article class="template"><div><strong>${escapeHtml(template.name)}</strong><small>${template.columns} × ${template.rows} · ${template.format}</small></div><div><button type="button" data-template-load="${index}">Use</button><button type="button" class="danger" data-template-delete="${index}">Delete</button></div></article>`).join('');
}
function savedTemplates() { try { return JSON.parse(localStorage.getItem('sticker-sheet-studio.templates.v1')) || []; } catch { return []; } }
function applyPreviewCrop(button, cell) {
  const dimensions = contentDimensions(cell, state.labelWidth, state.labelHeight);
  const crop = imageCropBox(cell, 0, 0, dimensions.width, dimensions.height);
  button.style.setProperty('--safe', `${crop.inset / dimensions.width * 100}%`);
  button.style.setProperty('--safe-y', `${crop.inset / dimensions.height * 100}%`);
  const content = button.querySelector('.label-content');
  content?.style.setProperty('--rotation', `${cell.rotation}deg`);
  content?.style.setProperty('--content-width', `${dimensions.width / state.labelWidth * 100}%`);
  content?.style.setProperty('--content-height', `${dimensions.height / state.labelHeight * 100}%`);
  const image = content?.querySelector('.label-image-wrap');
  if (image) {
    image.style.setProperty('--image-size', crop.backgroundSize);
    image.style.setProperty('--image-position', crop.backgroundPosition);
  }
}
function patchPreview() { selection.forEach((index) => { const button = app.querySelector(`[data-select="${index}"]`); const cell = state.cells[index]; if (!button) return; button.style.setProperty('--bg', cell.background); button.style.setProperty('--ink', cell.color); button.style.setProperty('--size', `${cell.fontSize}px`); button.style.setProperty('--weight', cell.weight); button.style.setProperty('--align', cell.align); button.style.setProperty('--valign', cell.valign === 'top' ? 'flex-start' : cell.valign === 'bottom' ? 'flex-end' : 'center'); button.dataset.pattern = cell.pattern; button.querySelector('.label-text').textContent = cell.text; applyPreviewCrop(button, cell); }); }
function patchSelected(patch) { state.cells = patchSelectedCells(state.cells, selection, patch); persist(); }
function selectLabel(index, toggle = false) {
  if (toggle) {
    selection = selection.includes(index) ? selection.filter((item) => item !== index) : [...selection, index];
    selection = normalizeSelection(selection, state.cells.length, selected);
  } else selection = [index];
  selected = selection.includes(index) ? index : selection[0];
  activeTab = 'label';
  if (window.matchMedia('(max-width: 760px)').matches) ui = { ...ui, labelEditor: true };
  requestRender();
}
function clampPreviewZoom(value) { return Math.min(PREVIEW_ZOOM_MAX, Math.max(PREVIEW_ZOOM_MIN, value)); }
function setupPreviewZoom() {
  const viewport = app.querySelector('#preview-viewport');
  const sheet = app.querySelector('#sheet-preview');
  const status = app.querySelector('#preview-zoom-status');
  if (!viewport || !sheet || !status) return;
  const baseSheetWidth = sheet.getBoundingClientRect().width;
  const apply = (next, clientX, clientY) => {
    next = clampPreviewZoom(next);
    const viewportBounds = viewport.getBoundingClientRect();
    const oldSheetBounds = sheet.getBoundingClientRect();
    const pointerX = clientX ?? viewportBounds.left + viewportBounds.width / 2;
    const pointerY = clientY ?? viewportBounds.top + viewportBounds.height / 2;
    const ratioX = Math.min(1, Math.max(0, (pointerX - oldSheetBounds.left) / oldSheetBounds.width));
    const ratioY = Math.min(1, Math.max(0, (pointerY - oldSheetBounds.top) / oldSheetBounds.height));
    previewZoom = next;
    sheet.style.width = `${baseSheetWidth * previewZoom}px`;
    status.textContent = `Zoom ${Math.round(previewZoom * 100)}%`;
    if (previewZoom === 1) {
      viewport.scrollLeft = 0;
      viewport.scrollTop = 0;
      return;
    }
    // Width changes alter the stage's intrinsic size. Flush that layout before
    // assigning scroll offsets; otherwise the browser clamps them using the
    // previous, non-scrollable stage dimensions.
    void sheet.offsetWidth;
    // Offset coordinates stay in the untransformed scroll stage, which lets the
    // exact point below the cursor retain its place after the size change.
    viewport.scrollLeft = sheet.offsetLeft + ratioX * sheet.offsetWidth - (pointerX - viewportBounds.left);
    viewport.scrollTop = sheet.offsetTop + ratioY * sheet.offsetHeight - (pointerY - viewportBounds.top);
  };
  app.querySelectorAll('[data-preview-zoom]').forEach((button) => button.addEventListener('click', () => {
    const action = button.dataset.previewZoom;
    apply(action === 'fit' ? 1 : previewZoom * (action === 'in' ? 1.2 : 1 / 1.2));
  }));
  viewport.addEventListener('wheel', (event) => {
    // Ctrl/Cmd-wheel remains available to the browser's page zoom feature.
    if (event.ctrlKey || event.metaKey) return;
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientHeight : 1);
    apply(previewZoom * Math.exp(-delta * .0015), event.clientX, event.clientY);
    event.preventDefault();
  }, { passive: false });
  viewport.addEventListener('keydown', (event) => {
    if (event.target !== viewport || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === '+' || event.key === '=') { apply(previewZoom * 1.2); event.preventDefault(); }
    if (event.key === '-') { apply(previewZoom / 1.2); event.preventDefault(); }
    if (event.key === '0') { apply(1); event.preventDefault(); }
  });
  apply(previewZoom);
}
function setupContextHelp() {
  const tooltip = app.querySelector('#context-tooltip');
  if (!tooltip) return;
  let activeButton;
  const hide = () => {
    if (activeButton) activeButton.setAttribute('aria-expanded', 'false');
    activeButton = undefined;
    tooltip.hidden = true;
  };
  const show = (button) => {
    activeButton = button;
    const host = button.closest('dialog') || app;
    if (tooltip.parentElement !== host) host.append(tooltip);
    tooltip.textContent = button.dataset.contextHelp;
    tooltip.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    const bounds = button.getBoundingClientRect();
    const inset = 8;
    const left = Math.min(window.innerWidth - tooltip.offsetWidth - inset, Math.max(inset, bounds.left + bounds.width / 2 - tooltip.offsetWidth / 2));
    const top = bounds.bottom + 8 + tooltip.offsetHeight <= window.innerHeight - inset
      ? bounds.bottom + 8
      : Math.max(inset, bounds.top - tooltip.offsetHeight - 8);
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  };
  app.querySelectorAll('[data-context-help]').forEach((button) => {
    button.addEventListener('mouseenter', () => show(button));
    button.addEventListener('mouseleave', () => { if (document.activeElement !== button) hide(); });
    button.addEventListener('focus', () => show(button));
    button.addEventListener('blur', hide);
    button.addEventListener('click', () => show(button));
    button.addEventListener('keydown', (event) => { if (event.key === 'Escape') { hide(); button.focus(); } });
  });
  window.addEventListener('resize', hide, { once: true });
  window.addEventListener('scroll', hide, { once: true, capture: true });
}
function wireEvents() {
  setupPreviewZoom();
  setupContextHelp();
  app.querySelectorAll('[data-tab]').forEach((tab) => tab.addEventListener('click', () => { activeTab = tab.dataset.tab; render(); }));
  app.querySelector('.tabs').addEventListener('keydown', (event) => { if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return; event.preventDefault(); activeTab = event.key === 'ArrowLeft' || event.key === 'Home' ? 'sheet' : 'label'; render(); app.querySelector(`[data-tab="${activeTab}"]`).focus(); });
  app.querySelectorAll('[data-sheet]').forEach((input) => input.addEventListener('change', () => { state[input.dataset.sheet] = input.value; updateGrid(); }));
  app.querySelectorAll('[data-cell]').forEach((input) => input.addEventListener('input', () => { patchSelected(() => ({ [input.dataset.cell]: input.value })); patchPreview(); }));
  // Do not rerender on change: keyboard navigation commits change before focusing the next
  // control, and a rerender would remove a Copy-to-all button before its Enter/Space click.
  app.querySelectorAll('[data-cell]').forEach((input) => input.addEventListener('change', () => { patchSelected(() => ({ [input.dataset.cell]: input.value })); patchPreview(); }));
  app.querySelector('[data-cell="background"]')?.addEventListener('keydown', (event) => {
    if (event.key === 'Tab' && event.shiftKey) { event.preventDefault(); app.querySelector('[data-copy="appearance"]')?.focus(); }
  });
  app.querySelectorAll('[data-appearance-mode]').forEach((input) => input.addEventListener('change', () => {
    const mode = input.dataset.appearanceMode;
    if (mode === 'image' && !state.cells[selected].image) { app.querySelector('#image-input')?.click(); return; }
    patchSelected(() => ({ appearanceMode: mode }));
    render();
  }));
  app.querySelectorAll('[data-select]').forEach((button) => button.addEventListener('click', (event) => selectLabel(Number(button.dataset.select), event.ctrlKey || event.metaKey || selectionMode)));
  app.querySelector('#selection-mode').addEventListener('click', () => { selectionMode = !selectionMode; render(); });
  app.querySelector('#clear-label').addEventListener('click', () => {
    const populated = selection.filter((index) => hasLabelContent(state.cells[index]));
    if (populated.length && !confirm(`Clear ${selection.length === 1 ? 'this label' : `${selection.length} selected labels`}? This removes their text, image, pattern, and formatting.`)) return;
    state.cells = resetSelectedCells(state.cells, selection);
    persist();
    render();
    app.querySelector('#clear-label')?.focus();
  });
  app.querySelectorAll('[data-copy]').forEach((button) => {
    const copyToAll = () => {
      const group = button.dataset.copy;
      const source = state.cells[selected];
      const copy = group === 'text' ? copyTextSettings : group === 'style' ? copyStyleSettings : copyAppearanceSettings;
      state.cells = state.cells.map((item) => copy(source, item));
      persist();
      render();
      app.querySelector(`[data-copy="${group}"]`)?.focus();
    };
    let copiedOnPointer = false;
    button.addEventListener('pointerdown', (event) => { event.preventDefault(); copiedOnPointer = true; skipPointerCopyClick = true; copyToAll(); });
    button.addEventListener('click', () => {
      if (skipPointerCopyClick) { skipPointerCopyClick = false; return; }
      if (!copiedOnPointer) copyToAll();
    });
  });
  app.querySelector('[data-toggle-weight]').addEventListener('click', () => { patchSelected((cell) => ({ weight: cell.weight === '700' ? '400' : '700' })); render(); });
  app.querySelectorAll('[data-align]').forEach((button) => button.addEventListener('click', () => { patchSelected(() => ({ align: button.dataset.align })); render(); }));
  app.querySelectorAll('[data-editor-rotation]').forEach((button) => button.addEventListener('click', () => { patchSelected(() => ({ rotation: Number(button.dataset.editorRotation) })); render(); }));
  app.querySelector('#image-input')?.addEventListener('change', (event) => { const file = event.target.files[0]; if (!file) return; const reader = new FileReader(); reader.onload = () => { const image = new Image(); image.onload = () => { patchSelected(() => ({ appearanceMode: 'image', image: reader.result, imageWidth: image.naturalWidth, imageHeight: image.naturalHeight, imageZoom: 1, imageX: 0, imageY: 0 })); render(); openCropDialog(); }; image.src = reader.result; }; reader.readAsDataURL(file); });
  app.querySelector('#remove-image')?.addEventListener('click', () => { patchSelected(() => ({ appearanceMode: 'solid', image: '', imageWidth: 0, imageHeight: 0 })); render(); });
  app.querySelector('#position-image')?.addEventListener('click', openCropDialog);
  app.querySelector('#template-workflow').addEventListener('click', () => { app.querySelector('#export-dialog').close(); app.querySelector('#templates').showModal(); });
  app.querySelector('#save-template').addEventListener('click', () => { const name = prompt('Template name', state.name); if (!name) return; const templates = savedTemplates(); templates.push({ ...state, name }); localStorage.setItem('sticker-sheet-studio.templates.v1', JSON.stringify(templates)); render(); app.querySelector('#templates').showModal(); });
  app.querySelectorAll('[data-template-load]').forEach((button) => button.addEventListener('click', () => { state = normalizeSheet(savedTemplates()[Number(button.dataset.templateLoad)]); selected = 0; selection = [0]; persist(); app.querySelector('#templates').close(); render(); }));
  app.querySelectorAll('[data-template-delete]').forEach((button) => button.addEventListener('click', () => { const templates = savedTemplates(); templates.splice(Number(button.dataset.templateDelete), 1); localStorage.setItem('sticker-sheet-studio.templates.v1', JSON.stringify(templates)); render(); app.querySelector('#templates').showModal(); }));
  app.querySelectorAll('[data-export]').forEach((button) => button.addEventListener('click', () => {
    app.querySelector('#export-dialog').close();
    if (button.dataset.export === 'svg') download(`${safeName()}.svg`, new Blob([getSvg(state)], { type: 'image/svg+xml' }));
    if (button.dataset.export === 'pdf') exportPdf();
    if (button.dataset.export === 'json') download(`${safeName()}.json`, new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' }));
  }));
  app.querySelector('#import-template').addEventListener('change', (event) => { const file = event.target.files[0]; if (!file) return; const reader = new FileReader(); reader.onload = () => { try { state = normalizeSheet(JSON.parse(reader.result), { rejectInvalidGeometry: true }); selected = 0; selection = [0]; persist(); render(); } catch { alert('This file is not a valid Sticker Sheet Studio template.'); } }; reader.readAsText(file); });
  app.querySelector('#print-sheet').addEventListener('click', printSheet);
}
function openCropDialog() {
  const dialog = app.querySelector('#image-dialog');
  const cell = state.cells[selected];
  if (!cell?.image || cell.appearanceMode !== 'image' || dialog.open) return;
  const preview = dialog.querySelector('#crop-preview');
  const zoom = dialog.querySelector('#crop-zoom');
  const x = dialog.querySelector('#crop-x');
  const y = dialog.querySelector('#crop-y');
  let rotation = cell.rotation;
  let activeCrop;
  const clamp = (value) => Math.min(100, Math.max(-100, value));
  const sync = () => {
    const dimensions = contentDimensions({ ...cell, rotation }, state.labelWidth, state.labelHeight);
    const crop = imageCropBox({ ...cell, rotation, imageZoom: Number(zoom.value), imageX: Number(x.value), imageY: Number(y.value) }, 0, 0, dimensions.width, dimensions.height);
    const screenWidth = rotation === 270 ? crop.height : crop.width;
    const screenHeight = rotation === 270 ? crop.width : crop.height;
    const local = preview.querySelector('.crop-local');
    const image = local.querySelector('i');
    activeCrop = { crop, screenWidth, screenHeight };
    preview.style.aspectRatio = `${screenWidth} / ${screenHeight}`;
    Object.assign(local.style, {
      width: `${crop.width / screenWidth * 100}%`, height: `${crop.height / screenHeight * 100}%`,
      transform: `translate(-50%, -50%) rotate(${rotation}deg)`,
    });
    Object.assign(image.style, {
      backgroundImage: `url('${cell.image}')`,
      width: `${crop.imageWidth / crop.width * 100}%`, height: `${crop.imageHeight / crop.height * 100}%`,
      left: `${(crop.imageX - crop.x) / crop.width * 100}%`, top: `${(crop.imageY - crop.y) / crop.height * 100}%`,
    });
  };
  [zoom, x, y].forEach((input) => input.addEventListener('input', sync));
  dialog.querySelectorAll('[data-crop-rotation]').forEach((button) => button.addEventListener('click', () => {
    rotation = Number(button.dataset.cropRotation);
    dialog.querySelectorAll('[data-crop-rotation]').forEach((mode) => {
      const pressed = Number(mode.dataset.cropRotation) === rotation;
      mode.classList.toggle('is-active', pressed);
      mode.setAttribute('aria-pressed', String(pressed));
    });
    sync();
  }));
  let drag;
  preview.addEventListener('pointerdown', (event) => {
    if (event.button !== undefined && event.button !== 0) return;
    const bounds = preview.getBoundingClientRect();
    const { crop, screenWidth } = activeCrop;
    // The displayed physical crop can be scaled, but both rotated local axes
    // retain this one scale factor. Store local overflow, not transformed DOM
    // bounds, so a 270° drag cannot accidentally use the opposite axis.
    drag = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, imageX: Number(x.value), imageY: Number(y.value), overflowX: crop.imageWidth - crop.width, overflowY: crop.imageHeight - crop.height, scale: bounds.width / screenWidth };
    try { preview.setPointerCapture(event.pointerId); } catch { /* Synthetic pointer events may not have an active pointer. */ }
    event.preventDefault();
  });
  preview.addEventListener('pointermove', (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    // imageCropBox maps -100..100 across local image overflow. Convert the
    // screen gesture through the same 270° transform used by label and SVG.
    const delta = cropScreenDeltaToLocal({ rotation }, (event.clientX - drag.startX) / drag.scale, (event.clientY - drag.startY) / drag.scale);
    if (drag.overflowX > 0) x.value = String(clamp(drag.imageX - delta.x / drag.overflowX * 200));
    if (drag.overflowY > 0) y.value = String(clamp(drag.imageY - delta.y / drag.overflowY * 200));
    sync();
  });
  const endDrag = (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    try { if (preview.hasPointerCapture(event.pointerId)) preview.releasePointerCapture(event.pointerId); } catch { /* Pointer capture was not established. */ }
    drag = undefined;
  };
  preview.addEventListener('pointerup', endDrag);
  preview.addEventListener('pointercancel', endDrag);
  dialog.querySelector('#cancel-crop').addEventListener('click', () => dialog.close('cancel'));
  dialog.querySelector('form').addEventListener('submit', (event) => {
    event.preventDefault();
    patchSelected(() => ({ rotation, imageZoom: Number(zoom.value), imageX: Number(x.value), imageY: Number(y.value) }));
    dialog.close('apply');
    render();
  });
  sync();
  dialog.showModal();
}
async function createPdfBlob() {
  const svg = getSvg(state); const geometry = pdfExportGeometry(state);
  const image = new Image(); const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = url; });
    const canvas = document.createElement('canvas'); canvas.width = geometry.rasterWidth; canvas.height = geometry.rasterHeight;
    const context = canvas.getContext('2d'); context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const pdf = new jsPDF({ orientation: geometry.orientation, unit: 'mm', format: geometry.format, compress: true });
    const pageWidth = pdf.internal.pageSize.getWidth(); const pageHeight = pdf.internal.pageSize.getHeight();
    if (Math.abs(pageWidth - geometry.width) > .01 || Math.abs(pageHeight - geometry.height) > .01) throw new Error('PDF page geometry does not match the sheet.');
    pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, pageWidth, pageHeight, undefined, 'FAST');
    return pdf.output('blob');
  } finally { URL.revokeObjectURL(url); }
}
async function exportPdf() {
  const button = document.querySelector('[data-export="pdf"]'); const label = button?.innerHTML;
  if (button) { button.disabled = true; button.textContent = 'Creating PDF…'; }
  try {
    download(`${safeName()}.pdf`, await createPdfBlob());
  } catch { message.error('PDF generation failed. Try removing an incompatible image and export again.'); }
  finally { if (button) { button.disabled = false; button.innerHTML = label; } }
}
function printSheet() {
  const printable = window.open('', '_blank');
  if (!printable) { alert('Allow pop-ups to print the prepared sheet.'); return; }
  const svg = getSvg(state);
  printable.document.write(`<!doctype html><html><head><title>${escapeHtml(state.name)}</title><style>@page{size:${state.format} ${state.orientation};margin:0}html,body{margin:0;width:100%;height:100%;background:#fff}svg{display:block;width:100%;height:auto}</style></head><body>${svg}</body></html>`);
  printable.document.close();
  const startPrint = () => { printable.focus(); printable.print(); };
  if (printable.document.readyState === 'complete') startPrint();
  else printable.addEventListener('load', startPrint, { once: true });
}
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js'));
requestRender();
