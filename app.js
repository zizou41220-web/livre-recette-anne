/**
 * Livre de recettes d'Anne
 * Application PWA Cross-Platform (Smartphone & PC)
 * Scanner Multi-Pages & Traitement d'image pour recettes manuscrites + OCR Tesseract
 * Synchronisation Cloud Supabase
 */

const SUPABASE_URL = 'https://iwtuwtvgrocmxfkmidlk.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml3dHV3dHZncm9jbXhma21pZGxrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgzNTM5NzUsImV4cCI6MjA5MzkyOTk3NX0.ISCfQxrD4dAnygL-teYon-KoJWrzDuTEHFZpe9tslmY';

let supabaseClient = null;
if (window.supabase) {
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
} else {
    console.warn("Supabase n'a pas pu être chargé. Mode déconnecté.");
}

// Enregistrement PWA Service Worker
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js')
            .then(reg => console.log('Service Worker PWA actif:', reg.scope))
            .catch(err => console.log('Échec enregistrement Service Worker:', err));
    });
}

// Variables globales de l'application
let deferredInstallPrompt = null;
let currentRecipes = [];
let editingRecipeId = null;
let currentRecipeImages = []; // Images existantes en édition (tableau d'URLs)
let pendingImageBlobs = [];   // Blobs des pages prêtes à être envoyées à Supabase
let scanFilterOnly = false;

// Variables pour le Studio Scanner Multi-Pages
let scannedPages = []; // [{ originalImage, filter, rotation, contrast, canvasBlob, previewUrl }]
let activePageIndex = 0;

// Variables pour le visualiseur recette
let viewRecipeActiveImages = [];
let currentViewPageIndex = 0;
let currentZoom = 1;

document.addEventListener('DOMContentLoaded', () => {
    initApp();
});

function initApp() {
    setupPwaInstallation();
    setupNavigationAndModals();
    setupScannerStudio();
    setupRecipeForm();
    setupSearchAndFilters();
    setupDeviceSyncModal();
    setupPasteSupport();

    loadRecipes();
}

/**
 * Utilitaire pour extraire la liste des images d'une recette
 * Supporte rétroactivement une URL unique string OU un tableau JSON d'URLs
 */
function getRecipeImages(recipe) {
    if (!recipe || !recipe.image_url) return [];
    if (typeof recipe.image_url === 'string') {
        const trimmed = recipe.image_url.trim();
        if (trimmed.startsWith('[')) {
            try {
                const parsed = JSON.parse(trimmed);
                if (Array.isArray(parsed)) return parsed.filter(Boolean);
            } catch (e) {
                return [trimmed];
            }
        }
        return [trimmed];
    }
    if (Array.isArray(recipe.image_url)) return recipe.image_url.filter(Boolean);
    return [];
}

/* ============================================================ */
/* 1. GESTION DE L'INSTALLATION PWA ET SYNCHRONISATION          */
/* ============================================================ */
function setupPwaInstallation() {
    const installBtn = document.getElementById('installPwaBtn');

    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredInstallPrompt = e;
        if (installBtn) {
            installBtn.classList.remove('hidden');
        }
    });

    if (installBtn) {
        installBtn.addEventListener('click', async () => {
            if (deferredInstallPrompt) {
                deferredInstallPrompt.prompt();
                const { outcome } = await deferredInstallPrompt.userChoice;
                if (outcome === 'accepted') {
                    showToast("Application installée avec succès !", "success");
                    installBtn.classList.add('hidden');
                }
                deferredInstallPrompt = null;
            }
        });
    }

    window.addEventListener('appinstalled', () => {
        if (installBtn) installBtn.classList.add('hidden');
        showToast("L'application est maintenant installée sur cet appareil !", "success");
    });
}

