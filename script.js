// ================== 全域設定 ==================
const CONFIG = {
  // ⚠️ 重要：改成你的 Worker 網址
  API_ENDPOINT: 'https://confined-space-api.firework202511.workers.dev',
  MAX_PDF_SIZE_MB: 10,
};

// 常用照片（存 R2，可跨次帶出）
const PERSISTENT_KEYS = ['signage', 'license1', 'license2', 'rescue'];
 
// 上傳項目定義
const UPLOAD_ITEMS = {
  before: [
    { k: 'kaohsiung',   label: '高市檢申報擷取畫面' },
    { k: 'permit',      label: '局限空間進入許可證' },
    { k: 'checklist1',  label: '作業前作業場所檢點表' },
    { k: 'checklist2',  label: '作業前作業安全檢核表' },
    { k: 'ventilation', label: '通風設備' },
    { k: 'gas',         label: '氣體偵測器' },
    { k: 'rescue',      label: '急救設備及空氣呼吸器',  persistent: true },
    { k: 'signage',     label: '作業場所告示牌',        persistent: true },
    { k: 'license1',    label: '缺氧作業主管證照',      persistent: true },
    { k: 'license2',    label: '急救人員證照',          persistent: true },
  ],
  mid: [
    { k: 'cctv',       label: 'CCTV 監看螢幕畫面' },
    { k: 'access_mid', label: '人員進出管制表' },
  ],
  after: [
    { k: 'access_after', label: '人員進出管制表' },
    { k: 'site_end',     label: '現場結束後狀況' },
  ],
};
 
// 全域狀態
const S = {
  dd: [],                // dropdown data
  files: {},             // before 圖片 { k: [File,...] }
  filesMid: {},          // mid 圖片
  filesAfter: {},        // after 圖片
  beforeFields: null,    // 作業前填寫的欄位（供作業中/後自動帶入）
  midAutoFields: null,   // 從 Worker 查回的作業前記錄（作業中用）
  afterAutoFields: null, // 從 Worker 查回的作業前記錄（作業後用）
  G_PDF_B64: '',         // 最後一次產生的 PDF base64
  lastBeforeRecord: null, // 上次作業前記錄（自動帶入用）
  persistentUrls: {},    // 常用照片的現有 R2 URL { signage, license1, license2, rescue }
  persistentB64:  {},    // 常用照片的 base64（本次上傳或 fetch 後緩存，優先用於 PDF）
};
 
// ================== 初始化 ==================
async function initApp() {
  try {
    const res  = await fetch(`${CONFIG.API_ENDPOINT}/api/dropdown-data`);
    const data = await res.json();
    S.dd = data.dropdowns || [];
    fillAllCompanySelects();
    // 查詢頁預設今日
    const todayEl = document.getElementById('queryDate');
    if (todayEl) todayEl.value = getTodayDateString();
  } catch (err) {
    console.error('初始化失敗:', err);
    alert('載入下拉選單失敗，請重新整理頁面');
  }
  // 建立上傳格子
  buildUploadGrid('before');
  buildUploadGrid('mid');
  buildUploadGrid('after');
}
 
function getTodayDateString() {
  return new Date().toLocaleDateString('zh-TW', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit'
  }).replace(/\//g, '-');
}
 
// ================== 下拉選單 ==================
function fillAllCompanySelects() {
  const cos = [...new Set(S.dd.map(r => r.company))].sort();
 
  // 作業前/中/後：加「其他」選項；查詢頁不加
  ['beforeCompany', 'midCompany', 'afterCompany'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = '<option value="">— 請選擇公司 —</option>';
    cos.forEach(c => el.add(new Option(c, c)));
    el.add(new Option('其他（手動輸入）', '__other__'));
  });
 
  // 查詢頁：只列公司，不加「其他」
  const qEl = document.getElementById('queryCompany');
  if (qEl) {
    qEl.innerHTML = '<option value="">— 全部 —</option>';
    cos.forEach(c => qEl.add(new Option(c, c)));
  }
}
 
function onCompanyChange(phase) {
  const co    = document.getElementById(phase + 'Company').value;
  const prjEl = document.getElementById(phase + 'Project');
 
  // ── 處理「其他」：顯示手動輸入區 ──────────────────
  if (phase === 'before') {
    const manualBox = document.getElementById('beforeManualBox');
    if (manualBox) manualBox.style.display = (co === '__other__') ? 'block' : 'none';
    if (co === '__other__') {
      prjEl.innerHTML = '<option value="">—</option>';
      prjEl.disabled = true;
      document.getElementById('beforeDept').value    = '';
      document.getElementById('beforeSection').value = '';
      updateProceedBtn('before');
      return;
    }
  }
 
  prjEl.innerHTML = '<option value="">請選擇工程</option>';
  prjEl.disabled  = !co;
  if (!co) return;
 
  const projs = [...new Set(S.dd.filter(r => r.company === co).map(r => r.project))].sort();
  projs.forEach(p => prjEl.add(new Option(p, p)));
  prjEl.add(new Option('其他（手動輸入）', '__other__'));
 
  // 作業前：同步部門課別
  if (phase === 'before') {
    document.getElementById('beforeDept').value    = '';
    document.getElementById('beforeSection').value = '';
    updateProceedBtn('before');
  }
 
  // 工程選好後的處理
  prjEl.onchange = () => {
    const prj = prjEl.value;
 
    // 處理工程「其他」
    if (phase === 'before') {
      const manualBox = document.getElementById('beforeManualBox');
      if (manualBox) manualBox.style.display = (prj === '__other__') ? 'block' : 'none';
      if (prj === '__other__') {
        document.getElementById('beforeDept').value    = '';
        document.getElementById('beforeSection').value = '';
        updateProceedBtn('before');
        return;
      }
      const m = S.dd.find(r => r.company === co && r.project === prj);
      document.getElementById('beforeDept').value    = m?.dept    || '';
      document.getElementById('beforeSection').value = m?.section || '';
      fetchLastBeforeRecord(co, prj);
      updateProceedBtn('before');
    }
    if (phase === 'mid' || phase === 'after') fetchBeforeRecord(phase);
  };
}
 
