/**
 * Livre de recettes d'Anne
 * Application PWA Cross-Platform (Smartphone & PC)
 * Scanner & Traitement d'image pour recettes manuscrites + OCR Tesseract
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
let currentRecipeImageUrl = null;
let pendingImageBlob = null;
let scanFilterOnly = false;

// Variables pour le Studio Scanner
let originalImage = null;
let currentFilter = 'scan-doc';
let currentRotation = 0;
let currentContrast = 15;

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
/* 3. STUDIO PHOTO & SCANNER DE RECETTE MANUSCRITE              */
/* ============================================================ */
function setupScannerStudio() {
    const cameraInput = document.getElementById('cameraDirectInput');
    const galleryInput = document.getElementById('galleryFileInput');
    const scanUploadZone = document.getElementById('scanUploadZone');
    const scanEditorArea = document.getElementById('scanEditorArea');
    const retakeBtn = document.getElementById('retakePhotoBtn');
    const canvas = document.getElementById('scannerCanvas');
    const filterPills = document.querySelectorAll('.filter-pill');
    const rotateLeftBtn = document.getElementById('rotateLeftBtn');
    const rotateRightBtn = document.getElementById('rotateRightBtn');
    const contrastRange = document.getElementById('contrastRange');
    const contrastVal = document.getElementById('contrastVal');

    const chooseOcrBtn = document.getElementById('chooseOcrBtn');
    const chooseScanDocBtn = document.getElementById('chooseScanDocBtn');

    // Chargement de l'image sélectionnée
    const handleFileSelect = (file) => {
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

                originalImage = new Image();
                originalImage.onload = () => {
                    currentFilter = 'scan-doc';
                    currentRotation = 0;
                    currentContrast = 15;
                    contrastRange.value = 15;
                    contrastVal.textContent = '15';

                    filterPills.forEach(p => p.classList.toggle('active', p.dataset.filter === 'scan-doc'));

                    scanUploadZone.classList.add('hidden');
                    scanEditorArea.classList.remove('hidden');

                    renderScannedImage();
                };
                originalImage.src = tempCanvas.toDataURL('image/jpeg', 0.92);
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    };

    if (cameraInput) {
        cameraInput.addEventListener('change', (e) => {
            if (e.target.files && e.target.files[0]) handleFileSelect(e.target.files[0]);
        });
    }

    if (galleryInput) {
        galleryInput.addEventListener('change', (e) => {
            if (e.target.files && e.target.files[0]) handleFileSelect(e.target.files[0]);
        });
    }

    if (retakeBtn) {
        retakeBtn.addEventListener('click', resetScannerStudio);
    }

    // Gestion des filtres de rendu de scan
    filterPills.forEach(pill => {
        pill.addEventListener('click', () => {
            filterPills.forEach(p => p.classList.remove('active'));
            pill.classList.add('active');
            currentFilter = pill.dataset.filter;
            renderScannedImage();
        });
    });

    // Rotation
    if (rotateLeftBtn) {
        rotateLeftBtn.addEventListener('click', () => {
            currentRotation = (currentRotation - 90) % 360;
            renderScannedImage();
        });
    }

    if (rotateRightBtn) {
        rotateRightBtn.addEventListener('click', () => {
            currentRotation = (currentRotation + 90) % 360;
            renderScannedImage();
        });
    }

    // Curseur de contraste
    if (contrastRange) {
        contrastRange.addEventListener('input', (e) => {
            currentContrast = parseInt(e.target.value, 10);
            contrastVal.textContent = currentContrast;
            renderScannedImage();
        });
    }

    // Option 1 : Rédiger automatiquement via OCR
    if (chooseOcrBtn) {
        chooseOcrBtn.addEventListener('click', async () => {
            await runOcrAndFillRecipe();
        });
    }

    // Option 2 : Conserver le Scan Manuscrit
    if (chooseScanDocBtn) {
        chooseScanDocBtn.addEventListener('click', () => {
            keepAsHandwrittenScan();
        });
    }
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
                        originalImage = img;
                        currentFilter = 'scan-doc';
                        currentRotation = 0;
                        currentContrast = 15;
                        document.getElementById('scanUploadZone').classList.add('hidden');
                        document.getElementById('scanEditorArea').classList.remove('hidden');
                        renderScannedImage();
                        showToast("Image collée depuis le presse-papier !", "info");
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
    originalImage = null;
    currentRotation = 0;
    currentFilter = 'scan-doc';
    currentContrast = 15;

    const cameraInput = document.getElementById('cameraDirectInput');
    const galleryInput = document.getElementById('galleryFileInput');
    if (cameraInput) cameraInput.value = '';
    if (galleryInput) galleryInput.value = '';

    document.getElementById('scanUploadZone').classList.remove('hidden');
    document.getElementById('scanEditorArea').classList.add('hidden');
    document.getElementById('ocrProgressContainer').classList.add('hidden');
}

