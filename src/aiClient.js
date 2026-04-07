const fs = require('fs');
const path = require('path');
let electronApp = null;
try {
  ({ app: electronApp } = require('electron'));
} catch {
  electronApp = null;
}

const DUMMY_GROQ_KEY = 'groq-dummy-replace-with-your-key';
const DEFAULT_GROQ_MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct';
const PROMPTS_PATH = path.join(__dirname, '..', 'config', 'ai-prompts.json');
const LEGACY_SETTINGS_PATH = path.join(__dirname, '..', 'config', 'ai-settings.json');
const DEFAULT_SETTINGS = {
  modelMode: 'groq',
  stealthMode: true
};

function getSettingsPath() {
  try {
    if (electronApp && typeof electronApp.getPath === 'function') {
      return path.join(electronApp.getPath('userData'), 'ai-settings.json');
    }
  } catch {
    /* fall through */
  }
  return LEGACY_SETTINGS_PATH;
}

function readSettings() {
  const base = readJsonSafe(LEGACY_SETTINGS_PATH, DEFAULT_SETTINGS);
  const active = readJsonSafe(getSettingsPath(), {});
  return {
    ...DEFAULT_SETTINGS,
    ...base,
    ...active
  };
}

function writeSettings(value) {
  writeJsonSafe(getSettingsPath(), value);
}

function getGroqKey() {
  const settings = readSettings();
  const saved = String(settings.groqKey || '').trim();
  if (saved) return saved;
  const env = (process.env.GROQ_KEY || '').trim();
  if (env) return env;
  return DUMMY_GROQ_KEY;
}