function updateProceedBtn(phase) {
  const coSel  = document.getElementById('beforeCompany').value;
  const prjSel = document.getElementById('beforeProject').value;
 
  let hasCompany, hasProject;
  if (coSel === '__other__') {
    // 手動輸入：讀手動欄位
    hasCompany  = document.getElementById('manualCompany')?.value.trim();
    hasProject  = document.getElementById('manualProject')?.value.trim();
  } else if (prjSel === '__other__') {
    hasCompany  = !!coSel;
    hasProject  = document.getElementById('manualProject')?.value.trim();
  } else {
    hasCompany  = !!coSel;
    hasProject  = !!prjSel;
  }
 
  document.getElementById('btnBeforeNext').disabled = !(hasCompany && hasProject);
}
 
// ================== 自動帶入上次作業前記錄 ==================
async function fetchLastBeforeRecord(company, project) {
  if (!company || !project) return;
 
  // 顯示查詢中提示
  const hintEl = document.getElementById('beforeLastHint');
  if (hintEl) {
    hintEl.textContent = '🔍 查詢上次記錄中...';
    hintEl.style.color = '#2952c8';
    hintEl.style.display = 'block';
  }
 
  try {
    const url = new URL(`${CONFIG.API_ENDPOINT}/api/get-last-before`);
    url.searchParams.set('company', company);
    url.searchParams.set('project', project);
    const res  = await fetch(url);
    const data = await res.json();
 
    if (!data.found || !data.record) {
      S.lastBeforeRecord = null;
      if (hintEl) {
        hintEl.textContent = '📝 查無上次記錄，請手動填寫';
        hintEl.style.color = '#888';
      }
      return;
    }
 
    const rec = data.record;
    S.lastBeforeRecord = rec;
 
    // 帶入欄位（保留可編輯）
    setVal('beforeInspector', rec.inspector);
    setVal('beforeOxygen',    rec.oxygenSupervisor);
    setVal('beforePhone',     rec.phone);
    setVal('beforeArea',      rec.workArea);
    setVal('beforeDetail',    rec.workDetail);
 
    // ★ 帶入常用照片預覽
    if (rec.persistentPhotos) {
      S.persistentUrls = rec.persistentPhotos;
      loadPersistentPreviews(rec.persistentPhotos);
    }
    // 時間欄位：只帶入上次的時間部分（HH:MM），日期改為今日
    if (rec.startTime) {
      const timePart = rec.startTime.includes('T')
        ? rec.startTime.split('T')[1]?.slice(0, 5)
        : rec.startTime.slice(11, 16);
      const todayStr = new Date().toLocaleDateString('zh-TW', {
        timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit'
      }).replace(/\//g, '-');
      if (timePart) setVal('beforeStart', `${todayStr}T${timePart}`);
    }
    if (rec.endTime) {
      const timePart = rec.endTime.includes('T')
        ? rec.endTime.split('T')[1]?.slice(0, 5)
        : rec.endTime.slice(11, 16);
      const todayStr = new Date().toLocaleDateString('zh-TW', {
        timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit'
      }).replace(/\//g, '-');
      if (timePart) setVal('beforeEnd', `${todayStr}T${timePart}`);
    }
 
    if (hintEl) {
      const lastDate = (rec.uploadTime || rec.startTime || '').slice(0, 10);
      hintEl.innerHTML = `✅ 已帶入上次記錄（${lastDate}），可直接修改各欄位`;
      hintEl.style.color = '#0f7b5a';
    }
 
  } catch (err) {
    console.warn('fetchLastBeforeRecord 失敗:', err);
    S.lastBeforeRecord = null;
    if (hintEl) {
      hintEl.textContent = '⚠️ 查詢上次記錄失敗，請手動填寫';
      hintEl.style.color = '#b45309';
    }
  }
}
 
function setVal(id, val) {
  const el = document.getElementById(id);
  if (el && val !== undefined && val !== null) el.value = val;
}
 
// ================== 子頁面切換 ==================
async function goToUpload(phase) {
  // 驗證必填
  const inspector = val('beforeInspector');
  const oxygen    = val('beforeOxygen');
  const phone     = val('beforePhone');
  const start     = val('beforeStart');
  const end       = val('beforeEnd');
  const area      = val('beforeArea');
  const detail    = val('beforeDetail');
 
  if (!inspector || !oxygen || !phone || !start || !end || !area || !detail) {
    alert('請填寫所有必填欄位（姓名、主管、聯絡方式、時間、地點）');
    return;
  }
 
  // 讀取公司/工程（含「其他」手動輸入）
  const coSel  = val('beforeCompany');
  const prjSel = val('beforeProject');
 
  // 公司：__other__ → 讀手動欄位；否則用下拉值
  const company = (coSel === '__other__')
    ? val('manualCompany').trim()
    : coSel;
 
  // 工程：下拉或手動欄位（公司是「其他」時工程也一律讀手動）
  const project = (coSel === '__other__' || prjSel === '__other__')
    ? val('manualProject').trim()
    : prjSel;
 
  // 部門課別：「其他」時讀手動欄位，否則讀 beforeDept/beforeSection
  const dept    = (coSel === '__other__')
    ? val('manualDept').trim()
    : val('beforeDept');
  const section = (coSel === '__other__')
    ? val('manualSection').trim()
    : val('beforeSection');
 
  if (!company) { alert('請填寫公司名稱'); return; }
  if (!project) { alert('請填寫工程名稱'); return; }
 
  // 若手動輸入，自動存入 DROPDOWNDATA
  if (coSel === '__other__' || prjSel === '__other__') {
    try {
      await fetch(`${CONFIG.API_ENDPOINT}/api/add-dropdown`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company, project, dept, section })
      });
      // 同步更新本地 dd
      if (!S.dd.some(r => r.company === company && r.project === project)) {
        S.dd.push({ company, project, dept, section });
        fillAllCompanySelects();
      }
    } catch(e) { console.warn('更新 DROPDOWNDATA 失敗:', e); }
  }
 
  // 儲存到全域（供 PDF 及作業中/後使用）
  S.beforeFields = {
    company, project, dept, section,
    inspector, oxygenSupervisor: oxygen, phone,
    startTime: start, endTime: end,
    workArea:  area,  workDetail: detail,
  };
 
  // 更新 Auto Info Box
  document.getElementById('bai_company').textContent   = S.beforeFields.company;
  document.getElementById('bai_project').textContent   = S.beforeFields.project;
  document.getElementById('bai_inspector').textContent = inspector;
  document.getElementById('bai_oxygen').textContent    = oxygen;
  document.getElementById('bai_area').textContent      = area;
  document.getElementById('bai_detail').textContent    = detail;
 
  // 切換子頁面
  document.getElementById('beforePageA').style.display = 'none';
  document.getElementById('beforePageB').style.display = 'block';
 
  // 更新步驟指示
  stepDone('bStep1'); stepActive('bStep2');
  document.getElementById('bLine1').classList.add('ok');
}
 
