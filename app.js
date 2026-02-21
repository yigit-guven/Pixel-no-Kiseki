/**
 * Pixel-no-Kiseki - Unified Portability Edition (Hotfix 4)
 * Fixes:
 * 1. Exact-dimension PNG Export (Clipping ghost data)
 * 2. Physical canvas resizing with data preservation
 */

// --- 1. State Management ---
class State {
    constructor() {
        this.width = 16;
        this.height = 16;
        this.zoom = 30;
        this.panX = 0;
        this.panY = 0;
        this.currentColor = '#38bdf8';
        this.currentTool = 'pencil';
        this.brushSize = 1;
        this.settingsVisible = false;
        this.isDrawing = false;
        this.isPanning = false;
        this.history = [];
        this.redoStack = [];
        this.maxHistory = 50;
        this.subscribers = new Set();
    }

    update(newState) {
        Object.assign(this, newState);
        this.notify();
    }

    subscribe(callback) {
        this.subscribers.add(callback);
        return () => this.subscribers.delete(callback);
    }

    notify() {
        this.subscribers.forEach(callback => callback(this));
    }

    saveHistory(dataURL) {
        this.history.push(dataURL);
        if (this.history.length > this.maxHistory) this.history.shift();
        this.redoStack = [];
        this.notify();
    }

    performUndo() {
        if (this.history.length <= 1) return null;
        const current = this.history.pop();
        this.redoStack.push(current);
        return this.history[this.history.length - 1];
    }

    performRedo() {
        if (this.redoStack.length === 0) return null;
        const next = this.redoStack.pop();
        this.history.push(next);
        return next;
    }
}

const state = new State();

// --- 2. Coordinate Management ---
class CoordinateManager {
    constructor(state) {
        this.state = state;
    }

    screenToPixel(e, canvasRect) {
        const pixelWidth = canvasRect.width / this.state.width;
        const pixelHeight = canvasRect.height / this.state.height;
        return {
            x: Math.floor((e.clientX - canvasRect.left) / pixelWidth),
            y: Math.floor((e.clientY - canvasRect.top) / pixelHeight)
        };
    }

    calculateFit(viewportWidth, viewportHeight, padding = 100) {
        const availableW = Math.max(10, viewportWidth - padding);
        const availableH = Math.max(10, viewportHeight - padding);
        const scaleW = availableW / this.state.width;
        const scaleH = availableH / this.state.height;
        let zoom = Math.floor(Math.min(scaleW, scaleH));
        zoom = Math.max(1, Math.min(100, zoom));
        return {
            zoom,
            panX: (viewportWidth - (this.state.width * zoom)) / 2,
            panY: (viewportHeight - (this.state.height * zoom)) / 2
        };
    }
}

// --- 3. Viewport Management ---
class ViewportManager {
    constructor(state, elements) {
        this.state = state;
        this.canvas = elements.canvas;
        this.container = elements.container;
        this.viewport = elements.viewport;
        this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
        this.coords = new CoordinateManager(state);
        this.isInitialized = false;
        this.setupResizing();
    }

    setupResizing() {
        this.resizeObserver = new ResizeObserver(() => {
            const rect = this.viewport.getBoundingClientRect();
            if (rect.width > 50 && rect.height > 50) {
                if (!this.isInitialized) {
                    this.autoFit();
                    this.isInitialized = true;
                } else {
                    this.centerOnly();
                }
            }
        });
        this.resizeObserver.observe(this.viewport);
    }

    centerOnly() {
        const vw = this.viewport.clientWidth;
        const vh = this.viewport.clientHeight;
        if (vw === 0 || vh === 0) return;
        this.state.update({
            panX: (vw - this.canvas.width) / 2,
            panY: (vh - this.canvas.height) / 2
        });
    }

    autoFit() {
        const vw = this.viewport.clientWidth;
        const vh = this.viewport.clientHeight;
        if (vw === 0 || vh === 0) return;
        const result = this.coords.calculateFit(vw, vh);
        this.state.update({ zoom: result.zoom, panX: result.panX, panY: result.panY });
    }

    syncDisplaySize() {
        const z = Math.max(1, Math.floor(this.state.zoom));
        const targetW = this.state.width * z;
        const targetH = this.state.height * z;
        if (this.canvas.width !== targetW || this.canvas.height !== targetH) {
            this.canvas.width = targetW;
            this.canvas.height = targetH;
            this.ctx.imageSmoothingEnabled = false;
        }
    }