function setupDeviceSyncModal() {
    const deviceBtn = document.getElementById('deviceSyncBtn');
    const mobDeviceBtn = document.getElementById('mobDeviceBtn');
    const deviceModal = document.getElementById('deviceModal');
    const closeBtn = document.querySelector('.device-close-btn');
    const qrImg = document.getElementById('qrCodeImg');
    const customUrlInput = document.getElementById('customPhoneUrlInput');
    const copyUrlBtn = document.getElementById('copyUrlBtn');
    const useWifiIpBtn = document.getElementById('useWifiIpBtn');
    const useOnlineUrlBtn = document.getElementById('useOnlineUrlBtn');

    const LOCAL_WIFI_URL = 'http://192.168.1.15:8080/';
    const GITHUB_PAGES_URL = 'https://zizou41220-web.github.io/livre-recette-anne/';

    const updateQr = (url) => {
        if (!url) return;
        if (customUrlInput) customUrlInput.value = url;
        if (qrImg) qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(url)}`;
        localStorage.setItem('anne_phone_url', url);
    };

    const openDeviceModal = () => {
        const savedUrl = localStorage.getItem('anne_phone_url');
        const defaultUrl = savedUrl || LOCAL_WIFI_URL;
        updateQr(defaultUrl);

        if (useWifiIpBtn && useOnlineUrlBtn) {
            useWifiIpBtn.classList.toggle('active', defaultUrl.includes('192.168'));
            useOnlineUrlBtn.classList.toggle('active', !defaultUrl.includes('192.168'));
        }

        deviceModal.classList.remove('hidden');
    };

    if (deviceBtn) deviceBtn.addEventListener('click', openDeviceModal);
    if (mobDeviceBtn) mobDeviceBtn.addEventListener('click', openDeviceModal);

    if (useWifiIpBtn) {
        useWifiIpBtn.addEventListener('click', () => {
            useWifiIpBtn.classList.add('active');
            useOnlineUrlBtn.classList.remove('active');
            updateQr(LOCAL_WIFI_URL);
        });
    }

    if (useOnlineUrlBtn) {
        useOnlineUrlBtn.addEventListener('click', () => {
            useOnlineUrlBtn.classList.add('active');
            useWifiIpBtn.classList.remove('active');
            updateQr(GITHUB_PAGES_URL);
        });
    }

    if (customUrlInput) {
        customUrlInput.addEventListener('input', (e) => {
            const val = e.target.value.trim();
            if (val) updateQr(val);
        });
    }

    if (closeBtn) {
        closeBtn.addEventListener('click', () => deviceModal.classList.add('hidden'));
    }

    if (copyUrlBtn) {
        copyUrlBtn.addEventListener('click', () => {
            const urlToCopy = customUrlInput ? customUrlInput.value : window.location.href;
            navigator.clipboard.writeText(urlToCopy).then(() => {
                showToast("Lien copié dans le presse-papier !", "success");
            }).catch(() => {
                showToast("Impossible de copier automatiquement le lien.", "error");
            });
        });
    }
}

/* ============================================================ */
/* 2. NAVIGATION ET GESTION DES MODALES                         */
/* ============================================================ */
function setupNavigationAndModals() {
    const addBtn = document.getElementById('addRecipeBtn');
    const mobAddBtn = document.getElementById('mobAddBtn');
    const openScannerBtn = document.getElementById('openScannerBtn');
    const mobScanBtn = document.getElementById('mobScanBtn');
    const mobHomeBtn = document.getElementById('mobHomeBtn');

    const recipeModal = document.getElementById('recipeModal');
    const viewModal = document.getElementById('viewRecipeModal');
    const scannerModal = document.getElementById('scannerModal');
    const deviceModal = document.getElementById('deviceModal');

    const formCloseBtn = document.querySelector('.form-close-btn');
    const viewCloseBtn = document.querySelector('.view-close-btn');
    const scannerCloseBtn = document.querySelector('.scanner-close-btn');

    // Ouverture formulaire ajout
    const openNewRecipe = () => {
        resetRecipeForm();
        recipeModal.classList.remove('hidden');
    };
    if (addBtn) addBtn.addEventListener('click', openNewRecipe);
    if (mobAddBtn) mobAddBtn.addEventListener('click', openNewRecipe);

    // Ouverture scanner
    const openScanner = () => {
        resetScannerStudio();
        scannerModal.classList.remove('hidden');
    };
    if (openScannerBtn) openScannerBtn.addEventListener('click', openScanner);
    if (mobScanBtn) mobScanBtn.addEventListener('click', openScanner);

    // Raccourci accueil mobile
    if (mobHomeBtn) {
        mobHomeBtn.addEventListener('click', () => {
            window.scrollTo({ top: 0, behavior: 'smooth' });
            document.getElementById('searchInput').value = '';
            document.getElementById('typeFilter').value = 'all';
            scanFilterOnly = false;
            document.getElementById('filterScanOnlyBtn').classList.remove('active');
            renderRecipes();
        });
    }

    // Fermetures
    if (formCloseBtn) formCloseBtn.addEventListener('click', () => recipeModal.classList.add('hidden'));
    if (viewCloseBtn) viewCloseBtn.addEventListener('click', () => viewModal.classList.add('hidden'));
    if (scannerCloseBtn) scannerCloseBtn.addEventListener('click', () => scannerModal.classList.add('hidden'));

    // Fermeture par clic sur l'arrière-plan ou touche Échap
    window.addEventListener('click', (e) => {
        if (e.target === recipeModal) recipeModal.classList.add('hidden');
        if (e.target === viewModal) viewModal.classList.add('hidden');
        if (e.target === scannerModal) scannerModal.classList.add('hidden');
        if (e.target === deviceModal) deviceModal.classList.add('hidden');
    });

    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            recipeModal.classList.add('hidden');
            viewModal.classList.add('hidden');
            scannerModal.classList.add('hidden');
            deviceModal.classList.add('hidden');
        }
    });
}

/* ============================================================ */
/* 3. STUDIO PHOTO & SCANNER MULTI-PAGES                        */
/* ============================================================ */
function setupScannerStudio() {
    const cameraInput = document.getElementById('cameraDirectInput');
    const galleryInput = document.getElementById('galleryFileInput');
    const addAnotherPageInput = document.getElementById('addAnotherPageInput');
    const scanUploadZone = document.getElementById('scanUploadZone');
    const scanEditorArea = document.getElementById('scanEditorArea');
    const retakeBtn = document.getElementById('retakePhotoBtn');
    const filterPills = document.querySelectorAll('.filter-pill');
    const rotateLeftBtn = document.getElementById('rotateLeftBtn');
    const rotateRightBtn = document.getElementById('rotateRightBtn');
    const contrastRange = document.getElementById('contrastRange');
    const contrastVal = document.getElementById('contrastVal');

    const chooseOcrBtn = document.getElementById('chooseOcrBtn');
    const chooseScanDocBtn = document.getElementById('chooseScanDocBtn');

    // Chargement d'une image (première page ou page suivante)
    const handleFileSelect = (file, isAppend = false) => {
        if (!file || !file.type.startsWith('image/')) {
            showToast("Veuillez sélectionner un fichier image valide.", "error");
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                // Redimensionner à une taille de travail optimale (max 1800px)
                const maxDim = 1800;
                let w = img.width;
                let h = img.height;
                if (w > maxDim || h > maxDim) {
                    if (w > h) {
                        h = Math.round((h * maxDim) / w);
                        w = maxDim;
                    } else {
                        w = Math.round((w * maxDim) / h);
                        h = maxDim;
                    }
                }

                const tempCanvas = document.createElement('canvas');
                tempCanvas.width = w;
                tempCanvas.height = h;
                const tempCtx = tempCanvas.getContext('2d');
                tempCtx.drawImage(img, 0, 0, w, h);

                const cleanImg = new Image();
                cleanImg.onload = () => {
                    const newPageObj = {
                        originalImage: cleanImg,
                        filter: 'scan-doc',
                        rotation: 0,
                        contrast: 15
                    };

                    if (!isAppend) {
                        scannedPages = [newPageObj];
                        activePageIndex = 0;
                    } else {
                        scannedPages.push(newPageObj);
                        activePageIndex = scannedPages.length - 1;
                        showToast(`Page ${scannedPages.length} ajoutée à la recette !`, "success");
                    }

                    scanUploadZone.classList.add('hidden');
                    scanEditorArea.classList.remove('hidden');

                    updateScannerPagesBar();
                    loadActivePageControls();
                    renderScannedImage();
                };
                cleanImg.src = tempCanvas.toDataURL('image/jpeg', 0.92);
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    };

    if (cameraInput) {
        cameraInput.addEventListener('change', (e) => {
            if (e.target.files && e.target.files[0]) handleFileSelect(e.target.files[0], false);
        });
    }

    if (galleryInput) {
        galleryInput.addEventListener('change', (e) => {
            if (e.target.files && e.target.files[0]) handleFileSelect(e.target.files[0], false);
        });
    }

    // Ajout d'une page supplémentaire (Page 2, 3...)
    if (addAnotherPageInput) {
        addAnotherPageInput.addEventListener('change', (e) => {
            if (e.target.files && e.target.files[0]) {
                handleFileSelect(e.target.files[0], true);
                addAnotherPageInput.value = '';
            }
        });
    }

    if (retakeBtn) {
        retakeBtn.addEventListener('click', resetScannerStudio);
    }

    // Gestion des filtres
    filterPills.forEach(pill => {
        pill.addEventListener('click', () => {
            filterPills.forEach(p => p.classList.remove('active'));
            pill.classList.add('active');
            if (scannedPages[activePageIndex]) {
                scannedPages[activePageIndex].filter = pill.dataset.filter;
                renderScannedImage();
            }
        });
    });

    // Rotation
    if (rotateLeftBtn) {
        rotateLeftBtn.addEventListener('click', () => {
            if (scannedPages[activePageIndex]) {
                scannedPages[activePageIndex].rotation = (scannedPages[activePageIndex].rotation - 90) % 360;
                renderScannedImage();
            }
        });
    }

    if (rotateRightBtn) {
        rotateRightBtn.addEventListener('click', () => {
            if (scannedPages[activePageIndex]) {
                scannedPages[activePageIndex].rotation = (scannedPages[activePageIndex].rotation + 90) % 360;
                renderScannedImage();
            }
        });
    }

    // Curseur de contraste
    if (contrastRange) {
        contrastRange.addEventListener('input', (e) => {
            const val = parseInt(e.target.value, 10);
            contrastVal.textContent = val;
            if (scannedPages[activePageIndex]) {
                scannedPages[activePageIndex].contrast = val;
                renderScannedImage();
            }
        });
    }

    // Option 1 : Rédiger automatiquement via OCR (multi-pages)
    if (chooseOcrBtn) {
        chooseOcrBtn.addEventListener('click', async () => {
            await runOcrAndFillRecipe();
        });
    }

    // Option 2 : Conserver le Scan Manuscrit (multi-pages)
    if (chooseScanDocBtn) {
        chooseScanDocBtn.addEventListener('click', async () => {
            await keepAsHandwrittenScan();
        });
    }
}

/**
 * Mise à jour de la barre d'onglets des pages dans le scanner
 */
function updateScannerPagesBar() {
    const list = document.getElementById('scannerPagesList');
    const addBtnText = document.getElementById('addPageBtnText');
    if (!list) return;

    list.innerHTML = '';
    scannedPages.forEach((page, idx) => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = `page-chip ${idx === activePageIndex ? 'active' : ''}`;
        chip.innerHTML = `<span>Page ${idx + 1}</span>`;

        if (scannedPages.length > 1) {
            const removeIcon = document.createElement('i');
            removeIcon.className = 'fa-solid fa-xmark remove-page-icon';
            removeIcon.title = `Supprimer la page ${idx + 1}`;
            removeIcon.onclick = (e) => {
                e.stopPropagation();
                removeScannedPage(idx);
            };
            chip.appendChild(removeIcon);
        }

        chip.addEventListener('click', () => {
            activePageIndex = idx;
            updateScannerPagesBar();
            loadActivePageControls();
            renderScannedImage();
        });

        list.appendChild(chip);
    });

    if (addBtnText) {
        addBtnText.textContent = `Ajouter la page ${scannedPages.length + 1}...`;
    }
}

function removeScannedPage(index) {
    if (scannedPages.length <= 1) return;
    scannedPages.splice(index, 1);
    if (activePageIndex >= scannedPages.length) {
        activePageIndex = scannedPages.length - 1;
    }
    updateScannerPagesBar();
    loadActivePageControls();
    renderScannedImage();
    showToast("Page supprimée.", "info");
}

function loadActivePageControls() {
    const page = scannedPages[activePageIndex];
    if (!page) return;

    const filterPills = document.querySelectorAll('.filter-pill');
    filterPills.forEach(p => p.classList.toggle('active', p.dataset.filter === page.filter));

    const contrastRange = document.getElementById('contrastRange');
    const contrastVal = document.getElementById('contrastVal');
    if (contrastRange) contrastRange.value = page.contrast;
    if (contrastVal) contrastVal.textContent = page.contrast;
}

// Support du collage direct (Ctrl+V) depuis le presse-papier
function setupPasteSupport() {
    window.addEventListener('paste', (e) => {
        const items = (e.clipboardData || e.originalEvent.clipboardData).items;
        for (let item of items) {
            if (item.type.indexOf('image') === 0) {
                const blob = item.getAsFile();
                const scannerModal = document.getElementById('scannerModal');
                scannerModal.classList.remove('hidden');

                const reader = new FileReader();
                reader.onload = (event) => {
                    const img = new Image();
                    img.onload = () => {
                        const newPageObj = {
                            originalImage: img,
                            filter: 'scan-doc',
                            rotation: 0,
                            contrast: 15
                        };
                        scannedPages.push(newPageObj);
                        activePageIndex = scannedPages.length - 1;

                        document.getElementById('scanUploadZone').classList.add('hidden');
                        document.getElementById('scanEditorArea').classList.remove('hidden');

                        updateScannerPagesBar();
                        loadActivePageControls();
                        renderScannedImage();
                        showToast(`Page ${scannedPages.length} collée depuis le presse-papier !`, "info");
                    };
                    img.src = event.target.result;
                };
                reader.readAsDataURL(blob);
                break;
            }
        }
    });
}

function resetScannerStudio() {
    scannedPages = [];
    activePageIndex = 0;

    const cameraInput = document.getElementById('cameraDirectInput');
    const galleryInput = document.getElementById('galleryFileInput');
    if (cameraInput) cameraInput.value = '';
    if (galleryInput) galleryInput.value = '';

    document.getElementById('scanUploadZone').classList.remove('hidden');
    document.getElementById('scanEditorArea').classList.add('hidden');
    document.getElementById('ocrProgressContainer').classList.add('hidden');
}

/**
 * Rendu de la page active sur le canvas du studio
 */
function renderScannedImage() {
    const page = scannedPages[activePageIndex];
    if (!page || !page.originalImage) return;

    const canvas = document.getElementById('scannerCanvas');
    renderPageToCanvasElement(page, canvas);
}

/**
 * Dessine une page avec ses filtres et rotation sur un élément canvas donné
 */
function renderPageToCanvasElement(page, canvas) {
    const img = page.originalImage;
    const ctx = canvas.getContext('2d');

    const rad = (page.rotation * Math.PI) / 180;
    const isSideways = Math.abs(page.rotation % 180) === 90;

    canvas.width = isSideways ? img.height : img.width;
    canvas.height = isSideways ? img.width : img.height;

    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate(rad);
    ctx.drawImage(img, -img.width / 2, -img.height / 2);
    ctx.restore();

    if (page.filter !== 'original' || page.contrast !== 0) {
        applyScanFilter(ctx, canvas.width, canvas.height, page.filter, page.contrast);
    }
}

function createProcessedCanvasForPage(page) {
    const c = document.createElement('canvas');
    renderPageToCanvasElement(page, c);
    return c;
}

function canvasToBlobPromise(canvas, format = 'image/jpeg', quality = 0.92) {
    return new Promise(resolve => canvas.toBlob(resolve, format, quality));
}

/**
 * Algorithme de filtrage de scan de documents
 * Blanchit le fond tout en préservant et contrastant l'encre manuscrite
 */
function applyScanFilter(ctx, width, height, mode, contrastVal) {
    const imgData = ctx.getImageData(0, 0, width, height);
    const data = imgData.data;

    // Facteur de contraste
    const factor = (259 * (contrastVal + 255)) / (255 * (259 - contrastVal));

    for (let i = 0; i < data.length; i += 4) {
        let r = data[i];
        let g = data[i + 1];
        let b = data[i + 2];

        if (contrastVal !== 0) {
            r = factor * (r - 128) + 128;
            g = factor * (g - 128) + 128;
            b = factor * (b - 128) + 128;
            r = Math.min(255, Math.max(0, r));
            g = Math.min(255, Math.max(0, g));
            b = Math.min(255, Math.max(0, b));
        }

        const gray = 0.299 * r + 0.587 * g + 0.114 * b;

        if (mode === 'scan-doc') {
            if (gray > 140) {
                const boost = Math.min(255, gray + (255 - gray) * 0.82);
                data[i] = boost;
                data[i + 1] = boost;
                data[i + 2] = boost;
            } else {
                data[i] = Math.max(0, r * 0.65);
                data[i + 1] = Math.max(0, g * 0.65);
                data[i + 2] = Math.max(0, b * 0.65);
            }
        } else if (mode === 'scan-bw') {
            const threshold = 142;
            const val = gray < threshold ? 15 : 255;
            data[i] = val;
            data[i + 1] = val;
            data[i + 2] = val;
        } else if (mode === 'vintage') {
            const sepiaR = (gray * 1.05) + 25;
            const sepiaG = (gray * 0.95) + 15;
            const sepiaB = (gray * 0.78) + 5;
            data[i] = Math.min(255, Math.max(0, sepiaR));
            data[i + 1] = Math.min(255, Math.max(0, sepiaG));
            data[i + 2] = Math.min(255, Math.max(0, sepiaB));
        } else {
            data[i] = r;
            data[i + 1] = g;
            data[i + 2] = b;
        }
    }

    ctx.putImageData(imgData, 0, 0);
}

/* ============================================================ */
/* 4. OPTION 1 : OCR MULTI-PAGES ET RÉDACTION AUTOMATIQUE       */
/* ============================================================ */
async function runOcrAndFillRecipe() {
    const progressContainer = document.getElementById('ocrProgressContainer');
    const progressBar = document.getElementById('ocrProgressBar');
    const statusMsg = document.getElementById('ocrStatusMsg');

    if (!window.Tesseract) {
        showToast("Le module de reconnaissance de texte (Tesseract) n'est pas encore prêt.", "error");
        return;
    }

    if (scannedPages.length === 0) {
        showToast("Aucune page à numériser.", "error");
        return;
    }

    progressContainer.classList.remove('hidden');
    progressBar.style.width = '10%';
    statusMsg.textContent = "Initialisation du moteur OCR en français...";

    try {
        let extractedTexts = [];
        pendingImageBlobs = [];

        for (let i = 0; i < scannedPages.length; i++) {
            const page = scannedPages[i];
            const pageNum = i + 1;
            const totalPages = scannedPages.length;

            statusMsg.textContent = `Traitement et lecture de la page ${pageNum} sur ${totalPages}...`;
            progressBar.style.width = `${Math.round((i / totalPages) * 80) + 10}%`;

            // Canvas optimisé N&B pour OCR
            const ocrCanvas = createProcessedCanvasForPage(page);
            applyScanFilter(ocrCanvas.getContext('2d'), ocrCanvas.width, ocrCanvas.height, 'scan-bw', 25);

            // Reconnaissance Tesseract
            const result = await Tesseract.recognize(
                ocrCanvas,
                'fra',
                {
                    langPath: 'https://cdn.jsdelivr.net/gh/naptha/tessdata@gh-pages/4.0.0',
                    logger: m => {
                        if (m.status === 'recognizing text') {
                            const pct = Math.round(m.progress * 100);
                            statusMsg.textContent = `Page ${pageNum}/${totalPages} : lecture (${pct}%)...`;
                        }
                    }
                }
            );

            extractedTexts.push(result.data.text);

            // Préparer le blob haute résolution du scan traité
            const pageBlob = await canvasToBlobPromise(createProcessedCanvasForPage(page));
            pendingImageBlobs.push(pageBlob);
        }

        progressBar.style.width = '100%';
        statusMsg.textContent = "Toutes les pages ont été transcrites avec succès !";

        // Fusionner les textes de toutes les pages
        const parsed = parseMultiPageRecipeTexts(extractedTexts);

        // Fermer le scanner et pré-remplir le formulaire
        document.getElementById('scannerModal').classList.add('hidden');
        resetRecipeForm();

        const pageLabel = scannedPages.length > 1 ? ` (${scannedPages.length} pages)` : '';
        document.getElementById('modalTitle').textContent = `Recette Rédigée via Scan${pageLabel}`;
        document.getElementById('recipeTitle').value = parsed.title || "Nouvelle Recette";
        document.getElementById('recipeType').value = parsed.type;
        document.getElementById('recipeKeywords').value = parsed.keywords.join(', ');
        document.getElementById('recipeContent').value = parsed.content;

        renderFormImagePreviews();
        switchFormTab('text-tab');

        document.getElementById('recipeModal').classList.remove('hidden');
        showToast(`Recette rédigée depuis ${scannedPages.length} page(s) ! Vous pouvez la relire et l'enregistrer.`, "success");

    } catch (err) {
        console.error("Erreur OCR:", err);
        showToast("Erreur lors de la reconnaissance. Vous pouvez conserver la recette en tant que scan.", "error");
    } finally {
        progressContainer.classList.add('hidden');
    }
}

