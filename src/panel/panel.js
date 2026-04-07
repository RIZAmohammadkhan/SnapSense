/* global snapsense */

const chatEl = document.getElementById('chat');
const shotText = document.getElementById('shot-text');
const msgEl = document.getElementById('msg');
const sendBtn = document.getElementById('send');
const typingEl = document.getElementById('typing');
const bannerEl = document.getElementById('banner');
const bannerTextEl = document.getElementById('banner-text');
const bannerConfigureBtn = document.getElementById('banner-configure-key');
const btnClose = document.getElementById('btn-close');
const btnApiSettings = document.getElementById('btn-api-settings');
const sectionAi = document.getElementById('section-ai');
const sectionText = document.getElementById('section-text');
const sectionLens = document.getElementById('section-lens');
const modeLabel = document.getElementById('mode-label');
const appWrap = document.getElementById('app-wrap');
const textChatEl = document.getElementById('text-chat');
const textStatusEl = document.getElementById('text-status');
const textOutputEl = document.getElementById('text-output');
const textCopyBtn = document.getElementById('text-copy');
const textLoadingEl = document.getElementById('text-loading');
const textResultEl = document.getElementById('text-result');
const textErrorEl = document.getElementById('text-error');
const lensWebview = document.getElementById('lens-view');
const lensOpenExternalBtn = document.getElementById('lens-open-browser');
const lensLoadingEl = document.getElementById('lens-loading');
const lensErrorEl = document.getElementById('lens-error');
const modelModeSelect = document.getElementById('ai-model-mode');
const modelSelectWrap = document.querySelector('.model-select-wrap');
const apiSettingsEl = document.getElementById('api-settings');
const apiKeyStatusEl = document.getElementById('api-key-status');
const apiKeyNoteEl = document.getElementById('api-key-note');
const groqKeyInput = document.getElementById('groq-key-input');
const groqKeySaveBtn = document.getElementById('groq-key-save');
const groqKeyClearBtn = document.getElementById('groq-key-clear');

let imageDataUrl = '';
let messages = [];
let busy = false;
let activeLensUrl = 'https://lens.google.com/';
let aiLoadingEl = null;
/** Until first real http(s) page finishes loading after assigning Lens URL */
let lensSessionPending = false;
/** While main process is uploading — ignore webview load events from the previous page. */
let lensUploadPhase = false;
/** Open default browser once if embedded Lens cannot load (Google often blocks webviews). */
let lensEmbedFallbackOpened = false;
let apiSettingsOpen = false;
let groqKeyState = null;

/** Plain text for Copy (OCR may include markdown-style text we render as HTML). */
let lastExtractedPlainText = '';

const mdEngine = window.marked;
if (mdEngine && mdEngine.setOptions) {
  mdEngine.setOptions({
    gfm: true,
    breaks: true
  });
}

function toPrettyText(value) {
  if (typeof value !== 'string') {
    return String(value || '');
  }
  const trimmed = value.trim();
  if (!trimmed) return '';
  try {
    const parsed = JSON.parse(trimmed);
    return `\`\`\`json\n${JSON.stringify(parsed, null, 2)}\n\`\`\``;
  } catch {
    return value;
  }
}

function renderMarkdown(text) {
  const source = toPrettyText(text);
  const rawHtml = mdEngine ? mdEngine.parse(source) : source;
  return window.DOMPurify.sanitize(rawHtml);
}

/** Approximate typing speed for assistant replies (characters per second). */
const ASSISTANT_STREAM_CPS = 82;
/** Text-extract result reveal speed (rendered markdown in a div). */
const TEXT_EXTRACT_STREAM_CPS = 95;

/**
 * Reveal markdown progressively: each frame re-parses the prefix so lists/formatting
 * update continuously (not raw `**` syntax).
 */