function backToForm(phase) {
  document.getElementById('beforePageA').style.display = 'block';
  document.getElementById('beforePageB').style.display = 'none';
  stepActive('bStep1'); stepReset('bStep2'); stepReset('bStep3');
  document.getElementById('bLine1').classList.remove('ok');
  document.getElementById('bLine2').classList.remove('ok');
}
 
function stepActive(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove('ok'); el.classList.add('on');
}
function stepDone(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove('on'); el.classList.add('ok');
  el.querySelector('.step-dot').textContent = '✓';
}
function stepReset(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove('on', 'ok');
  const num = el.querySelector('.step-dot');
  if (num) num.textContent = num.dataset.num || '?';
}
 
// ================== 作業中/後 查詢作業前記錄 ==================
async function fetchBeforeRecord(phase) {
  const company = val(phase + 'Company');
  const project = val(phase + 'Project');
  const warnEl  = document.getElementById(phase + 'Warn');
  const autoBox = document.getElementById(phase + 'AutoBox');
  const uploadsEl = document.getElementById(phase + 'Uploads');
  const submitBtn = document.getElementById('btn' + cap(phase) + 'Submit');
 
  if (!company || !project) return;
 
  warnEl.classList.remove('show');
  autoBox.style.display = 'none';
  uploadsEl.style.display = 'none';
  submitBtn.disabled = true;
  submitBtn.style.opacity = '0.5';
 
  try {
    const url = new URL(`${CONFIG.API_ENDPOINT}/api/get-today-before`);
    url.searchParams.set('company', company);
    url.searchParams.set('project', project);
    const res  = await fetch(url);
    const data = await res.json();
 
    if (!data.found || !data.record) {
      warnEl.classList.add('show');
      return;
    }
 
    const rec = data.record;
    const prefix = phase === 'mid' ? 'mai_' : 'aai_';
 
    document.getElementById(prefix + 'inspector').textContent = rec.inspector        || '—';
    document.getElementById(prefix + 'oxygen').textContent    = rec.oxygenSupervisor || '—';
    document.getElementById(prefix + 'phone').textContent     = rec.phone             || '—';
    document.getElementById(prefix + 'area').textContent      = rec.workArea          || '—';
    document.getElementById(prefix + 'detail').textContent    = rec.workDetail        || '—';
    document.getElementById(prefix + 'start').textContent     = (rec.startTime || '').replace('T', ' ');
 
    autoBox.style.display   = 'grid';
    uploadsEl.style.display = 'block';
    submitBtn.disabled      = false;
    submitBtn.style.opacity = '1';
 
    // 存到全域
    if (phase === 'mid')   S.midAutoFields   = rec;
    if (phase === 'after') S.afterAutoFields = rec;
 
  } catch (err) {
    console.error('查詢作業前記錄失敗:', err);
    warnEl.classList.add('show');
  }
}
 