/**
 * Fusionne et structure les textes de plusieurs pages scannées
 */
function parseMultiPageRecipeTexts(pageTexts) {
    if (!pageTexts || pageTexts.length === 0) {
        return { title: "Recette Scannée", type: "plat", keywords: ["scan"], content: "" };
    }

    // Analyser la première page pour le titre, type et début des ingrédients
    const firstPageParsed = parseRecipeFromText(pageTexts[0]);

    if (pageTexts.length === 1) {
        return firstPageParsed;
    }

    // S'il y a plusieurs pages, concaténer les suites logiquement
    let fullContent = firstPageParsed.content;

    for (let i = 1; i < pageTexts.length; i++) {
        const pageText = pageTexts[i].trim();
        if (pageText) {
            fullContent += `\n\n--- [ SUITE PAGE ${i + 1} ] ---\n` + pageText;
        }
    }

    const keywords = [...new Set([...firstPageParsed.keywords, `${pageTexts.length} pages`])];

    return {
        title: firstPageParsed.title,
        type: firstPageParsed.type,
        keywords: keywords,
        content: fullContent
    };
}

/**
 * Analyse et structure le texte brut extrait d'une page
 */
function parseRecipeFromText(text) {
    if (!text || !text.trim()) {
        return {
            title: "Recette Scannée",
            type: "plat",
            keywords: ["manuscrit", "scan"],
            content: ""
        };
    }

    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    
    // Détection du Titre (première ligne significative)
    let title = "Recette";
    let startIndex = 0;
    for (let i = 0; i < Math.min(5, lines.length); i++) {
        const line = lines[i];
        if (line.length > 3 && !line.match(/^(ingr[ée]dients|pr[ée]paration|recette|fiche)/i)) {
            title = line;
            startIndex = i + 1;
            break;
        }
    }
    title = title.replace(/^[\*\-\#\.\:\s]+/, '').slice(0, 70);

    const fullLower = text.toLowerCase();
    let type = 'plat';
    if (fullLower.match(/(g[aâ]teau|tarte|mousse|cr[èe]me|chocolat|sucre|dessert|biscuit|flan|cake|fondant|moelleux|pomme|fraise|confiture)/)) {
        type = 'dessert';
    } else if (fullLower.match(/(salade|soupe|velout[ée]|potage|quiche|toast|tartine|entr[ée]e|avocat|verrine)/)) {
        type = 'entree';
    } else if (fullLower.match(/(cocktail|jus|smoothie|th[ée]|tisane|sirop|boisson|punch|mojito)/)) {
        type = 'boisson';
    }

    const keywords = ['scan manuscrit'];
    if (fullLower.includes('chocolat')) keywords.push('chocolat');
    if (fullLower.includes('four')) keywords.push('au four');
    if (fullLower.includes('rapide') || fullLower.includes('facile')) keywords.push('rapide');
    if (fullLower.includes('pomme')) keywords.push('pommes');
    if (fullLower.includes('fromage')) keywords.push('fromage');

    let ingredients = [];
    let instructions = [];
    let isInstructionsMode = false;

    for (let i = startIndex; i < lines.length; i++) {
        const line = lines[i];
        if (line.match(/^(pr[ée]paration|instructions?|[ée]tapes?|m[ée]langer|faire cuire|recette)/i)) {
            isInstructionsMode = true;
            continue;
        }
        if (line.match(/^ingr[ée]dients/i)) {
            isInstructionsMode = false;
            continue;
        }

        if (isInstructionsMode) {
            instructions.push(line);
        } else {
            ingredients.push(line.startsWith('-') || line.startsWith('•') ? line : `- ${line}`);
        }
    }

    let formattedContent = "";
    if (ingredients.length > 0) {
        formattedContent += "INGRÉDIENTS :\n" + ingredients.join('\n') + "\n\n";
    }
    if (instructions.length > 0) {
        formattedContent += "PRÉPARATION :\n" + instructions.join('\n');
    }
    if (!formattedContent) {
        formattedContent = text;
    }

    return { title, type, keywords, content: formattedContent };
}

/* ============================================================ */
/* 5. OPTION 2 : CONSERVER LE SCAN MANUSCRIT (MULTI-PAGES)      */
/* ============================================================ */
async function keepAsHandwrittenScan() {
    if (scannedPages.length === 0) {
        showToast("Aucune page scannée.", "error");
        return;
    }

    pendingImageBlobs = [];
    for (let page of scannedPages) {
        const blob = await canvasToBlobPromise(createProcessedCanvasForPage(page));
        pendingImageBlobs.push(blob);
    }

    document.getElementById('scannerModal').classList.add('hidden');
    resetRecipeForm();

    const count = scannedPages.length;
    const countText = count > 1 ? ` (${count} pages)` : '';

    document.getElementById('modalTitle').textContent = `Enregistrer la Recette Manuscrite${countText}`;
    document.getElementById('recipeTitle').value = "";
    document.getElementById('recipeKeywords').value = `manuscrit, scan${count > 1 ? `, ${count} pages` : ''}`;
    document.getElementById('recipeContent').value = `Recette conservée au format scan manuscrit${countText}.`;

    renderFormImagePreviews();
    switchFormTab('image-tab');

    document.getElementById('recipeModal').classList.remove('hidden');
    showToast(`Scan de ${count} page(s) prêt ! Entrez un titre pour enregistrer la recette.`, "success");
}

function renderFormImagePreviews() {
    const previewContainer = document.getElementById('imagePreview');
    if (!previewContainer) return;

    previewContainer.innerHTML = '';

    // Afficher les URLs existantes (en modification)
    currentRecipeImages.forEach((url, idx) => {
        const wrapper = document.createElement('div');
        wrapper.style.display = 'inline-block';
        wrapper.style.margin = '0.35rem';
        wrapper.style.textAlign = 'center';
        wrapper.innerHTML = `
            <img src="${url}" style="max-height: 120px; border-radius: 6px; border: 1px solid var(--glass-border); display: block;" alt="Page ${idx + 1}">
            <small style="color: var(--text-muted);">Page ${idx + 1}</small>
        `;
        previewContainer.appendChild(wrapper);
    });

    // Afficher les nouveaux blobs en attente d'upload
    pendingImageBlobs.forEach((blob, idx) => {
        const url = URL.createObjectURL(blob);
        const wrapper = document.createElement('div');
        wrapper.style.display = 'inline-block';
        wrapper.style.margin = '0.35rem';
        wrapper.style.textAlign = 'center';
        const pageNum = currentRecipeImages.length + idx + 1;
        wrapper.innerHTML = `
            <img src="${url}" style="max-height: 120px; border-radius: 6px; border: 1px solid var(--accent); display: block;" alt="Page ${pageNum}">
            <small style="color: #fda4af;">Nouvelle Page ${pageNum}</small>
        `;
        previewContainer.appendChild(wrapper);
    });
}

/* ============================================================ */
/* 6. GESTION DU FORMULAIRE ET ENREGISTREMENT                   */
/* ============================================================ */
function setupRecipeForm() {
    const form = document.getElementById('recipeForm');
    const tabBtns = document.querySelectorAll('.form-tabs .tab-btn');
    const recipeImageInput = document.getElementById('recipeImage');
    const launchScannerFromFormBtn = document.getElementById('launchScannerFromFormBtn');
    const formScanToTextBtn = document.getElementById('formScanToTextBtn');

    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => switchFormTab(btn.dataset.tab));
    });

    if (recipeImageInput) {
        recipeImageInput.addEventListener('change', (e) => {
            if (e.target.files && e.target.files[0]) {
                pendingImageBlobs.push(e.target.files[0]);
                renderFormImagePreviews();
                recipeImageInput.value = '';
            }
        });
    }

    if (launchScannerFromFormBtn) {
        launchScannerFromFormBtn.addEventListener('click', () => {
            document.getElementById('recipeModal').classList.add('hidden');
            resetScannerStudio();
            document.getElementById('scannerModal').classList.remove('hidden');
        });
    }

    if (formScanToTextBtn) {
        formScanToTextBtn.addEventListener('click', () => {
            document.getElementById('recipeModal').classList.add('hidden');
            resetScannerStudio();
            document.getElementById('scannerModal').classList.remove('hidden');
        });
    }

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        if (!supabaseClient) {
            showToast("Sauvegarde impossible, base de données non connectée.", "error");
            return;
        }

        const submitBtn = form.querySelector('.submit-btn');
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Enregistrement en cours...';

        let finalImages = [...currentRecipeImages];

        // Téléversement de toutes les nouvelles pages vers Supabase Storage
        if (pendingImageBlobs.length > 0) {
            for (let i = 0; i < pendingImageBlobs.length; i++) {
                const blob = pendingImageBlobs[i];
                const fileName = `recipe_${Date.now()}_p${i + 1}_${Math.random().toString(36).substring(2, 7)}.jpg`;

                const { error: uploadError } = await supabaseClient.storage
                    .from('recipe-images')
                    .upload(fileName, blob, {
                        contentType: 'image/jpeg',
                        upsert: true
                    });

                if (uploadError) {
                    console.error("Erreur d'upload image:", uploadError);
                    showToast(`Erreur lors du téléversement de la page ${i + 1}.`, "error");
                    submitBtn.disabled = false;
                    submitBtn.innerHTML = '<i class="fa-solid fa-save"></i> Enregistrer la recette';
                    return;
                }

                const { data: publicUrlData } = supabaseClient.storage
                    .from('recipe-images')
                    .getPublicUrl(fileName);

                finalImages.push(publicUrlData.publicUrl);
            }
        }

        // Format de stockage : URL unique string si 1 seule page, ou JSON array si plusieurs pages
        let finalImageUrl = null;
        if (finalImages.length === 1) {
            finalImageUrl = finalImages[0];
        } else if (finalImages.length > 1) {
            finalImageUrl = JSON.stringify(finalImages);
        }

        const keywordsStr = document.getElementById('recipeKeywords').value;
        const keywordsArray = keywordsStr ? keywordsStr.split(',').map(k => k.trim()).filter(k => k) : [];

        const recipeData = {
            title: document.getElementById('recipeTitle').value.trim(),
            type: document.getElementById('recipeType').value,
            keywords: keywordsArray,
            content: document.getElementById('recipeContent').value.trim(),
            url: document.getElementById('recipeUrl').value.trim(),
            image_url: finalImageUrl
        };

        if (editingRecipeId) {
            const { error } = await supabaseClient
                .from('recipes')
                .update(recipeData)
                .eq('id', editingRecipeId);

            if (error) {
                console.error('Erreur modification:', error);
                showToast("Erreur lors de la modification.", "error");
            } else {
                showToast("Recette modifiée avec succès !", "success");
            }
        } else {
            const { error } = await supabaseClient
                .from('recipes')
                .insert([recipeData]);

            if (error) {
                console.error('Erreur ajout:', error);
                showToast("Erreur lors de l'ajout.", "error");
            } else {
                showToast("Recette enregistrée avec succès !", "success");
            }
        }

        await loadRecipes();
        document.getElementById('recipeModal').classList.add('hidden');

        submitBtn.disabled = false;
        submitBtn.innerHTML = '<i class="fa-solid fa-save"></i> Enregistrer la recette';
    });
}