function streamMarkdownReveal(el, fullText, cps, scrollEl) {
  const text = typeof fullText === 'string' ? fullText : String(fullText ?? '');
  return new Promise((resolve) => {
    el.innerHTML = '';
    if (!text.length) {
      resolve();
      return;
    }
    const t0 = performance.now();
    function tick(now) {
      const n = Math.min(text.length, Math.floor(((now - t0) / 1000) * cps));
      el.innerHTML = renderMarkdown(text.slice(0, n));
      if (scrollEl) {
        scrollEl.scrollTop = scrollEl.scrollHeight;
      }
      if (n < text.length) {
        requestAnimationFrame(tick);
      } else {
        resolve();
      }
    }
    requestAnimationFrame(tick);
  });
}

/**
 * Reveal assistant reply as markdown during streaming; keeps chat scrolled to bottom.
 */
function streamAssistantReply(fullText) {
  const text = typeof fullText === 'string' ? fullText : String(fullText ?? '');
  clearAiLoadingSkeleton();

  const wrap = document.createElement('div');
  wrap.className = 'bubble assistant';
  const body = document.createElement('div');
  body.className = 'bubble-body';
  wrap.appendChild(body);
  chatEl.appendChild(wrap);

  if (!text.length) {
    body.innerHTML = renderMarkdown('');
    chatEl.scrollTop = chatEl.scrollHeight;
    return Promise.resolve();
  }

  return streamMarkdownReveal(body, text, ASSISTANT_STREAM_CPS, chatEl).then(() => {
    chatEl.scrollTo({ top: chatEl.scrollHeight, behavior: 'smooth' });
  });
}

function appendBubble(role, text, extraClass) {
  const wrap = document.createElement('div');
  wrap.className = `bubble ${role}${extraClass ? ` ${extraClass}` : ''}`;
  const body = document.createElement('div');
  body.className = 'bubble-body';
  if (role === 'assistant' && !extraClass) {
    body.innerHTML = renderMarkdown(text);
  } else {
    body.textContent = text;
  }
  wrap.appendChild(body);
  chatEl.appendChild(wrap);
  chatEl.scrollTop = chatEl.scrollHeight;
}

/** User message with screenshot only (prompt text is sent to the API but not shown). */
function appendUserCaptureInChat(imageDataUrl) {
  const wrap = document.createElement('div');
  wrap.className = 'bubble user';
  const body = document.createElement('div');
  body.className = 'bubble-body user-capture-msg user-capture-img-only';
  const img = document.createElement('img');
  img.className = 'chat-inline-capture';
  img.src = imageDataUrl;
  img.alt = '';
  body.appendChild(img);
  wrap.appendChild(body);
  chatEl.appendChild(wrap);
  chatEl.scrollTop = chatEl.scrollHeight;
}

function aiLoadingSkeletonHtml() {
  return `
    <div class="bubble-body shimmer-bubble-inner shimmer-text-only">
      <div class="shimmer-line shimmer-title w-35"></div>
      <div class="shimmer-line w-100 d1"></div>
      <div class="shimmer-line w-94 d2"></div>
      <div class="shimmer-line w-88 d3"></div>
      <div class="shimmer-line w-76 d4"></div>
      <div class="shimmer-line w-90 d5"></div>
    </div>
  `;
}

function addAiLoadingSkeleton() {
  if (aiLoadingEl) {
    aiLoadingEl.remove();
  }
  aiLoadingEl = document.createElement('div');
  aiLoadingEl.className = 'bubble assistant loading';
  aiLoadingEl.innerHTML = aiLoadingSkeletonHtml();
  chatEl.appendChild(aiLoadingEl);
  chatEl.scrollTop = chatEl.scrollHeight;
}

function clearAiLoadingSkeleton() {
  if (aiLoadingEl) {
    aiLoadingEl.remove();
    aiLoadingEl = null;
  }
}

function setTyping(on) {
  typingEl.hidden = !on;
}

async function syncModelSelectFromMain() {
  if (!modelModeSelect) return;
  try {
    const { mode } = await window.snapsense.getModelMode();
    if (mode === 'groq' || mode === 'test') {
      modelModeSelect.value = mode;
    }
  } catch {
    /* ignore */
  }
}