/**
 * Traitement de l'image sur Canvas avec filtres de scanne de documents
 */
function renderScannedImage() {
    if (!originalImage) return;

    const canvas = document.getElementById('scannerCanvas');
    const ctx = canvas.getContext('2d');

    // Calcul dimensions avec rotation
    const rad = (currentRotation * Math.PI) / 180;
    const isSideways = Math.abs(currentRotation % 180) === 90;

    canvas.width = isSideways ? originalImage.height : originalImage.width;
    canvas.height = isSideways ? originalImage.width : originalImage.height;

    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate(rad);
    ctx.drawImage(originalImage, -originalImage.width / 2, -originalImage.height / 2);
    ctx.restore();

    // Application des filtres de document / écriture manuscrite
    if (currentFilter !== 'original' || currentContrast !== 0) {
        applyScanFilter(ctx, canvas.width, canvas.height, currentFilter, currentContrast);
    }
}

/**
 * Algorithme de filtrage de scan de documents
 * Blanchit le fond tout en préservant et contrastant l'encre manuscrite
 */
function applyScanFilter(ctx, width, height, mode, contrastVal) {
    const imgData = ctx.getImageData(0, 0, width, height);
    const data = imgData.data;

    // Facteur d'amplification de contraste
    const factor = (259 * (contrastVal + 255)) / (255 * (259 - contrastVal));

    for (let i = 0; i < data.length; i += 4) {
        let r = data[i];
        let g = data[i + 1];
        let b = data[i + 2];

        // Ajustement contraste
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
            // Mode "Scan Nettoyé" : blanchit le papier jauni ou ombré, accentue l'encre
            if (gray > 140) {
                // Fond de page : pousse vers le blanc pur
                const boost = Math.min(255, gray + (255 - gray) * 0.82);
                data[i] = boost;
                data[i + 1] = boost;
                data[i + 2] = boost;
            } else {
                // Écriture manuscrite : accentue la netteté et la densité de l'encre
                data[i] = Math.max(0, r * 0.65);
                data[i + 1] = Math.max(0, g * 0.65);
                data[i + 2] = Math.max(0, b * 0.65);
            }
        } else if (mode === 'scan-bw') {
            // Mode Scan Noir & Blanc élevé
            const threshold = 142;
            const val = gray < threshold ? 15 : 255;
            data[i] = val;
            data[i + 1] = val;
            data[i + 2] = val;
        } else if (mode === 'vintage') {
            // Mode Parchemin / Carnet de famille
            const sepiaR = (gray * 1.05) + 25;
            const sepiaG = (gray * 0.95) + 15;
            const sepiaB = (gray * 0.78) + 5;
            data[i] = Math.min(255, Math.max(0, sepiaR));
            data[i + 1] = Math.min(255, Math.max(0, sepiaG));
            data[i + 2] = Math.min(255, Math.max(0, sepiaB));
        } else {
            // Original avec contraste
            data[i] = r;
            data[i + 1] = g;
            data[i + 2] = b;
        }
    }

    ctx.putImageData(imgData, 0, 0);
}