function cap(str) { return str.charAt(0).toUpperCase() + str.slice(1); }
 
// ================== 上傳格子建立 ==================
function buildUploadGrid(phase) {
  const items     = UPLOAD_ITEMS[phase];
  const containerId = phase + 'Uploads';
  const container = document.getElementById(containerId);
  if (!container) return;
 
  container.innerHTML = `<div style="display:grid;grid-template-columns:1fr 1fr;gap:13px;margin-bottom:16px">` +
    items.map((item, i) => {
      const isPersistent = phase === 'before' && item.persistent;
      const badge = isPersistent
        ? `<span style="font-size:.6rem;background:#ebfaf4;color:#0f7b5a;border-radius:3px;padding:1px 5px;font-weight:700;border:1px solid #0f7b5a">可帶出</span>`
        : `<span style="font-size:.62rem;background:#fdf2f1;color:#c0392b;border-radius:3px;padding:1px 5px;font-weight:600;">必填</span>`;
      return `
      <div id="box_${phase}_${item.k}"
           style="border:1.5px dashed ${isPersistent ? '#0f7b5a' : '#ccc'};border-radius:10px;padding:14px;background:${isPersistent ? '#f0faf6' : '#f5f6f8'};"
           ondragover="event.preventDefault()" ondrop="onDrop(event,'${item.k}','${phase}')">
        <div style="font-size:.78rem;font-weight:700;color:#555;margin-bottom:8px;display:flex;align-items:center;gap:6px;">
          <span style="width:19px;height:19px;border-radius:50%;background:${isPersistent ? '#0f7b5a' : '#2952c8'};color:#fff;font-size:.65rem;font-weight:700;display:inline-flex;align-items:center;justify-content:center;">${i+1}</span>
          ${item.label}
          ${badge}
        </div>
        <div style="border:1px dashed #ccc;border-radius:6px;padding:10px;text-align:center;cursor:pointer;background:#fff;"
             onclick="document.getElementById('fi_${phase}_${item.k}').click()">
          <input type="file" id="fi_${phase}_${item.k}" multiple accept="image/*"
                 style="display:none" onchange="onFile('${item.k}',this.files,'${phase}')">
          <div>📎</div><div style="font-size:.7rem;color:#888">拖放或點選覆蓋</div>
          <div style="font-size:.74rem;color:#2952c8;font-weight:600">僅限圖片檔</div>
        </div>
        <div id="pv_${phase}_${item.k}" style="display:flex;flex-wrap:wrap;gap:5px;margin-top:7px"></div>
      </div>`;
    }).join('') + `</div>`;
}
 
function onDrop(e, k, phase) {
  e.preventDefault();
  if (e.dataTransfer.files.length) onFile(k, e.dataTransfer.files, phase);
}
 
function onFile(k, fl, phase) {
  const store = phase === 'before' ? S.files : (phase === 'mid' ? S.filesMid : S.filesAfter);
  if (!store[k]) store[k] = [];
  Array.from(fl).forEach(f => store[k].push(f));
  renderPreviews(k, phase);
  const box = document.getElementById(`box_${phase}_${k}`);
  if (box) box.style.borderColor = store[k].length ? '#0f7b5a' : '#ccc';
  S.G_PDF_B64 = ''; // 圖片變更後需重新生成
}
 
function renderPreviews(k, phase) {
  const store = phase === 'before' ? S.files : (phase === 'mid' ? S.filesMid : S.filesAfter);
  const el = document.getElementById(`pv_${phase}_${k}`);
  if (!el) return;
  el.innerHTML = (store[k] || []).map((f, i) => `
    <div style="position:relative;border-radius:6px;overflow:hidden;border:1px solid #ddd;">
      ${f.type.startsWith('image/') ? `<img src="${URL.createObjectURL(f)}" style="width:54px;height:54px;object-fit:cover;display:block">` : `<div style="width:54px;height:54px;display:flex;align-items:center;justify-content:center;background:#eef2fc;font-size:1.1rem">📄</div>`}
      <button onclick="rmFile('${k}',${i},'${phase}')"
        style="position:absolute;top:2px;right:2px;width:15px;height:15px;border-radius:50%;background:rgba(0,0,0,.55);color:#fff;font-size:.58rem;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;">✕</button>
    </div>`).join('');
}
 
function rmFile(k, i, phase) {
  const store = phase === 'before' ? S.files : (phase === 'mid' ? S.filesMid : S.filesAfter);
  store[k].splice(i, 1);
  renderPreviews(k, phase);
  const box = document.getElementById(`box_${phase}_${k}`);
  if (box) box.style.borderColor = (store[k]?.length) ? '#0f7b5a' : '#ccc';
}
 
