// Database (IndexedDB) Wrapper
class CardDB {
    constructor() {
        this.dbName = 'SmartCardScannerDB';
        this.dbVersion = 1;
        this.storeName = 'cards';
        this.db = null;
    }

    init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.dbVersion);

            request.onerror = (event) => {
                console.error('Database error:', event.target.error);
                reject(event.target.error);
            };

            request.onsuccess = (event) => {
                this.db = event.target.result;
                resolve();
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains(this.storeName)) {
                    db.createObjectStore(this.storeName, { keyPath: 'id' });
                }
            };
        });
    }

    getAllCards() {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readonly');
            const store = transaction.objectStore(this.storeName);
            const request = store.getAll();

            request.onsuccess = () => {
                const cards = request.result.sort((a, b) => b.createdAt - a.createdAt);
                resolve(cards);
            };

            request.onerror = (event) => {
                reject(event.target.error);
            };
        });
    }

    saveCard(card) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readwrite');
            const store = transaction.objectStore(this.storeName);
            const request = store.put(card);

            request.onsuccess = () => {
                resolve();
            };

            request.onerror = (event) => {
                reject(event.target.error);
            };
        });
    }

    deleteCard(id) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readwrite');
            const store = transaction.objectStore(this.storeName);
            const request = store.delete(id);

            request.onsuccess = () => {
                resolve();
            };

            request.onerror = (event) => {
                reject(event.target.error);
            };
        });
    }

    clearAll() {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readwrite');
            const store = transaction.objectStore(this.storeName);
            const request = store.clear();

            request.onsuccess = () => {
                resolve();
            };

            request.onerror = (event) => {
                reject(event.target.error);
            };
        });
    }
}

// Global Application State
const state = {
    db: new CardDB(),
    localStream: null,
    currentCaptureBlob: null,
    currentCaptureBase64: null,
    activeCardId: null,
    tesseractWorker: null,
    isMirrored: false
};

// UI Elements
const el = {
    video: document.getElementById('video-preview'),
    selectCamera: document.getElementById('select-camera'),
    btnCapture: document.getElementById('btn-capture'),
    btnSaveCard: document.getElementById('btn-save-card'),
    btnExportZip: document.getElementById('btn-export-zip'),
    btnClearHistory: document.getElementById('btn-clear-history'),
    btnMirror: document.getElementById('btn-mirror'),
    canvas: document.getElementById('capture-canvas'),
    previewImg: document.getElementById('capture-preview-img'),
    previewPlaceholder: document.getElementById('preview-placeholder'),
    historyList: document.getElementById('history-list'),
    historyCount: document.getElementById('history-count'),
    cameraStatus: document.getElementById('camera-status'),
    
    progressContainer: document.getElementById('ocr-progress-container'),
    progressStatus: document.getElementById('ocr-status-text'),
    progressPercent: document.getElementById('ocr-percent-text'),
    progressBar: document.getElementById('ocr-progress-bar'),

    editCompany: document.getElementById('edit-company'),
    editName: document.getElementById('edit-name'),
    editLandline: document.getElementById('edit-landline'),
    editMobile: document.getElementById('edit-mobile'),
    editEmail: document.getElementById('edit-email'),
    editZip: document.getElementById('edit-zip'),
    editAddress: document.getElementById('edit-address'),
    editMemo: document.getElementById('edit-memo'),
    rawOcrOutput: document.getElementById('raw-ocr-output'),

    rawCompany: document.getElementById('raw-company'),
    rawName: document.getElementById('raw-name'),
    rawLandline: document.getElementById('raw-landline'),
    rawMobile: document.getElementById('raw-mobile'),
    rawEmail: document.githubio || document.getElementById('raw-email'),
    rawZip: document.getElementById('raw-zip'),
    rawAddress: document.getElementById('raw-address')
};