/* ============================================================ */
/* 4. OPTION 1 : OCR ET RÉDACTION AUTOMATIQUE (TESSERACT)       */
/* ============================================================ */
async function runOcrAndFillRecipe() {
    const canvas = document.getElementById('scannerCanvas');
    const progressContainer = document.getElementById('ocrProgressContainer');
    const progressBar = document.getElementById('ocrProgressBar');
    const statusMsg = document.getElementById('ocrStatusMsg');

    if (!window.Tesseract) {
        showToast("Le module de reconnaissance de texte (Tesseract) n'est pas encore prêt.", "error");
        return;
    }

    progressContainer.classList.remove('hidden');
    progressBar.style.width = '10%';
    statusMsg.textContent = "Initialisation du moteur OCR en français...";

    try {
        // Préparer un canvas à haut contraste pour optimiser la reconnaissance
        const ocrCanvas = document.createElement('canvas');
        ocrCanvas.width = canvas.width;
        ocrCanvas.height = canvas.height;
        const ocrCtx = ocrCanvas.getContext('2d');
        ocrCtx.drawImage(canvas, 0, 0);
        applyScanFilter(ocrCtx, ocrCanvas.width, ocrCanvas.height, 'scan-bw', 25);

        // Appel Tesseract avec logger de progression et CDN francais garanti
        const result = await Tesseract.recognize(
            ocrCanvas,
            'fra',
            {
                langPath: 'https://cdn.jsdelivr.net/gh/naptha/tessdata@gh-pages/4.0.0',
                logger: m => {
                    if (m.status === 'recognizing text') {
                        const pct = Math.round(m.progress * 100);
                        progressBar.style.width = `${Math.max(15, pct)}%`;
                        statusMsg.textContent = `Lecture et transcription de la recette (${pct}%)...`;
                    } else if (m.status === 'loading language traineddata') {
                        progressBar.style.width = '35%';
                        statusMsg.textContent = "Téléchargement du dictionnaire français...";
                    }
                }
            }
        );

        progressBar.style.width = '100%';
        statusMsg.textContent = "Recette transcrite avec succès !";

        const rawText = result.data.text;
        const parsed = parseRecipeFromText(rawText);

        // Sauvegarder l'image du scan pour l'associer à la recette
        canvas.toBlob((blob) => {
            pendingImageBlob = blob;
            const previewUrl = URL.createObjectURL(blob);
            document.getElementById('imagePreview').innerHTML = `<img src="${previewUrl}" alt="Scan de la recette">`;
        }, 'image/jpeg', 0.9);

        // Fermer le scanner et pré-remplir le formulaire
        document.getElementById('scannerModal').classList.add('hidden');
        resetRecipeForm();

        document.getElementById('modalTitle').textContent = "Recette Rédigée via Scan";
        document.getElementById('recipeTitle').value = parsed.title || "Nouvelle Recette";
        document.getElementById('recipeType').value = parsed.type;
        document.getElementById('recipeKeywords').value = parsed.keywords.join(', ');
        document.getElementById('recipeContent').value = parsed.content;

        // Activer l'onglet texte
        switchFormTab('text-tab');

        document.getElementById('recipeModal').classList.remove('hidden');
        showToast("Recette rédigée avec succès ! Vous pouvez la relire et l'enregistrer.", "success");

    } catch (err) {
        console.error("Erreur OCR:", err);
        showToast("Erreur lors de la reconnaissance de texte. Vous pouvez conserver la recette en tant que scan.", "error");
    } finally {
        progressContainer.classList.add('hidden');
    }
}