    applyTransform() {
        if (!this.container) return;
        this.container.style.transition = 'none';
        this.container.style.transform = `translate(${Math.floor(this.state.panX)}px, ${Math.floor(this.state.panY)}px)`;
        requestAnimationFrame(() => {
            if (this.container) this.container.style.transition = 'transform 0.05s linear';
        });
    }

    render(workCanvas) {
        this.syncDisplaySize();
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        const isLight = document.documentElement.getAttribute('data-theme') === 'light';
        const color1 = isLight ? '#ffffff' : '#1e293b';
        const color2 = isLight ? '#94a3b8' : '#475569';
        const z = Math.max(1, Math.floor(this.state.zoom));

        for (let y = 0; y < this.state.height; y++) {
            for (let x = 0; x < this.state.width; x++) {
                this.ctx.fillStyle = (x + y) % 2 === 0 ? color1 : color2;
                this.ctx.fillRect(x * z, y * z, z, z);
            }
        }

        if (workCanvas) {
            // Draw only the active logical area of the work canvas
            this.ctx.drawImage(workCanvas, 0, 0, this.state.width, this.state.height, 0, 0, this.canvas.width, this.canvas.height);
        }
        this.applyTransform();
    }
}

// --- 4. Tool Management ---
class ToolManager {
    constructor(state, viewport, workCtx) {
        this.state = state; this.viewport = viewport; this.workCtx = workCtx;
        this.lastX = -1; this.lastY = -1;
    }

    execute(action, x, y) {
        if (x < 0 || x >= this.state.width || y < 0 || y >= this.state.height) return;
        const tool = this.state.currentTool;
        const color = this.state.currentColor;
        switch (action) {
            case 'start':
                this.state.update({ isDrawing: true });
                if (tool === 'fill') this.floodFill(x, y, color);
                else if (tool === 'eyedropper') this.pickColor(x, y);
                else { this.drawPixel(x, y, color); this.lastX = x; this.lastY = y; }
                break;
            case 'move':
                if (!this.state.isDrawing) return;
                if (tool === 'pencil' || tool === 'eraser') {
                    this.drawLine(this.lastX, this.lastY, x, y, color);
                    this.lastX = x; this.lastY = y;
                }
                break;
            case 'end':
                if (this.state.isDrawing) {
                    this.state.update({ isDrawing: false });
                    return 'SHOULD_SAVE_HISTORY';
                }
                break;
        }
    }

    drawPixel(x, y, color) {
        const b = this.state.brushSize || 1;
        const half = Math.floor(b / 2);
        const px = x - half;
        const py = y - half;
        const cx = Math.max(0, px);
        const cy = Math.max(0, py);
        const cw = Math.min(b, this.state.width - cx);
        const ch = Math.min(b, this.state.height - cy);
        if (this.state.currentTool === 'eraser') {
            this.workCtx.clearRect(cx, cy, cw, ch);
        } else {
            this.workCtx.fillStyle = color;
            this.workCtx.fillRect(cx, cy, cw, ch);
        }
    }

    drawLine(x0, y0, x1, y1, color) {
        const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
        const sx = (x0 < x1) ? 1 : -1, sy = (y0 < y1) ? 1 : -1;
        let err = dx - dy;
        while (true) {
            this.drawPixel(x0, y0, color);
            if (x0 === x1 && y0 === y1) break;
            const e2 = 2 * err;
            if (e2 > -dy) { err -= dy; x0 += sx; }
            if (e2 < dx) { err += dx; y0 += sy; }
        }
    }

    floodFill(startX, startY, fillColor) {
        const imgData = this.workCtx.getImageData(0, 0, this.state.width, this.state.height);
        const data = imgData.data;
        const targetColor = this.getPixelColor(startX, startY, data);
        const fillRGBA = this.hexToRgb(fillColor);
        if (this.colorsMatch(targetColor, fillRGBA)) return;
        const queue = [[startX, startY]];
        while (queue.length > 0) {
            const [x, y] = queue.shift();
            const currentColor = this.getPixelColor(x, y, data);
            if (this.colorsMatch(currentColor, targetColor)) {
                this.setPixelData(x, y, data, fillRGBA);
                if (x > 0) queue.push([x - 1, y]);
                if (x < this.state.width - 1) queue.push([x + 1, y]);
                if (y > 0) queue.push([x, y - 1]);
                if (y < this.state.height - 1) queue.push([x, y + 1]);
            }
        }
        this.workCtx.putImageData(imgData, 0, 0);
    }