// Initialize Application
document.addEventListener('DOMContentLoaded', async () => {
    if (typeof lucide !== 'undefined') {
        lucide.createIcons();
    }
    
    try {
        await state.db.init();
        await updateHistoryList();
    } catch (e) {
        console.error('IndexedDB initialization failed', e);
    }

    await initCamera();

    el.selectCamera.addEventListener('change', (e) => {
        if (e.target.value) {
            const selectedOption = el.selectCamera.options[el.selectCamera.selectedIndex];
            const label = selectedOption ? selectedOption.text.toLowerCase() : '';
            state.isMirrored = label.includes('front') || label.includes('internal') || label.includes('イン') || label.includes('face');
            updateMirrorState();
            startCamera(e.target.value);
        }
    });

    el.btnCapture.addEventListener('click', captureAndProcessOCR);
    el.btnSaveCard.addEventListener('click', saveCurrentCard);
    el.btnExportZip.addEventListener('click', exportToZip);
    el.btnClearHistory.addEventListener('click', clearHistory);

    el.btnMirror.addEventListener('click', () => {
        state.isMirrored = !state.isMirrored;
        updateMirrorState();
    });

    const formInputs = [el.editCompany, el.editName, el.editLandline, el.editMobile, el.editEmail, el.editZip, el.editAddress, el.editMemo];
    formInputs.forEach(input => {
        if (input) {
            input.addEventListener('input', () => {
                if (state.currentCaptureBase64) {
                    el.btnSaveCard.disabled = false;
                }
            });
        }
    });
});
async function initCamera() {
    try {
        setCameraStatus(false, 'カメラを初期化中...');
        const tempStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        tempStream.getTracks().forEach(track => track.stop());

        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = devices.filter(device => device.kind === 'videoinput');

        el.selectCamera.innerHTML = '';
        if (videoDevices.length === 0) {
            setCameraStatus(false, '有効なカメラが見つかりません');
            return;
        }

        let targetDeviceId = null;
        videoDevices.forEach(device => {
            const option = document.createElement('option');
            option.value = device.deviceId;
            option.text = device.label || `カメラ ${el.selectCamera.length + 1}`;
            el.selectCamera.appendChild(option);

            const labelLower = option.text.toLowerCase();
            if (labelLower.includes('back') || labelLower.includes('environment') || labelLower.includes('背面') || labelLower.includes('アウト')) {
                targetDeviceId = device.deviceId;
            }
        });

        if (!targetDeviceId && videoDevices.length > 0) {
            targetDeviceId = videoDevices[videoDevices.length - 1].deviceId;
        }

        el.selectCamera.value = targetDeviceId;
        state.isMirrored = false;
        updateMirrorState();

        await startCamera(targetDeviceId);
    } catch (e) {
        console.error('Camera init failed, trying direct stream...', e);
        try {
            state.localStream = await navigator.mediaDevices.getUserMedia({ 
                video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } } 
            });
            el.video.srcObject = state.localStream;
            setCameraStatus(true, 'カメラ動作中 (標準モード)');
        } catch (err) {
            setCameraStatus(false, 'アクセスが拒否されました。設定を確認してください。');
        }
    }
}

async function startCamera(deviceId) {
    if (state.localStream) {
        state.localStream.getTracks().forEach(track => track.stop());
    }

    const constraints = {
        video: {
            deviceId: deviceId ? { exact: deviceId } : undefined,
            width: { ideal: 1920 },
            height: { ideal: 1080 }
        },
        audio: false
    };

    try {
        state.localStream = await navigator.mediaDevices.getUserMedia(constraints);
        el.video.srcObject = state.localStream;
        setCameraStatus(true, '背面カメラ起動完了');
    } catch (e) {
        console.error('Resolution failed, trying auto...', e);
        try {
            state.localStream = await navigator.mediaDevices.getUserMedia({ video: { deviceId: deviceId } });
            el.video.srcObject = state.localStream;
            setCameraStatus(true, '背面カメラ起動完了 (自動解像度)');
        } catch (err) {
            setCameraStatus(false, 'カメラの映像を取得できませんでした');
        }
    }
}

function setCameraStatus(isOnline, text) {
    if (!el.cameraStatus) return;
    if (isOnline) {
        el.cameraStatus.className = 'status-indicator online';
        el.cameraStatus.querySelector('.status-text').textContent = text;
        el.btnCapture.disabled = false;
    } else {
        el.cameraStatus.className = 'status-indicator offline';
        el.cameraStatus.querySelector('.status-text').textContent = text;
        el.btnCapture.disabled = true;
    }
}

function updateMirrorState() {
    if (!el.video) return;
    el.video.style.transform = state.isMirrored ? 'scaleX(-1)' : 'scaleX(1)';
}

async function captureAndProcessOCR() {
    if (!state.localStream) return;

    const width = el.video.videoWidth || 1280;
    const height = el.video.videoHeight || 720;

    el.canvas.width = width;
    el.canvas.height = height;

    const ctx = el.canvas.getContext('2d');
    if (state.isMirrored) {
        ctx.translate(width, 0);
        ctx.scale(-1, 1);
    }
    ctx.drawImage(el.video, 0, 0, width, height);

    const dataUrl = el.canvas.toDataURL('image/jpeg', 0.95);
    state.currentCaptureBase64 = dataUrl;
    el.previewImg.src = dataUrl;
    el.previewImg.style.display = 'block';
    el.previewPlaceholder.style.display = 'none';

    el.canvas.toBlob((blob) => {
        state.currentCaptureBlob = blob;
    }, 'image/jpeg', 0.95);

    await runOCR(dataUrl);
}

