pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

class PDFOptimizedViewer {
    constructor() {
        this.pdfDoc = null;
        this.loadedPages = [];
        this.currentPreviewIndex = 0;
        this.thumbnailSize = 160;
        this.resolutionScale = 2.5;
        this.numPages = 0;
        this.selectedIndex = null;
        this._thumbnailCache = [];
        this._previewCache = [];
        this._observer = null;
        this._renderQueue = [];
        this._rendering = false;

        this.init();
    }

    init() {
        this.setupEventListeners();
        this.setupThumbnailControl();
        this.setupResolutionControl();
        this.setupPreviewModal();
        this.setupIntersectionObserver();
        this.setupZipModal();
    }

    setupIntersectionObserver() {
        this._observer = new IntersectionObserver((entries) => {
            for (const entry of entries) {
                if (entry.isIntersecting) {
                    const index = parseInt(entry.target.dataset.index);
                    if (!this._thumbnailCache[index]) {
                        this._thumbnailCache[index] = true; // marca como encolado
                        this._renderQueue.push(index);
                        this._processQueue();
                    }
                    this._observer.unobserve(entry.target);
                }
            }
        }, { rootMargin: '100px' });
    }

    setupResolutionControl() {
        const select = document.getElementById('resolutionMode');
        const info = document.getElementById('resolutionInfo');
        const menuInfo = document.getElementById('currentResMenu');

        select.addEventListener('change', (e) => {
            this.resolutionScale = parseFloat(e.target.value);
            const option = e.target.options[e.target.selectedIndex];
            info.textContent = option.textContent;
            menuInfo.textContent = option.textContent;
            if (this.previewModal && this.previewModal.classList.contains('active')) {
                document.getElementById('previewHeader').textContent =
                    `Página ${this.currentPreviewIndex + 1} (${this.resolutionScale}x)`;
            }
            this.showNotification(`🎛️ Resolución cambiada a: ${option.textContent}`);
        });

        const initialOption = select.options[select.selectedIndex];
        info.textContent = initialOption.textContent;
        menuInfo.textContent = initialOption.textContent;
    }