function readJsonSafe(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeJsonSafe(filePath, value) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function getModelMode() {
  const settings = readSettings();
  const m = settings.modelMode;
  if (m === 'openai') {
    settings.modelMode = 'groq';
    writeSettings(settings);
    return 'groq';
  }
  if (m === 'test') return 'test';
  return 'groq';
}

function setModelMode(mode) {
  const normalized = mode === 'test' ? 'test' : 'groq';
  const settings = readSettings();
  settings.modelMode = normalized;
  writeSettings(settings);
  return normalized;
}

function getStealthMode() {
  const settings = readSettings();
  if (typeof settings.stealthMode === 'boolean') {
    return settings.stealthMode;
  }
  settings.stealthMode = true;
  writeSettings(settings);
  return true;
}

function setStealthMode(enabled) {
  const settings = readSettings();
  settings.stealthMode = Boolean(enabled);
  writeSettings(settings);
  return settings.stealthMode;
}

function getGroqKeyState() {
  const settings = readSettings();
  const saved = String(settings.groqKey || '').trim();
  const env = String(process.env.GROQ_KEY || '').trim();
  const activeKey = saved || env || '';
  const source = saved ? 'saved' : env ? 'env' : 'none';
  const isDummy = !activeKey || activeKey === DUMMY_GROQ_KEY || activeKey.length < 20;
  return {
    configured: Boolean(activeKey && !isDummy),
    hasStoredKey: Boolean(saved),
    source,
    isDummy
  };
}

function setGroqKey(value) {
  const normalized = String(value || '').trim();
  if (!normalized || normalized.length < 20 || normalized === DUMMY_GROQ_KEY) {
    throw new Error('Enter a valid Groq API key.');
  }
  const settings = readSettings();
  settings.groqKey = normalized;
  writeSettings(settings);
  return getGroqKeyState();
}

function clearGroqKey() {
  const settings = readSettings();
  delete settings.groqKey;
  writeSettings(settings);
  return getGroqKeyState();
}

function getGroqModel() {
  const configured = (process.env.GROQ_MODEL || '').trim();
  if (configured) return configured;
  return DEFAULT_GROQ_MODEL;
}

function getPrompt(name) {
  const defaults = {
    chatSystemPrompt:
      'You are SnapSense AI assistant. Give direct, practical answers about the screenshot. If output is JSON, format it in markdown code blocks.',
    ocrSystemPrompt:
      'You are an OCR extractor. Extract all visible text exactly as seen. Do not explain. Do not summarize. Preserve line breaks and order. Return only plain text.'
  };
  const prompts = readJsonSafe(PROMPTS_PATH, defaults);
  if (name === 'ocr') return String(prompts.ocrSystemPrompt || defaults.ocrSystemPrompt);
  return String(prompts.chatSystemPrompt || defaults.chatSystemPrompt);
}

function getAiKeyStatus() {
  const mode = getModelMode();
  if (mode === 'test') {
    return { configured: true, isDummy: false, provider: 'test' };
  }
  const keyState = getGroqKeyState();
  return {
    configured: keyState.configured,
    isDummy: keyState.isDummy,
    source: keyState.source,
    hasStoredKey: keyState.hasStoredKey,
    provider: 'groq'
  };
}

function randomDelayMs() {
  return 1000 + Math.floor(Math.random() * 2000);
}

function buildTestResponse(messages, mode) {
  if (mode === 'ocr' || mode === 'text') {
    return `SnapSense (test mode)\n\nDetected text sample:\n- Invoice #94731\n- Date: 2026-03-28\n- Total: $129.90\n- Status: Paid`;
  }
  const lastUser = [...(messages || [])].reverse().find((m) => m?.role === 'user');
  let userText = '';
  if (typeof lastUser?.content === 'string') {
    userText = lastUser.content;
  } else if (Array.isArray(lastUser?.content)) {
    userText =
      lastUser.content.find((p) => p?.type === 'text' && typeof p.text === 'string')?.text || '';
  }
  const prompt = userText || 'the screenshot';
  return `### Test mode response\n\nI analyzed **${prompt.slice(0, 180)}**.\n\n- Main elements are detected and readable.\n- No blocking errors are visible.\n- You can continue with a follow-up question for deeper analysis.\n\n\`\`\`json\n{\n  "mode": "test",\n  "provider": "groq-mock",\n  "confidence": 0.93\n}\n\`\`\``;
}

async function requestGroq(messages, maxTokens = 4096, logger = null) {
  const apiKey = getGroqKey();
  if (!apiKey || apiKey === DUMMY_GROQ_KEY) {
    return {
      error: 'Groq API key is not configured.'
    };
  }
  const model = getGroqModel();
  if (logger?.debug) {
    const userMessageCount = Array.isArray(messages)
      ? messages.filter((m) => m && m.role === 'user').length
      : 0;
    logger.debug('aiClient', 'Groq request', { userMessageCount });
  }

  const body = {
    model,
    messages,
    max_tokens: maxTokens
  };
  let res;
  try {
    res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(body)
    });
  } catch (e) {
    if (logger?.error) {
      logger.error('aiClient', 'Groq fetch failed', { message: e.message, model });
    }
    return { error: e.message || 'Network error - check your connection.' };
  }

  const text = await res.text();
  if (!res.ok) {
    if (logger?.error) {
      logger.error('aiClient', 'Groq HTTP error', { status: res.status, body: text.slice(0, 500), model });
    }
    return { error: `Groq error ${res.status}: ${text.slice(0, 240)}` };
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    if (logger?.error) {
      logger.error('aiClient', 'Groq parse error', e);
    }
    return { error: 'Invalid response from Groq.' };
  }
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    if (logger?.error) {
      logger.error('aiClient', 'Groq unexpected shape', data);
    }
    return { error: 'Unexpected Groq response.' };
  }

  if (logger?.info) {
    logger.info('aiClient', 'Model resolved', { model });
  }
  return { content };
}

async function requestAi(messages, maxTokens = 4096, logger = null, mode = 'chat') {
  const modelMode = getModelMode();
  if (modelMode === 'test') {
    if (logger?.debug) {
      const userMessageCount = Array.isArray(messages)
        ? messages.filter((m) => m && m.role === 'user').length
        : 0;
      logger.debug('aiClient', 'Test mode request (no API)', { userMessageCount });
    }
    await new Promise((resolve) => setTimeout(resolve, randomDelayMs()));
    return { content: buildTestResponse(messages, mode) };
  }
  return requestGroq(messages, maxTokens, logger);
}

module.exports = {
  getAiKeyStatus,
  getGroqKeyState,
  setGroqKey,
  clearGroqKey,
  getModelMode,
  setModelMode,
  getStealthMode,
  setStealthMode,
  getPrompt,
  requestAi
};