async function runOCR(imageSrc) {
    el.progressContainer.style.display = 'block';
    updateProgress('OCR初期化中...', 10);

    try {
        if (!state.tesseractWorker) {
            state.tesseractWorker = await Tesseract.createWorker('jpn+eng');
        }
        
        updateProgress('文字を認識中...', 40);
        const ret = await state.tesseractWorker.recognize(imageSrc);
        updateProgress('解析完了', 100);

        const text = ret.data.text;
        parseAndFillFields(text);
        
        el.btnSaveCard.disabled = false;
        setTimeout(() => { el.progressContainer.style.display = 'none'; }, 2000);
    } catch (e) {
        console.error(e);
        updateProgress('エラーが発生しました', 0);
    }
}

function updateProgress(status, percent) {
    el.progressStatus.textContent = status;
    el.progressPercent.textContent = `${percent}%`;
    el.progressBar.style.width = `${percent}%`;
}

function parseAndFillFields(text) {
    const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    
    const fields = ['Company', 'Name', 'Landline', 'Mobile', 'Email', 'Zip', 'Address'];
    fields.forEach(f => {
        if (el[`edit${f}`]) el[`edit${f}`].value = '';
        if (el[`raw${f}`]) el[`raw${f}`].textContent = '-';
    });

    const emailReg = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
    const mobileReg = /(090|080|070)-\d{4}-\d{4}|(090|080|070)\d{8}/;
    const landReg = /0\d{1,4}-\d{1,4}-\d{4}/;
    const zipReg = /〒?\s?\d{3}-\d{4}/;

    lines.forEach(line => {
        if (emailReg.test(line)) {
            const match = line.match(emailReg);
            if(el.editEmail) el.editEmail.value = match;
            if(el.rawEmail) el.rawEmail.textContent = match;
        } else if (mobileReg.test(line)) {
            const match = line.match(mobileReg);
            if(el.editMobile) el.editMobile.value = match;
            if(el.rawMobile) el.rawMobile.textContent = match;
        } else if (landReg.test(line)) {
            const match = line.match(landReg);
            if(el.editLandline) el.editLandline.value = match;
            if(el.rawLandline) el.rawLandline.textContent = match;
        } else if (zipReg.test(line)) {
            const match = line.match(zipReg);
            if(el.editZip) el.editZip.value = match;
            if(el.rawZip) el.rawZip.textContent = match;
        }
    });

    if (lines.length > 0 && el.editName) { el.editName.value = lines[0]; el.rawName.textContent = lines[0]; }
    if (lines.length > 1 && el.editCompany) { el.editCompany.value = lines[1]; el.rawCompany.textContent = lines[1]; }
}

async function updateHistoryList() {
    const cards = await state.db.getAllCards();
    el.historyCount.textContent = `${cards.length} 件`;
    
    if (cards.length === 0) {
        el.historyList.innerHTML = '<div class="empty-state"><p>保存された名刺はありません</p></div>';
        el.btnExportZip.disabled = true;
        el.btnClearHistory.disabled = true;
        return;
    }
    
    el.btnExportZip.disabled = false;
    el.btnClearHistory.disabled = false;
    el.historyList.innerHTML = '';
    
    cards.forEach(card => {
        const item = document.createElement('div');
        item.className = 'history-item';
        item.innerHTML = `<div><strong>${card.name || '名前なし'}</strong><br><small>${card.company || '会社名なし'}</small></div>`;
        el.historyList.appendChild(item);
    });
}

async function saveCurrentCard() {
    const card = {
        id: state.activeCardId || Date.now().toString(),
        company: el.editCompany.value,
        name: el.editName.value,
        landline: el.editLandline.value,
        mobile: el.editMobile.value,
        email: el.editEmail.value,
        zip: el.editZip.value,
        address: el.editAddress.value,
        memo: el.editMemo.value,
        image: state.currentCaptureBase64,
        createdAt: Date.now()
    };
    await state.db.saveCard(card);
    await updateHistoryList();
    alert('保存しました！');
}

async function exportToZip() { alert('ZIPエクスポート機能'); }
async function clearHistory() { 
    if(confirm('すべての履歴を削除しますか？')) {
        await state.db.clearAll();
        await updateHistoryList();
    }
}