/**
 * Analyse et structure le texte brut extrait par l'OCR
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
    
    // Détection du Titre (première ligne significative, max 80 caractères)
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
    // Nettoyer le titre
    title = title.replace(/^[\*\-\#\.\:\s]+/, '').slice(0, 70);

    // Détection du type selon les mots-clés présents
    const fullLower = text.toLowerCase();
    let type = 'plat';
    if (fullLower.match(/(g[aâ]teau|tarte|mousse|cr[èe]me|chocolat|sucre|dessert|biscuit|flan|cake|fondant|moelleux|pomme|fraise|confiture)/)) {
        type = 'dessert';
    } else if (fullLower.match(/(salade|soupe|velout[ée]|potage|quiche|toast|tartine|entr[ée]e|avocat|verrine)/)) {
        type = 'entree';
    } else if (fullLower.match(/(cocktail|jus|smoothie|th[ée]|tisane|sirop|boisson|punch|mojito)/)) {
        type = 'boisson';
    }

    // Mots-clés automatiques
    const keywords = ['scan manuscrit'];
    if (fullLower.includes('chocolat')) keywords.push('chocolat');
    if (fullLower.includes('four')) keywords.push('au four');
    if (fullLower.includes('rapide') || fullLower.includes('facile')) keywords.push('rapide');
    if (fullLower.includes('pomme')) keywords.push('pommes');
    if (fullLower.includes('fromage')) keywords.push('fromage');

    // Structuration en Ingrédients et Préparation
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
            // Ligne d'ingrédient
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
/* 5. OPTION 2 : CONSERVER LE SCAN MANUSCRIT                    */
/* ============================================================ */
function keepAsHandwrittenScan() {
    const canvas = document.getElementById('scannerCanvas');

    canvas.toBlob((blob) => {
        pendingImageBlob = blob;
        const previewUrl = URL.createObjectURL(blob);
        document.getElementById('imagePreview').innerHTML = `<img src="${previewUrl}" alt="Aperçu du scan manuscrit">`;

        document.getElementById('scannerModal').classList.add('hidden');
        resetRecipeForm();

        document.getElementById('modalTitle').textContent = "Enregistrer la Recette Manuscrite";
        document.getElementById('recipeTitle').value = "";
        document.getElementById('recipeKeywords').value = "manuscrit, scan carnet";
        document.getElementById('recipeContent').value = "Recette conservée au format scan manuscrit.";

        // Activer l'onglet Photo / Scan
        switchFormTab('image-tab');

        document.getElementById('recipeModal').classList.remove('hidden');
        showToast("Rendu scan prêt ! Entrez un titre pour enregistrer la recette.", "success");
    }, 'image/jpeg', 0.92);
}