function switchFormTab(tabId) {
    const tabBtns = document.querySelectorAll('.form-tabs .tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');

    tabBtns.forEach(b => b.classList.toggle('active', b.dataset.tab === tabId));
    tabContents.forEach(c => c.classList.toggle('active', c.id === tabId));
}

function resetRecipeForm() {
    editingRecipeId = null;
    currentRecipeImages = [];
    pendingImageBlobs = [];

    document.getElementById('recipeForm').reset();
    document.getElementById('modalTitle').textContent = "Ajouter une recette";
    renderFormImagePreviews();
    switchFormTab('text-tab');
}

/* ============================================================ */
/* 7. CHARGEMENT ET AFFICHAGE DES RECETTES                      */
/* ============================================================ */
async function loadRecipes() {
    const recipesGrid = document.getElementById('recipesGrid');
    const countBadge = document.getElementById('recipesCount');

    if (!supabaseClient) {
        recipesGrid.innerHTML = `
            <div style="grid-column: 1/-1; text-align: center; color: var(--accent); padding: 3rem;">
                <i class="fa-solid fa-triangle-exclamation" style="font-size: 2.5rem; margin-bottom: 1rem;"></i>
                <p>Connexion à la base de recettes impossible. Vérifiez votre connexion internet.</p>
            </div>`;
        return;
    }

    recipesGrid.innerHTML = `
        <div style="grid-column: 1/-1; text-align: center; color: var(--text-muted); padding: 3rem;">
            <i class="fa-solid fa-spinner fa-spin" style="font-size: 2.5rem; margin-bottom: 1rem; color: var(--accent);"></i>
            <p>Chargement de vos recettes...</p>
        </div>`;

    const { data, error } = await supabaseClient
        .from('recipes')
        .select('*')
        .order('created_at', { ascending: false });

    if (error) {
        console.error("Erreur chargement Supabase:", error);
        recipesGrid.innerHTML = `<p style="grid-column: 1/-1; text-align: center; color: var(--accent);">Erreur : ${error.message}</p>`;
        return;
    }

    currentRecipes = data || [];
    renderRecipes();
}