async function refreshApiBanner() {
  try {
    const { mode } = await window.snapsense.getModelMode();
    if (mode === 'test') {
      bannerEl.classList.remove('visible');
      bannerConfigureBtn.hidden = true;
      return;
    }
    const s = await window.snapsense.getApiKeyStatus();
    if (s.isDummy || !s.configured) {
      bannerTextEl.textContent = 'Groq API key is missing or invalid.';
      bannerConfigureBtn.hidden = false;
      bannerEl.classList.add('visible');
    } else {
      bannerTextEl.textContent = '';
      bannerConfigureBtn.hidden = true;
      bannerEl.classList.remove('visible');
    }
  } catch {
    bannerTextEl.textContent = '';
    bannerConfigureBtn.hidden = true;
    bannerEl.classList.remove('visible');
  }
}

function setApiSettingsOpen(open) {
  apiSettingsOpen = Boolean(open);
  const visible = apiSettingsOpen && appWrap?.dataset.mode === 'ai';
  if (apiSettingsEl) {
    apiSettingsEl.hidden = !visible;
  }
  if (btnApiSettings) {
    btnApiSettings.classList.toggle('active', visible);
  }
}

function focusGroqKeyInput() {
  if (!groqKeyInput) return;
  groqKeyInput.focus();
  groqKeyInput.select();
}

function renderGroqKeyState(state, noteOverride = '') {
  groqKeyState = state || null;
  if (!apiKeyStatusEl || !apiKeyNoteEl || !groqKeyClearBtn || !groqKeyInput) return;

  if (!state || state.source === 'none') {
    apiKeyStatusEl.textContent = 'No Groq key saved yet.';
    apiKeyNoteEl.textContent =
      noteOverride || 'Saved locally in your SnapSense app data for this device profile.';
    groqKeyInput.placeholder = 'Paste Groq API key';
    groqKeyClearBtn.disabled = true;
    return;
  }

  if (state.isDummy) {
    if (state.source === 'saved') {
      apiKeyStatusEl.textContent = 'Saved Groq key looks invalid.';
      apiKeyNoteEl.textContent =
        noteOverride || 'Replace or clear the saved key to restore AI mode.';
      groqKeyInput.placeholder = 'Replace saved Groq API key';
      groqKeyClearBtn.disabled = false;
      return;
    }
    apiKeyStatusEl.textContent = 'Environment Groq key looks invalid.';
    apiKeyNoteEl.textContent =
      noteOverride || 'Save a valid key here to override the environment key for SnapSense.';
    groqKeyInput.placeholder = 'Save a local Groq API key';
    groqKeyClearBtn.disabled = true;
    return;
  }

  if (state.source === 'saved') {
    apiKeyStatusEl.textContent = 'Groq key saved locally.';
    apiKeyNoteEl.textContent =
      noteOverride || 'This stored key is used by SnapSense on this device.';
    groqKeyInput.placeholder = 'Replace saved Groq API key';
    groqKeyClearBtn.disabled = false;
    return;
  }

  apiKeyStatusEl.textContent = 'Using environment Groq key.';
  apiKeyNoteEl.textContent =
    noteOverride || 'Saving a key here will override the environment key for SnapSense.';
  groqKeyInput.placeholder = 'Save a local Groq API key';
  groqKeyClearBtn.disabled = true;
}

async function refreshGroqKeyState(noteOverride = '') {
  try {
    const state = await window.snapsense.getGroqKeyState();
    renderGroqKeyState(state, noteOverride);
  } catch (e) {
    renderGroqKeyState(null, noteOverride || (e?.message || 'Could not read API key status.'));
  }
}

async function saveGroqKeyFromInput() {
  const key = (groqKeyInput?.value || '').trim();
  if (!key) {
    renderGroqKeyState(groqKeyState, 'Paste a Groq API key first.');
    setApiSettingsOpen(true);
    focusGroqKeyInput();
    return;
  }

  groqKeySaveBtn.disabled = true;
  groqKeyClearBtn.disabled = true;
  try {
    await window.snapsense.saveGroqKey(key);
    groqKeyInput.value = '';
    await refreshGroqKeyState('Groq key saved locally.');
    await refreshApiBanner();
  } catch (e) {
    renderGroqKeyState(groqKeyState, e?.message || 'Could not save Groq API key.');
  } finally {
    groqKeySaveBtn.disabled = false;
    groqKeyClearBtn.disabled = !groqKeyState?.hasStoredKey;
  }
}