    pickColor(x, y) {
        const data = this.workCtx.getImageData(x, y, 1, 1).data;
        if (data[3] > 0) {
            const hex = "#" + ((1 << 24) + (data[0] << 16) + (data[1] << 8) + data[2]).toString(16).slice(1);
            this.state.update({ currentColor: hex });
        }
    }

    getPixelColor(x, y, data) {
        const i = (y * this.state.width + x) * 4;
        return [data[i], data[i + 1], data[i + 2], data[i + 3]];
    }

    setPixelData(x, y, data, rgba) {
        const i = (y * this.state.width + x) * 4;
        data[i] = rgba[0]; data[i + 1] = rgba[1]; data[i + 2] = rgba[2]; data[i + 3] = rgba[3];
    }

    colorsMatch(c1, c2) { return c1[0] === c2[0] && c1[1] === c2[1] && c1[2] === c2[2] && c1[3] === c2[3]; }

    hexToRgb(hex) {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return result ? [parseInt(result[1], 16), parseInt(result[2], 16), parseInt(result[3], 16), 255] : [0, 0, 0, 255];
    }
}

// --- 5. Theme System ---
class ThemeSystem {
    constructor(state) {
        this.state = state;
        this.toggleBtn = document.getElementById('theme-toggle');
        this.init();
    }

    init() {
        const savedTheme = localStorage.getItem('theme') || (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
        this.apply(savedTheme);
        if (this.toggleBtn) {
            this.toggleBtn.onclick = () => {
                const current = document.documentElement.getAttribute('data-theme');
                this.apply(current === 'dark' ? 'light' : 'dark');
            };
        }
    }

    apply(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem('theme', theme);
        if (this.toggleBtn) {
            const targetIcon = theme === 'light' ? 'moon' : 'sun';
            this.toggleBtn.innerHTML = `<i data-lucide="${targetIcon}"></i>`;
            if (window.lucide) window.lucide.createIcons();
        }
        this.state.notify();
    }
}

// --- 6. File Management ---
class FileManager {
    constructor(state, viewport, workCanvas, workCtx) {
        this.state = state; this.viewport = viewport; this.workCanvas = workCanvas; this.workCtx = workCtx;
        this.fileInput = document.getElementById('file-input');
        if (this.fileInput) {
            this.fileInput.onchange = (e) => this.importPNG(e);
        }
    }

    exportPNG() {
        // PROFESSIONAL CLIPPING FIX: 
        // We create a temporary canvas to ensure only the active area is exported.
        const exportCanvas = document.createElement('canvas');
        exportCanvas.width = this.state.width;
        exportCanvas.height = this.state.height;
        const exportCtx = exportCanvas.getContext('2d');

        // Copy only the logical area from workCanvas
        exportCtx.drawImage(this.workCanvas, 0, 0, this.state.width, this.state.height, 0, 0, this.state.width, this.state.height);

        const link = document.createElement('a');
        link.download = `texture_${this.state.width}x${this.state.height}.png`;
        link.href = exportCanvas.toDataURL('image/png');
        link.click();
    }

    importPNG(e) {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (event) => {
            const img = new Image();
            img.onload = () => {
                if (img.width > 320 || img.height > 320) { alert('Image too large! Maximum 320x320.'); return; }

                // Update State and Canvas Dimensions
                this.state.update({ width: img.width, height: img.height });
                this.workCanvas.width = img.width;
                this.workCanvas.height = img.height;

                this.workCtx.clearRect(0, 0, img.width, img.height);
                this.workCtx.drawImage(img, 0, 0);
                this.viewport.autoFit();
                this.state.saveHistory(this.workCanvas.toDataURL());
            };
            img.src = event.target.result;
        };
        reader.readAsDataURL(file);
    }

    triggerImport() { if (this.fileInput) this.fileInput.click(); }
}

// --- 7. UI Controller ---
class UIController {
    constructor(state, viewport, tools, files) {
        this.state = state; this.viewport = viewport; this.tools = tools; this.files = files;
        this.coordDisplay = document.getElementById('coord-display');
        this.sizeDisplay = document.getElementById('size-display');
        this.zoomDisplay = document.getElementById('zoom-display');
        this.setupBindings();
        this.setupEventListeners();
    }