function renderRecipes() {
    const recipesGrid = document.getElementById('recipesGrid');
    const searchInput = document.getElementById('searchInput');
    const typeFilter = document.getElementById('typeFilter');
    const countBadge = document.getElementById('recipesCount');
    const clearSearchBtn = document.getElementById('clearSearchBtn');

    const searchTerm = searchInput.value.toLowerCase().trim();
    const filterType = typeFilter.value;

    if (searchTerm) {
        clearSearchBtn.classList.remove('hidden');
    } else {
        clearSearchBtn.classList.add('hidden');
    }

    const filtered = currentRecipes.filter(recipe => {
        const matchesSearch = !searchTerm ||
            recipe.title.toLowerCase().includes(searchTerm) ||
            (recipe.keywords && recipe.keywords.some(k => k.toLowerCase().includes(searchTerm))) ||
            (recipe.content && recipe.content.toLowerCase().includes(searchTerm));

        const matchesType = filterType === 'all' || recipe.type === filterType;

        const isScan = (recipe.keywords && recipe.keywords.some(k => k.toLowerCase().includes('scan') || k.toLowerCase().includes('manuscrit'))) ||
            (!recipe.content && recipe.image_url);

        const matchesScanFilter = !scanFilterOnly || isScan;

        return matchesSearch && matchesType && matchesScanFilter;
    });

    countBadge.innerHTML = `<i class="fa-solid fa-book"></i> <strong>${filtered.length}</strong> recette${filtered.length > 1 ? 's' : ''}`;

    recipesGrid.innerHTML = '';

    if (filtered.length === 0) {
        recipesGrid.innerHTML = `
            <div style="grid-column: 1/-1; text-align: center; color: var(--text-muted); padding: 4rem 1rem;">
                <i class="fa-solid fa-book-open" style="font-size: 3rem; margin-bottom: 1rem; opacity: 0.4;"></i>
                <p style="font-size: 1.1rem; margin-bottom: 0.5rem;">Aucune recette ne correspond à votre recherche.</p>
                <small>Essayez un autre mot-clé ou ajoutez une nouvelle recette !</small>
            </div>`;
        return;
    }

    const typeLabels = {
        'entree': '🥗 Entrée',
        'plat': '🍲 Plat',
        'dessert': '🍰 Dessert',
        'boisson': '🍹 Boisson'
    };

    filtered.forEach(recipe => {
        const card = document.createElement('div');
        card.className = 'recipe-card';

        const images = getRecipeImages(recipe);
        const pageCount = images.length;
        const isScan = (recipe.keywords && recipe.keywords.some(k => k.toLowerCase().includes('scan') || k.toLowerCase().includes('manuscrit'))) ||
            (!recipe.content && pageCount > 0);

        let mediaHTML = '';
        if (pageCount > 0) {
            mediaHTML = `
                <div class="recipe-media-preview" title="Cliquer pour voir la recette">
                    <img src="${images[0]}" class="recipe-image-thumb" alt="${recipe.title}">
                    ${pageCount > 1 ? `<span class="pages-count-badge"><i class="fa-solid fa-copy"></i> ${pageCount} pages</span>` : ''}
                    <div class="media-hover-overlay">
                        <i class="fa-solid fa-magnifying-glass-plus"></i>
                    </div>
                </div>`;
        }

        let keywordsHTML = '';
        if (recipe.keywords && recipe.keywords.length > 0) {
            keywordsHTML = recipe.keywords.slice(0, 4).map(k => `<span class="keyword-tag">${k}</span>`).join('');
        }

        const scanBadgeLabel = pageCount > 1 ? `Manuscrit (${pageCount} p.)` : 'Manuscrit / Scan';

        card.innerHTML = `
            <div class="card-badges">
                <span class="recipe-type">${typeLabels[recipe.type] || recipe.type}</span>
                ${isScan ? `<span class="recipe-scan-tag"><i class="fa-solid fa-signature"></i> ${scanBadgeLabel}</span>` : ''}
            </div>

            <h3 class="recipe-title" style="cursor:pointer;" title="Voir la recette">${recipe.title}</h3>

            ${mediaHTML}

            ${keywordsHTML ? `<div class="recipe-keywords">${keywordsHTML}</div>` : ''}

            <p class="recipe-preview" style="cursor:pointer;" title="Voir la recette">
                ${recipe.content ? recipe.content : (recipe.url ? '🔗 Recette via lien externe' : `📜 Recette manuscrite (${pageCount} page${pageCount > 1 ? 's' : ''})`)}
            </p>

            <div class="recipe-actions">
                <button class="btn ghost-btn view-btn"><i class="fa-solid fa-eye"></i> Voir</button>
                <button class="icon-btn edit-btn" title="Modifier"><i class="fa-solid fa-pen"></i></button>
                ${recipe.url ? `<a href="${recipe.url}" target="_blank" class="icon-btn" title="Ouvrir le lien web"><i class="fa-solid fa-external-link-alt"></i></a>` : ''}
                <button class="icon-btn delete-btn" title="Supprimer" style="color: #f43f5e; margin-left: auto;"><i class="fa-solid fa-trash"></i></button>
            </div>
        `;

        const openView = () => openViewModal(recipe);
        card.querySelector('.recipe-title').addEventListener('click', openView);
        card.querySelector('.recipe-preview').addEventListener('click', openView);
        card.querySelector('.view-btn').addEventListener('click', openView);
        const mediaElem = card.querySelector('.recipe-media-preview');
        if (mediaElem) mediaElem.addEventListener('click', openView);

        card.querySelector('.edit-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            openEditModal(recipe);
        });

        card.querySelector('.delete-btn').addEventListener('click', async (e) => {
            e.stopPropagation();
            if (confirm(`Supprimer définitivement la recette « ${recipe.title} » ?`)) {
                const btn = card.querySelector('.delete-btn');
                btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';

                const { error } = await supabaseClient
                    .from('recipes')
                    .delete()
                    .eq('id', recipe.id);

                if (!error) {
                    showToast("Recette supprimée avec succès.", "info");
                    await loadRecipes();
                } else {
                    console.error("Erreur suppression:", error);
                    showToast("Erreur lors de la suppression.", "error");
                    btn.innerHTML = '<i class="fa-solid fa-trash"></i>';
                }
            }
        });

        recipesGrid.appendChild(card);
    });
}