// ================== 常用照片帶入預覽 ==================
// 從 R2 URL 帶入常用照片的縮圖預覽（不需重新上傳就能使用）
// 同時在背景 fetch 成 base64 緩存，避免 PDF 生成時的 CORS 問題
function loadPersistentPreviews(photoUrls) {
  PERSISTENT_KEYS.forEach(k => {
    const url = photoUrls[k];
    if (!url) return;
    const pvEl = document.getElementById(`pv_before_${k}`);
    const boxEl = document.getElementById(`box_before_${k}`);
    if (!pvEl) return;
 
    // 若使用者已自行上傳新圖，不覆蓋
    if (S.files[k] && S.files[k].length > 0) return;
 
    // 標記此格為「使用既有 R2 圖片」
    if (!S.persistentUrls[k]) S.persistentUrls[k] = url;
 
    // ★ 背景 fetch 成 base64 緩存，PDF 生成時直接用（無 CORS 問題）
    if (!S.persistentB64[k]) {
      fetch(url)
        .then(r => r.ok ? r.blob() : Promise.reject(r.status))
        .then(blob => new Promise((res, rej) => {
          const reader = new FileReader();
          reader.onload  = e => res(e.target.result);
          reader.onerror = rej;
          reader.readAsDataURL(blob);
        }))
        .then(b64 => { S.persistentB64[k] = b64; })
        .catch(e => console.warn(`預載 ${k} 失敗:`, e));
    }
 
    pvEl.innerHTML = `
      <div style="position:relative;border-radius:6px;overflow:hidden;border:2px solid #0f7b5a;">
        <img src="${url}" style="width:54px;height:54px;object-fit:cover;display:block"
             onerror="this.parentElement.style.display='none'">
        <div style="position:absolute;bottom:0;left:0;right:0;background:rgba(15,123,90,.8);color:#fff;font-size:.5rem;text-align:center;padding:1px 0;">上次</div>
        <button onclick="clearPersistentPreview('${k}')"
          style="position:absolute;top:2px;right:2px;width:15px;height:15px;border-radius:50%;background:rgba(192,57,43,.85);color:#fff;font-size:.58rem;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;">✕</button>
      </div>`;
    if (boxEl) {
      boxEl.style.borderColor = '#0f7b5a';
      boxEl.style.borderStyle = 'solid';
    }
  });
}
 
// 使用者點 ✕ 清除帶入的常用照片（改為重新上傳）
function clearPersistentPreview(k) {
  delete S.persistentUrls[k];
  const pvEl  = document.getElementById(`pv_before_${k}`);
  const boxEl = document.getElementById(`box_before_${k}`);
  if (pvEl)  pvEl.innerHTML = '';
  if (boxEl) { boxEl.style.borderColor = '#ccc'; boxEl.style.borderStyle = 'dashed'; }
}
 
// ================== 圖片壓縮工具 ==================
// 壓縮到 800px 寬、JPEG 0.65 品質後回傳 base64（不含 data: 前綴）
async function compressImage(file, maxWidth = 800, quality = 0.65) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('讀取失敗'));
    reader.onload  = e => {
      const img = new Image();
      img.onerror = () => reject(new Error('圖片載入失敗'));
      img.onload  = () => {
        const scale  = Math.min(1, maxWidth / img.width);
        const canvas = document.createElement('canvas');
        canvas.width  = Math.round(img.width  * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'medium';
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        resolve(dataUrl.split(',')[1]); // 只回傳 base64 本體
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}
 
// ================== PDF 生成 + 上傳 ==================
async function generateAndSubmit(phase) {
  const items = UPLOAD_ITEMS[phase];
  const store = phase === 'before' ? S.files : (phase === 'mid' ? S.filesMid : S.filesAfter);
 
  // 檢查所有必填圖片
  // 常用照片：新上傳 File 或已有既有 R2 URL，二者之一即可
  const missing = items.filter(it => {
    const hasNewFile = store[it.k] && store[it.k].length > 0;
    const hasPersistent = phase === 'before' && it.persistent && S.persistentUrls[it.k];
    return !hasNewFile && !hasPersistent;
  });
  if (missing.length > 0) {
    alert(`以下項目尚未上傳圖片：\n${missing.map(m => '• ' + m.label).join('\n')}`);
    return;
  }
 
  const loadingEl = document.getElementById(phase + 'Loading');
  const msgEl     = document.getElementById(phase + 'Msg');
  const submitBtn = document.getElementById('btn' + cap(phase) + 'Submit');
 
  loadingEl.style.display = 'block';
  submitBtn.disabled = true;
  submitBtn.textContent = '⏳ 處理中...';
  msgEl.textContent = '';
 
  try {
    const f    = getFieldsForPhase(phase);
    const phLbl = { before:'作業前', mid:'作業中', after:'作業後' }[phase];
 
    // ── Step 1（作業前）：先上傳常用照片到 R2 ─────
    if (phase === 'before') {
      msgEl.textContent = '☁️ 正在儲存常用照片...';
      // 壓縮 4 張常用照片（有新上傳的才壓縮；沿用舊的傳 null）
      const persistentPayload = {};
      for (const k of PERSISTENT_KEYS) {
        if (S.files[k] && S.files[k].length > 0) {
          // 有新圖片 → 壓縮後上傳，並緩存 base64 供本次 PDF 使用
          const b64 = await compressImage(S.files[k][0]);
          persistentPayload[k] = b64;
          S.persistentB64[k]   = 'data:image/jpeg;base64,' + b64; // 緩存完整 dataURL
        } else {
          // 沿用既有 R2 圖片 → 傳 null
          persistentPayload[k] = null;
        }
      }
      const pRes = await fetch(`${CONFIG.API_ENDPOINT}/api/upload-persistent-photos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project: f.project, photos: persistentPayload })
      });
      if (!pRes.ok) throw new Error('常用照片上傳失敗');
      const pData = await pRes.json();
      // 更新全域常用照片 URL（供 PDF 渲染使用）
      S.persistentUrls = pData.urls || {};
    }
 
    // ── Step 2: 生成 PDF ───────────────────────────
    msgEl.textContent = '📄 正在生成 PDF...';
    const pdfB64 = await generatePDF(phase, items, store);
    S.G_PDF_B64 = pdfB64;
 
    // 顯示預覽按鈕（僅作業前）
    if (phase === 'before') {
      document.getElementById('beforePdfArea').classList.add('show');
    }
 
    // ── Step 3: 上傳 PDF 至 R2 ────────────────────
    msgEl.textContent = '☁️ 正在上傳 PDF...';
    const filename = `局限作業_${phLbl}_${f.project || ''}_${f.inspector || ''}.pdf`;
    const uploadRes = await fetch(`${CONFIG.API_ENDPOINT}/api/upload-pdf`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pdfBase64: pdfB64, filename })
    });
    if (!uploadRes.ok) throw new Error('PDF 上傳失敗');
    const { pdfUrl } = await uploadRes.json();
 
    // ── Step 4: 寫入 Google Sheets ────────────────
    msgEl.textContent = '📊 正在寫入 Google Sheets...';
    const actionMap = { before: '/api/submit-before', mid: '/api/submit-mid', after: '/api/submit-after' };
    const submitRes = await fetch(`${CONFIG.API_ENDPOINT}${actionMap[phase]}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: f, pdfUrl })
    });
    if (!submitRes.ok) throw new Error('寫入 Sheets 失敗');
 
    // 成功
    loadingEl.style.display = 'none';
    msgEl.style.color = '#0f7b5a';
    msgEl.textContent = '✅ 通報成功！PDF 已儲存至雲端。';
    submitBtn.textContent = '✅ 已送出';
 
    // 作業前完成後可繼續用於作業中/後
    if (phase === 'before') {
      stepDone('bStep2'); stepActive('bStep3');
      document.getElementById('bLine2').classList.add('ok');
    }
 
  } catch (err) {
    console.error('送出失敗:', err);
    loadingEl.style.display = 'none';
    msgEl.style.color = '#c0392b';
    msgEl.textContent = '❌ 送出失敗：' + err.message;
    submitBtn.disabled = false;
    submitBtn.textContent = '🚀 生成 PDF 並上傳送出';
  }
}
 