    setupEventListeners() {
        const uploadZone = document.getElementById('uploadZone');
        const fileInput = document.getElementById('fileInput');

        uploadZone.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', (e) => {
            if (e.target.files[0]) this.loadPDF(e.target.files[0]);
        });

        uploadZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadZone.classList.add('dragover');
        });
        uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('dragover'));
        uploadZone.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadZone.classList.remove('dragover');
            const files = e.dataTransfer.files;
            if (files.length > 0 && files[0].type === 'application/pdf') {
                this.loadPDF(files[0]);
            }
        });

        document.addEventListener('click', () => {
            document.getElementById('contextMenu').style.display = 'none';
        });

        document.getElementById('previewDownload').addEventListener('click', async () => {
            await this.downloadImage();
        });
    }

    setupPreviewModal() {
        this.previewModal = document.getElementById('previewModal');
        const closeBtn = document.getElementById('closePreview');
        const prevBtn = document.getElementById('prevBtn');
        const nextBtn = document.getElementById('nextBtn');

        closeBtn.addEventListener('click', () => this.closePreview());
        prevBtn.addEventListener('click', () => this.prevPage());
        nextBtn.addEventListener('click', () => this.nextPage());

        document.addEventListener('keydown', (e) => {
            if (this.previewModal.classList.contains('active')) {
                if (e.key === 'Escape') this.closePreview();
                if (e.key === 'ArrowLeft') this.prevPage();
                if (e.key === 'ArrowRight') this.nextPage();
            }
        });

        document.getElementById('previewImage').addEventListener('contextmenu', (e) => {
            e.preventDefault();
            this.selectedIndex = this.currentPreviewIndex;
            this.showContextMenu(e);
        });
    }

    setupThumbnailControl() {
        const slider = document.getElementById('thumbnailSize');
        const sizeValue = document.getElementById('sizeValue');

        slider.addEventListener('input', (e) => {
            this.thumbnailSize = parseInt(e.target.value);
            sizeValue.textContent = `${this.thumbnailSize}px`;
            this.updateThumbnailSizes();
        });
    }

    parsePageSelection(inputStr, maxPages) {
        const pages = new Set();
        const parts = inputStr.split(',');
        for (let part of parts) {
            part = part.trim();
            if (!part) continue;
            if (part.includes('-')) {
                const range = part.split('-');
                if (range.length === 2) {
                    const start = parseInt(range[0].trim(), 10);
                    const end = parseInt(range[1].trim(), 10);
                    if (!isNaN(start) && !isNaN(end) && start <= end) {
                        for (let i = start; i <= end; i++) {
                            if (i >= 1 && i <= maxPages) {
                                pages.add(i - 1); // 0-based
                            }
                        }
                    }
                }
            } else {
                const num = parseInt(part, 10);
                if (!isNaN(num) && num >= 1 && num <= maxPages) {
                    pages.add(num - 1); // 0-based
                }
            }
        }
        return Array.from(pages).sort((a, b) => a - b);
    }

    promptPageSelection() {
        return new Promise((resolve) => {
            const rangeModal = document.getElementById('rangeModal');
            const pageRangeInput = document.getElementById('pageRangeInput');
            const rangeMaxPages = document.getElementById('rangeMaxPages');
            const btnLoadRange = document.getElementById('btnLoadRange');
            const btnLoadAll = document.getElementById('btnLoadAll');

            rangeMaxPages.textContent = this.numPages;
            pageRangeInput.value = '';
            rangeModal.classList.add('active');
            pageRangeInput.focus();

            const cleanup = () => {
                rangeModal.classList.remove('active');
                btnLoadRange.removeEventListener('click', handleRangeSubmit);
                btnLoadAll.removeEventListener('click', handleAllSubmit);
                pageRangeInput.removeEventListener('keypress', handleKeyPress);
            };

            const handleRangeSubmit = () => {
                const val = pageRangeInput.value.trim();
                cleanup();
                if (val === '') {
                    resolve(Array.from({ length: this.numPages }, (_, i) => i));
                } else {
                    const selected = this.parsePageSelection(val, this.numPages);
                    if (selected.length === 0) {
                        resolve(Array.from({ length: this.numPages }, (_, i) => i));
                    } else {
                        resolve(selected);
                    }
                }
            };

            const handleAllSubmit = () => {
                cleanup();
                resolve(Array.from({ length: this.numPages }, (_, i) => i));
            };

            const handleKeyPress = (e) => {
                if (e.key === 'Enter') {
                    handleRangeSubmit();
                }
            };

            btnLoadRange.addEventListener('click', handleRangeSubmit);
            btnLoadAll.addEventListener('click', handleAllSubmit);
            pageRangeInput.addEventListener('keypress', handleKeyPress);
        });
    }

    async loadPDF(file) {
        const loading = document.getElementById('loading');
        const pagesContainer = document.getElementById('pagesContainer');
        const statusMessage = document.getElementById('statusMessage');

        try {
            loading.style.display = 'block';
            pagesContainer.innerHTML = '';
            this.loadedPages = [];
            this._thumbnailCache = [];
            this._previewCache = [];
            this.selectedIndex = null;
            statusMessage.style.display = 'none';

            const arrayBuffer = await file.arrayBuffer();
            this.pdfDoc = await pdfjsLib.getDocument(arrayBuffer).promise;
            this.numPages = this.pdfDoc.numPages;

            document.getElementById('pageInfo').textContent = `PDF cargado: ${file.name}`;
            
            // Ocultar loading temporalmente durante la pregunta
            loading.style.display = 'none';
            this.loadedPages = await this.promptPageSelection();
            loading.style.display = 'block';

            document.getElementById('totalPages').textContent = `${this.loadedPages.length} de ${this.numPages} páginas`;

            for (const i of this.loadedPages) {
                this.createPlaceholder(i);
            }

            this.updateThumbnailSizes();
            loading.style.display = 'none';
            statusMessage.style.display = 'block';
            statusMessage.innerHTML = `✅ ${this.loadedPages.length} páginas cargadas. Sin renderizado — haz clic para previsualizar.`;
            statusMessage.style.background = '#d4edda';
            statusMessage.style.color = '#155724';

            // Habilitar botón de ZIP
            document.getElementById('btnDownloadZip').disabled = false;

        } catch (error) {
            console.error('Error:', error);
            loading.style.display = 'none';
            statusMessage.style.display = 'block';
            statusMessage.innerHTML = `❌ Error: ${error.message}`;
            statusMessage.style.background = '#f8d7da';
            statusMessage.style.color = '#721c24';
        }
    }

    createPlaceholder(index) {
        const pageNum = index + 1;
        const pagesContainer = document.getElementById('pagesContainer');

        const pageContainer = document.createElement('div');
        pageContainer.className = 'page-container';
        pageContainer.dataset.pageNum = pageNum;
        pageContainer.dataset.index = index;

        const thumbnailWrapper = document.createElement('div');
        thumbnailWrapper.className = 'thumbnail-wrapper';

        const placeholder = document.createElement('div');
        placeholder.className = 'page-placeholder';
        placeholder.textContent = pageNum;

        const pageNumber = document.createElement('div');
        pageNumber.className = 'page-number';
        pageNumber.textContent = `P${pageNum}`;

        thumbnailWrapper.appendChild(placeholder);
        pageContainer.appendChild(thumbnailWrapper);
        pageContainer.appendChild(pageNumber);
        pagesContainer.appendChild(pageContainer);

        pageContainer.addEventListener('click', () => this.openPreview(index));
        pageContainer.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            this.selectedIndex = index;
            this.showContextMenu(e);
        });

        this._observer.observe(pageContainer);
        this._thumbnailCache[index] = null;
        this._previewCache[index] = null;
    }

    _processQueue() {
        if (this._rendering || this._renderQueue.length === 0) return;
        this._rendering = true;
        const index = this._renderQueue.shift();
        this._renderSingleThumbnail(index).finally(() => {
            this._rendering = false;
            this._processQueue();
        });
    }

    async _renderSingleThumbnail(index) {
        if (this._thumbnailCache[index] && this._thumbnailCache[index] !== true) return;
        try {
            const page = await this.pdfDoc.getPage(index + 1);
            const scale = 0.15;
            const viewport = page.getViewport({ scale });
            const canvas = document.createElement('canvas');
            canvas.width = viewport.width;
            canvas.height = viewport.height;

            await page.render({
                canvasContext: canvas.getContext('2d'),
                viewport
            }).promise;

            const dataUrl = canvas.toDataURL('image/jpeg', 0.4);
            this._thumbnailCache[index] = dataUrl;

            const container = document.querySelector(`.page-container[data-index="${index}"]`);
            if (container) {
                const wrapper = container.querySelector('.thumbnail-wrapper');
                const old = wrapper.querySelector('.page-placeholder');
                if (old) old.remove();
                const img = document.createElement('img');
                img.className = 'page-canvas';
                img.src = dataUrl;
                wrapper.appendChild(img);
            }
        } catch (e) {
            delete this._thumbnailCache[index];
        }
    }

    async renderThumbnailLazy(index) {
        if (this._thumbnailCache[index] && this._thumbnailCache[index] !== true) return;
        const idx = this._renderQueue.indexOf(index);
        if (idx !== -1) this._renderQueue.splice(idx, 1);
        await this._renderSingleThumbnail(index);
    }

    async renderPreview(index) {
        if (this._previewCache[index]) return this._previewCache[index];

        const page = await this.pdfDoc.getPage(index + 1);
        const scale = 1.5;
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;

        await page.render({
            canvasContext: canvas.getContext('2d'),
            viewport
        }).promise;

        const dataUrl = canvas.toDataURL('image/png');
        this._previewCache[index] = dataUrl;
        return dataUrl;
    }

    async renderHighRes(index) {
        const scale = this.resolutionScale;
        const page = await this.pdfDoc.getPage(index + 1);
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        canvas.dataset.pageNum = index + 1;

        await page.render({
            canvasContext: canvas.getContext('2d'),
            viewport
        }).promise;

        return canvas;
    }

    async openPreview(index) {
        if (index < 0 || index >= this.numPages) return;
        this.currentPreviewIndex = index;
        this.selectedIndex = index;

        this.renderThumbnailLazy(index);

        const previewImg = document.getElementById('previewImage');
        previewImg.src = '';
        document.getElementById('previewHeader').textContent = `Cargando página ${index + 1}...`;
        this.previewModal.classList.add('active');
        document.body.style.overflow = 'hidden';

        const data = await this.renderPreview(index);
        previewImg.src = data;
        document.getElementById('previewHeader').textContent =
            `Página ${index + 1} (${this.resolutionScale}x)`;
    }

    closePreview() {
        this.previewModal.classList.remove('active');
        document.body.style.overflow = 'auto';
    }

    async prevPage() {
        const pos = this.loadedPages.indexOf(this.currentPreviewIndex);
        if (pos > 0) {
            await this.openPreview(this.loadedPages[pos - 1]);
        }
    }

    async nextPage() {
        const pos = this.loadedPages.indexOf(this.currentPreviewIndex);
        if (pos !== -1 && pos < this.loadedPages.length - 1) {
            await this.openPreview(this.loadedPages[pos + 1]);
        }
    }

    updateThumbnailSizes() {
        const containers = document.querySelectorAll('.page-container');
        const grid = document.getElementById('pagesContainer');
        const newMinMax = Math.max(120, this.thumbnailSize - 20);
        grid.style.gridTemplateColumns = `repeat(auto-fill, minmax(${newMinMax}px, 1fr))`;

        containers.forEach(container => {
            container.style.width = `${this.thumbnailSize}px`;
            container.style.height = `${this.thumbnailSize}px`;
        });
    }

    showContextMenu(e) {
        const contextMenu = document.getElementById('contextMenu');
        contextMenu.style.display = 'block';
        contextMenu.style.left = `${e.clientX}px`;
        contextMenu.style.top = `${e.clientY}px`;

        const select = document.getElementById('resolutionMode');
        const option = select.options[select.selectedIndex];
        document.getElementById('currentResMenu').textContent = option.textContent;

        const menuHeight = contextMenu.offsetHeight;
        const menuWidth = contextMenu.offsetWidth;

        if (e.clientY + menuHeight > window.innerHeight) {
            contextMenu.style.top = `${e.clientY - menuHeight}px`;
        }
        if (e.clientX + menuWidth > window.innerWidth) {
            contextMenu.style.left = `${e.clientX - menuWidth}px`;
        }
    }

    async copySingleImage() {
        if (this.selectedIndex === null) return;
        const canvas = await this.renderHighRes(this.selectedIndex);
        const blob = await this.canvasToBlob(canvas);
        await this.copyBlobsToClipboard([blob]);
        this.showNotification(`✅ Copia ${this.resolutionScale}x: Página ${this.selectedIndex + 1}`);
    }

    async copyAllPages() {
        if (!this.loadedPages.length) return;
        this.showNotification(`⏳ Renderizando ${this.loadedPages.length} páginas una por una...`);
        const blobs = [];
        for (const i of this.loadedPages) {
            const canvas = await this.renderHighRes(i);
            const blob = await this.canvasToBlob(canvas);
            blobs.push(blob);
        }
        await this.copyBlobsToClipboard(blobs);
        this.showNotification(`✅ ${this.loadedPages.length} páginas copiadas (${this.resolutionScale}x)`);
    }

    canvasToBlob(canvas, type = 'image/png', quality = 1.0) {
        return new Promise((resolve) => {
            canvas.toBlob((blob) => resolve(blob), type, quality);
        });
    }

    async copyBlobsToClipboard(blobs) {
        try {
            if (navigator.clipboard && window.isSecureContext) {
                const items = blobs.map(blob => new ClipboardItem({ 'image/png': blob }));
                await navigator.clipboard.write(items);
            } else {
                const lastItem = new ClipboardItem({ 'image/png': blobs[blobs.length - 1] });
                await navigator.clipboard.write([lastItem]);
            }
        } catch (error) {
            console.error('Error copying:', error);
            this.showNotification('📥 No se pudo copiar, intenta descargar');
        }
    }

    async downloadImage() {
        if (this.selectedIndex === null) return;
        const canvas = await this.renderHighRes(this.selectedIndex);
        const link = document.createElement('a');
        link.download = `pagina-${this.selectedIndex + 1}_${this.resolutionScale}x.png`;
        link.href = canvas.toDataURL('image/png', 1.0);
        link.click();
        this.showNotification(`✅ Descargada página ${this.selectedIndex + 1} (${this.resolutionScale}x)`);
    }

    showNotification(message) {
        const existing = document.querySelector('.notification');
        if (existing) existing.remove();

        const notification = document.createElement('div');
        notification.className = 'notification';
        notification.innerHTML = `<strong>${message}</strong>`;
        document.body.appendChild(notification);

        setTimeout(() => {
            notification.style.animation = 'slideOut 0.3s ease';
            setTimeout(() => notification.remove(), 300);
        }, 4000);
    }

    setupZipModal() {
        const zipModal = document.getElementById('zipModal');
        const btnCancel = document.getElementById('btnCancelZip');
        const btnStart = document.getElementById('btnStartZipDownload');

        btnCancel.addEventListener('click', () => {
            zipModal.classList.remove('active');
        });

        btnStart.addEventListener('click', async () => {
            const format = document.querySelector('input[name="zipFormat"]:checked').value;
            zipModal.classList.remove('active');
            await this.generateZip(format);
        });
    }

    formatBytes(bytes) {
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }

    async estimateZipSizes() {
        // Rinde la primera página del rango para estimar el tamaño total
        const sampleIndex = this.loadedPages[0];
        const canvas = await this.renderHighRes(sampleIndex);
        const count = this.loadedPages.length;

        const pngBlob = await this.canvasToBlob(canvas, 'image/png', 1.0);
        const jpgBlob = await this.canvasToBlob(canvas, 'image/jpeg', 0.9);

        return {
            png: pngBlob.size * count,
            jpg: jpgBlob.size * count
        };
    }

    async openZipModal() {
        if (!this.loadedPages.length) return;

        const zipModal = document.getElementById('zipModal');
        const zipEstimating = document.getElementById('zipEstimating');
        const zipOptions = document.getElementById('zipOptions');
        const pngSizeText = document.getElementById('pngSizeText');
        const jpgSizeText = document.getElementById('jpgSizeText');
        const btnStart = document.getElementById('btnStartZipDownload');
        const zipPagesCount = document.getElementById('zipPagesCount');

        // Reset state
        zipEstimating.style.display = 'flex';
        zipOptions.style.display = 'none';
        btnStart.disabled = true;
        zipPagesCount.textContent = this.loadedPages.length;
        zipModal.classList.add('active');

        try {
            const sizes = await this.estimateZipSizes();
            pngSizeText.textContent = `≈ ${this.formatBytes(sizes.png)}`;
            jpgSizeText.textContent = `≈ ${this.formatBytes(sizes.jpg)}`;
            zipEstimating.style.display = 'none';
            zipOptions.style.display = 'block';
            btnStart.disabled = false;
        } catch (e) {
            pngSizeText.textContent = 'No disponible';
            jpgSizeText.textContent = 'No disponible';
            zipEstimating.style.display = 'none';
            zipOptions.style.display = 'block';
            btnStart.disabled = false;
        }
    }

    async generateZip(format) {
        const mimeType = format === 'jpeg' ? 'image/jpeg' : 'image/png';
        const quality = format === 'jpeg' ? 0.9 : 1.0;
        const ext = format === 'jpeg' ? 'jpg' : 'png';
        const total = this.loadedPages.length;

        this.showNotification(`⏳ Generando ZIP con ${total} páginas...`);

        const zip = new JSZip();

        for (let i = 0; i < this.loadedPages.length; i++) {
            const pageIndex = this.loadedPages[i];
            const pageNum = pageIndex + 1;
            const canvas = await this.renderHighRes(pageIndex);
            const blob = await this.canvasToBlob(canvas, mimeType, quality);
            zip.file(`pagina-${pageNum}.${ext}`, blob);

            // Actualizar notificación con progreso
            if ((i + 1) % 3 === 0 || i === this.loadedPages.length - 1) {
                this.showNotification(`📦 Procesando página ${i + 1} de ${total}...`);
            }
        }

        this.showNotification('🔒 Comprimiendo archivo ZIP...');
        const content = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(content);
        link.download = `paginas-pdf.zip`;
        link.click();
        URL.revokeObjectURL(link.href);
        this.showNotification(`✅ ZIP descargado con ${total} páginas (${ext.toUpperCase()})`);
    }
}

const viewer = new PDFOptimizedViewer();

document.getElementById('copyImage').addEventListener('click', async () => {
    await viewer.copySingleImage();
    document.getElementById('contextMenu').style.display = 'none';
});

document.getElementById('copyImageSmart').addEventListener('click', async () => {
    await viewer.copySingleImage();
    document.getElementById('contextMenu').style.display = 'none';
});

document.getElementById('downloadImage').addEventListener('click', async () => {
    await viewer.downloadImage();
    document.getElementById('contextMenu').style.display = 'none';
});

document.getElementById('copyAll').addEventListener('click', async () => {
    await viewer.copyAllPages();
    document.getElementById('contextMenu').style.display = 'none';
});

document.getElementById('btnDownloadZip').addEventListener('click', async () => {
    await viewer.openZipModal();
});