/* ============================================================ */
/* 8. VISUALISATION COMPLÈTE & ZOOM HAUTE DÉFINITION           */
/* ============================================================ */
function openViewModal(recipe) {
    const viewModal = document.getElementById('viewRecipeModal');
    const titleElem = document.getElementById('viewModalTitle');
    const typeElem = document.getElementById('viewModalType');
    const scanBadge = document.getElementById('viewModalScanBadge');
    const keywordsElem = document.getElementById('viewModalKeywords');
    const contentArea = document.getElementById('viewModalContentArea');
    const printBtn = document.getElementById('viewPrintBtn');
    const editBtn = document.getElementById('viewEditBtn');

    const pagesNav = document.getElementById('viewPagesNav');
    const pageIndicator = document.getElementById('viewPageIndicator');
    const prevPageBtn = document.getElementById('viewPrevPageBtn');
    const nextPageBtn = document.getElementById('viewNextPageBtn');

    titleElem.textContent = recipe.title;

    const typeLabels = {
        'entree': '🥗 Entrée',
        'plat': '🍲 Plat principal',
        'dessert': '🍰 Dessert',
        'boisson': '🍹 Boisson'
    };
    typeElem.textContent = typeLabels[recipe.type] || recipe.type;

    viewRecipeActiveImages = getRecipeImages(recipe);
    currentViewPageIndex = 0;

    const isScan = (recipe.keywords && recipe.keywords.some(k => k.toLowerCase().includes('scan') || k.toLowerCase().includes('manuscrit'))) ||
        (!recipe.content && viewRecipeActiveImages.length > 0);

    if (isScan) {
        scanBadge.classList.remove('hidden');
        scanBadge.innerHTML = viewRecipeActiveImages.length > 1 ?
            `<i class="fa-solid fa-signature"></i> Scan (${viewRecipeActiveImages.length} pages)` :
            `<i class="fa-solid fa-signature"></i> Scan Manuscrit`;
    } else {
        scanBadge.classList.add('hidden');
    }

    if (recipe.keywords && recipe.keywords.length > 0) {
        keywordsElem.innerHTML = recipe.keywords.map(k => `<span class="keyword-tag">${k}</span>`).join('');
        keywordsElem.style.display = 'flex';
    } else {
        keywordsElem.innerHTML = '';
        keywordsElem.style.display = 'none';
    }

    // Gestion de la barre multi-pages
    if (viewRecipeActiveImages.length > 1) {
        pagesNav.classList.remove('hidden');
    } else {
        pagesNav.classList.add('hidden');
    }

    let contentHTML = '';

    if (viewRecipeActiveImages.length > 0) {
        contentHTML += `
            <div class="scan-hd-viewer-container">
                <div class="scan-toolbar">
                    <span id="viewerPageTitle"><i class="fa-solid fa-magnifying-glass"></i> Visualiseur HD</span>
                    <div style="display: flex; gap: 0.5rem; align-items: center;">
                        <button type="button" class="icon-control-btn" id="zoomOutBtn" title="Dézoomer"><i class="fa-solid fa-minus"></i></button>
                        <span id="zoomLevelDisplay" style="font-size: 0.8rem; min-width: 45px; text-align: center;">100%</span>
                        <button type="button" class="icon-control-btn" id="zoomInBtn" title="Zoomer"><i class="fa-solid fa-plus"></i></button>
                        <button type="button" class="icon-control-btn" id="zoomResetBtn" title="Réinitialiser le zoom"><i class="fa-solid fa-rotate-left"></i></button>
                    </div>
                </div>
                <div class="zoom-viewport" id="zoomViewport">
                    <img src="${viewRecipeActiveImages[0]}" id="hdZoomImage" class="zoom-image" alt="${recipe.title}">
                </div>
            </div>`;
    }

    if (recipe.content) {
        contentHTML += `<div class="recipe-text-body">${recipe.content}</div>`;
    }

    if (recipe.url) {
        contentHTML += `<a href="${recipe.url}" target="_blank" class="btn primary-btn" style="width: 100%; text-decoration: none; justify-content: center;"><i class="fa-solid fa-external-link-alt"></i> Ouvrir la recette sur le site d'origine</a>`;
    }

    contentArea.innerHTML = contentHTML;

    // Mise à jour de la navigation de page
    const updateViewPage = (idx) => {
        if (viewRecipeActiveImages.length === 0) return;
        currentViewPageIndex = (idx + viewRecipeActiveImages.length) % viewRecipeActiveImages.length;
        if (pageIndicator) {
            pageIndicator.textContent = `Page ${currentViewPageIndex + 1} sur ${viewRecipeActiveImages.length}`;
        }
        const zoomImg = document.getElementById('hdZoomImage');
        if (zoomImg) {
            zoomImg.src = viewRecipeActiveImages[currentViewPageIndex];
            currentZoom = 1;
            zoomImg.style.transform = `scale(1)`;
            const zoomDisplay = document.getElementById('zoomLevelDisplay');
            if (zoomDisplay) zoomDisplay.textContent = '100%';
        }
    };

    if (prevPageBtn) prevPageBtn.onclick = () => updateViewPage(currentViewPageIndex - 1);
    if (nextPageBtn) nextPageBtn.onclick = () => updateViewPage(currentViewPageIndex + 1);

    if (viewRecipeActiveImages.length > 1) {
        updateViewPage(0);
    }

    // Configuration des boutons de zoom
    if (viewRecipeActiveImages.length > 0) {
        currentZoom = 1;
        const zoomImg = document.getElementById('hdZoomImage');
        const zoomIn = document.getElementById('zoomInBtn');
        const zoomOut = document.getElementById('zoomOutBtn');
        const zoomReset = document.getElementById('zoomResetBtn');
        const zoomDisplay = document.getElementById('zoomLevelDisplay');
        const viewport = document.getElementById('zoomViewport');

        const updateZoom = (z) => {
            currentZoom = Math.min(3.5, Math.max(0.7, z));
            if (zoomImg) zoomImg.style.transform = `scale(${currentZoom})`;
            if (zoomDisplay) zoomDisplay.textContent = `${Math.round(currentZoom * 100)}%`;
        };

        if (zoomIn) zoomIn.addEventListener('click', () => updateZoom(currentZoom + 0.3));
        if (zoomOut) zoomOut.addEventListener('click', () => updateZoom(currentZoom - 0.3));
        if (zoomReset) zoomReset.addEventListener('click', () => updateZoom(1));

        if (viewport) {
            viewport.addEventListener('wheel', (e) => {
                e.preventDefault();
                updateZoom(currentZoom + (e.deltaY < 0 ? 0.2 : -0.2));
            }, { passive: false });
        }
    }

    // Impression
    printBtn.onclick = () => window.print();

    // Modification
    editBtn.onclick = () => {
        viewModal.classList.add('hidden');
        openEditModal(recipe);
    };

    viewModal.classList.remove('hidden');
}