function getFieldsForPhase(phase) {
  if (phase === 'before') return S.beforeFields || {};
  if (phase === 'mid')    return { ...(S.midAutoFields || {}),   company: val('midCompany'),   project: val('midProject') };
  if (phase === 'after')  return { ...(S.afterAutoFields || {}), company: val('afterCompany'), project: val('afterProject') };
  return {};
}
 
// ================== PDF 生成（逐元素排版，圖片不跨頁）==================
// 策略：
//   ① 基本資料表用 html2canvas 截成一塊 headerCanvas
//   ② 每張照片各自截成獨立 imgCanvas
//   ③ 放置每個 canvas 前先算剩餘頁高是否足夠，不夠就 addPage
//   → 每個元素都完整，永遠不會被分頁裁斷
async function generatePDF(phase, items, store) {
  const f        = getFieldsForPhase(phase);
  const phLbl    = { before:'作業前', mid:'作業中', after:'作業後' }[phase];
  const phColor  = { before:'#2952c8', mid:'#6d28d9', after:'#0d7490' }[phase];
  const phBg     = { before:'#eef2fc', mid:'#f5f3ff', after:'#ecfeff' }[phase];
  const TH = 'border:1px solid #cbd5e1;padding:8px 10px;background:#f8fafc;color:#334155;width:20%;vertical-align:top';
  const TD = 'border:1px solid #cbd5e1;padding:8px 10px;vertical-align:top';
  const RENDER_W = 780; // 渲染容器寬度（px）
 
  // ── Step 1: 讀取所有圖片 ──────────────────────────────────────────
  // R2 URL 沒有 CORS header → html2canvas 直接用 URL 會截出空白
  // 解法：先用 fetch 把 R2 圖片讀成 base64 dataURL，再交給 html2canvas
  async function urlToBase64(url) {
    try {
      const res  = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload  = e => resolve(e.target.result);
        reader.onerror = () => reject(new Error('FileReader 失敗'));
        reader.readAsDataURL(blob);
      });
    } catch(e) {
      console.warn('R2 圖片讀取失敗，將顯示為空白:', url, e);
      return null; // 讀取失敗時回傳 null，後續跳過該圖
    }
  }
 
  const imgMap = {};
  for (const item of items) {
    const files = (store[item.k] || []).filter(fi => fi.type && fi.type.startsWith('image/'));
    if (files.length > 0) {
      // 本次新上傳的圖片：直接讀成 dataURL
      imgMap[item.k] = await Promise.all(files.map(fileToDataUrl));
    } else if (phase === 'before' && item.persistent) {
      // 常用照片：優先用記憶體緩存（本次壓縮的 base64），其次 fetch R2 URL
      if (S.persistentB64[item.k]) {
        imgMap[item.k] = [S.persistentB64[item.k]]; // 直接用緩存，100% 無 CORS 問題
      } else if (S.persistentUrls[item.k]) {
        const b64 = await urlToBase64(S.persistentUrls[item.k]);
        if (b64) S.persistentB64[item.k] = b64;     // 成功 fetch 後也緩存
        imgMap[item.k] = b64 ? [b64] : [];
      } else {
        imgMap[item.k] = [];
      }
    } else {
      imgMap[item.k] = [];
    }
  }
 
  // ── 工具：將 DOM 元素截圖為 canvas ────────────────────────────────
  async function domToCanvas(el) {
    return html2canvas(el, {
      scale: 2, useCORS: true, allowTaint: true,
      backgroundColor: '#ffffff', logging: false
    });
  }
 
  // ── 工具：臨時掛載隱藏元素 ────────────────────────────────────────
  function mountHidden(el) {
    el.style.cssText += `position:fixed;left:-9999px;top:0;width:${RENDER_W}px;box-sizing:border-box;background:#fff;`;
    document.body.appendChild(el);
    return el;
  }
  function unmount(el) { document.body.removeChild(el); }
 
  // ── Step 2: 截圖基本資料表頭 ─────────────────────────────────────
  const headerEl = document.createElement('div');
  headerEl.style.fontFamily = 'Arial, sans-serif';
  headerEl.style.fontSize   = '13px';
  headerEl.style.lineHeight = '1.6';
  headerEl.style.color      = '#111';
  headerEl.innerHTML = `
    <div style="text-align:center;margin-bottom:20px;border-bottom:3px solid ${phColor};padding-bottom:12px">
      <h1 style="margin:0;color:#1d3d9e;font-size:20px">局限空間作業通報書</h1>
      <div style="font-size:11px;color:#555;margin-top:3px">Confined Space Work Notification Report</div>
      <span style="display:inline-block;margin-top:6px;padding:2px 12px;border-radius:20px;font-size:11px;font-weight:700;background:${phBg};color:${phColor};border:1px solid ${phColor}">📌 ${phLbl}通報</span>
    </div>
    <div style="text-align:right;font-size:10px;color:#888;margin-bottom:10px">產出時間：${new Date().toLocaleString('zh-TW', { timeZone:'Asia/Taipei' })}</div>
    <div style="background:#eef2fc;font-weight:bold;color:#2952c8;padding:6px 10px;margin-bottom:6px;border-left:4px solid #2952c8;font-size:12px">基本資料</div>
    <table style="width:100%;border-collapse:collapse;margin-bottom:8px;font-size:11px">
      <tr><th style="${TH}">承攬商公司</th><td style="${TD}">${f.company||'—'}</td><th style="${TH}">工程名稱</th><td style="${TD}">${f.project||'—'}</td></tr>
      <tr><th style="${TH}">主辦部門</th><td style="${TD}">${f.dept||'—'}</td><th style="${TH}">主辦課別</th><td style="${TD}">${f.section||'—'}</td></tr>
      <tr><th style="${TH}">檢驗員</th><td style="${TD}">${f.inspector||'—'}</td><th style="${TH}">缺氧作業主管</th><td style="${TD}">${f.oxygenSupervisor||'—'}</td></tr>
      <tr><th style="${TH}">聯絡方式</th><td style="${TD}">${f.phone||'—'}</td><th style="${TH}">上傳時機</th><td style="${TD};font-weight:700;color:${phColor}">${phLbl}通報</td></tr>
      <tr><th style="${TH}">開始時間</th><td style="${TD}">${(f.startTime||'').replace('T',' ')}</td><th style="${TH}">結束時間</th><td style="${TD}">${(f.endTime||'').replace('T',' ')}</td></tr>
      <tr><th style="${TH}">作業區域</th><td style="${TD}">${f.workArea||'—'}</td><th style="${TH}">詳細位置</th><td style="${TD}">${f.workDetail||'—'}</td></tr>
    </table>
    <div style="background:#eef2fc;font-weight:bold;color:#2952c8;padding:6px 10px;border-left:4px solid #2952c8;font-size:12px">查核照片與附件（${phLbl}）</div>`;
  mountHidden(headerEl);
  const headerCanvas = await domToCanvas(headerEl);
  unmount(headerEl);
 
  // ── Step 3: 每張照片各自截圖（含標籤）────────────────────────────
  // 每個格子：一張圖 + 標籤文字，自適應高度
  const photoCanvases = []; // [{ canvas, label }]
  for (const item of items) {
    const srcs = imgMap[item.k] || [];
    for (const src of srcs) {
      const cell = document.createElement('div');
      cell.style.fontFamily  = 'Arial, sans-serif';
      cell.style.fontSize    = '12px';
      cell.style.textAlign   = 'center';
      cell.style.padding     = '8px';
      cell.style.border      = '1px solid #ddd';
      cell.style.background  = '#fff';
      cell.innerHTML = `
        <img src="${src}" crossorigin="anonymous"
             style="max-width:100%;height:auto;display:block;margin:0 auto">
        <div style="font-weight:bold;margin-top:6px;color:#334155">${item.label}</div>`;
      mountHidden(cell);
      const c = await domToCanvas(cell);
      unmount(cell);
      photoCanvases.push(c);
    }
  }
 
  // ── Step 4: 組合 PDF（逐塊放置，圖片不跨頁）─────────────────────
  const { jsPDF } = window.jspdf;
  const pdf   = new jsPDF({ orientation:'portrait', unit:'mm', format:'a4' });
  const A4_W  = 210;
  const A4_H  = 297;
  const MARGIN = 10; // mm 上下左右邊距
  const CONTENT_W = A4_W - MARGIN * 2;
  const CONTENT_H = A4_H - MARGIN * 2;
  const SCALE     = RENDER_W / 2; // canvas scale:2，CSS px = canvas.width / 2
 
  let curY = MARGIN; // 目前在 PDF 上的 Y 位置（mm）
 
  // 放置一個 canvas 到 PDF，若空間不足先換頁
  function placeCanvas(c, gapBefore = 3) {
    const cssW  = c.width  / 2; // CSS px
    const cssH  = c.height / 2;
    const mmW   = CONTENT_W;
    const mmH   = cssH * (CONTENT_W / cssW); // 按比例換算 mm 高度
 
    // 換頁判斷：若放下去會超出頁面
    if (curY + gapBefore + mmH > A4_H - MARGIN) {
      pdf.addPage();
      curY = MARGIN;
    } else {
      curY += gapBefore;
    }
 
    pdf.addImage(c.toDataURL('image/jpeg', 0.92), 'JPEG', MARGIN, curY, mmW, mmH);
    curY += mmH;
  }
 
  // 放表頭
  placeCanvas(headerCanvas, 0);
 
  // 兩欄放照片：先收集本行兩張，合成後放入
  // 為了不讓兩欄圖片被分到不同頁，改為單欄排列（更安全，圖片也更清晰）
  for (const c of photoCanvases) {
    placeCanvas(c, 4);
  }
 
  return pdf.output('datauristring').split(',')[1];
}
 