async function clearSavedGroqKey() {
  groqKeySaveBtn.disabled = true;
  groqKeyClearBtn.disabled = true;
  try {
    await window.snapsense.clearGroqKey();
    if (groqKeyInput) {
      groqKeyInput.value = '';
    }
    await refreshGroqKeyState('Saved Groq key removed.');
    await refreshApiBanner();
  } catch (e) {
    renderGroqKeyState(groqKeyState, e?.message || 'Could not clear Groq API key.');
  } finally {
    groqKeySaveBtn.disabled = false;
    groqKeyClearBtn.disabled = !groqKeyState?.hasStoredKey;
  }
}

function textModeSkeletonHtml() {
  return `
    <div class="bubble assistant loading text-extract-loading">
      <div class="bubble-body shimmer-bubble-inner shimmer-text-only">
        <div class="shimmer-line shimmer-title w-45"></div>
        <div class="shimmer-para">
          <div class="shimmer-line w-100"></div>
          <div class="shimmer-line w-96 d1"></div>
          <div class="shimmer-line w-90 d2"></div>
          <div class="shimmer-line w-94 d3"></div>
          <div class="shimmer-line w-85 d4"></div>
        </div>
        <div class="shimmer-line w-72 d5"></div>
      </div>
    </div>
  `;
}

function scrollTextChat() {
  if (textChatEl) {
    textChatEl.scrollTop = textChatEl.scrollHeight;
  }
}

async function runTextExtractFlow() {
  if (textResultEl) textResultEl.hidden = true;
  if (textErrorEl) {
    textErrorEl.hidden = true;
    textErrorEl.textContent = '';
  }
  textStatusEl.textContent = 'Reading text from image…';
  lastExtractedPlainText = '';
  textOutputEl.innerHTML = '';
  textCopyBtn.disabled = true;
  textLoadingEl.hidden = false;
  textLoadingEl.innerHTML = textModeSkeletonHtml();

  try {
    const { text } = await window.snapsense.extractText(imageDataUrl);
    const finalText = text || '';
    textLoadingEl.hidden = true;
    textLoadingEl.innerHTML = '';

    if (!finalText.trim()) {
      textStatusEl.textContent = 'No readable text found in this capture.';
      if (textResultEl) textResultEl.hidden = true;
      return;
    }

    if (textResultEl) textResultEl.hidden = false;
    textStatusEl.textContent = `Done · ${finalText.length} characters`;
    lastExtractedPlainText = finalText;
    await streamMarkdownReveal(textOutputEl, finalText, TEXT_EXTRACT_STREAM_CPS, textChatEl);
    textCopyBtn.disabled = false;
    scrollTextChat();
  } catch (e) {
    textLoadingEl.hidden = true;
    textLoadingEl.innerHTML = '';
    textStatusEl.textContent = '';
    if (textResultEl) textResultEl.hidden = true;
    if (textErrorEl) {
      textErrorEl.hidden = false;
      textErrorEl.textContent = e?.message || 'Could not extract text.';
    }
  }
}

function getLensWebviewUrl() {
  try {
    return lensWebview.getURL();
  } catch {
    return lensWebview.src || '';
  }
}

/** Layout reference width (px). Larger ⇒ stronger zoom-out for narrow panels (~420px). */
const LENS_ZOOM_REFERENCE_PX = 720;

function applyLensWebviewZoom() {
  if (!lensWebview) return;
  try {
    const w = window.innerWidth || 420;
    const factor = Math.min(1, Math.max(0.48, w / LENS_ZOOM_REFERENCE_PX));
    if (typeof lensWebview.setZoomFactor === 'function') {
      lensWebview.setZoomFactor(factor);
    }
  } catch {
    /* ignore */
  }
}

