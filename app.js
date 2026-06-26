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
    rawEmail: document.getElementById('raw-email'),
    rawZip: document.getElementById('raw-zip'),
    rawAddress: document.getElementById('raw-address')
};

// Initialize Application
document.addEventListener('DOMContentLoaded', async () => {
    lucide.createIcons();
    
    try {
        await state.db.init();
        await updateHistoryList();
    } catch (e) {
        console.error('IndexedDB initialization failed', e);
        alert('データベースの初期化に失敗しました。');
    }

    // カメラの初期化
    await initCamera();

    el.selectCamera.addEventListener('change', (e) => {
        if (e.target.value) {
            const selectedOption = el.selectCamera.options[el.selectCamera.selectedIndex];
            const label = selectedOption ? selectedOption.text.toLowerCase() : '';
            // スマホのアウトカメラ（背面）の時は反転させない
            state.isMirrored = label.includes('front') || label.includes('internal') || label.includes('インカメラ') || label.includes('face');
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

// Camera System (★大幅に強化・高画質化)
async function initCamera() {
    try {
        // iOS/Android向けの設定を含む初期リクエスト
        const initialConstraints = { 
            video: { facingMode: { ideal: "environment" } } 
        };
        const tempStream = await navigator.mediaDevices.getUserMedia(initialConstraints);
        tempStream.getTracks().forEach(track => track.stop());

        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = devices.filter(device => device.kind === 'videoinput');

        el.selectCamera.innerHTML = '';
        if (videoDevices.length === 0) {
            setCameraStatus(false, 'カメラが見つかりません');
            el.btnCapture.disabled = true;
            return;
        }

        // 背面カメラ(environment/back/outer)を優先的に探す
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

        // 背面カメラが見つからなければ最後のデバイス（スマホは大体最後が背面）を選択
        if (!targetDeviceId && videoDevices.length > 0) {
            targetDeviceId = videoDevices[videoDevices.length - 1].deviceId;
        } else if (!targetDeviceId) {
            targetDeviceId = videoDevices[0].deviceId;
        }

        el.selectCamera.value = targetDeviceId;
        
        // 背面カメラならミラーリングをオフにする
        const selectedOption = el.selectCamera.options[el.selectCamera.selectedIndex];
        const label = selectedOption ? selectedOption.text.toLowerCase() : '';
        state.isMirrored = label.includes('front') || label.includes('internal') || label.includes('インカメラ');
        updateMirrorState();

        await startCamera(targetDeviceId);
    } catch (e) {
        console.error('Camera access denied or failed:', e);
        setCameraStatus(false, 'カメラへのアクセスが拒否されました');
    }
}

async function startCamera(deviceId) {
    if (state.localStream) {
        state.localStream.getTracks().forEach(track => track.stop());
    }

    // ★スマホのアウトカメラで最大限の高画質（4Kまたは1080p）を出すための設定
    const constraints = {
        video: {
            deviceId: deviceId ? { exact: deviceId } : undefined,
            width: { ideal: 3840, max: 3840 },  // 4Kを理想とし、端末の最大に合わせる
            height: { ideal: 2160, max: 2160 },
            frameRate: { ideal: 30 }
        },
        audio: false
    };

    try {
        state.localStream = await navigator.mediaDevices.getUserMedia(constraints);
        el.video.srcObject = state.localStream;
        setCameraStatus(true, 'カメラ動作中 (高解像度モード)');
    } catch (e) {
        console.error('Failed to start camera with standard resolution, retrying fallback...', e);
        // 万が一超高解像度でエラーが出た場合のフォールバック（自動調整）
        try {