function fileToDataUrl(file) {
  return new Promise(res => {
    const r = new FileReader();
    r.onload = e => res(e.target.result);
    r.readAsDataURL(file);
  });
}
 
function previewPDF() {
  if (!S.G_PDF_B64) { alert('請先生成 PDF'); return; }
  const bytes = atob(S.G_PDF_B64);
  const buf = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) buf[i] = bytes.charCodeAt(i);
  window.open(URL.createObjectURL(new Blob([buf], { type: 'application/pdf' })), '_blank');
}
 
// ================== 查詢邏輯 ==================
async function searchRecords() {
  const date    = val('queryDate');
  const company = val('queryCompany');
  const phase   = val('queryPhase');
  const insp    = val('queryInspector');
  const div     = document.getElementById('queryResults');
 
  if (!date && !company) {
    alert('請至少輸入「查詢日期」或選擇「公司名稱」');
    return;
  }
 
  document.getElementById('queryLoading').style.display = 'block';
  div.innerHTML = '';
 
  try {
    const url = new URL(`${CONFIG.API_ENDPOINT}/api/search-records`);
    if (date)    url.searchParams.set('date', date);
    if (company) url.searchParams.set('company', company);
    if (phase)   url.searchParams.set('phase', phase);
    if (insp)    url.searchParams.set('inspector', insp);
 
    const res  = await fetch(url);
    const json = await res.json();
 
    if (json.error) throw new Error(json.error);
    if (!json.data || json.data.length === 0) {
      div.innerHTML = '<div class="no-results">查無資料</div>';
      return;
    }
 
    const phaseInfo = {
      before: { label:'作業前', cls:'badge-before' },
      mid:    { label:'作業中', cls:'badge-mid' },
      after:  { label:'作業後', cls:'badge-after' },
    };
 
    let html = `<table class="result-table">
      <thead><tr>
        <th>時機</th><th>公司</th><th>工程</th><th>檢驗員</th>
        <th>開始時間</th><th>作業地點</th><th>PDF</th>
      </tr></thead><tbody>`;
 
    json.data.forEach(row => {
      const pi   = phaseInfo[row.phase] || { label: row.phase || '—', cls: '' };
      const pdfLink = row.pdfUrl
        ? `<a href="${row.pdfUrl}" target="_blank" style="color:#2952c8;font-weight:600;">📄 查看</a>`
        : '-';
      html += `<tr>
        <td><span class="badge ${pi.cls}">${pi.label}</span></td>
        <td>${row.company || '-'}</td>
        <td>${row.project || '-'}</td>
        <td>${row.inspector || '-'}</td>
        <td>${(row.startTime || '').replace('T', ' ')}</td>
        <td>${row.workArea || '-'} ${row.workDetail || ''}</td>
        <td>${pdfLink}</td>
      </tr>`;
    });
 
    div.innerHTML = html + '</tbody></table>';
  } catch (err) {
    console.error(err);
    div.innerHTML = `<div style="text-align:center;color:red;padding:20px">查詢錯誤: ${err.message}</div>`;
  } finally {
    document.getElementById('queryLoading').style.display = 'none';
  }
}
 
// ================== 工具 ==================
function val(id) { return document.getElementById(id)?.value || ''; }
 
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
