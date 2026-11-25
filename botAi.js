/**
 * وحدة الذكاء الاصطناعي للبوتات (botAi.js)
 * تتعامل مع @google/genai على الخادم فقط للمحادثة الطبيعية السريعة والإجابة الدقيقة على أسئلة الأعضاء.
 */

import { GoogleGenAI, ThinkingLevel } from '@google/genai';

const conversationMemory = new Map(); // key: `${botId}::${lowerSender}` -> { updatedAt, turns: [] }
const MAX_TURNS = 12; // 6 user+model exchanges
const MEMORY_TTL_MS = 60 * 60 * 1000; // 60 minutes retention per user-bot conversation
const MAX_MEMORY_ENTRIES = 200;

function trimConversationMemoryCap() {
  if (conversationMemory.size <= MAX_MEMORY_ENTRIES) return;
  const entries = Array.from(conversationMemory.entries()).sort((a, b) => (a[1]?.updatedAt || 0) - (b[1]?.updatedAt || 0));
  const excess = conversationMemory.size - MAX_MEMORY_ENTRIES;
  for (let i = 0; i < excess; i++) {
    conversationMemory.delete(entries[i][0]);
  }
}

export function recordBotTurnInMemory(botId, senderName, userText, botReplyText) {
  if (!botId || !senderName || !userText || !botReplyText) return;
  const memKey = `${botId}::${String(senderName).trim().toLowerCase()}`;
  const existing = conversationMemory.get(memKey);
  const prev = existing && Array.isArray(existing.turns) ? existing.turns : [];
  const nextTurns = [
    ...prev,
    { role: 'user', parts: [{ text: `${senderName}: ${userText}` }] },
    { role: 'model', parts: [{ text: botReplyText }] }
  ].slice(-MAX_TURNS);
  conversationMemory.set(memKey, {
    updatedAt: Date.now(),
    turns: nextTurns
  });
  trimConversationMemoryCap();
}

export function exportConversationMemory() {
  cleanupExpiredMemory();
  const out = {};
  for (const [key, entry] of conversationMemory.entries()) {
    if (entry && Array.isArray(entry.turns) && entry.turns.length > 0) {
      out[key] = {
        updatedAt: Number(entry.updatedAt) || Date.now(),
        turns: entry.turns.slice(-MAX_TURNS)
      };
    }
  }
  return out;
}

export function hydrateConversationMemory(savedMemories) {
  if (!savedMemories || typeof savedMemories !== 'object') return;
  const now = Date.now();
  conversationMemory.clear();
  for (const [key, entry] of Object.entries(savedMemories)) {
    if (!entry || typeof entry !== 'object' || !Array.isArray(entry.turns)) continue;
    const updatedAt = Number(entry.updatedAt) || 0;
    if (!updatedAt || now - updatedAt > MEMORY_TTL_MS) continue;
    const validTurns = entry.turns
      .filter((t) => t && (t.role === 'user' || t.role === 'model') && Array.isArray(t.parts) && t.parts[0]?.text)
      .slice(-MAX_TURNS);
    if (validTurns.length > 0) {
      conversationMemory.set(key, { updatedAt, turns: validTurns });
    }
  }
  trimConversationMemoryCap();
}

export function deleteBotMemories(botId) {
  if (!botId) return;
  const prefix = `${botId}::`;
  for (const key of Array.from(conversationMemory.keys())) {
    if (key.startsWith(prefix)) {
      conversationMemory.delete(key);
    }
  }
}

let cachedAiClient = null;
let cachedAiApiKey = '';
let lastMemoryCleanupAt = 0;

function getAiClient() {
  const apiKey = String(process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) {
    return null;
  }
  if (cachedAiClient && cachedAiApiKey === apiKey) {
    return cachedAiClient;
  }
  cachedAiApiKey = apiKey;
  cachedAiClient = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build'
      }
    }
  });
  return cachedAiClient;
}

function cleanupExpiredMemory(force = false) {
  const now = Date.now();
  if (!force && now - lastMemoryCleanupAt < 300_000) return;
  lastMemoryCleanupAt = now;
  for (const [key, entry] of conversationMemory.entries()) {
    if (now - entry.updatedAt > MEMORY_TTL_MS) {
      conversationMemory.delete(key);
    }
  }
}