/** Reduce horizontal scroll inside Google pages; keep width tied to host. */
function clampLensGuestToHostWidth() {
  if (!lensWebview || typeof lensWebview.executeJavaScript !== 'function') return;
  lensWebview
    .executeJavaScript(
      `(()=>{try{var d=document.documentElement,b=document.body;if(d){d.style.overflowX='hidden';d.style.width='100%';d.style.maxWidth='100%';}if(b){b.style.overflowX='hidden';b.style.width='100%';b.style.maxWidth='100%';b.style.boxSizing='border-box';}}catch(_){}})();`,
      false
    )
    .catch(() => {});
}

function syncLensWebviewPresentation() {
  clampLensGuestToHostWidth();
  applyLensWebviewZoom();
}

async function runLensFlow() {
  lensSessionPending = true;
  lensUploadPhase = true;
  lensEmbedFallbackOpened = false;
  if (lensErrorEl) {
    lensErrorEl.hidden = true;
    lensErrorEl.textContent = '';
  }
  activeLensUrl = 'https://lens.google.com/';
  lensLoadingEl.hidden = false;

  try {
    if (typeof lensWebview.stop === 'function') {
      lensWebview.stop();
    }
  } catch {
    /* ignore */
  }

  try {
    const result = await window.snapsense.createLensSession(imageDataUrl);
    const url = result?.url || 'https://lens.google.com/';
    activeLensUrl = url;
    lensUploadPhase = false;
    lensWebview.src = url;
  } catch (e) {
    lensUploadPhase = false;
    lensSessionPending = false;
    lensLoadingEl.hidden = true;
    if (lensErrorEl) {
      lensErrorEl.hidden = false;
      lensErrorEl.textContent =
        e?.message || 'Could not reach Google Lens. Try “Open in browser”.';
    }
    lensWebview.src = 'https://lens.google.com/';
  }
}

async function sendUserMessage(text) {
  const trimmed = text.trim();
  if (!trimmed || busy) return;
  busy = true;
  sendBtn.disabled = true;
  msgEl.value = '';
  messages.push({ role: 'user', content: trimmed });
  appendBubble('user', trimmed);
  setTyping(true);
  addAiLoadingSkeleton();
  try {
    const res = await window.snapsense.panelChat(messages);
    const reply = res.content;
    messages.push({ role: 'assistant', content: reply });
    await streamAssistantReply(reply);
  } catch (e) {
    clearAiLoadingSkeleton();
    const msg =
      e && e.message
        ? e.message
        : 'Something went wrong. Check your connection and API key.';
    appendBubble('assistant', msg, 'error');
    console.error('[SnapSense panel]', e);
  } finally {
    setTyping(false);
    busy = false;
    sendBtn.disabled = false;
    msgEl.focus();
  }
}

function applyMode(mode) {
  const normalized = mode === 'ocr' ? 'text' : mode;
  const m = normalized === 'text' || normalized === 'lens' ? normalized : 'ai';
  sectionAi.hidden = m !== 'ai';
  sectionText.hidden = m !== 'text';
  sectionLens.hidden = m !== 'lens';
  modeLabel.textContent = m === 'ai' ? 'AI' : m === 'text' ? 'Text' : 'Lens';
  if (appWrap) {
    appWrap.dataset.mode = m;
  }
  bannerEl.hidden = m !== 'ai';
  if (btnApiSettings) {
    btnApiSettings.hidden = m !== 'ai';
  }
  if (modelSelectWrap) {
    modelSelectWrap.hidden = m !== 'ai';
  }
  if (m !== 'ai') {
    bannerEl.classList.remove('visible');
    setApiSettingsOpen(false);
  } else {
    setApiSettingsOpen(apiSettingsOpen);
  }
  return m;
}

