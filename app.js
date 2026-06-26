class CardDB {
    constructor() { this.dbName = 'SmartCardScannerDB'; this.storeName = 'cards'; this.db = null; }
    init() { return new Promise(res => { const r = indexedDB.open(this.dbName, 1); r.onsuccess = e => { this.db = e.target.result; res(); }; r.onupgradeneeded = e => { if (!e.target.result.objectStoreNames.contains(this.storeName)) e.target.result.createObjectStore(this.storeName, { keyPath: 'id' }); }; }); }
    getAllCards() { return new Promise(res => { this.db.transaction([this.storeName], 'readonly').objectStore(this.storeName).getAll().onsuccess = e => res(e.target.result.sort((a, b) => b.createdAt - a.createdAt)); }); }
    saveCard(c) { return new Promise(res => { this.db.transaction([this.storeName], 'readwrite').objectStore(this.storeName).put(c).onsuccess = () => res(); }); }
    clearAll() { return new Promise(res => { this.db.transaction([this.storeName], 'readwrite').objectStore(this.storeName).clear().onsuccess = () => res(); }); }
}
const state = { db: new CardDB(), localStream: null, currentCaptureBase64: null, tesseractWorker: null, isMirrored: false };
const el = {
    video: document.getElementById('video-preview'), selectCamera: document.getElementById('select-camera'), btnCapture: document.getElementById('btn-capture'), btnSaveCard: document.getElementById('btn-save-card'), btnClearHistory: document.getElementById('btn-clear-history'), btnMirror: document.getElementById('btn-mirror'), canvas: document.getElementById('capture-canvas'), previewImg: document.getElementById('capture-preview-img'), previewPlaceholder: document.getElementById('preview-placeholder'), historyList: document.getElementById('history-list'), historyCount: document.getElementById('history-count'), cameraStatus: document.getElementById('camera-status'),
    progressContainer: document.getElementById('ocr-progress-container'), progressStatus: document.getElementById('ocr-status-text'), progressPercent: document.getElementById('ocr-percent-text'), progressBar: document.getElementById('ocr-progress-bar'),
    editCompany: document.getElementById('edit-company'), editName: document.getElementById('edit-name'), editLandline: document.getElementById('edit-landline'), editMobile: document.getElementById('edit-mobile'), editEmail: document.getElementById('edit-email'), editZip: document.getElementById('edit-zip'), editAddress: document.getElementById('edit-address'), editMemo: document.getElementById('edit-memo'),
    rawCompany: document.getElementById('raw-company'), rawName: document.getElementById('raw-name'), rawLandline: document.getElementById('raw-landline'), rawMobile: document.getElementById('raw-mobile'), rawEmail: document.getElementById('raw-email'), rawZip: document.getElementById('raw-zip'), rawAddress: document.getElementById('raw-address')
};
document.addEventListener('DOMContentLoaded', async () => {
    if (typeof lucide !== 'undefined') lucide.createIcons();
    try { await state.db.init(); await updateHistoryList(); } catch (e) {}
    await initCamera();
    el.selectCamera.addEventListener('change', e => { if (e.target.value) { const lbl = el.selectCamera.options[el.selectCamera.selectedIndex].text.toLowerCase(); state.isMirrored = lbl.includes('front') || lbl.includes('internal') || lbl.includes('イン') || lbl.includes('face'); el.video.style.transform = state.isMirrored ? 'scaleX(-1)' : 'scaleX(1)'; startCamera(e.target.value); } });
    el.btnCapture.addEventListener('click', captureAndProcessOCR); el.btnSaveCard.addEventListener('click', saveCurrentCard); el.btnClearHistory.addEventListener('click', clearHistory);
    el.btnMirror.addEventListener('click', () => { state.isMirrored = !state.isMirrored; el.video.style.transform = state.isMirrored ? 'scaleX(-1)' : 'scaleX(1)'; });
    [el.editCompany, el.editName, el.editLandline, el.editMobile, el.editEmail, el.editZip, el.editAddress, el.editMemo].forEach(i => { if (i) i.addEventListener('input', () => { if (state.currentCaptureBase64) el.btnSaveCard.disabled = false; }); });
});
async function initCamera() {
    try {
        const temp = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } }); temp.getTracks().forEach(t => t.stop());
        const devices = await navigator.mediaDevices.enumerateDevices(); const videoDevices = devices.filter(d => d.kind === 'videoinput'); el.selectCamera.innerHTML = '';
        if (videoDevices.length === 0) return setCameraStatus(false, 'カメラなし');
        let targetId = null;
        videoDevices.forEach(d => {
            const opt = document.createElement('option'); opt.value = d.deviceId; opt.text = d.label || `カメラ ${el.selectCamera.length + 1}`; el.selectCamera.appendChild(opt);
            const lbl = opt.text.toLowerCase(); if (lbl.includes('back') || lbl.includes('environment') || lbl.includes('背面') || lbl.includes('アウト')) targetId = d.deviceId;
        });
        if (!targetId && videoDevices.length > 0) targetId = videoDevices[videoDevices.length - 1].deviceId;
        el.selectCamera.value = targetId; await startCamera(targetId);
    } catch (e) {
        try { state.localStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: 1920, height: 1080 } }); el.video.srcObject = state.localStream; setCameraStatus(true, 'カメラ動作中'); } catch (err) { setCameraStatus(false, 'アクセス拒否'); }
    }
}
async function startCamera(id) {
    if (state.localStream) state.localStream.getTracks().forEach(t => t.stop());
    try { state.localStream = await navigator.mediaDevices.getUserMedia({ video: { deviceId: id ? { exact: id } : undefined, width: 1920, height: 1080 }, audio: false }); el.video.srcObject = state.localStream; setCameraStatus(true, '背面カメラ起動完了'); } catch (e) {
        try { state.localStream = await navigator.mediaDevices.getUserMedia({ video: { deviceId: id } }); el.video.srcObject = state.localStream; setCameraStatus(true, '背面カメラ起動完了'); } catch (err) { setCameraStatus(false, '起動失敗'); }
    }
}
function setCameraStatus(on, txt) { if (el.cameraStatus) { el.cameraStatus.className = on ? 'status-indicator online' : 'status-indicator offline'; el.cameraStatus.querySelector('.status-text').textContent = txt; el.btnCapture.disabled = !on; } }
async function captureAndProcessOCR() {
    if (!state.localStream) return;
    const w = el.video.videoWidth || 1280, h = el.video.videoHeight || 720; el.canvas.width = w; el.canvas.height = h;
    const ctx = el.canvas.getContext('2d'); if (state.isMirrored) { ctx.translate(w, 0); ctx.scale(-1, 1); } ctx.drawImage(el.video, 0, 0, w, h);
    state.currentCaptureBase64 = el.canvas.toDataURL('image/jpeg', 0.95); el.previewImg.src = state.currentCaptureBase64; el.previewImg.style.display = 'block'; el.previewPlaceholder.style.display = 'none';
    await runOCR(state.currentCaptureBase64);
}
async function runOCR(src) {
    el.progressContainer.style.display = 'block'; el.progressStatus.textContent = 'OCR初期化中...'; el.progressPercent.textContent = '10%'; el.progressBar.style.width = '10%';
    try {
        if (!state.tesseractWorker) {
            state.tesseractWorker = await Tesseract.createWorker('jpn+eng', 1, {
                workerPath: 'https://unpkg.com', corePath: 'https://unpkg.com',
                logger: m => { if (m.status === 'recognizing text') { const p = Math.floor(m.progress * 100); el.progressStatus.textContent = '文字を認識中...'; el.progressPercent.textContent = `${p}%`; el.progressBar.style.width = `${p}%`; } }
            });
        }
        const ret = await state.tesseractWorker.recognize(src); el.progressStatus.textContent = '解析完了'; el.progressPercent.textContent = '100%'; el.progressBar.style.width = '100%';
        parseAndFillFields(ret.data.text); el.btnSaveCard.disabled = false; setTimeout(() => { el.progressContainer.style.display = 'none'; }, 2000);
    } catch (e) { el.progressStatus.textContent = 'エラーが発生しました'; el.progressPercent.textContent = '0%'; el.progressBar.style.width = '0%'; }
}
function parseAndFillFields(text) {
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    ['Company', 'Name', 'Landline', 'Mobile', 'Email', 'Zip', 'Address'].forEach(f => { if (el[`edit${f}`]) el[`edit${f}`].value = ''; if (el[`raw${f}`]) el[`raw${f}`].textContent = '-'; });
    const em = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/, mb = /(090|080|070)-\d{4}-\d{4}|(090|080|070)\d{8}/, ll = /0\d{1,4}-\d{1,4}-\d{4}/, zp = /〒?\s?\d{3}-\d{4}/;
    lines.forEach(l => {
        if (em.test(l)) { const m = l.match(em); if(el.editEmail) el.editEmail.value = m; if(el.rawEmail) el.rawEmail.textContent = m; }
        else if (mb.test(l)) { const m = l.match(mb); if(el.editMobile) el.editMobile.value = m; if(el.rawMobile) el.rawMobile.textContent = m; }
        else if (ll.test(l)) { const m = l.match(ll); if(el.editLandline) el.editLandline.value = m; if(el.rawLandline) el.rawLandline.textContent = m; }
        else if (zp.test(l)) { const m = l.match(zp); if(el.editZip) el.editZip.value = m; if(el.rawZip) el.rawZip.textContent = m; }
    });
    if (lines.length > 0 && el.editName) { el.editName.value = lines[0]; el.rawName.textContent = lines[0]; }
    if (lines.length > 1 && el.editCompany) { el.editCompany.value = lines[1]; el.rawCompany.textContent = lines[1]; }
}
async function updateHistoryList() {
    const cards = await state.db.getAllCards(); el.historyCount.textContent = `${cards.length} 件`;
    if (cards.length === 0) { el.historyList.innerHTML = '<div class="empty-state"><p>保存された名刺はありません</p></div>'; el.btnExportZip.disabled = true; el.btnClearHistory.disabled = true; return; }
    el.btnExportZip.disabled = false; el.btnClearHistory.disabled = false; el.historyList.innerHTML = '';
    cards.forEach(c => { const item = document.createElement('div'); item.className = 'history-item'; item.innerHTML = `<div><strong>${c.name || '名前なし'}</strong><br><small>${c.company || '会社名なし'}</small></div>`; el.historyList.appendChild(item); });
}
async function saveCurrentCard() {
    await state.db.saveCard({ id: Date.now().toString(), company: el.editCompany.value, name: el.editName.value, landline: el.editLandline.value, mobile: el.editMobile.value, email: el.editEmail.value, zip: el.editZip.value, address: el.editAddress.value, memo: el.editMemo.value, image: state.currentCaptureBase64, createdAt: Date.now() });
    await updateHistoryList(); alert('保存しました！');
}
async function clearHistory() { if(confirm('すべての履歴を削除しますか？')) { await state.db.clearAll(); await updateHistoryList(); } }