    setupBindings() {
        this.state.subscribe((s) => {
            if (this.sizeDisplay) this.sizeDisplay.innerText = `${s.width} x ${s.height}`;
            if (this.zoomDisplay) this.zoomDisplay.innerText = `${Math.round(s.zoom * 100 / 30)}%`;
            document.querySelectorAll('.tool-btn').forEach(btn => btn.classList.toggle('active', btn.id === `tool-${s.currentTool}`));
            this.updateColorUI(s.currentColor);
            document.querySelectorAll('.swatch').forEach(sw => {
                sw.classList.toggle('active', sw.dataset.color === s.currentColor.toLowerCase());
            });
            this.updateContextualSettings(s.currentTool, s.settingsVisible);
        });
    }

    updateContextualSettings(tool, visible = true) {
        const panel = document.getElementById('tool-settings-panel');
        const colorSet = document.getElementById('color-settings');
        const brushSet = document.getElementById('brush-settings');
        if (!panel) return;

        const toolSupportsColor = (tool === 'pencil' || tool === 'fill');
        const toolSupportsBrush = (tool === 'pencil' || tool === 'eraser');
        const toolHasSettings = toolSupportsColor || toolSupportsBrush;

        const active = toolHasSettings && visible;
        panel.classList.toggle('hidden', !active);
        if (colorSet) colorSet.style.display = toolSupportsColor ? 'block' : 'none';
        if (brushSet) brushSet.style.display = toolSupportsBrush ? 'block' : 'none';
    }