/* ============================================================ */
/* 6. GESTION DU FORMULAIRE ET ONGLETS                          */
/* ============================================================ */
function setupRecipeForm() {
    const form = document.getElementById('recipeForm');
    const tabBtns = document.querySelectorAll('.form-tabs .tab-btn');
    const recipeImageInput = document.getElementById('recipeImage');
    const imagePreview = document.getElementById('imagePreview');
    const launchScannerFromFormBtn = document.getElementById('launchScannerFromFormBtn');
    const formScanToTextBtn = document.getElementById('formScanToTextBtn');

    // Basculement des onglets
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => switchFormTab(btn.dataset.tab));
    });

    // Sélecteur d'image standard
    if (recipeImageInput) {
        recipeImageInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                pendingImageBlob = file;
                const reader = new FileReader();
                reader.onload = (event) => {
                    imagePreview.innerHTML = `<img src="${event.target.result}" alt="Aperçu de la photo">`;
                };
                reader.readAsDataURL(file);
            }
        });
    }

    // Ouvrir le scanner depuis le formulaire
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

    // Soumission du formulaire
    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        if (!supabaseClient) {
            showToast("Sauvegarde impossible, base de données non connectée.", "error");
            return;
        }

        const submitBtn = form.querySelector('.submit-btn');
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Enregistrement en cours...';

        let finalImageUrl = currentRecipeImageUrl;

        // Upload de la nouvelle image / scan si présent
        if (pendingImageBlob) {
            const fileName = `recipe_${Date.now()}_${Math.random().toString(36).substring(2, 9)}.jpg`;
            
            const { data: uploadData, error: uploadError } = await supabaseClient.storage
                .from('recipe-images')
                .upload(fileName, pendingImageBlob, {
                    contentType: 'image/jpeg',
                    upsert: true
                });

            if (uploadError) {
                console.error("Erreur d'upload image:", uploadError);
                showToast("Erreur lors de l'enregistrement de l'image.", "error");
                submitBtn.disabled = false;
                submitBtn.innerHTML = '<i class="fa-solid fa-save"></i> Enregistrer la recette';
                return;
            }

            const { data: publicUrlData } = supabaseClient.storage
                .from('recipe-images')
                .getPublicUrl(fileName);

            finalImageUrl = publicUrlData.publicUrl;
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
    currentRecipeImageUrl = null;
    pendingImageBlob = null;

    document.getElementById('recipeForm').reset();
    document.getElementById('modalTitle').textContent = "Ajouter une recette";
    document.getElementById('imagePreview').innerHTML = '';
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

        const isScan = (recipe.keywords && recipe.keywords.some(k => k.toLowerCase().includes('scan') || k.toLowerCase().includes('manuscrit'))) ||
            (!recipe.content && recipe.image_url);

        let mediaHTML = '';
        if (recipe.image_url) {
            mediaHTML = `
                <div class="recipe-media-preview" title="Cliquer pour voir la recette">
                    <img src="${recipe.image_url}" class="recipe-image-thumb" alt="${recipe.title}">
                    <div class="media-hover-overlay">
                        <i class="fa-solid fa-magnifying-glass-plus"></i>
                    </div>
                </div>`;
        }

        let keywordsHTML = '';
        if (recipe.keywords && recipe.keywords.length > 0) {
            keywordsHTML = recipe.keywords.slice(0, 4).map(k => `<span class="keyword-tag">${k}</span>`).join('');
        }

        card.innerHTML = `
            <div class="card-badges">
                <span class="recipe-type">${typeLabels[recipe.type] || recipe.type}</span>
                ${isScan ? `<span class="recipe-scan-tag"><i class="fa-solid fa-signature"></i> Manuscrit / Scan</span>` : ''}
            </div>

            <h3 class="recipe-title" style="cursor:pointer;" title="Voir la recette">${recipe.title}</h3>

            ${mediaHTML}

            ${keywordsHTML ? `<div class="recipe-keywords">${keywordsHTML}</div>` : ''}

            <p class="recipe-preview" style="cursor:pointer;" title="Voir la recette">
                ${recipe.content ? recipe.content : (recipe.url ? '🔗 Recette via lien externe' : '📜 Recette au format scan manuscrit')}
            </p>

            <div class="recipe-actions">
                <button class="btn ghost-btn view-btn"><i class="fa-solid fa-eye"></i> Voir</button>
                <button class="icon-btn edit-btn" title="Modifier"><i class="fa-solid fa-pen"></i></button>
                ${recipe.url ? `<a href="${recipe.url}" target="_blank" class="icon-btn" title="Ouvrir le lien web"><i class="fa-solid fa-external-link-alt"></i></a>` : ''}
                <button class="icon-btn delete-btn" title="Supprimer" style="color: #f43f5e; margin-left: auto;"><i class="fa-solid fa-trash"></i></button>
            </div>
        `;

        // Événements d'ouverture
        const openView = () => openViewModal(recipe);
        card.querySelector('.recipe-title').addEventListener('click', openView);
        card.querySelector('.recipe-preview').addEventListener('click', openView);
        card.querySelector('.view-btn').addEventListener('click', openView);
        const mediaElem = card.querySelector('.recipe-media-preview');
        if (mediaElem) mediaElem.addEventListener('click', openView);

        // Modification
        card.querySelector('.edit-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            openEditModal(recipe);
        });

        // Suppression
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
let currentZoom = 1;