function openEditModal(recipe) {
    editingRecipeId = recipe.id;
    currentRecipeImages = getRecipeImages(recipe);
    pendingImageBlobs = [];

    document.getElementById('modalTitle').textContent = "Modifier la recette";
    document.getElementById('recipeTitle').value = recipe.title;
    document.getElementById('recipeType').value = recipe.type;
    document.getElementById('recipeKeywords').value = recipe.keywords ? recipe.keywords.join(', ') : '';
    document.getElementById('recipeContent').value = recipe.content || '';
    document.getElementById('recipeUrl').value = recipe.url || '';

    renderFormImagePreviews();

    if (recipe.content) {
        switchFormTab('text-tab');
    } else if (currentRecipeImages.length > 0) {
        switchFormTab('image-tab');
    } else if (recipe.url) {
        switchFormTab('url-tab');
    } else {
        switchFormTab('text-tab');
    }

    document.getElementById('recipeModal').classList.remove('hidden');
}

/* ============================================================ */
/* 9. RECHERCHE ET FILTRES                                      */
/* ============================================================ */
function setupSearchAndFilters() {
    const searchInput = document.getElementById('searchInput');
    const typeFilter = document.getElementById('typeFilter');
    const clearSearchBtn = document.getElementById('clearSearchBtn');
    const filterScanOnlyBtn = document.getElementById('filterScanOnlyBtn');

    searchInput.addEventListener('input', renderRecipes);
    typeFilter.addEventListener('change', renderRecipes);

    clearSearchBtn.addEventListener('click', () => {
        searchInput.value = '';
        renderRecipes();
        searchInput.focus();
    });

    filterScanOnlyBtn.addEventListener('click', () => {
        scanFilterOnly = !scanFilterOnly;
        filterScanOnlyBtn.classList.toggle('active', scanFilterOnly);
        renderRecipes();
    });
}

/* ============================================================ */
/* 10. NOTIFICATIONS TOAST                                      */
/* ============================================================ */
function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;

    let icon = 'fa-circle-info';
    if (type === 'success') icon = 'fa-circle-check';
    if (type === 'error') icon = 'fa-triangle-exclamation';

    toast.innerHTML = `<i class="fa-solid ${icon}"></i><span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
        toast.style.animation = 'toastOut 0.3s ease forwards';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}