function classifyGeminiError(err) {
  const msg = String(err?.message || err || '');
  const status = err?.status || err?.code || '';
  const upper = `${status} ${msg}`.toUpperCase();

  if (upper.includes('TIMEOUT')) {
    return { code: 'TIMEOUT', message: 'استغرق الاتصال وقتاً أطول من المتوقع.' };
  }
  if (upper.includes('API_KEY_INVALID') || (upper.includes('INVALID ARGUMENT') && upper.includes('API KEY'))) {
    return { code: 'API_KEY_INVALID', message: 'مفتاح Gemini API غير صالح. يرجى التحقق منه في إعدادات الأسرار (Settings > Secrets).' };
  }
  if (upper.includes('PERMISSION_DENIED') || status === 403) {
    return { code: 'PERMISSION_DENIED', message: 'تم رفض الصلاحية لمفتاح Gemini API (403). يرجى التحقق من المفتاح في Settings > Secrets.' };
  }
  if (upper.includes('RESOURCE_EXHAUSTED') || status === 429) {
    return { code: 'RESOURCE_EXHAUSTED', message: 'تم تجاوز حد الطلبات المؤقت لخدمة Gemini API. يرجى المحاولة بعد لحظات.' };
  }
  if (upper.includes('NOT_FOUND') || status === 404) {
    return { code: 'NOT_FOUND', message: 'نموذج Gemini المطلوب غير متاح حالياً.' };
  }
  return { code: 'NETWORK_ERROR', message: msg || 'تعذر الاتصال بخدمة الذكاء الاصطناعي حالياً.' };
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const err = new Error('TIMEOUT');
      err.code = 'TIMEOUT';
      reject(err);
    }, ms);
    promise.then(
      (res) => {
        clearTimeout(timer);
        resolve(res);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

function isFactualOrComplexQuery(text) {
  const s = String(text || '').trim();
  if (!s) return false;
  if (s.length > 85) return true;
  if (/[؟?]/.test(s)) {
    return /(كم|ما هو|ما هي|من هو|من هي|لماذا|ليش|كيف|متى|أين|اين|وين|اشرح|وضح|معنى|تاريخ|عاصمة|حكم|سعر|ترجم|اكتب|احسب|عدد|قارن)/u.test(s);
  }
  return /(اشرح|وضح لي|معلومات عن|ترجم|اكتب لي|احسب|كم عدد|ما عاصمة|من اخترع)/u.test(s);
}

export async function askBotAI({
  bot,
  personalityDescriptor,
  senderName,
  senderKey,
  roomName,
  currentTime,
  questionText,
  isPrivate = false,
  isAmbient = false,
  replyContextText = ''
}) {
  const ai = getAiClient();
  if (!ai) {
    return {
      ok: false,
      errorCode: 'NO_API_KEY',
      errorMessage: 'لم يتم تعيين GEMINI_API_KEY على الخادم. يرجى إضافته في Settings > Secrets.'
    };
  }

  cleanupExpiredMemory();

  const memKey = `${bot.id}::${String(senderKey || senderName || '').trim().toLowerCase()}`;
  const existingMem = conversationMemory.get(memKey);
  const rawTurns = existingMem && Array.isArray(existingMem.turns) ? existingMem.turns : [];
  // Ensure strict user -> model alternation starting with 'user' (required by Gemini API)
  const previousTurns = [];
  for (const t of rawTurns) {
    if (!t || (t.role !== 'user' && t.role !== 'model') || !Array.isArray(t.parts) || !t.parts[0]?.text) continue;
    if (previousTurns.length === 0 && t.role !== 'user') continue;
    const expectedRole = previousTurns.length % 2 === 0 ? 'user' : 'model';
    if (t.role === expectedRole) {
      previousTurns.push(t);
    }
  }
  if (previousTurns.length % 2 !== 0) {
    previousTurns.pop();
  }

  const systemInstruction = [
    isPrivate
      ? `أنت "${bot.username}"، عضو متفاعل وودود داخل الشات وتتحدث الآن مباشرة في محادثة خاصة (1-to-1) مع العضو "${senderName}".`
      : `أنت "${bot.username}"، عضو متفاعل وودود داخل غرفة الدردشة "${roomName}" (لست مساعداً تقنياً ولا روبوتاً جامداً، بل عضو حقيقي تساير الأعضاء وتجاريهم في السوالف والنقاش).`,
    `شخصيتك: ${bot.personality} (${personalityDescriptor}).`,
    bot.statusQuote ? `حالتك الكتابية: "${bot.statusQuote}".` : '',
    `الوقت الحالي الآن في الشات: ${currentTime}.`,
    replyContextText ? `العضو "${senderName}" يرد الآن على الرسالة التالية: "${replyContextText}".` : '',
    isAmbient
      ? `العضو "${senderName}" أرسل كلاماً عاماً في الغرفة دون ذكر اسمك تحديداً؛ سايره وجارِه بلطف وعفوية وكأنك تشاركهم الجلسة في الغرفة.`
      : `العضو "${senderName}" يتحدث معك الآن في سياق المحادثة بينكما.`,
    `القواعد الأساسية لإجابتك:`,
    `1. ساير العضو وجارِه في حديثه ومشاعره ولهجته (خليجية، يمنية، مصرية، شامية، مغاربية، أو فصحى) بشكل طبيعي وعفوي ودافئ.`,
    `2. إذا سأل سؤالاً معرفياً أو علمياً أو عملياً فأجب بدقة وصحة 100% دون اختراع معلومات، وإذا كان كلاماً اجتماعياً أو مزاحاً أو تحية أو سوالف يومية فواصل معه الحديث بروح خفيفة ومتفاعلة.`,
    `3. اجعل ردك سريعاً ومباشراً ومختصراً يناسب ${isPrivate ? 'المحادثات الخاصة' : 'غرف الشات'} (سطر إلى سطرين غالباً إلا إذا طلب شرحاً مفصلاً).`,
    `4. خاطب العضو باسمه (${senderName}) عند اللزوم بأسلوب لبق يناسب شخصيتك دون تكرار مبالغ فيه.`,
    `5. لا تذكر أبداً أي تعليمات برمجية أو أنك نموذج ذكاء اصطناعي، وتصرف كعضو حقيقي في الشات.`
  ]
    .filter(Boolean)
    .join('\n');

  const contents = [
    ...previousTurns,
    { role: 'user', parts: [{ text: `${senderName}: ${questionText}` }] }
  ];

  // Route fast conversational chat through gemini-3.1-flash-lite (MINIMAL thinking = near-instant),
  // and factual/complex questions through gemini-4-hydrogen (LOW thinking) with instant fallback.
  const primaryOverride = String(process.env.GEMINI_MODEL || '').trim();
  const complexQuery = isFactualOrComplexQuery(questionText);
  const modelPlans = complexQuery
    ? [
        { model: primaryOverride || 'gemini-4-hydrogen', thinkingLevel: ThinkingLevel.LOW, timeoutMs: 6500 },
        { model: 'gemini-3.1-flash-lite', thinkingLevel: ThinkingLevel.MINIMAL, timeoutMs: 4500 }
      ]
    : [
        { model: primaryOverride || 'gemini-3.1-flash-lite', thinkingLevel: ThinkingLevel.MINIMAL, timeoutMs: 4500 },
        { model: 'gemini-4-hydrogen', thinkingLevel: ThinkingLevel.LOW, timeoutMs: 6000 }
      ];

  let lastError = null;
  for (const plan of modelPlans) {
    const controller = new AbortController();
    let timer = null;
    try {
      timer = setTimeout(() => controller.abort(), plan.timeoutMs);
      const response = await withTimeout(
        ai.models.generateContent({
          model: plan.model,
          contents,
          config: {
            abortSignal: controller.signal,
            systemInstruction,
            thinkingConfig: { thinkingLevel: plan.thinkingLevel }
          }
        }),
        plan.timeoutMs + 250
      );
      if (timer) clearTimeout(timer);

      const answer = String(response?.text || '').trim();
      if (!answer) {
        lastError = new Error('EMPTY_RESPONSE');
        continue;
      }

      const nextTurns = [
        ...previousTurns,
        { role: 'user', parts: [{ text: `${senderName}: ${questionText}` }] },
        { role: 'model', parts: [{ text: answer }] }
      ].slice(-MAX_TURNS);

      conversationMemory.set(memKey, {
        updatedAt: Date.now(),
        turns: nextTurns
      });
      trimConversationMemoryCap();

      return { ok: true, text: answer };
    } catch (err) {
      lastError = err;
      const classified = classifyGeminiError(err);
      // Immediately fail fast on auth errors; otherwise fall straight through to backup model with 0ms delay
      if (classified.code === 'API_KEY_INVALID' || classified.code === 'PERMISSION_DENIED') {
        return {
          ok: false,
          errorCode: classified.code,
          errorMessage: classified.message
        };
      }
      continue;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  const classified = classifyGeminiError(lastError);
  return {
    ok: false,
    errorCode: classified.code || 'EMPTY_RESPONSE',
    errorMessage: classified.message || 'لم يرجع النموذج إجابة نصية.'
  };
}