function openViewModal(recipe) {
    const viewModal = document.getElementById('viewRecipeModal');
    const titleElem = document.getElementById('viewModalTitle');
    const typeElem = document.getElementById('viewModalType');
    const scanBadge = document.getElementById('viewModalScanBadge');
    const keywordsElem = document.getElementById('viewModalKeywords');
    const contentArea = document.getElementById('viewModalContentArea');
    const printBtn = document.getElementById('viewPrintBtn');
    const editBtn = document.getElementById('viewEditBtn');

    titleElem.textContent = recipe.title;

    const typeLabels = {
        'entree': '🥗 Entrée',
        'plat': '🍲 Plat principal',
        'dessert': '🍰 Dessert',
        'boisson': '🍹 Boisson'
    };
    typeElem.textContent = typeLabels[recipe.type] || recipe.type;

    const isScan = (recipe.keywords && recipe.keywords.some(k => k.toLowerCase().includes('scan') || k.toLowerCase().includes('manuscrit'))) ||
        (!recipe.content && recipe.image_url);

    if (isScan) {
        scanBadge.classList.remove('hidden');
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

    let contentHTML = '';

    // Si image / scan présent : afficher le visualiseur avec Zoom HD
    if (recipe.image_url) {
        contentHTML += `
            <div class="scan-hd-viewer-container">
                <div class="scan-toolbar">
                    <span><i class="fa-solid fa-magnifying-glass"></i> Visualiseur HD</span>
                    <div style="display: flex; gap: 0.5rem; align-items: center;">
                        <button type="button" class="icon-control-btn" id="zoomOutBtn" title="Dézoomer"><i class="fa-solid fa-minus"></i></button>
                        <span id="zoomLevelDisplay" style="font-size: 0.8rem; min-width: 45px; text-align: center;">100%</span>
                        <button type="button" class="icon-control-btn" id="zoomInBtn" title="Zoomer"><i class="fa-solid fa-plus"></i></button>
                        <button type="button" class="icon-control-btn" id="zoomResetBtn" title="Réinitialiser le zoom"><i class="fa-solid fa-rotate-left"></i></button>
                    </div>
                </div>
                <div class="zoom-viewport" id="zoomViewport">
                    <img src="${recipe.image_url}" id="hdZoomImage" class="zoom-image" alt="${recipe.title}">
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

    // Configuration des boutons de zoom
    if (recipe.image_url) {
        currentZoom = 1;
        const zoomImg = document.getElementById('hdZoomImage');
        const zoomIn = document.getElementById('zoomInBtn');
        const zoomOut = document.getElementById('zoomOutBtn');
        const zoomReset = document.getElementById('zoomResetBtn');
        const zoomDisplay = document.getElementById('zoomLevelDisplay');
        const viewport = document.getElementById('zoomViewport');

        const updateZoom = (z) => {
            currentZoom = Math.min(3.5, Math.max(0.7, z));
            zoomImg.style.transform = `scale(${currentZoom})`;
            zoomDisplay.textContent = `${Math.round(currentZoom * 100)}%`;
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

    // Bouton imprimer
    printBtn.onclick = () => window.print();

    // Bouton modifier depuis la vue
    editBtn.onclick = () => {
        viewModal.classList.add('hidden');
        openEditModal(recipe);
    };

    viewModal.classList.remove('hidden');
}

function openEditModal(recipe) {
    editingRecipeId = recipe.id;
    currentRecipeImageUrl = recipe.image_url || null;
    pendingImageBlob = null;

    document.getElementById('modalTitle').textContent = "Modifier la recette";
    document.getElementById('recipeTitle').value = recipe.title;
    document.getElementById('recipeType').value = recipe.type;
    document.getElementById('recipeKeywords').value = recipe.keywords ? recipe.keywords.join(', ') : '';
    document.getElementById('recipeContent').value = recipe.content || '';
    document.getElementById('recipeUrl').value = recipe.url || '';

    const imagePreview = document.getElementById('imagePreview');
    imagePreview.innerHTML = currentRecipeImageUrl ? `<img src="${currentRecipeImageUrl}" alt="Aperçu">` : '';

    if (recipe.content) {
        switchFormTab('text-tab');
    } else if (recipe.image_url) {
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