function onOpen(payload) {
  imageDataUrl = payload.imageDataUrl || '';
  const mode = applyMode(payload.mode);

  shotText.src = imageDataUrl;

  if (mode === 'text') {
    runTextExtractFlow();
    bannerEl.classList.remove('visible');
    return;
  }

  if (mode === 'lens') {
    runLensFlow();
    bannerEl.classList.remove('visible');
    return;
  }

  chatEl.innerHTML = '';
  messages = [];
  const intro =
    'Describe this screenshot and help me with anything visible in it. If you see text, summarize key points.';
  appendUserCaptureInChat(imageDataUrl);
  messages.push({
    role: 'user',
    content: [
      { type: 'text', text: intro },
      { type: 'image_url', image_url: { url: imageDataUrl } }
    ]
  });
  busy = true;
  sendBtn.disabled = true;
  setTyping(true);
  addAiLoadingSkeleton();
  window.snapsense
    .panelChat(messages)
    .then(async (res) => {
      messages.push({ role: 'assistant', content: res.content });
      await streamAssistantReply(res.content);
    })
    .catch((e) => {
      clearAiLoadingSkeleton();
      const msg =
        e && e.message
          ? e.message
          : 'Could not reach the Groq API. Check your network and account limits.';
      appendBubble('assistant', msg, 'error');
      console.error('[SnapSense panel] initial', e);
    })
    .finally(() => {
      busy = false;
      sendBtn.disabled = false;
      setTyping(false);
      msgEl.focus();
    });
  syncModelSelectFromMain();
  refreshGroqKeyState();
  refreshApiBanner();
}

sendBtn.addEventListener('click', () => sendUserMessage(msgEl.value));
msgEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    sendUserMessage(msgEl.value);
  }
});
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    e.preventDefault();
    window.snapsense.closePanel();
  }
});
btnClose.addEventListener('click', () => window.snapsense.closePanel());
if (btnApiSettings) {
  btnApiSettings.addEventListener('click', () => {
    const next = !apiSettingsOpen;
    setApiSettingsOpen(next);
    if (next) {
      focusGroqKeyInput();
    }
  });
}
if (bannerConfigureBtn) {
  bannerConfigureBtn.addEventListener('click', () => {
    setApiSettingsOpen(true);
    focusGroqKeyInput();
  });
}
if (groqKeySaveBtn) {
  groqKeySaveBtn.addEventListener('click', () => {
    saveGroqKeyFromInput();
  });
}
if (groqKeyInput) {
  groqKeyInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveGroqKeyFromInput();
    }
  });
}
if (groqKeyClearBtn) {
  groqKeyClearBtn.addEventListener('click', () => {
    clearSavedGroqKey();
  });
}
textCopyBtn.addEventListener('click', async () => {
  const text = (lastExtractedPlainText || textOutputEl.textContent || '').trim();
  if (!text) return;
  await navigator.clipboard.writeText(text);
});
lensOpenExternalBtn.addEventListener('click', async () => {
  if (!imageDataUrl || !imageDataUrl.startsWith('data:')) {
    return;
  }
  try {
    const r = await window.snapsense.openLensInBrowser(imageDataUrl);
    if (r && r.ok === false && lensErrorEl) {
      lensErrorEl.hidden = false;
      lensErrorEl.textContent =
        'Could not open your default browser. Set a default browser in system settings and try again.';
    } else if (r && r.ok && !r.copied && lensErrorEl) {
      lensErrorEl.hidden = false;
      lensErrorEl.textContent =
        'Clipboard copy failed — open Lens, then use the capture from the SnapSense preview (right‑click image → Copy) or take a new capture.';
    } else if (r && r.ok && r.copied && lensErrorEl) {
      lensErrorEl.hidden = true;
      lensErrorEl.textContent = '';
    }
  } catch (e) {
    console.error('[SnapSense] openLensInBrowser', e);
    if (lensErrorEl) {
      lensErrorEl.hidden = false;
      lensErrorEl.textContent = e?.message || 'Could not open browser.';
    }
  }
});

lensWebview.addEventListener('dom-ready', () => {
  syncLensWebviewPresentation();
});

lensWebview.addEventListener('did-navigate', (e) => {
  if (e.url && /^https?:\/\//i.test(e.url)) {
    activeLensUrl = e.url;
  }
});