    // Parse color string (hex3/6/8) → { hex6, alpha(0-255) }
    parseColor(raw) {
        let h = (raw || '').trim().replace(/^#/, '');
        if (h.length === 3) h = h.split('').map(c => c + c).join('');
        const hex6 = '#' + h.slice(0, 6).padEnd(6, '0');
        const alpha = h.length >= 8 ? parseInt(h.slice(6, 8), 16) : 255;
        return { hex6, alpha: isNaN(alpha) ? 255 : alpha };
    }

    // Build full RGBA hex from hex6 and alpha
    buildColor(hex6, alpha) {
        if (alpha >= 255) return hex6.toLowerCase();
        return hex6.toLowerCase() + Math.round(alpha).toString(16).padStart(2, '0');
    }

    updateColorUI(colorRaw) {
        const { hex6, alpha } = this.parseColor(colorRaw);
        const cp = document.getElementById('color-picker');
        const hexIn = document.getElementById('hex-input');
        const alphaSl = document.getElementById('alpha-slider');
        const alphaNum = document.getElementById('alpha-value');
        const preview = document.getElementById('color-preview-swatch');

        if (cp) cp.value = hex6;
        if (hexIn && document.activeElement !== hexIn) {
            hexIn.value = alpha < 255 ? (hex6 + Math.round(alpha).toString(16).padStart(2, '0')).toUpperCase() : hex6.toUpperCase();
        }
        if (alphaSl) alphaSl.value = alpha;
        if (alphaNum) alphaNum.textContent = alpha;

        // Update CSS custom property for swatch preview and alpha slider gradient
        const rgbParts = hex6.slice(1).match(/.{2}/g).map(x => parseInt(x, 16));
        const rgbaStr = `rgba(${rgbParts.join(',')},${(alpha / 255).toFixed(2)})`;
        if (preview) preview.parentElement.style.setProperty('--preview-color', rgbaStr);
        const slider = document.getElementById('alpha-slider');
        if (slider) slider.style.background = `linear-gradient(to right, transparent, ${hex6})`;
    }

    setupEventListeners() {
        const toolMap = { 'tool-pencil': 'pencil', 'tool-eraser': 'eraser', 'tool-fill': 'fill', 'tool-eyedropper': 'eyedropper', 'tool-hand': 'hand' };
        Object.entries(toolMap).forEach(([id, tool]) => {
            const el = document.getElementById(id);
            if (el) el.onclick = () => {
                if (this.state.currentTool === tool) {
                    this.state.update({ settingsVisible: !this.state.settingsVisible });
                } else {
                    this.state.update({ currentTool: tool, settingsVisible: true });
                }
            };
        });

        const bind = (id, fn) => { const el = document.getElementById(id); if (el) el.onclick = fn; };

        // Color picker: native colour input
        const cp = document.getElementById('color-picker');
        if (cp) cp.oninput = () => {
            const alphaSl = document.getElementById('alpha-slider');
            const alpha = alphaSl ? parseInt(alphaSl.value) : 255;
            this.state.update({ currentColor: this.buildColor(cp.value, alpha) });
        };

        // Hex text input
        const hexIn = document.getElementById('hex-input');
        if (hexIn) hexIn.addEventListener('input', () => {
            const raw = hexIn.value.trim();
            if (/^#?[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(raw)) {
                const full = raw.startsWith('#') ? raw : '#' + raw;
                const { hex6, alpha } = this.parseColor(full);
                this.state.update({ currentColor: this.buildColor(hex6, alpha) });
            }
        });

        // Alpha slider
        const alphaSl = document.getElementById('alpha-slider');
        if (alphaSl) alphaSl.addEventListener('input', () => {
            const { hex6 } = this.parseColor(this.state.currentColor);
            this.state.update({ currentColor: this.buildColor(hex6, parseInt(alphaSl.value)) });
        });

        bind('undo-btn', () => { const d = this.state.performUndo(); if (d) this.loadStateToWorkCanvas(d); });
        bind('redo-btn', () => { const d = this.state.performRedo(); if (d) this.loadStateToWorkCanvas(d); });
        bind('export-btn', () => this.files.exportPNG());
        bind('import-btn', () => this.files.triggerImport());
        bind('center-view-btn', () => this.viewport.centerOnly());
        bind('fit-btn', () => this.viewport.autoFit());
        bind('center-view-btn-sidebar', () => this.viewport.centerOnly());

        const wIn = document.getElementById('canvas-width-input');
        const hIn = document.getElementById('canvas-height-input');

        // Preset sizes
        document.querySelectorAll('.preset-btn[data-size]').forEach(btn => {
            btn.onclick = () => {
                const s = btn.dataset.size;
                if (wIn) wIn.value = s;
                if (hIn) hIn.value = s;
            };
        });

        // Square utility
        bind('square-btn', () => {
            if (wIn && hIn) {
                const max = Math.max(parseInt(wIn.value) || 0, parseInt(hIn.value) || 0);
                wIn.value = max;
                hIn.value = max;
            }
        });

        bind('resize-btn', () => {
            const MAX = 320, MIN = 1;
            let nw = Math.min(MAX, Math.max(MIN, parseInt(wIn.value) || MIN));
            let nh = Math.min(MAX, Math.max(MIN, parseInt(hIn.value) || MIN));

            // Reflect clamped values back to the inputs so user sees what was applied
            wIn.value = nw;
            hIn.value = nh;

            const temp = document.createElement('canvas');
            temp.width = this.state.width;
            temp.height = this.state.height;
            temp.getContext('2d').drawImage(this.files.workCanvas, 0, 0);

            this.state.update({ width: nw, height: nh });
            this.files.workCanvas.width = nw;
            this.files.workCanvas.height = nh;
            this.files.workCtx.drawImage(temp, 0, 0);

            this.viewport.autoFit();
            this.state.saveHistory(this.files.workCanvas.toDataURL());
        });

        // Info Modal Logic
        const modal = document.getElementById('info-modal');
        const openModal = () => { if (modal) { modal.classList.add('active'); if (window.lucide) window.lucide.createIcons(); } };
        const closeModal = () => { if (modal) modal.classList.remove('active'); };

        bind('info-btn', openModal);
        bind('close-modal', closeModal);
        if (modal) modal.onclick = (e) => { if (e.target === modal) closeModal(); };

        // Reset Canvas Confirmation Modal
        const confirmModal = document.getElementById('confirm-modal');
        const openConfirm = () => { if (confirmModal) { confirmModal.classList.add('active'); if (window.lucide) window.lucide.createIcons(); } };
        const closeConfirm = () => { if (confirmModal) confirmModal.classList.remove('active'); };

        bind('reset-canvas-btn', openConfirm);
        bind('confirm-reset-cancel', closeConfirm);
        if (confirmModal) confirmModal.onclick = (e) => { if (e.target === confirmModal) closeConfirm(); };

        bind('confirm-reset-ok', () => {
            this.files.workCtx.clearRect(0, 0, this.files.workCanvas.width, this.files.workCanvas.height);
            this.state.saveHistory(this.files.workCanvas.toDataURL());
            this.state.notify();
            closeConfirm();
        });

        window.onkeydown = (e) => {
            const key = e.key.toLowerCase();
            if (key === 'p') this.state.update({ currentTool: 'pencil' });
            if (key === 'e') this.state.update({ currentTool: 'eraser' });
            if (key === 'b') this.state.update({ currentTool: 'fill' });
            if (key === 'i') this.state.update({ currentTool: 'eyedropper' });
            if (key === 'h') this.state.update({ currentTool: 'hand' });
            if (key === 'c') this.viewport.centerOnly();
            if (e.ctrlKey && key === 'z') { e.preventDefault(); document.getElementById('undo-btn').click(); }
            if (e.ctrlKey && key === 'y') { e.preventDefault(); document.getElementById('redo-btn').click(); }
        };
    }

    loadStateToWorkCanvas(dataURL) {
        const img = new Image();
        img.onload = () => {
            // Ensure the canvas matches the history state dimensions
            this.state.update({ width: img.width, height: img.height });
            this.files.workCanvas.width = img.width;
            this.files.workCanvas.height = img.height;
            this.files.workCtx.drawImage(img, 0, 0);
            this.state.notify();
        };
        img.src = dataURL;
    }

    rgbToHex(rgb) {
        if (!rgb) return '';
        const match = rgb.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);
        if (!match) return rgb;
        return "#" + ((1 << 24) + (parseInt(match[1]) << 16) + (parseInt(match[2]) << 8) + parseInt(match[3])).toString(16).slice(1).toLowerCase();
    }
}

// --- 8. App Orchestrator ---
class App {
    constructor() {
        try {
            const elements = {
                canvas: document.getElementById('drawing-canvas'),
                container: document.getElementById('canvas-container'),
                viewport: document.getElementById('viewport')
            };
            this.workCanvas = document.createElement('canvas');
            this.workCtx = this.workCanvas.getContext('2d', { alpha: true });

            this.viewport = new ViewportManager(state, elements);
            this.tools = new ToolManager(state, this.viewport, this.workCtx);
            this.theme = new ThemeSystem(state);
            this.files = new FileManager(state, this.viewport, this.workCanvas, this.workCtx);
            this.ui = new UIController(state, this.viewport, this.tools, this.files);

            this.initPalette();
            this.initDrawingEvents(elements.canvas);

            this.workCanvas.width = state.width;
            this.workCanvas.height = state.height;
            this.workCtx.clearRect(0, 0, state.width, state.height);

            state.subscribe(() => {
                this.viewport.render(this.workCanvas);
            });

            this.viewport.autoFit();
            state.saveHistory(this.workCanvas.toDataURL());
            console.log('Pixel-no-Kiseki: Boot Complete.');
        } catch (err) {
            console.error('Boot Error:', err);
        }
    }

    initPalette() {
        const palette = document.getElementById('palette');
        if (!palette) return;
        const colors = ['#000000', '#ffffff', '#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff', '#ffa500', '#800080', '#38bdf8', '#fbbf24', '#f87171', '#4ade80', '#a78bfa'];
        colors.forEach(color => {
            const swatch = document.createElement('div');
            swatch.className = 'swatch';
            swatch.dataset.color = color;
            // Inner layer for actual color display (on top of checkerboard ::before)
            const colorLayer = document.createElement('div');
            colorLayer.style.cssText = `position:absolute;inset:0;background:${color};`;
            swatch.appendChild(colorLayer);
            swatch.onclick = () => {
                // preserve current alpha when switching palette color
                const { alpha } = this.ui.parseColor(state.currentColor);
                state.update({ currentColor: this.ui.buildColor(color, alpha) });
            };
            palette.appendChild(swatch);
        });
        state.notify();
    }

    initDrawingEvents(canvas) {
        if (!canvas) return;
        canvas.onmousedown = (e) => {
            if (e.button === 1 || (e.button === 0 && (e.altKey || state.isPanning || state.currentTool === 'hand'))) {
                state.update({ isPanning: true }); return;
            }
            if (e.button === 0) {
                const { x, y } = this.viewport.coords.screenToPixel(e, canvas.getBoundingClientRect());
                if (this.tools.execute('start', x, y) === 'SHOULD_SAVE_HISTORY') state.saveHistory(this.workCanvas.toDataURL());
                state.notify();
            }
        };

        // Brush size slider
        const brushSlider = document.getElementById('brush-size-slider');
        const brushLabel = document.getElementById('brush-size-label');
        const brushPreview = document.getElementById('brush-preview-row');
        const updateBrushUI = (size) => {
            if (brushLabel) brushLabel.textContent = `${size}px`;
            state.update({ brushSize: size });
            // Draw mini grid preview
            if (brushPreview) {
                const cellSize = 6;
                brushPreview.innerHTML = '';
                const grid = document.createElement('div');
                grid.style.cssText = `display:grid;grid-template-columns:repeat(${size},${cellSize}px);gap:1px;`;
                for (let i = 0; i < size * size; i++) {
                    const cell = document.createElement('div');
                    cell.style.cssText = `width:${cellSize}px;height:${cellSize}px;background:var(--accent);border-radius:1px;`;
                    grid.appendChild(cell);
                }
                brushPreview.appendChild(grid);
            }
        };
        if (brushSlider) {
            brushSlider.oninput = () => updateBrushUI(parseInt(brushSlider.value));
            updateBrushUI(1);
        }

        const brushCursor = document.getElementById('brush-cursor');
        const viewport = document.getElementById('viewport');

        const showCursor = (e) => {
            if (!brushCursor || state.currentTool === 'hand' || state.currentTool === 'eyedropper') {
                if (brushCursor) brushCursor.style.display = 'none';
                return;
            }
            const b = state.brushSize || 1;
            const zoom = Math.max(1, Math.floor(state.zoom));
            const rect = canvas.getBoundingClientRect();
            // Hide if mouse is outside the canvas bounds
            if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) {
                brushCursor.style.display = 'none';
                return;
            }
            const { x, y } = this.viewport.coords.screenToPixel(e, rect);
            const half = Math.floor(b / 2);
            const screenX = rect.left + (x - half) * zoom;
            const screenY = rect.top + (y - half) * zoom;
            brushCursor.style.display = 'block';
            brushCursor.style.position = 'fixed';
            brushCursor.style.width = `${b * zoom}px`;
            brushCursor.style.height = `${b * zoom}px`;
            brushCursor.style.left = `${screenX}px`;
            brushCursor.style.top = `${screenY}px`;
        };