lensWebview.addEventListener('did-navigate-in-page', (e) => {
  if (e.url && /^https?:\/\//i.test(e.url)) {
    activeLensUrl = e.url;
  }
});

lensWebview.addEventListener('did-stop-loading', () => {
  if (lensUploadPhase) {
    return;
  }
  const u = getLensWebviewUrl();
  if (lensSessionPending) {
    if (u && u.startsWith('http')) {
      lensLoadingEl.hidden = true;
      lensSessionPending = false;
      if (lensErrorEl) {
        lensErrorEl.hidden = true;
      }
      syncLensWebviewPresentation();
    }
    return;
  }
  if (u && u.startsWith('http')) {
    lensLoadingEl.hidden = true;
    syncLensWebviewPresentation();
  }
});

lensWebview.addEventListener('did-fail-load', (e) => {
  const v = e.validatedURL || '';
  if (!v || v.startsWith('about:')) {
    return;
  }
  lensSessionPending = false;
  lensLoadingEl.hidden = true;
  if (lensErrorEl) {
    lensErrorEl.hidden = false;
    lensErrorEl.textContent =
      'Google Lens often cannot run inside this window. Opening results in your browser…';
  }
  if (!lensEmbedFallbackOpened && imageDataUrl && imageDataUrl.startsWith('data:')) {
    lensEmbedFallbackOpened = true;
    window.snapsense.openLensInBrowser(imageDataUrl);
  }
});

if (modelModeSelect) {
  modelModeSelect.addEventListener('change', async () => {
    const v = modelModeSelect.value;
    try {
      await window.snapsense.setModelMode(v);
      await refreshApiBanner();
    } catch (e) {
      console.error('[SnapSense panel] setModelMode', e);
    }
  });
}

const off = window.snapsense.onPanelOpen((payload) => onOpen(payload));
syncModelSelectFromMain();
refreshGroqKeyState();
refreshApiBanner();
window.addEventListener('resize', () => {
  if (appWrap && appWrap.dataset.mode === 'lens') {
    applyLensWebviewZoom();
  }
});
window.addEventListener('beforeunload', () => {
  if (typeof off === 'function') off();
});
// feat: create panel window base @ 14:32:00
// feat: create panel window base @ 14:32:00
// ui: scroll improvements @ 18:25:00
// feat: google lens upload flow @ 18:50:00
// fix: lens upload + redirect handling @ 19:10:00
// ui: responsive panel sizing @ 19:50:00
// fix: lens width + overflow @ 20:10:00
// ui: floating open-in-browser button @ 20:25:00
// refactor: stabilize panel interactions @ 20:55:00
// feat: create panel window base @ 14:29:00
// ui: scroll + container cleanup @ 18:24:00
// feat: google lens upload flow @ 18:49:00
// fix: lens upload + redirect handling @ 19:11:00
// ui: responsive panel sizing improvements @ 19:47:00
// fix: lens width + remove horizontal scroll @ 20:08:00
// ui: floating open-in-browser button @ 20:23:00
// refactor: stabilize panel interactions + cleanup @ 20:56:00
// feat: create panel window base @ 14:29:00
// ui: scroll + container cleanup @ 18:24:00
// feat: google lens upload flow @ 18:49:00
// fix: lens upload + redirect handling @ 19:11:00
// ui: responsive panel sizing improvements @ 19:47:00
// fix: lens width + remove horizontal scroll @ 20:08:00
// ui: floating open-in-browser button @ 20:23:00
// refactor: stabilize panel interactions + cleanup @ 20:56:00
// feat: create panel window base @ 14:29:00
// ui: scroll + container cleanup @ 18:24:00
// feat: google lens upload flow @ 18:49:00
// fix: lens upload + redirect handling @ 19:11:00
// ui: responsive panel sizing improvements @ 19:47:00
// fix: lens width + remove horizontal scroll @ 20:08:00
// ui: floating open-in-browser button @ 20:23:00
// refactor: stabilize panel interactions + cleanup @ 20:56:00