        canvas.addEventListener('mouseenter', () => { if (brushCursor) brushCursor.style.display = 'block'; });
        canvas.addEventListener('mouseleave', () => { if (brushCursor) brushCursor.style.display = 'none'; });

        window.onmousemove = (e) => {
            if (state.isPanning) {
                state.update({ panX: state.panX + e.movementX, panY: state.panY + e.movementY });
                if (brushCursor) brushCursor.style.display = 'none';
                return;
            }
            const { x, y } = this.viewport.coords.screenToPixel(e, canvas.getBoundingClientRect());
            const coordDisp = document.getElementById('coord-display');
            if (coordDisp) coordDisp.innerText = `${x} : ${y}`;
            showCursor(e);
            if (state.isDrawing) {
                if (this.tools.execute('move', x, y) === 'SHOULD_SAVE_HISTORY') state.saveHistory(this.workCanvas.toDataURL());
                state.notify();
            }
        };

        window.onmouseup = () => {
            if (this.tools.execute('end') === 'SHOULD_SAVE_HISTORY') state.saveHistory(this.workCanvas.toDataURL());
            state.update({ isPanning: false });
            state.notify();
        };

        this.viewport.viewport.onwheel = (e) => {
            e.preventDefault();
            const delta = e.deltaY < 0 ? 1.1 : 0.9;
            const oldZoom = state.zoom;
            let newZoom = Math.max(1, Math.min(100, state.zoom * delta));
            const rect = canvas.getBoundingClientRect();
            const mouseX = e.clientX - rect.left, mouseY = e.clientY - rect.top;
            const ratio = newZoom / oldZoom;
            state.update({
                zoom: newZoom,
                panX: state.panX - (mouseX * ratio - mouseX),
                panY: state.panY - (mouseY * ratio - mouseY)
            });
        };
    }
}

window.onload = () => { window.app = new App(); };
