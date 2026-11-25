/**
 * نظام البوتات الاحترافي — المحرك الأساسي (bot.js)
 * يعمل كأعضاء حقيقيين في الشات مع مزامنة فورية عبر Socket.IO وحفظ دائم في MongoDB.
 */

import {
  askBotAI,
  recordBotTurnInMemory,
  exportConversationMemory,
  hydrateConversationMemory,
  deleteBotMemories
} from './botAi.js';

export const DEFAULT_BOT_SETTINGS = {
  globalEnabled: true,
  autoHopEnabled: false,
  autoRejoinOnKick: true,
  kickRejoinDelaySeconds: 10,
  autoRepliesEnabled: true,
  privateRepliesEnabled: true,
  smartQaEnabled: true,
  welcomeEnabled: true,
  delayedReplyEnabled: true,
  replyDelaySeconds: 2,
  hopMode: 'random', // 'random' | 'selected'
  hopIntervalMinutes: 5,
  selectedHopRooms: []
};

export const DEFAULT_BOT_REPLIES = [
  { id: 'br-1', keyword: 'السلام عليكم', reply: 'وعليكم السلام ورحمة الله، نورتنا يا {اسم العضو} 🌹' },
  { id: 'br-2', keyword: 'سلام', reply: 'وعليكم السلام يا {اسم العضو}، أهلاً وسهلاً بك ✨' },
  { id: 'br-3', keyword: 'هلا', reply: 'هلا وغلا يا {اسم العضو}، منور الشات بوجودك 🌹' },
  { id: 'br-4', keyword: 'صباح الخير', reply: 'صباح النور والسرور يا {اسم العضو} ☀️ يومك سعيد' },
  { id: 'br-5', keyword: 'مساء الخير', reply: 'مساء الورد والفل يا {اسم العضو} 🌙 منورنا' },
  { id: 'br-6', keyword: 'كيفك', reply: 'الحمد لله بخير يا {اسم العضو}، دامكم بخير أنا بخير 🌹 وأنت كيف حالك؟' },
  { id: 'br-7', keyword: 'منور', reply: 'النور نورك يا {اسم العضو} تسلم ✨🌹' },
  { id: 'br-8', keyword: 'باي', reply: 'في أمان الله يا {اسم العضو}، نشوفك على خير قريب 👋🌹' },
  { id: 'br-9', keyword: 'شكرا', reply: 'العفو يا {اسم العضو}، بالخدمة دائماً 🌹' },
  { id: 'br-10', keyword: 'وينك', reply: 'موجود هنا يا {اسم العضو} متابع معكم أول بأول 👀✨' },
  { id: 'br-11', keyword: 'احبك', reply: 'تسلم يا {اسم العضو} كلك ذوق ومحبة 🌹❤️' },
  { id: 'br-12', keyword: 'كم الساعة', reply: 'الساعة الآن {الوقت الحقيقي} حسب توقيت الشات 🕒' },
  { id: 'br-13', keyword: 'من انت', reply: 'أنا {اسم البوت} ({شخصية البوت})، عضو متفاعل في الشات للترحيب بكم ومشاركتكم الحديث 🌹' },
  { id: 'br-14', keyword: 'نكته', reply: 'مرة واحد سأل صاحبه: ليه الكمبيوتر بردان؟ قاله عشان نسي الويندوز مفتوح! 😂🌹 منور يا {اسم العضو}' },
  { id: 'br-15', keyword: 'زعلان', reply: 'أفا لا تزعل يا {اسم العضو}، الدنيا ما تستاهل، ابتسم وخلينا ننبسط معك 🌹✨' },
  { id: 'br-16', keyword: 'بوت', reply: 'لبيه يا {اسم العضو}، آمرني أنا جاهز 🌹' },
  { id: 'br-17', keyword: 'ايش اخبارك', reply: 'الأخبار كلها طيبة بوجودكم يا {اسم العضو}، وأنت طمّنا عنك 🌹' },
  { id: 'br-18', keyword: 'ارحب', reply: 'البقى يا {اسم العضو}، يا مرحبا ومسهلا بك في الشات 🌹✨' },
  { id: 'br-19', keyword: 'حياك', reply: 'الله يحييك ويبقيك يا {اسم العضو}، تشرفنا بحضورك 🌹' }
];

const DEFAULT_FALLBACK_BOT_AVATAR =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Cdefs%3E%3ClinearGradient id='bg' x1='0%25' y1='0%25' x2='100%25' y2='100%25'%3E%3Cstop offset='0%25' stop-color='%23f59e0b'/%3E%3Cstop offset='100%25' stop-color='%2392400e'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='64' height='64' rx='32' fill='url(%23bg)'/%3E%3Ccircle cx='32' cy='24' r='11' fill='%23fff' opacity='0.95'/%3E%3Cpath d='M14 54c2-11 10-16 18-16s16 5 18 16' fill='%23fff' opacity='0.95'/%3E%3C/svg%3E";

function normalizeArabicForMatch(text) {
  if (!text) return '';
  return String(text)
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    // Strip Arabic diacritics, Quranic annotation marks, zero-width joiners, and tatweel
    .replace(/[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u08D3-\u08FF\u0640\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFE00-\uFE0F]/g, '')
    // Normalize decorative Arabic / Urdu / Persian letter variants
    .replace(/[أإآٱٲٳٵ]/g, 'ا')
    .replace(/[ةہۂۀھە]/g, 'ه')
    .replace(/[ىيیئېۑ]/g, 'ي')
    .replace(/[ؤۄۅۆۇۈۉ]/g, 'و')
    .replace(/[كکڪګ]/g, 'ك')
    // Strip decorative symbols/punctuation often used inside ornate shortcuts
    .replace(/[꧁꧂✿❀❁❃❋★☆✦✧•·~*|'`"«»_،؛؟.,!()[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeArabicCompact(text) {
  const base = normalizeArabicForMatch(text);
  if (!base) return '';
  // Collapse 2+ repeated letters (e.g. هلااااا -> هلا) and remove spaces between stretched decorative letters
  return base.replace(/(.)\1+/g, '$1').replace(/\s+/g, '');
}

function getPersonalityDescriptor(personality) {
  switch (personality) {
    case 'رسمي':
      return 'رسمي ومحترم';
    case 'مرح':
      return 'مرح ومحب للضحك';
    case 'ذكي':
      return 'ذكي وسريع البديهة';
    case 'ودود':
    default:
      return 'ودود ولطيف';
  }
}

function sanitizeBotText(value, maxLen = 200) {
  if (value === undefined || value === null) return '';
  return String(value)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim()
    .slice(0, maxLen);
}

function sanitizeBotAvatarUrl(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  if (trimmed === DEFAULT_FALLBACK_BOT_AVATAR) return trimmed;
  if (/^(javascript|vbscript|file):/i.test(trimmed)) return '';
  if (/^\/(?!\/)/.test(trimmed) || /^https?:\/\//i.test(trimmed)) {
    return trimmed.slice(0, 1024);
  }
  if (/^data:image\/(?:png|jpeg|jpg|webp|gif);base64,/i.test(trimmed)) {
    return trimmed;
  }
  return '';
}

const RESERVED_BOT_NAMES = new Set(['admin', 'hassan', 'النظام', 'الإدارة', 'إدارة حسان برو', 'نظام الهدايا 🎁']);

export function createBotEngine(ctx) {
  const {
    io,
    dataManager,
    users,
    registeredMembers,
    chatRooms,
    chatHistory,
    getCurrentTimeString,
    saveHistory,
    pruneRoomChatHistory,
    saveMembers,
    broadcastRoomUsers,
    broadcastAllUsers,
    broadcastAllRegisteredMembers,
    broadcastRoomsUpdate,
    logMonitorEvent,
    hashPassword,
    privateChatHistory,
    getPmPairKey,
    savePrivateChatHistory,
    offlinePrivateMessages,
    saveOfflinePrivateMessages,
    assignOrGetFlagNumber
  } = ctx;

  let bots = [];
  let botSettings = { ...DEFAULT_BOT_SETTINGS };
  let botReplies = [];

  // Per-bot independent timers (never one global interval for all bots)
  const perBotHopTimers = new Map();
  const perBotRejoinTimers = new Map();
  const kickedBotsPendingRejoin = new Set();

  // Cooldown & queuing maps
  const roomLastBotHopArrivalAt = new Map(); // roomId -> timestamp (prevent >1 bot hopping to same room within 60s)
  const welcomeCooldowns = new Map(); // `${botId}::${lowerUser}` -> timestamp (5 min)
  const replyCooldowns = new Map(); // `${botId}::${lowerUser}::${keywordKey}` -> timestamp
  const activeConversations = new Map(); // `${roomId}::${lowerSender}` -> { botId, updatedAt }
  const ambientSilenceUntil = new Map(); // `${roomId}::${lowerSender}` -> timestamp
  const roomAmbientLastReplyAt = new Map(); // roomId -> timestamp (rate-limit ambient AI calls per room)
  const AMBIENT_ROOM_COOLDOWN_MS = 10000;
  const roomLastAmbientBotIdx = new Map(); // roomId -> last bot index for natural rotation
  const roomQueues = new Map(); // `${roomId}::${lowerSender}` -> { messages, timer, processing, sender }
  const pmQueues = new Map(); // `${botId}::${lowerSender}` -> { messages, timer, processing, sender, botRecord }
  const activeRoomTypingTimers = new Map(); // `${botKey}::${roomId}` -> { interval, botMeta, roomId }
  const activePmTypingTimers = new Map(); // `${botKey}::${lowerSender}` -> { interval, botRecord, sender }
  const ACTIVE_CONVERSATION_TTL_MS = 10 * 60 * 1000; // 10 minutes follow-up window persisted in MongoDB
  const TYPING_HEARTBEAT_MS = 2400; // Re-emit before client 4s auto-prune expires
  const MIN_TYPING_PREVIEW_MS = 850; // Guarantee visible "يكتب الآن..." even when delayedReplyEnabled is false

  let stateChangeListeners = new Set();

  function onStateChanged(cb) {
    stateChangeListeners.add(cb);
    return () => stateChangeListeners.delete(cb);
  }

  function notifyStateChanged() {
    for (const cb of stateChangeListeners) {
      try {
        cb(getPublicState());
      } catch (err) {
        console.error('[BotEngine] Error in state listener:', err);
      }
    }
  }

  function resolveValidRoom(roomId) {
    if (roomId && Array.isArray(chatRooms) && chatRooms.some((r) => r.id === roomId)) {
      return roomId;
    }
    return chatRooms[0]?.id || 'الغرفة العامة';
  }

  function getBotLiveId(botId) {
    return `bot-${botId}`;
  }

  function clearBotHopTimer(botId) {
    const t = perBotHopTimers.get(botId);
    if (t) {
      clearTimeout(t);
      perBotHopTimers.delete(botId);
    }
  }

  function clearBotRejoinTimer(botId) {
    const t = perBotRejoinTimers.get(botId);
    if (t) {
      clearTimeout(t);
      perBotRejoinTimers.delete(botId);
    }
    kickedBotsPendingRejoin.delete(botId);
  }

  function clearAllTimers() {
    for (const id of Array.from(perBotHopTimers.keys())) {
      clearBotHopTimer(id);
    }
    for (const id of Array.from(perBotRejoinTimers.keys())) {
      clearBotRejoinTimer(id);
    }
    for (const entry of activeRoomTypingTimers.values()) {
      clearInterval(entry.interval);
    }
    activeRoomTypingTimers.clear();
    for (const entry of activePmTypingTimers.values()) {
      clearInterval(entry.interval);
    }
    activePmTypingTimers.clear();
    for (const rq of roomQueues.values()) {
      if (rq.timer) clearTimeout(rq.timer);
    }
    roomQueues.clear();
    for (const pq of pmQueues.values()) {
      if (pq.timer) clearTimeout(pq.timer);
    }
    pmQueues.clear();
  }

  function saveBots() {
    dataManager.save('bots', bots).catch((err) => {
      console.error('[BotEngine] Error saving bots:', err);
    });
  }

  function saveBotSettings() {
    dataManager.save('bot_settings', botSettings).catch((err) => {
      console.error('[BotEngine] Error saving bot_settings:', err);
    });
  }

  function saveBotReplies() {
    dataManager.save('botReplies', botReplies).catch((err) => {
      console.error('[BotEngine] Error saving botReplies:', err);
    });
  }

  function saveBotConversations() {
    const now = Date.now();
    const sessions = {};
    for (const [k, v] of activeConversations.entries()) {
      if (v && v.botId && now - (Number(v.updatedAt) || 0) <= ACTIVE_CONVERSATION_TTL_MS) {
        sessions[k] = { botId: v.botId, updatedAt: Number(v.updatedAt) || now };
      } else {
        activeConversations.delete(k);
      }
    }
    const payload = {
      sessions,
      memories: exportConversationMemory()
    };
    dataManager.save('bot_conversations', payload).catch((err) => {
      console.error('[BotEngine] Error saving bot_conversations:', err);
    });
  }

  function mapStatusToPresence(status) {
    switch (status) {
      case 'away':
        return { presenceState: 'away', isGhost: false };
      case 'offline':
        return { presenceState: 'offline', isGhost: false };
      case 'hidden':
        return { presenceState: 'online', isGhost: true };
      case 'online':
      default:
        return { presenceState: 'online', isGhost: false };
    }
  }

  function emitBotEnterMessage(bot, roomId) {
    if (!bot || !roomId || bot.status === 'hidden') return;
    const entryMessage = {
      id: `enter-bot-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      room: roomId,
      username: bot.username,
      avatarUrl: bot.avatarUrl || DEFAULT_FALLBACK_BOT_AVATAR,
      nameBannerUrl: '',
      flag: bot.flag || '🇸🇦',
      badge: `${roomId} Room | دخل الى`,
      badgeColor: 'text-amber-400',
      text: `دخل ${bot.username} إلى ${roomId} أهلاً وسهلاً 🦅`,
      time: getCurrentTimeString(),
      timestamp: Date.now()
    };
    chatHistory.push(entryMessage);
    pruneRoomChatHistory(roomId);
    saveHistory();
    io.to(roomId).emit('message', entryMessage);
  }

  function emitBotLeaveMessage(bot, oldRoom, newRoom = null) {
    if (!bot || !oldRoom || bot.status === 'hidden') return;
    const leaveMessage = {
      id: `leave-bot-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      room: oldRoom,
      username: bot.username,
      avatarUrl: bot.avatarUrl || DEFAULT_FALLBACK_BOT_AVATAR,
      nameBannerUrl: '',
      flag: bot.flag || '🇸🇦',
      badge: newRoom ? `${newRoom} | انتقل إلى` : 'مغادرة 🚪',
      badgeColor: 'text-amber-400',
      text: newRoom
        ? `غادر ${bot.username} وانتقل إلى غرفة [${newRoom}] 🚪`
        : `غادر ${bot.username} الغرفة 🚪`,
      time: getCurrentTimeString(),
      timestamp: Date.now()
    };
    chatHistory.push(leaveMessage);
    pruneRoomChatHistory(oldRoom);
    saveHistory();
    io.to(oldRoom).emit('message', leaveMessage);
  }

  function upsertRegisteredMemberForBot(bot, oldUsername) {
    const botUsername = String(bot?.username || bot?.name || '').trim();
    if (!bot || !botUsername) return;
    if (!bot.username) bot.username = botUsername;

    const cleanOld = typeof oldUsername === 'string' ? oldUsername.trim() : '';
    if (cleanOld && cleanOld.toLowerCase() !== botUsername.toLowerCase()) {
      const oldKey = Object.keys(registeredMembers).find((k) => k.toLowerCase() === cleanOld.toLowerCase());
      if (oldKey && registeredMembers[oldKey]?.isBot) {
        delete registeredMembers[oldKey];
      }
    }

    const existingKey = Object.keys(registeredMembers).find((k) => k.toLowerCase() === botUsername.toLowerCase());
    const targetKey = existingKey || botUsername;
    const prev = registeredMembers[targetKey];

    const botFlag = bot.flag || prev?.flag || '🇸🇦';
    const assignedFlagNumber = typeof assignOrGetFlagNumber === 'function'
      ? assignOrGetFlagNumber(targetKey, botFlag)
      : (prev?.flagNumber || bot.flagNumber);
    if (assignedFlagNumber) {
      bot.flagNumber = assignedFlagNumber;
    }

    registeredMembers[targetKey] = {
      ...(prev || {}),
      password: prev?.password || hashPassword(`bot-secret-${bot.id}`),
      originalUsername: prev?.originalUsername || targetKey,
      registeredAt: prev?.registeredAt || bot.createdAt || Date.now(),
      displayName: bot.username,
      role: 'member', // Strict requirement: bot is NEVER guest or system
      flag: botFlag,
      flagNumber: assignedFlagNumber || prev?.flagNumber,
      flagNumbersByFlag: {
        ...(prev?.flagNumbersByFlag || {}),
        ...(assignedFlagNumber ? { [botFlag]: assignedFlagNumber } : {})
      },
      statusQuote: bot.statusQuote || 'أهلاً بكم في الشات',
      avatarUrl: bot.avatarUrl || DEFAULT_FALLBACK_BOT_AVATAR,
      likes: prev?.likes ?? 100,
      points: prev?.points ?? 500,
      isBot: true,
      lastSeen: Date.now()
    };
    saveMembers();
  }

  function removeLiveUserForBot(botId) {
    const liveId = getBotLiveId(botId);
    const affectedRooms = new Set();
    for (let i = users.length - 1; i >= 0; i--) {
      if (users[i].id === liveId) {
        if (users[i].room) affectedRooms.add(users[i].room);
        users.splice(i, 1);
      }
    }
    return Array.from(affectedRooms);
  }

  function syncBotLiveUser(bot) {
    const liveId = getBotLiveId(bot.id);
    const shouldBeActive = Boolean(botSettings.globalEnabled && bot.enabled && !kickedBotsPendingRejoin.has(bot.id));

    const existingIdx = users.findIndex((u) => u.id === liveId);
    const oldRoom = existingIdx !== -1 ? users[existingIdx].room : null;

    if (!shouldBeActive) {
      if (existingIdx !== -1) {
        users.splice(existingIdx, 1);
      }
      clearBotHopTimer(bot.id);
      return { oldRoom, newRoom: null, changed: existingIdx !== -1 };
    }

    const targetRoom = resolveValidRoom(bot.currentRoom || bot.defaultRoom);
    if (bot.currentRoom !== targetRoom) {
      bot.currentRoom = targetRoom;
    }

    const { presenceState, isGhost } = mapStatusToPresence(bot.status);
    const regEntry = registeredMembers[bot.username];
    const resolvedFlag = bot.flag || regEntry?.flag || '🇸🇦';
    const resolvedFlagNumber = typeof assignOrGetFlagNumber === 'function'
      ? assignOrGetFlagNumber(bot.username, resolvedFlag)
      : (bot.flagNumber || regEntry?.flagNumber);
    if (resolvedFlagNumber) {
      bot.flagNumber = resolvedFlagNumber;
    }

    const liveObj = {
      id: liveId,
      username: bot.username,
      room: targetRoom,
      avatarSeed: bot.username,
      avatarUrl: bot.avatarUrl || DEFAULT_FALLBACK_BOT_AVATAR,
      statusQuote: bot.statusQuote,
      flag: resolvedFlag,
      flagNumber: resolvedFlagNumber,
      role: 'member', // Real chat member, never guest or system
      likes: regEntry?.likes ?? 100,
      points: regEntry?.points ?? 500,
      isVoice: false,
      micSlot: null,
      isMuted: false,
      isTextMuted: false,
      isSpeaking: false,
      presenceState,
      isGhost,
      isBot: true,
      joinedAt: existingIdx !== -1 ? users[existingIdx].joinedAt : Date.now(),
      lastActiveTime: Date.now()
    };

    if (existingIdx !== -1) {
      users[existingIdx] = liveObj;
    } else {
      users.push(liveObj);
    }

    scheduleBotHopTimer(bot);
    return { oldRoom, newRoom: targetRoom, changed: true };
  }

  function broadcastPresenceForRooms(roomsSet) {
    for (const r of roomsSet) {
      if (r) broadcastRoomUsers(r);
    }
    broadcastAllUsers();
    broadcastRoomsUpdate();
  }

  function syncAllBotsToChat() {
    const affectedRooms = new Set();
    const validLiveIds = new Set(bots.filter((b) => b && b.id && b.username).map((b) => getBotLiveId(b.id)));
    for (let i = users.length - 1; i >= 0; i--) {
      if (users[i]?.isBot && !validLiveIds.has(users[i].id)) {
        if (users[i].room) affectedRooms.add(users[i].room);
        users.splice(i, 1);
      }
    }
    for (const bot of bots) {
      if (!bot || !bot.username) continue;
      try {
        upsertRegisteredMemberForBot(bot);
        const { oldRoom, newRoom } = syncBotLiveUser(bot);
        if (oldRoom) affectedRooms.add(oldRoom);
        if (newRoom) affectedRooms.add(newRoom);
      } catch (err) {
        console.error(`[BotEngine] Error syncing bot "${bot?.username || bot?.id}":`, err);
      }
    }
    broadcastPresenceForRooms(affectedRooms);
  }

  function getBotTypingPayload(botUserOrRecord, roomId, isTyping) {
    const rec = bots.find(
      (b) => b.id === botUserOrRecord?.id || getBotLiveId(b.id) === botUserOrRecord?.id || b.username.toLowerCase() === String(botUserOrRecord?.username || '').toLowerCase()
    );
    const liveId = rec ? getBotLiveId(rec.id) : (botUserOrRecord?.id || `bot-${botUserOrRecord?.username || 'bot'}`);
    const username = rec?.username || botUserOrRecord?.username || 'بوت';
    const avatarUrl = rec?.avatarUrl || botUserOrRecord?.avatarUrl || DEFAULT_FALLBACK_BOT_AVATAR;
    const flag = rec?.flag || botUserOrRecord?.flag || '🇸🇦';
    return {
      userId: liveId,
      username,
      displayName: username,
      avatarUrl,
      flag,
      role: 'member',
      room: roomId,
      isTyping: Boolean(isTyping),
      timestamp: Date.now()
    };
  }

  function startRoomBotTyping(botUserOrRecord, roomId) {
    if (!botUserOrRecord || !roomId) return;
    const payload = getBotTypingPayload(botUserOrRecord, roomId, true);
    const tKey = `${payload.userId}::${roomId}`;
    const existing = activeRoomTypingTimers.get(tKey);
    if (existing) {
      clearInterval(existing.interval);
    }
    io.to(roomId).emit('userTyping', payload);
    const interval = setInterval(() => {
      const stillActive = activeRoomTypingTimers.get(tKey);
      if (!stillActive) return;
      io.to(roomId).emit('userTyping', { ...payload, timestamp: Date.now() });
    }, TYPING_HEARTBEAT_MS);
    activeRoomTypingTimers.set(tKey, { interval, botMeta: payload, roomId });
  }

  function stopRoomBotTyping(botUserOrRecord, roomId) {
    if (!botUserOrRecord || !roomId) return;
    const payload = getBotTypingPayload(botUserOrRecord, roomId, false);
    const tKey = `${payload.userId}::${roomId}`;
    const existing = activeRoomTypingTimers.get(tKey);
    if (existing) {
      clearInterval(existing.interval);
      activeRoomTypingTimers.delete(tKey);
    }
    io.to(roomId).emit('userTyping', payload);
  }

  function emitPmTypingFrame(botRecord, sender, isTyping) {
    if (!botRecord || !sender) return;
    const lowerSender = String(sender.username || '').trim().toLowerCase();
    const liveSender = users.find((u) => !u.isBot && u.username.toLowerCase() === lowerSender);
    const sid = liveSender?.id || sender.id;
    if (!sid || !io.sockets.sockets.get(sid)?.connected) return;
    const botLiveId = getBotLiveId(botRecord.id);
    const botAvatar = botRecord.avatarUrl || DEFAULT_FALLBACK_BOT_AVATAR;
    io.to(sid).emit('userPmTyping', {
      fromUserId: botLiveId,
      fromUsername: botRecord.username,
      fromDisplayName: botRecord.username,
      avatarUrl: botAvatar,
      nameBannerUrl: '',
      isTyping: Boolean(isTyping),
      timestamp: Date.now()
    });
  }

  function startPmBotTyping(botRecord, sender) {
    if (!botRecord || !sender) return;
    const lowerSender = String(sender.username || '').trim().toLowerCase();
    const tKey = `${botRecord.id}::${lowerSender}`;
    const existing = activePmTypingTimers.get(tKey);
    if (existing) {
      clearInterval(existing.interval);
    }
    emitPmTypingFrame(botRecord, sender, true);
    const interval = setInterval(() => {
      const entry = activePmTypingTimers.get(tKey);
      if (!entry) return;
      emitPmTypingFrame(entry.botRecord, entry.sender, true);
    }, TYPING_HEARTBEAT_MS);
    activePmTypingTimers.set(tKey, { interval, botRecord, sender });
  }

  function stopPmBotTyping(botRecord, sender) {
    if (!botRecord || !sender) return;
    const lowerSender = String(sender.username || '').trim().toLowerCase();
    const tKey = `${botRecord.id}::${lowerSender}`;
    const existing = activePmTypingTimers.get(tKey);
    if (existing) {
      clearInterval(existing.interval);
      activePmTypingTimers.delete(tKey);
    }
    emitPmTypingFrame(botRecord, sender, false);
  }

  function stopAllTypingForBot(botOrId) {
    const botId = typeof botOrId === 'string' ? botOrId : botOrId?.id;
    const liveId = botId ? getBotLiveId(botId) : '';
    for (const [key, entry] of Array.from(activeRoomTypingTimers.entries())) {
      if ((liveId && key.startsWith(`${liveId}::`)) || (botId && key.startsWith(`${botId}::`))) {
        clearInterval(entry.interval);
        activeRoomTypingTimers.delete(key);
        io.to(entry.roomId).emit('userTyping', { ...entry.botMeta, isTyping: false, timestamp: Date.now() });
      }
    }
    for (const [key, entry] of Array.from(activePmTypingTimers.entries())) {
      if (botId && key.startsWith(`${botId}::`)) {
        clearInterval(entry.interval);
        activePmTypingTimers.delete(key);
        emitPmTypingFrame(entry.botRecord, entry.sender, false);
      }
    }
  }

  function sendBotMessage(botUserOrRecord, roomId, text) {
    if (!text || !roomId) return;
    stopRoomBotTyping(botUserOrRecord, roomId);
    const username = botUserOrRecord.username;
    const avatarUrl = botUserOrRecord.avatarUrl || DEFAULT_FALLBACK_BOT_AVATAR;
    const flag = botUserOrRecord.flag || '🇸🇦';
    const messageObj = {
      id: `botmsg-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      room: roomId,
      username,
      avatarUrl,
      nameBannerUrl: '',
      flag,
      text,
      time: getCurrentTimeString(),
      timestamp: Date.now(),
      reactions: {},
      giftBadges: []
    };

    chatHistory.push(messageObj);
    pruneRoomChatHistory(roomId);
    saveHistory();

    const liveBot = users.find((u) => u.username.toLowerCase() === username.toLowerCase() && u.isBot);
    if (liveBot) {
      liveBot.lastActiveTime = Date.now();
    }

    io.to(roomId).emit('message', messageObj);
  }

  function sendBotPrivateMessage(botRecord, recipientUser, text, replyToPm = null) {
    if (!botRecord || !recipientUser || !text) return;
    stopPmBotTyping(botRecord, recipientUser);
    const now = Date.now();
    const botUsername = botRecord.username;
    const botLiveId = getBotLiveId(botRecord.id);
    const botAvatar = botRecord.avatarUrl || DEFAULT_FALLBACK_BOT_AVATAR;
    const destUsername = recipientUser.username;

    const liveRecipient = users.find(
      (u) => !u.isBot && u.username.toLowerCase() === destUsername.toLowerCase()
    );
    const recipientSocketId = liveRecipient?.id || recipientUser.id;
    const recipientSock = recipientSocketId ? io.sockets.sockets.get(recipientSocketId) : undefined;
    const isRecipientOnline = Boolean(recipientSock && recipientSock.connected);

    const pm = {
      id: `pm-bot-${now}-${Math.random().toString(36).substring(2, 7)}`,
      fromId: botLiveId,
      fromUsername: botUsername,
      fromDisplayName: botUsername,
      fromAvatar: botAvatar,
      fromNameBannerUrl: '',
      toId: recipientSocketId || `offline-${destUsername}`,
      toUsername: destUsername,
      toDisplayName: liveRecipient?.displayName || recipientUser.displayName || destUsername,
      toNameBannerUrl: liveRecipient?.nameBannerUrl || recipientUser.nameBannerUrl,
      text,
      replyTo: replyToPm
        ? {
            id: replyToPm.id,
            username: replyToPm.fromUsername || destUsername,
            displayName: replyToPm.fromDisplayName || liveRecipient?.displayName || destUsername,
            text: replyToPm.text || ''
          }
        : undefined,
      time: getCurrentTimeString(),
      timestamp: now,
      status: isRecipientOnline ? 'delivered' : 'sent'
    };

    if (privateChatHistory && getPmPairKey && savePrivateChatHistory) {
      const pairKey = getPmPairKey(botUsername, destUsername);
      if (!privateChatHistory.has(pairKey)) {
        privateChatHistory.set(pairKey, []);
      }
      privateChatHistory.get(pairKey).push(pm);
      savePrivateChatHistory();
    }

    const liveBot = users.find((u) => u.username.toLowerCase() === botUsername.toLowerCase() && u.isBot);
    if (liveBot) {
      liveBot.lastActiveTime = now;
    }

    if (isRecipientOnline) {
      io.to(recipientSocketId).emit('newPrivateMessage', pm);
    } else if (offlinePrivateMessages && saveOfflinePrivateMessages) {
      const key = destUsername.toLowerCase();
      if (!offlinePrivateMessages.has(key)) {
        offlinePrivateMessages.set(key, []);
      }
      offlinePrivateMessages.get(key).push(pm);
      saveOfflinePrivateMessages();
    }
  }

  function scheduleBotHopTimer(bot) {
    clearBotHopTimer(bot.id);
    if (!botSettings.globalEnabled || !bot.enabled || !botSettings.autoHopEnabled || kickedBotsPendingRejoin.has(bot.id)) {
      return;
    }

    const minutes = Math.max(1, Number(botSettings.hopIntervalMinutes) || 5);
    const delayMs = minutes * 60 * 1000;

    const timer = setTimeout(() => {
      perBotHopTimers.delete(bot.id);
      attemptBotHop(bot.id);
    }, delayMs);

    perBotHopTimers.set(bot.id, timer);
  }

  function attemptBotHop(botId) {
    const bot = bots.find((b) => b.id === botId);
    if (!bot || !botSettings.globalEnabled || !bot.enabled || !botSettings.autoHopEnabled || kickedBotsPendingRejoin.has(bot.id)) {
      return;
    }

    const liveBot = users.find((u) => u.id === getBotLiveId(bot.id));
    if (!liveBot) return;

    const currentRoom = liveBot.room || bot.currentRoom || bot.defaultRoom;

    // Rule: لا ينتقل البوت إذا كانت الغرفة فيها أعضاء حقيقيون غيره
    const otherMembersInRoom = users.filter((u) => !u.isBot && u.room === currentRoom && u.id !== liveBot.id);
    if (otherMembersInRoom.length < 1) {
      scheduleBotHopTimer(bot);
      return;
    }

    const now = Date.now();
    let pool = Array.isArray(chatRooms) ? chatRooms.filter((r) => r.id !== 'سجن حسان برو' && r.id !== currentRoom) : [];
    if (botSettings.hopMode === 'selected' && Array.isArray(botSettings.selectedHopRooms) && botSettings.selectedHopRooms.length > 0) {
      pool = pool.filter((r) => botSettings.selectedHopRooms.includes(r.id));
    }

    // Rule: لا ينتقل أكثر من بوت لنفس الغرفة في نفس الدقيقة
    const eligibleRooms = pool.filter((r) => {
      const lastArrival = roomLastBotHopArrivalAt.get(r.id) || 0;
      return now - lastArrival >= 60 * 1000;
    });

    if (eligibleRooms.length === 0) {
      scheduleBotHopTimer(bot);
      return;
    }

    const chosenRoom = eligibleRooms[Math.floor(Math.random() * eligibleRooms.length)];
    const oldRoom = currentRoom;
    const newRoom = chosenRoom.id;

    bot.currentRoom = newRoom;
    bot.updatedAt = now;
    liveBot.room = newRoom;
    liveBot.lastActiveTime = now;
    roomLastBotHopArrivalAt.set(newRoom, now);

    saveBots();
    emitBotLeaveMessage(bot, oldRoom, newRoom);
    broadcastPresenceForRooms(new Set([oldRoom, newRoom]));
    emitBotEnterMessage(bot, newRoom);

    if (botSettings.autoRepliesEnabled) {
      sendBotMessage(liveBot, newRoom, 'أهلاً، وصلت، منورين 🌹');
    }

    notifyStateChanged();
    scheduleBotHopTimer(bot);
  }

  function getActiveBotUsersInRoom(roomId) {
    if (!botSettings.globalEnabled || !roomId) return [];
    return users.filter((u) => {
      if (!u.isBot || u.room !== roomId || u.presenceState === 'offline') return false;
      const rec = bots.find((b) => getBotLiveId(b.id) === u.id);
      return Boolean(rec && rec.enabled && rec.status !== 'offline');
    });
  }

  function onUserJoinedRoom(joinedUser, roomId) {
    if (!botSettings.globalEnabled || !botSettings.welcomeEnabled) return;
    if (!joinedUser || joinedUser.isBot || joinedUser.isGhost) return;

    const activeBots = getActiveBotUsersInRoom(roomId);
    if (activeBots.length === 0) return;

    const now = Date.now();
    const lowerMember = joinedUser.username.trim().toLowerCase();

    // Find a visible active bot in the room that hasn't welcomed this user within the last 5 minutes
    const eligibleBot = activeBots.find((b) => {
      if (b.isGhost) return false;
      const botRecord = bots.find((rec) => getBotLiveId(rec.id) === b.id);
      if (!botRecord || !botRecord.enabled || botRecord.status === 'hidden') return false;
      const key = `${botRecord.id}::${lowerMember}`;
      const lastWelcome = welcomeCooldowns.get(key) || 0;
      return now - lastWelcome >= 5 * 60 * 1000;
    });

    if (!eligibleBot) return;

    const botRecord = bots.find((rec) => getBotLiveId(rec.id) === eligibleBot.id);
    if (!botRecord) return;

    welcomeCooldowns.set(`${botRecord.id}::${lowerMember}`, now);
    startRoomBotTyping(eligibleBot, roomId);

    setTimeout(() => {
      if (!botSettings.globalEnabled || !botSettings.welcomeEnabled) {
        stopRoomBotTyping(eligibleBot, roomId);
        return;
      }
      const stillBot = users.find((u) => u.id === eligibleBot.id && u.room === roomId);
      const stillMember = users.find(
        (u) => !u.isBot && u.username.trim().toLowerCase() === lowerMember && u.room === roomId
      );
      if (!stillBot || !stillMember) {
        stopRoomBotTyping(eligibleBot, roomId);
        return;
      }

      const roomObj = chatRooms.find((r) => r.id === roomId);
      const roomName = roomObj?.name || roomId;
      const memberDisplay = stillMember.displayName || stillMember.username;
      const welcomeMsg = `نورت يا ${memberDisplay} 🌹 أهلاً فيك في ${roomName}`;
      // Open active conversation so the user's reply to the welcome is seamlessly picked up
      activeConversations.set(`${roomId}::${lowerMember}`, { botId: botRecord.id, updatedAt: Date.now() });
      recordBotTurnInMemory(botRecord.id, stillMember.username, 'دخل الغرفة', welcomeMsg);
      saveBotConversations();
      sendBotMessage(stillBot, roomId, welcomeMsg);
    }, 1500);
  }

  function formatReplyTemplate(template, senderName, botRecord) {
    let result = String(template || '');
    const currentTime = getCurrentTimeString();
    const personalityText = `${botRecord.personality} (${getPersonalityDescriptor(botRecord.personality)})`;

    result = result
      .replace(/\{اسم العضو\}/g, senderName)
      .replace(/\{الوقت الحقيقي\}/g, currentTime)
      .replace(/\{اسم البوت\}/g, botRecord.username)
      .replace(/\{شخصية البوت\}/g, personalityText);

    return result;
  }

  function textMatchesKeyword(candidates, keyword) {
    const cleanKw = String(keyword || '').trim();
    if (!cleanKw) return false;
    const normKw = normalizeArabicForMatch(cleanKw);
    const compactKw = normalizeArabicCompact(cleanKw);
    if (!normKw) return false;

    const kwWords = normKw.split(/\s+/).filter(Boolean);
    const kwWordCount = kwWords.length;

    for (const candidate of candidates) {
      if (!candidate?.norm) continue;
      const msgWords = candidate.norm.split(/\s+/).filter(Boolean);
      if (msgWords.length < kwWordCount) continue;

      for (let i = 0; i <= msgWords.length - kwWordCount; i++) {
        const slice = msgWords.slice(i, i + kwWordCount);
        const sliceJoined = slice.join(' ');
        if (sliceJoined === normKw) return true;

        // Allow optional conjunction prefix ("و" / "ف") on single/first word when keyword is at least 2 chars
        if (slice[0].length > kwWords[0].length + 0 && (slice[0].startsWith('و') || slice[0].startsWith('ف')) && kwWords[0].length >= 2) {
          const strippedFirst = slice[0].slice(1);
          const altSlice = [strippedFirst, ...slice.slice(1)].join(' ');
          if (altSlice === normKw) return true;
        }

        // Stretched-letters match per contiguous phrase window (e.g. "هلااااا" -> "هلا"), never across unrelated substrings
        if (compactKw.length >= 2) {
          const sliceCompact = sliceJoined.replace(/(.)\1+/g, '$1').replace(/\s+/g, '');
          if (sliceCompact === compactKw) return true;
          if (kwWordCount === 1 && (sliceCompact.startsWith('و') || sliceCompact.startsWith('ف')) && sliceCompact.slice(1) === compactKw) {
            return true;
          }
        }
      }
    }
    return false;
  }

  function tokenizeWithSpans(text) {
    const tokenRegex = /[^\s:،,\-!؟?.~*|"'«»()[\]{}@]+/gu;
    const tokens = [];
    let m;
    while ((m = tokenRegex.exec(text)) !== null) {
      tokens.push({ text: m[0], index: m.index, end: m.index + m[0].length });
      if (tokens.length >= 40) break;
    }
    return tokens;
  }

  function messageMentionsOtherHumanInRoom(candidates, roomId, senderId) {
    const otherHumans = users.filter(
      (u) => u.room === roomId && u.id !== senderId && !u.isBot && !u.isGhost && u.username
    );
    if (otherHumans.length === 0) return false;

    for (const human of otherHumans) {
      const namesToCheck = [human.username, human.displayName].filter(Boolean);
      for (const rawHumanName of namesToCheck) {
        const hNorm = normalizeArabicForMatch(rawHumanName);
        if (!hNorm || hNorm.length < 2) continue;
        const hWords = hNorm.split(/\s+/).filter(Boolean);
        for (const c of candidates) {
          if (!c?.norm) continue;
          const msgWords = c.norm.split(/\s+/).filter(Boolean);
          for (let i = 0; i <= msgWords.length - hWords.length; i++) {
            let ok = true;
            for (let j = 0; j < hWords.length; j++) {
              if (msgWords[i + j].replace(/^@+/, '') !== hWords[j]) {
                ok = false;
                break;
              }
            }
            if (ok) return true;
          }
        }
      }
    }
    return false;
  }

  function extractAddressedBotFromText(rawText, botCandidates) {
    const trimmed = String(rawText || '').trim();
    if (!trimmed) return null;

    const tokens = tokenizeWithSpans(trimmed);
    if (tokens.length === 0) return null;

    // Sort bots longest-normalized-name-first so multi-word bot names match before shorter prefixes
    const orderedBots = [...botCandidates].sort((a, b) => {
      const lenA = normalizeArabicForMatch(a.botRecord.username).length;
      const lenB = normalizeArabicForMatch(b.botRecord.username).length;
      return lenB - lenA;
    });

    // Pass 1: Match bot name at START (optionally after "@" or "يا" / "ي")
    // Pass 2: Match bot name ANYWHERE in the sentence with exact whole-word boundaries (e.g. "كيفك ساره", "ما عدد القارات يا سارة؟")
    for (const pass of ['start', 'anywhere']) {
      for (const item of orderedBots) {
        const botNorm = normalizeArabicForMatch(item.botRecord.username);
        const botCompact = normalizeArabicCompact(item.botRecord.username);
        if (!botNorm) continue;

        const botWords = botNorm.split(/\s+/).filter(Boolean);
        const wordCount = botWords.length;
        if (wordCount === 0 || tokens.length < wordCount) continue;

        const maxStartIdx = pass === 'start' ? 1 : tokens.length - wordCount;
        for (let startIdx = 0; startIdx <= maxStartIdx; startIdx++) {
          if (pass === 'start' && startIdx === 1) {
            const firstNorm = normalizeArabicForMatch(tokens[0].text);
            if (firstNorm !== 'يا' && firstNorm !== 'ي') continue;
          }
          if (startIdx + wordCount > tokens.length) continue;

          const spanText = tokens
            .slice(startIdx, startIdx + wordCount)
            .map((t) => t.text)
            .join(' ');
          const spanNorm = normalizeArabicForMatch(spanText);
          const spanCompact = normalizeArabicCompact(spanText);

          const isMatch =
            spanNorm === botNorm ||
            (botCompact.length >= 2 && spanCompact === botCompact);

          if (isMatch) {
            // If bot name is at start, strip prefix+botName so questionText is clean;
            // If bot name is in middle/end (e.g. "كيفك ساره"), keep the full natural sentence so AI sees full intent!
            let questionText = '';
            if (pass === 'start') {
              const endPos = tokens[startIdx + wordCount - 1].end;
              questionText = trimmed
                .slice(endPos)
                .replace(/^[\s:،,\-!؟?.~*|"'«»()[\]{}]+/, '')
                .trim();
            } else {
              const before = trimmed.slice(0, tokens[startIdx].index).trim();
              const after = trimmed.slice(tokens[startIdx + wordCount - 1].end).trim();
              const remainingTokens = tokens.length - wordCount;
              questionText = remainingTokens > 0 ? `${before} ${after}`.trim() : '';
              // Preserve natural phrasing when non-empty
              if (questionText) {
                questionText = trimmed;
              }
            }

            return {
              botUser: item.botUser,
              botRecord: item.botRecord,
              questionText,
              explicitMention: true
            };
          }
        }
      }
    }

    return null;
  }

  function extractAddressedBot(candidates, activeBots, roomId, sender) {
    const enabledBots = [];
    for (const botUser of activeBots) {
      const botRecord = bots.find((item) => getBotLiveId(item.id) === botUser.id);
      if (botRecord && botRecord.enabled) {
        enabledBots.push({ botUser, botRecord });
      }
    }
    if (enabledBots.length === 0) return null;

    // 1. Explicit bot name mention (at start, middle, or end of sentence)
    for (const candidate of candidates) {
      if (!candidate?.raw) continue;
      const hit = extractAddressedBotFromText(candidate.raw, enabledBots);
      if (hit) return hit;
    }

    // 2. Active conversation follow-up (e.g. user replied "انا بخير دامك بخير كيف كان يومك" right after talking to Sara)
    const lowerSender = String(sender?.username || '').trim().toLowerCase();
    const convKey = `${roomId}::${lowerSender}`;
    const conv = activeConversations.get(convKey);
    if (conv) {
      const now = Date.now();
      if (now - conv.updatedAt > ACTIVE_CONVERSATION_TTL_MS) {
        activeConversations.delete(convKey);
        saveBotConversations();
        return null;
      }

      // If user clearly started talking to another human member in the room, step back and close bot session
      if (messageMentionsOtherHumanInRoom(candidates, roomId, sender.id)) {
        activeConversations.delete(convKey);
        saveBotConversations();
        return null;
      }

      const activeTarget = enabledBots.find((item) => item.botRecord.id === conv.botId);
      if (!activeTarget) {
        activeConversations.delete(convKey);
        saveBotConversations();
        return null;
      }

      // Check if user wants to pause/stop bot talking ("خلاص", "اسكت", "اسكتي")
      const firstNorm = candidates[0]?.norm || '';
      if (/^(خلاص|اسكت|اسكتي|توقف|توقفي|بس خلاص)$/u.test(firstNorm)) {
        activeConversations.delete(convKey);
        saveBotConversations();
        return null;
      }

      return {
        botUser: activeTarget.botUser,
        botRecord: activeTarget.botRecord,
        questionText: candidates[0]?.raw || '',
        explicitMention: false,
        isFollowUp: true
      };
    }

    return null;
  }

  function generateSmartLocalFallback(botRecord, senderName, rawText, isPrivate = false) {
    const norm = normalizeArabicForMatch(rawText);
    const personality = botRecord?.personality || 'ودود';

    if (!norm) {
      return isPrivate
        ? `وصلت رسالتك يا ${senderName} 🌹 يسعدني تواصلك معي!`
        : `جميل يا ${senderName} ✨ منورين!`;
    }

    if (/(الله يسلمك|يسلمك|تسلم|الله يعافيك|الله يحييك|النور نورك|بنورك|بوجودك)/u.test(norm)) {
      return `يسعدك ربي يا ${senderName} 🌹 كيف حالك اليوم؟`;
    }
    if (/(تمام|الحمد لله|الحمدلله|بخير|طيب|عال العال|كويس|زين)/u.test(norm)) {
      return personality === 'مرح'
        ? `دوم إن شاء الله يا ${senderName} 😄✨ وش خططك اليوم؟`
        : `دائماً بخير يا ${senderName} 🌹 تشرفنا بسوالفك الطيبة.`;
    }
    if (/(طفش|ملل|زهق|ممل|ضايق|زعلان)/u.test(norm)) {
      return `أفا يا ${senderName} لا للطفش معنا! 😄 وش تحب نسولف فيه أو تحب أقولك نكتة تفرفشك؟ 🌹`;
    }
    if (/(هه|لول|ضحك|😂|🤣)/u.test(rawText) || /(هههه|ضحكتني)/u.test(norm)) {
      return `تدوم الضحكة يا ${senderName} 😂🌹`;
    }
    if (/(احد صاحي|احد هنا|وين الناس|في احد|موجودين|صاحين)/u.test(norm)) {
      return `أنا هنا يا ${senderName} صاحي ومنور معك 👀🌹 كيف أقدر أشاركك السوالف؟`;
    }
    if (/(شاي|قهوه|نسكافيه|كوفي)/u.test(norm)) {
      return `بالعافية عليك يا ${senderName} ☕✨ القهوة تعدل المزاج والله!`;
    }
    if (/(تصبح|نوم|بنام|رايح انام)/u.test(norm)) {
      return `نوم العوافي وأحلام سعيدة يا ${senderName} 🌙✨ نشوفك على خير!`;
    }
    if (/[؟?]$/.test(String(rawText || '').trim()) || /^(ايش|وش|ليش|ليه|كيف|متى|وين|هل|ممكن)/u.test(norm)) {
      return isPrivate
        ? `سؤال جميل يا ${senderName} 🤔🌹 خلينا ندردش فيه؛ وش رأيك أنت في الموضوع؟`
        : `سؤال حلو يا ${senderName} ✨ أنا معكم متابع، شاركنا رأيك!`;
    }

    const pool =
      personality === 'مرح'
        ? [
            `يا سلام عليك يا ${senderName} 😄✨ كلامك يفتح النفس!`,
            `منور السوالف يا ${senderName} 🌹 كمل كمل نسمعك!`,
            `والله إنك رهيب يا ${senderName} 😂✨ وش الجديد عندك؟`
          ]
        : personality === 'رسمي'
        ? [
            `أهلاً بك يا ${senderName}، أقدّر مشاركتك الراقية 🌹`,
            `كلام جميل يا ${senderName}، أتمنى لك وقتاً ممتعاً معنا ✨`
          ]
        : [
            `كلامك جميل يا ${senderName} 🌹 وأنا أتابع معك بكل سرور، وش الأخبار؟`,
            `منورنا والله يا ${senderName} ✨ كيف يومك ماشي معك؟`,
            `يا هلا بك يا ${senderName} 🌹 تسعدني سوالفك دائماً!`
          ];
    return pool[Math.floor(Math.random() * pool.length)];
  }

  function selectAmbientBotInRoom(activeBots, roomId) {
    if (!activeBots || activeBots.length === 0) return null;
    const visibleBots = activeBots.filter((b) => {
      if (b.isGhost) return false;
      const rec = bots.find((item) => getBotLiveId(item.id) === b.id);
      return Boolean(rec && rec.enabled && rec.status !== 'offline' && rec.status !== 'hidden');
    });
    if (visibleBots.length === 0) return null;
    const prevIdx = roomLastAmbientBotIdx.get(roomId) ?? -1;
    const nextIdx = (prevIdx + 1) % visibleBots.length;
    roomLastAmbientBotIdx.set(roomId, nextIdx);
    const botUser = visibleBots[nextIdx];
    const botRecord = bots.find((item) => getBotLiveId(item.id) === botUser.id);
    if (!botRecord || !botRecord.enabled || botRecord.status === 'offline' || botRecord.status === 'hidden') return null;
    return { botUser, botRecord };
  }

  async function processRoomMessageBatch(sender, roomId, items) {
    if (!botSettings.globalEnabled || !botSettings.autoRepliesEnabled) return;
    if (!sender || sender.isBot || !items || items.length === 0) return;

    const activeBots = getActiveBotUsersInRoom(roomId);
    if (activeBots.length === 0) return;

    const lastItem = items[items.length - 1];
    const mergedRawText = items.map((i) => i.rawText).filter(Boolean).join('\n').trim();
    const mergedOriginalText = items.map((i) => i.originalText).filter(Boolean).join('\n').trim();
    const effectiveText = mergedRawText || mergedOriginalText || lastItem.effectiveText;
    const msg = lastItem.msg;
    if (!effectiveText) return;

    const candidates = [effectiveText, mergedOriginalText]
      .filter((t, idx, arr) => Boolean(t) && arr.indexOf(t) === idx)
      .map((t) => ({
        raw: t,
        lower: t.toLowerCase(),
        norm: normalizeArabicForMatch(t),
        compact: normalizeArabicCompact(t)
      }));

    const now = Date.now();
    const lowerSender = sender.username.trim().toLowerCase();
    const convKey = `${roomId}::${lowerSender}`;
    const configuredDelayMs = botSettings.delayedReplyEnabled ? Math.max(0, Number(botSettings.replyDelaySeconds ?? 1)) * 1000 : 0;
    const effectiveTypingDelayMs = configuredDelayMs > 0 ? Math.max(configuredDelayMs, MIN_TYPING_PREVIEW_MS) : MIN_TYPING_PREVIEW_MS;
    const senderDisplay = sender.displayName || sender.username;

    // 0. Check Reply-To target (if member explicitly clicked Reply on a message)
    let addressed = null;
    let replyContextText = '';
    const replyItem = [...items].reverse().find((i) => i.msg?.replyTo?.username);
    if (replyItem?.msg?.replyTo?.username) {
      const replyTargetLower = String(replyItem.msg.replyTo.username).trim().toLowerCase();
      const targetBotUser = activeBots.find((b) => b.username.trim().toLowerCase() === replyTargetLower);
      if (targetBotUser) {
        const targetBotRec = bots.find((item) => getBotLiveId(item.id) === targetBotUser.id);
        if (targetBotRec && targetBotRec.enabled && targetBotRec.status !== 'offline') {
          replyContextText = String(replyItem.msg.replyTo.text || '').trim();
          addressed = {
            botUser: targetBotUser,
            botRecord: targetBotRec,
            questionText: effectiveText,
            explicitMention: true,
            isFollowUp: false
          };
        }
      } else if (replyTargetLower !== lowerSender) {
        activeConversations.delete(convKey);
        saveBotConversations();
        return;
      }
    }

    // 1. Addressed Bot Q&A or Active Conversation Follow-Up
    if (!addressed) {
      addressed = extractAddressedBot(candidates, activeBots, roomId, sender);
    }

    const firstNorm = candidates[0]?.norm || '';
    const isStopPhrase = /^(خلاص|اسكت|اسكتي|توقف|توقفي|بس خلاص|لا ترد|لا تردي)$/u.test(firstNorm);
    if (isStopPhrase) {
      activeConversations.delete(convKey);
      ambientSilenceUntil.set(convKey, now + 3 * 60 * 1000);
      saveBotConversations();
      return;
    }

    const mentionsOtherHuman = messageMentionsOtherHumanInRoom(candidates, roomId, sender.id);

    const dispatchSmartBotReply = async (botUser, botRecord, questionText, options = {}) => {
      const { isAmbient = false } = options;
      const isFarewell = /(مع السلامه|باي|تصبحون على خير|في امان الله|اشوفك على خير|برب|نوم العوافي)/u.test(firstNorm);

      if (isFarewell) {
        activeConversations.delete(convKey);
        saveBotConversations();
      } else {
        ambientSilenceUntil.delete(convKey);
        activeConversations.set(convKey, { botId: botRecord.id, updatedAt: now });
        if (activeConversations.size > 400) {
          for (const [k, v] of activeConversations.entries()) {
            if (now - v.updatedAt > ACTIVE_CONVERSATION_TTL_MS) activeConversations.delete(k);
          }
        }
      }

      if (!questionText) {
        const mentionKey = `${botRecord.id}::${lowerSender}::mention`;
        if (now - (replyCooldowns.get(mentionKey) || 0) >= 4000) {
          replyCooldowns.set(mentionKey, now);
          const replyMsg = `لبيه يا ${senderDisplay}، أنا هنا! تكلم معي أو اسألني وراح أجاوبك 🌹`;
          recordBotTurnInMemory(botRecord.id, sender.username, effectiveText, replyMsg);
          saveBotConversations();
          startRoomBotTyping(botUser, roomId);
          await new Promise((r) => setTimeout(r, effectiveTypingDelayMs));
          if (!botSettings.globalEnabled || !botSettings.autoRepliesEnabled) {
            stopRoomBotTyping(botUser, roomId);
            return;
          }
          const liveBot = users.find((u) => u.id === botUser.id && u.room === roomId);
          if (!liveBot) {
            stopRoomBotTyping(botUser, roomId);
            return;
          }
          sendBotMessage(liveBot, roomId, replyMsg);
        }
        return;
      }

      const normQuestionKey = normalizeArabicForMatch(questionText) || questionText.toLowerCase();
      const qaKey = `${botRecord.id}::${lowerSender}::qa::${normQuestionKey}`;
      if (now - (replyCooldowns.get(qaKey) || 0) < 1500) {
        return;
      }
      replyCooldowns.set(qaKey, now);
      if (replyCooldowns.size > 500) {
        for (const [k, ts] of replyCooldowns.entries()) {
          if (now - ts > 10 * 60 * 1000) replyCooldowns.delete(k);
        }
      }

      const sortedRepliesFallback = [...botReplies]
        .filter((r) => r && r.keyword && r.keyword.trim())
        .sort((a, b) => b.keyword.trim().length - a.keyword.trim().length);

      const qCandidates = [
        {
          raw: questionText,
          lower: questionText.toLowerCase(),
          norm: normalizeArabicForMatch(questionText),
          compact: normalizeArabicCompact(questionText)
        }
      ];

      startRoomBotTyping(botUser, roomId);

      try {
        if (botSettings.smartQaEnabled !== false) {
          const roomObj = chatRooms.find((r) => r.id === roomId);
          const roomName = roomObj?.name || roomId;
          const startedAt = Date.now();

          const aiRes = await askBotAI({
            bot: botRecord,
            personalityDescriptor: getPersonalityDescriptor(botRecord.personality),
            senderName: senderDisplay,
            senderKey: sender.username,
            roomName,
            currentTime: getCurrentTimeString(),
            questionText,
            isAmbient,
            replyContextText
          });

          const elapsed = Date.now() - startedAt;
          const remainingDelay = Math.max(0, effectiveTypingDelayMs - elapsed);
          if (remainingDelay > 0) {
            await new Promise((r) => setTimeout(r, remainingDelay));
          }

          if (!botSettings.globalEnabled || !botSettings.autoRepliesEnabled) {
            stopRoomBotTyping(botUser, roomId);
            return;
          }
          const liveBot = users.find((u) => u.id === botUser.id && u.room === roomId);
          if (!liveBot) {
            stopRoomBotTyping(botUser, roomId);
            return;
          }

          if (aiRes.ok && aiRes.text) {
            if (!isFarewell) {
              activeConversations.set(convKey, { botId: botRecord.id, updatedAt: Date.now() });
            }
            saveBotConversations();
            sendBotMessage(liveBot, roomId, aiRes.text);
            return;
          }

          const fallbackRule = sortedRepliesFallback.find((r) => textMatchesKeyword(qCandidates, r.keyword));
          if (fallbackRule) {
            let replyText = formatReplyTemplate(fallbackRule.reply, senderDisplay, botRecord);
            const normKw = normalizeArabicForMatch(fallbackRule.keyword);
            if (normKw === 'كم الساعه' && !fallbackRule.reply.includes('{الوقت الحقيقي}')) {
              replyText = `${replyText} (${getCurrentTimeString()})`;
            }
            recordBotTurnInMemory(botRecord.id, sender.username, questionText, replyText);
            saveBotConversations();
            sendBotMessage(liveBot, roomId, replyText);
            return;
          }

          console.warn(`[BotAI] Fallback triggered for bot "${botRecord.username}" (${aiRes.errorCode}): ${aiRes.errorMessage}`);
          const localReply = generateSmartLocalFallback(botRecord, senderDisplay, questionText, false);
          recordBotTurnInMemory(botRecord.id, sender.username, questionText, localReply);
          saveBotConversations();
          sendBotMessage(liveBot, roomId, localReply);
          return;
        }

        // smartQaEnabled === false -> keyword match or smart local reply
        const matchedRuleLocal = sortedRepliesFallback.find((r) => textMatchesKeyword(qCandidates, r.keyword));
        const replyText = matchedRuleLocal
          ? formatReplyTemplate(matchedRuleLocal.reply, senderDisplay, botRecord)
          : generateSmartLocalFallback(botRecord, senderDisplay, questionText, false);
        await new Promise((r) => setTimeout(r, effectiveTypingDelayMs));
        if (!botSettings.globalEnabled || !botSettings.autoRepliesEnabled) {
          stopRoomBotTyping(botUser, roomId);
          return;
        }
        const liveBot = users.find((u) => u.id === botUser.id && u.room === roomId);
        if (!liveBot) {
          stopRoomBotTyping(botUser, roomId);
          return;
        }
        recordBotTurnInMemory(botRecord.id, sender.username, questionText, replyText);
        saveBotConversations();
        sendBotMessage(liveBot, roomId, replyText);
      } catch (err) {
        stopRoomBotTyping(botUser, roomId);
        console.error('[BotAI] Unhandled async error:', err);
      }
    };

    if (addressed) {
      await dispatchSmartBotReply(addressed.botUser, addressed.botRecord, addressed.questionText, {
        isAmbient: false
      });
      return;
    }

    if (mentionsOtherHuman) {
      return;
    }

    // 2. General Keyword Dictionary ("كلمات البوت") when not explicitly addressed
    const sortedReplies = [...botReplies]
      .filter((r) => r && r.keyword && r.keyword.trim())
      .sort((a, b) => b.keyword.trim().length - a.keyword.trim().length);

    const matchedRule = sortedReplies.find((r) => textMatchesKeyword(candidates, r.keyword));

    if (matchedRule) {
      const responder = activeBots.find((b) => {
        if (b.isGhost) return false;
        const rec = bots.find((item) => getBotLiveId(item.id) === b.id);
        if (!rec || !rec.enabled || rec.status === 'offline' || rec.status === 'hidden') return false;
        const cKey = `${rec.id}::${lowerSender}::kw::${matchedRule.id}`;
        return now - (replyCooldowns.get(cKey) || 0) >= 5 * 1000;
      });

      if (responder) {
        const botRecord = bots.find((item) => getBotLiveId(item.id) === responder.id);
        if (botRecord) {
          replyCooldowns.set(`${botRecord.id}::${lowerSender}::kw::${matchedRule.id}`, now);

          let replyText = formatReplyTemplate(matchedRule.reply, senderDisplay, botRecord);
          const normKw = normalizeArabicForMatch(matchedRule.keyword);
          if (normKw === 'كم الساعه' && !matchedRule.reply.includes('{الوقت الحقيقي}')) {
            replyText = `${replyText} (${getCurrentTimeString()})`;
          }
          if (normKw === 'من انت' && !replyText.includes(botRecord.username)) {
            replyText = `أنا ${botRecord.username} (${botRecord.personality}) — ${replyText}`;
          }

          activeConversations.set(convKey, { botId: botRecord.id, updatedAt: now });
          startRoomBotTyping(responder, roomId);

          await new Promise((r) => setTimeout(r, effectiveTypingDelayMs));
          if (!botSettings.globalEnabled || !botSettings.autoRepliesEnabled) {
            stopRoomBotTyping(responder, roomId);
            return;
          }
          const liveBot = users.find((u) => u.id === responder.id && u.room === roomId);
          if (!liveBot) {
            stopRoomBotTyping(responder, roomId);
            return;
          }
          recordBotTurnInMemory(botRecord.id, sender.username, effectiveText, replyText);
          saveBotConversations();
          sendBotMessage(liveBot, roomId, replyText);
          return;
        }
      }
    }

    // 3. Ambient Conversational Keep-Up (المسايرة والمجاراة التلقائية حتى بدون ذكر اسم البوت)
    if (ambientSilenceUntil.size > 300) {
      for (const [k, until] of ambientSilenceUntil.entries()) {
        if (now >= until) ambientSilenceUntil.delete(k);
      }
    }
    const silencedUntil = ambientSilenceUntil.get(convKey) || 0;
    if (now < silencedUntil) {
      return;
    }

    if (!mergedRawText && !mergedOriginalText) {
      return;
    }

    const lastAmbientAt = roomAmbientLastReplyAt.get(roomId) || 0;
    if (now - lastAmbientAt < AMBIENT_ROOM_COOLDOWN_MS) {
      return;
    }

    const picked = selectAmbientBotInRoom(activeBots, roomId);
    if (picked) {
      roomAmbientLastReplyAt.set(roomId, now);
      await dispatchSmartBotReply(picked.botUser, picked.botRecord, effectiveText, {
        isAmbient: true
      });
    }
  }

  async function drainRoomQueue(queueKey, roomId) {
    const rq = roomQueues.get(queueKey);
    if (!rq || rq.processing) return;
    rq.processing = true;
    try {
      while (rq.messages.length > 0) {
        const items = rq.messages.splice(0, rq.messages.length);
        await processRoomMessageBatch(rq.sender, roomId, items);
      }
    } finally {
      rq.processing = false;
      if (rq.messages.length === 0 && !rq.timer) {
        roomQueues.delete(queueKey);
      }
    }
  }

  function onRoomMessage(sender, msg, rawOriginalText = '') {
    if (!botSettings.globalEnabled || !botSettings.autoRepliesEnabled) return;
    if (!sender || sender.isBot) return;
    if (!msg) return;

    const rawText = typeof msg.text === 'string' ? msg.text.trim() : '';
    const originalText = typeof rawOriginalText === 'string' ? rawOriginalText.trim() : '';
    const hasMediaAttachment = Boolean(msg.mediaUrl || msg.voiceNote);
    if (!rawText && !originalText && !hasMediaAttachment) return;

    const roomId = sender.room;
    const activeBots = getActiveBotUsersInRoom(roomId);
    if (activeBots.length === 0) return;

    const effectiveText = rawText || originalText || (msg.voiceNote ? '[أرسل رسالة صوتية]' : '[أرسل صورة أو ملصق]');
    const lowerSender = sender.username.trim().toLowerCase();
    const queueKey = `${roomId}::${lowerSender}`;

    // Immediate stop phrase check: abort queued items & silence right away
    const normCheck = normalizeArabicForMatch(effectiveText);
    if (/^(خلاص|اسكت|اسكتي|توقف|توقفي|بس خلاص|لا ترد|لا تردي)$/u.test(normCheck)) {
      const existingQ = roomQueues.get(queueKey);
      if (existingQ?.timer) {
        clearTimeout(existingQ.timer);
      }
      roomQueues.delete(queueKey);
      activeConversations.delete(queueKey);
      ambientSilenceUntil.set(queueKey, Date.now() + 3 * 60 * 1000);
      saveBotConversations();
      for (const b of activeBots) {
        stopRoomBotTyping(b, roomId);
      }
      return;
    }

    let rq = roomQueues.get(queueKey);
    if (!rq) {
      rq = { messages: [], timer: null, processing: false, sender };
      roomQueues.set(queueKey, rq);
    } else {
      rq.sender = sender;
    }

    rq.messages.push({ rawText, originalText, effectiveText, msg });

    if (rq.timer) {
      clearTimeout(rq.timer);
      rq.timer = null;
    }

    rq.timer = setTimeout(() => {
      rq.timer = null;
      drainRoomQueue(queueKey, roomId);
    }, 240);
  }

  async function processPrivateMessageBatch(queueKey, batchText, sender, botRecord, lastPm) {
    const senderDisplay = sender.displayName || sender.username;

    // Strip optional leading mention of the bot's own name
    let questionText = batchText;
    const botNorm = normalizeArabicForMatch(botRecord.username);
    if (botNorm) {
      const escapedBot = botRecord.username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const leadingBotRe = new RegExp(`^[@꧁✿★]*\\s*${escapedBot}[\\s:،,\\-!؟?.]*`, 'iu');
      const stripped = batchText.replace(leadingBotRe, '').trim();
      if (stripped) questionText = stripped;
    }

    const configuredDelayMs = botSettings.delayedReplyEnabled
      ? Math.max(0, Number(botSettings.replyDelaySeconds ?? 1)) * 1000
      : 0;
    const effectiveTypingDelayMs = configuredDelayMs > 0 ? Math.max(configuredDelayMs, MIN_TYPING_PREVIEW_MS) : MIN_TYPING_PREVIEW_MS;

    // Emit typing indicator with heartbeat refresh so it never expires during AI thinking
    startPmBotTyping(botRecord, sender);

    const candidates = [
      {
        raw: questionText,
        lower: questionText.toLowerCase(),
        norm: normalizeArabicForMatch(questionText),
        compact: normalizeArabicCompact(questionText)
      }
    ];
    if (batchText !== questionText) {
      candidates.push({
        raw: batchText,
        lower: batchText.toLowerCase(),
        norm: normalizeArabicForMatch(batchText),
        compact: normalizeArabicCompact(batchText)
      });
    }

    const sortedReplies = [...botReplies]
      .filter((r) => r && r.keyword && r.keyword.trim())
      .sort((a, b) => b.keyword.trim().length - a.keyword.trim().length);

    try {
      if (botSettings.smartQaEnabled !== false) {
        const startedAt = Date.now();
        const aiRes = await askBotAI({
          bot: botRecord,
          personalityDescriptor: getPersonalityDescriptor(botRecord.personality),
          senderName: senderDisplay,
          senderKey: sender.username,
          roomName: 'المحادثة الخاصة',
          currentTime: getCurrentTimeString(),
          questionText,
          isPrivate: true
        });

        const elapsed = Date.now() - startedAt;
        const remainingDelay = Math.max(0, effectiveTypingDelayMs - elapsed);
        if (remainingDelay > 0) {
          await new Promise((r) => setTimeout(r, remainingDelay));
        }

        if (!botSettings.globalEnabled || !botSettings.autoRepliesEnabled || botSettings.privateRepliesEnabled === false) {
          stopPmBotTyping(botRecord, sender);
          return;
        }
        const latestBot = bots.find((b) => b.id === botRecord.id);
        if (!latestBot || !latestBot.enabled || latestBot.status === 'offline') {
          stopPmBotTyping(botRecord, sender);
          return;
        }

        if (aiRes.ok && aiRes.text) {
          saveBotConversations();
          sendBotPrivateMessage(latestBot, sender, aiRes.text, lastPm);
          return;
        }

        // Fallback 1: keyword dictionary
        const fallbackRule = sortedReplies.find((r) => textMatchesKeyword(candidates, r.keyword));
        if (fallbackRule) {
          let replyText = formatReplyTemplate(fallbackRule.reply, senderDisplay, latestBot);
          const normKw = normalizeArabicForMatch(fallbackRule.keyword);
          if (normKw === 'كم الساعه' && !fallbackRule.reply.includes('{الوقت الحقيقي}')) {
            replyText = `${replyText} (${getCurrentTimeString()})`;
          }
          if (normKw === 'من انت' && !replyText.includes(latestBot.username)) {
            replyText = `أنا ${latestBot.username} (${latestBot.personality}) — ${replyText}`;
          }
          recordBotTurnInMemory(latestBot.id, sender.username, questionText, replyText);
          saveBotConversations();
          sendBotPrivateMessage(latestBot, sender, replyText, lastPm);
          return;
        }

        // Fallback 2: smart local conversational reply so PM NEVER drops or goes unanswered
        console.warn(`[BotAI][PM] Local fallback for bot "${latestBot.username}" (${aiRes.errorCode}): ${aiRes.errorMessage}`);
        const localReply = generateSmartLocalFallback(latestBot, senderDisplay, questionText, true);
        recordBotTurnInMemory(latestBot.id, sender.username, questionText, localReply);
        saveBotConversations();
        sendBotPrivateMessage(latestBot, sender, localReply, lastPm);
        return;
      }

      // smartQaEnabled === false -> keyword dictionary or smart local reply
      const matchedRule = sortedReplies.find((r) => textMatchesKeyword(candidates, r.keyword));
      let replyText = '';
      if (matchedRule) {
        replyText = formatReplyTemplate(matchedRule.reply, senderDisplay, botRecord);
        const normKw = normalizeArabicForMatch(matchedRule.keyword);
        if (normKw === 'كم الساعه' && !matchedRule.reply.includes('{الوقت الحقيقي}')) {
          replyText = `${replyText} (${getCurrentTimeString()})`;
        }
        if (normKw === 'من انت' && !replyText.includes(botRecord.username)) {
          replyText = `أنا ${botRecord.username} (${botRecord.personality}) — ${replyText}`;
        }
      } else {
        replyText = generateSmartLocalFallback(botRecord, senderDisplay, questionText, true);
      }

      await new Promise((r) => setTimeout(r, effectiveTypingDelayMs));
      const latestBot = bots.find((b) => b.id === botRecord.id);
      if (!latestBot || !latestBot.enabled || latestBot.status === 'offline' || !botSettings.globalEnabled || !botSettings.autoRepliesEnabled || botSettings.privateRepliesEnabled === false) {
        stopPmBotTyping(botRecord, sender);
        return;
      }
      recordBotTurnInMemory(latestBot.id, sender.username, batchText, replyText);
      saveBotConversations();
      sendBotPrivateMessage(latestBot, sender, replyText, lastPm);
    } catch (err) {
      console.error('[BotAI][PM] Unhandled batch error:', err);
      stopPmBotTyping(botRecord, sender);
    }
  }

  async function drainPrivateQueue(queueKey) {
    const q = pmQueues.get(queueKey);
    if (!q || q.processing) return;
    q.processing = true;
    try {
      while (q.messages.length > 0) {
        const items = q.messages.splice(0, q.messages.length);
        const batchText = items.map((i) => i.text).filter(Boolean).join('\n');
        const lastItem = items[items.length - 1];
        if (batchText) {
          await processPrivateMessageBatch(queueKey, batchText, lastItem.sender, q.botRecord, lastItem.pm);
        }
      }
    } finally {
      q.processing = false;
      if (q.messages.length === 0 && !q.timer) {
        pmQueues.delete(queueKey);
      }
    }
  }

  /**
   * @param {any} sender
   * @param {string} targetBotUsername
   * @param {string} rawText
   * @param {any} [incomingPm]
   */
  function onPrivateMessage(sender, targetBotUsername, rawText, incomingPm = null) {
    if (!botSettings.globalEnabled || !botSettings.autoRepliesEnabled || botSettings.privateRepliesEnabled === false) {
      return false;
    }
    if (!sender || sender.isBot) return false;

    let text = String(rawText || '').trim();
    if (!text && incomingPm) {
      if (incomingPm.voiceNote) text = '[أرسل رسالة صوتية]';
      else if (incomingPm.mediaUrl) text = '[أرسل صورة أو ملصق]';
    }
    if (!text) return false;

    const cleanTarget = String(targetBotUsername || '').trim().toLowerCase();
    const normTarget = normalizeArabicForMatch(targetBotUsername);
    const botRecord =
      bots.find((b) => b.username.trim().toLowerCase() === cleanTarget) ||
      bots.find((b) => normalizeArabicForMatch(b.username) === normTarget);

    if (!botRecord || !botRecord.enabled || botRecord.status === 'offline') {
      return false;
    }

    const now = Date.now();
    const lowerSender = String(sender.username || '').trim().toLowerCase();

    // Mark incoming message(s) to this bot as read immediately
    if (privateChatHistory && getPmPairKey && savePrivateChatHistory) {
      const pairKey = getPmPairKey(sender.username, botRecord.username);
      const historyList = privateChatHistory.get(pairKey);
      if (historyList) {
        let changed = false;
        const botLower = botRecord.username.trim().toLowerCase();
        for (const m of historyList) {
          if (m && String(m.toUsername || '').trim().toLowerCase() === botLower && m.status !== 'read') {
            m.status = 'read';
            m.readAt = now;
            changed = true;
          }
        }
        if (changed) {
          savePrivateChatHistory();
        }
      }
    }

    if (sender.id && io.sockets.sockets.get(sender.id)?.connected) {
      io.to(sender.id).emit('privateMessagesRead', { byUsername: botRecord.username, readAt: now });
    }

    // Queue & micro-batch rapid consecutive lines (320ms) instead of dropping fast messages!
    const queueKey = `${botRecord.id}::${lowerSender}`;
    let q = pmQueues.get(queueKey);
    if (!q) {
      q = { messages: [], timer: null, processing: false, botRecord };
      pmQueues.set(queueKey, q);
    } else {
      q.botRecord = botRecord;
    }

    q.messages.push({ text, sender, pm: incomingPm });

    if (q.timer) {
      clearTimeout(q.timer);
      q.timer = null;
    }

    q.timer = setTimeout(() => {
      q.timer = null;
      drainPrivateQueue(queueKey);
    }, 320);

    return true;
  }

  function onBotKicked(botUsername, kickedFromRoom) {
    const bot = bots.find((b) => b.username.toLowerCase() === String(botUsername || '').trim().toLowerCase());
    if (!bot) return false;

    clearBotHopTimer(bot.id);
    clearBotRejoinTimer(bot.id);
    stopAllTypingForBot(bot);
    const affectedRooms = removeLiveUserForBot(bot.id);
    if (kickedFromRoom) affectedRooms.push(kickedFromRoom);
    broadcastPresenceForRooms(new Set(affectedRooms));

    if (botSettings.globalEnabled && bot.enabled && botSettings.autoRejoinOnKick) {
      const returnRoom = resolveValidRoom(kickedFromRoom || bot.currentRoom || bot.defaultRoom);
      const waitSeconds = Math.max(1, Number(botSettings.kickRejoinDelaySeconds ?? 10));
      kickedBotsPendingRejoin.add(bot.id);

      const timer = setTimeout(() => {
        perBotRejoinTimers.delete(bot.id);
        kickedBotsPendingRejoin.delete(bot.id);

        const latestBot = bots.find((b) => b.id === bot.id);
        if (!latestBot || !botSettings.globalEnabled || !latestBot.enabled) {
          return;
        }

        latestBot.currentRoom = returnRoom;
        latestBot.updatedAt = Date.now();
        saveBots();
        upsertRegisteredMemberForBot(latestBot);
        syncBotLiveUser(latestBot);
        broadcastPresenceForRooms(new Set([returnRoom]));

        const liveBot = users.find((u) => u.id === getBotLiveId(latestBot.id));
        if (liveBot && !liveBot.isGhost) {
          emitBotEnterMessage(latestBot, returnRoom);
        }

        notifyStateChanged();
      }, waitSeconds * 1000);

      perBotRejoinTimers.set(bot.id, timer);
    }

    notifyStateChanged();
    return true;
  }

  function isBotUsername(username) {
    if (!username) return false;
    const clean = String(username).trim().toLowerCase();
    return bots.some((b) => b.username.trim().toLowerCase() === clean);
  }

  function createBot(payload) {
    if (!payload || typeof payload !== 'object') {
      throw new Error('بيانات البوت غير صالحة.');
    }
    const cleanName = sanitizeBotText(payload.username, 40);
    const avatarUrl = sanitizeBotAvatarUrl(payload.avatarUrl);
    const status = payload.status;
    const statusQuote = sanitizeBotText(payload.statusQuote, 160);
    const defaultRoom = resolveValidRoom(payload.defaultRoom);
    const personality = payload.personality;
    const note = sanitizeBotText(payload.note, 300);

    if (!cleanName || !avatarUrl || !status || !statusQuote || !defaultRoom || !personality) {
      throw new Error('جميع الحقول إجبارية ويجب أن يكون رابط الصورة صالحاً.');
    }
    if (RESERVED_BOT_NAMES.has(cleanName.toLowerCase())) {
      throw new Error('لا يمكن استخدام اسم محجوز للنظام كاسم بوت.');
    }
    if (!['online', 'offline', 'away', 'hidden'].includes(status)) {
      throw new Error('حالة البوت غير صالحة.');
    }
    if (!['ودود', 'رسمي', 'مرح', 'ذكي'].includes(personality)) {
      throw new Error('شخصية البوت غير صالحة.');
    }

    const collisionMember = Object.keys(registeredMembers).find((k) => k.toLowerCase() === cleanName.toLowerCase());
    if (collisionMember && !isBotUsername(cleanName)) {
      throw new Error(`الاسم [${cleanName}] مستخدم بالفعل لعضو حقيقي في الشات.`);
    }
    if (bots.some((b) => b.username.toLowerCase() === cleanName.toLowerCase())) {
      throw new Error(`يوجد بوت بنفس الاسم [${cleanName}] بالفعل.`);
    }

    const flag = sanitizeBotText(payload.flag || '🇸🇦', 12) || '🇸🇦';

    const newBot = {
      id: `b-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      username: cleanName,
      avatarUrl,
      status,
      statusQuote,
      defaultRoom,
      currentRoom: defaultRoom,
      personality,
      note,
      flag,
      enabled: payload.enabled !== false,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    bots.push(newBot);
    saveBots();
    upsertRegisteredMemberForBot(newBot);
    syncBotLiveUser(newBot);
    broadcastPresenceForRooms(new Set([newBot.currentRoom]));
    if (botSettings.globalEnabled && newBot.enabled) {
      emitBotEnterMessage(newBot, newBot.currentRoom);
    }
    notifyStateChanged();
    return newBot;
  }

  function updateBot(botId, payload) {
    if (!payload || typeof payload !== 'object') {
      throw new Error('بيانات تحديث البوت غير صالحة.');
    }
    const idx = bots.findIndex((b) => b.id === botId);
    if (idx === -1) throw new Error('البوت غير موجود.');

    const prev = bots[idx];
    const cleanName = payload.username !== undefined ? sanitizeBotText(payload.username, 40) : prev.username;
    const avatarUrl = payload.avatarUrl !== undefined ? sanitizeBotAvatarUrl(payload.avatarUrl) : prev.avatarUrl;
    const status = payload.status ?? prev.status;
    const statusQuote = payload.statusQuote !== undefined ? sanitizeBotText(payload.statusQuote, 160) : prev.statusQuote;
    const defaultRoom = resolveValidRoom(payload.defaultRoom ?? prev.defaultRoom);
    const personality = payload.personality ?? prev.personality;
    const note = payload.note !== undefined ? sanitizeBotText(payload.note, 300) : (prev.note || '');
    const flag = payload.flag !== undefined ? (sanitizeBotText(payload.flag, 12) || '🇸🇦') : (prev.flag || '🇸🇦');

    if (!cleanName || !avatarUrl || !status || !statusQuote || !defaultRoom || !personality) {
      throw new Error('جميع الحقول إجبارية ويجب أن يكون رابط الصورة صالحاً.');
    }
    if (RESERVED_BOT_NAMES.has(cleanName.toLowerCase())) {
      throw new Error('لا يمكن استخدام اسم محجوز للنظام كاسم بوت.');
    }
    if (!['online', 'offline', 'away', 'hidden'].includes(status)) {
      throw new Error('حالة البوت غير صالحة.');
    }
    if (!['ودود', 'رسمي', 'مرح', 'ذكي'].includes(personality)) {
      throw new Error('شخصية البوت غير صالحة.');
    }

    if (cleanName.toLowerCase() !== prev.username.toLowerCase()) {
      const collisionMember = Object.keys(registeredMembers).find((k) => k.toLowerCase() === cleanName.toLowerCase());
      if (collisionMember) {
        throw new Error(`الاسم [${cleanName}] مستخدم بالفعل.`);
      }
      if (bots.some((b) => b.id !== botId && b.username.toLowerCase() === cleanName.toLowerCase())) {
        throw new Error(`يوجد بوت آخر بنفس الاسم [${cleanName}].`);
      }
    }

    const oldRoom = prev.currentRoom;
    const nextRoom = payload.defaultRoom && payload.defaultRoom !== prev.defaultRoom ? defaultRoom : (prev.currentRoom || defaultRoom);

    const updated = {
      ...prev,
      username: cleanName,
      avatarUrl,
      status,
      statusQuote,
      defaultRoom,
      currentRoom: nextRoom,
      personality,
      note,
      flag,
      enabled: payload.enabled !== undefined ? Boolean(payload.enabled) : prev.enabled,
      updatedAt: Date.now()
    };

    stopAllTypingForBot(updated);
    bots[idx] = updated;
    saveBots();
    upsertRegisteredMemberForBot(updated, prev.username);
    syncBotLiveUser(updated);
    if (botSettings.globalEnabled && updated.enabled && oldRoom && updated.currentRoom && oldRoom !== updated.currentRoom) {
      emitBotLeaveMessage(updated, oldRoom, updated.currentRoom);
    }
    broadcastPresenceForRooms(new Set([oldRoom, updated.currentRoom]));
    if (botSettings.globalEnabled && updated.enabled && oldRoom && updated.currentRoom && oldRoom !== updated.currentRoom) {
      emitBotEnterMessage(updated, updated.currentRoom);
    }
    notifyStateChanged();
    return updated;
  }

  function deleteBot(botId) {
    const idx = bots.findIndex((b) => b.id === botId);
    if (idx === -1) throw new Error('البوت غير موجود.');

    const removed = bots.splice(idx, 1)[0];
    clearBotHopTimer(botId);
    clearBotRejoinTimer(botId);
    stopAllTypingForBot(removed);

    const affectedRooms = removeLiveUserForBot(botId);
    if (removed.currentRoom) affectedRooms.push(removed.currentRoom);

    const regKey = Object.keys(registeredMembers).find((k) => k.toLowerCase() === removed.username.toLowerCase());
    if (regKey && registeredMembers[regKey]?.isBot) {
      delete registeredMembers[regKey];
      saveMembers();
    }

    saveBots();
    deleteBotMemories(botId);
    for (const [k, v] of activeConversations.entries()) {
      if (v?.botId === botId) activeConversations.delete(k);
    }
    saveBotConversations();
    if (botSettings.globalEnabled && removed.enabled) {
      emitBotLeaveMessage(removed, removed.currentRoom);
    }
    broadcastPresenceForRooms(new Set(affectedRooms));
    notifyStateChanged();
    return removed;
  }

  function toggleBotEnabled(botId, nextEnabled) {
    const bot = bots.find((b) => b.id === botId);
    if (!bot) throw new Error('البوت غير موجود.');

    const wasEnabled = Boolean(bot.enabled);
    bot.enabled = typeof nextEnabled === 'boolean' ? nextEnabled : !bot.enabled;
    bot.updatedAt = Date.now();
    if (!bot.enabled) {
      clearBotHopTimer(bot.id);
      clearBotRejoinTimer(bot.id);
      stopAllTypingForBot(bot);
    }

    saveBots();
    const { oldRoom, newRoom } = syncBotLiveUser(bot);
    if (botSettings.globalEnabled && wasEnabled && !bot.enabled) {
      emitBotLeaveMessage(bot, bot.currentRoom);
    }
    broadcastPresenceForRooms(new Set([oldRoom, newRoom, bot.currentRoom]));
    if (botSettings.globalEnabled && !wasEnabled && bot.enabled) {
      emitBotEnterMessage(bot, bot.currentRoom);
    }
    notifyStateChanged();
    return bot;
  }

  function updateSettings(partial) {
    const wasGlobalEnabled = Boolean(botSettings.globalEnabled);
    const next = { ...botSettings };
    if (typeof partial.globalEnabled === 'boolean') next.globalEnabled = partial.globalEnabled;
    if (typeof partial.autoHopEnabled === 'boolean') next.autoHopEnabled = partial.autoHopEnabled;
    if (typeof partial.autoRejoinOnKick === 'boolean') next.autoRejoinOnKick = partial.autoRejoinOnKick;
    if (partial.kickRejoinDelaySeconds !== undefined) {
      next.kickRejoinDelaySeconds = Math.max(1, Math.min(3600, Number(partial.kickRejoinDelaySeconds) || 10));
    }
    if (typeof partial.autoRepliesEnabled === 'boolean') next.autoRepliesEnabled = partial.autoRepliesEnabled;
    if (typeof partial.privateRepliesEnabled === 'boolean') next.privateRepliesEnabled = partial.privateRepliesEnabled;
    if (typeof partial.smartQaEnabled === 'boolean') next.smartQaEnabled = partial.smartQaEnabled;
    if (typeof partial.welcomeEnabled === 'boolean') next.welcomeEnabled = partial.welcomeEnabled;
    if (typeof partial.delayedReplyEnabled === 'boolean') next.delayedReplyEnabled = partial.delayedReplyEnabled;
    if (partial.replyDelaySeconds !== undefined) {
      next.replyDelaySeconds = Math.max(0, Math.min(60, Number(partial.replyDelaySeconds) || 2));
    }
    if (partial.hopMode === 'random' || partial.hopMode === 'selected') {
      next.hopMode = partial.hopMode;
    }
    if (partial.hopIntervalMinutes !== undefined) {
      next.hopIntervalMinutes = Math.max(1, Math.min(1440, Number(partial.hopIntervalMinutes) || 5));
    }
    if (Array.isArray(partial.selectedHopRooms)) {
      next.selectedHopRooms = partial.selectedHopRooms.filter((r) => typeof r === 'string');
    }

    botSettings = next;
    saveBotSettings();

    if (!botSettings.globalEnabled) {
      if (wasGlobalEnabled) {
        for (const bot of bots) {
          if (bot.enabled) emitBotLeaveMessage(bot, bot.currentRoom);
        }
      }
      clearAllTimers();
    }
    syncAllBotsToChat();
    if (!wasGlobalEnabled && botSettings.globalEnabled) {
      for (const bot of bots) {
        if (bot.enabled) emitBotEnterMessage(bot, bot.currentRoom);
      }
    }
    notifyStateChanged();
    return botSettings;
  }

  function addBotReply(keyword, reply) {
    const cleanKw = sanitizeBotText(keyword, 80);
    const cleanReply = sanitizeBotText(reply, 500);
    if (!cleanKw || !cleanReply) {
      throw new Error('يرجى إدخال الكلمة والرد.');
    }

    const item = {
      id: `br-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      keyword: cleanKw,
      reply: cleanReply
    };
    botReplies.unshift(item);
    saveBotReplies();
    notifyStateChanged();
    return item;
  }

  function updateBotReply(id, keyword, reply) {
    const item = botReplies.find((r) => r.id === id);
    if (!item) throw new Error('الرد غير موجود.');
    const cleanKw = sanitizeBotText(keyword, 80);
    const cleanReply = sanitizeBotText(reply, 500);
    if (!cleanKw || !cleanReply) {
      throw new Error('يرجى إدخال الكلمة والرد.');
    }
    item.keyword = cleanKw;
    item.reply = cleanReply;
    saveBotReplies();
    notifyStateChanged();
    return item;
  }

  function deleteBotReply(id) {
    const idx = botReplies.findIndex((r) => r.id === id);
    if (idx === -1) throw new Error('الرد غير موجود.');
    const removed = botReplies.splice(idx, 1)[0];
    saveBotReplies();
    notifyStateChanged();
    return removed;
  }

  function getPublicState() {
    return {
      settings: { ...botSettings },
      bots: bots.map((b) => ({ ...b })),
      botReplies: botReplies.map((r) => ({ ...r }))
    };
  }

  function rehydrateFromStorage(isBoot = false) {
    try {
      clearAllTimers();

      const loadedSettings = dataManager.loadSync('bot_settings', null);
      if (loadedSettings && typeof loadedSettings === 'object') {
        botSettings = { ...DEFAULT_BOT_SETTINGS, ...loadedSettings };
      }

      const loadedBots = dataManager.loadSync('bots', null);
      if (Array.isArray(loadedBots)) {
        const sanitizedBots = [];
        let repairedAny = false;

        for (const raw of loadedBots) {
          if (!raw || typeof raw !== 'object') {
            repairedAny = true;
            continue;
          }
          const resolvedUsername = String(raw.username || raw.name || '').trim();
          if (!resolvedUsername) {
            repairedAny = true;
            continue;
          }
          if (!raw.username || !raw.id) repairedAny = true;

          sanitizedBots.push({
            ...raw,
            id: raw.id || `b-legacy-${resolvedUsername.toLowerCase().replace(/\s+/g, '_')}`,
            username: resolvedUsername,
            avatarUrl: raw.avatarUrl || DEFAULT_FALLBACK_BOT_AVATAR,
            status: ['online', 'offline', 'away', 'hidden'].includes(raw.status) ? raw.status : 'online',
            statusQuote: String(raw.statusQuote || 'أهلاً بكم في الشات').trim(),
            defaultRoom: resolveValidRoom(raw.defaultRoom || raw.currentRoom),
            currentRoom: resolveValidRoom(raw.currentRoom || raw.defaultRoom),
            personality: ['ودود', 'رسمي', 'مرح', 'ذكي'].includes(raw.personality) ? raw.personality : 'ودود',
            flag: String(raw.flag || '🇸🇦').trim() || '🇸🇦',
            note: raw.note ? String(raw.note) : '',
            enabled: raw.enabled !== false
          });
        }

        bots = sanitizedBots;
        if (repairedAny && !isBoot) {
          saveBots();
        }
      }

      const loadedReplies = dataManager.loadSync('botReplies', null);
      if (Array.isArray(loadedReplies)) {
        botReplies = loadedReplies.filter((r) => r && typeof r.keyword === 'string' && typeof r.reply === 'string');
      } else if (isBoot || botReplies.length === 0) {
        botReplies = DEFAULT_BOT_REPLIES.map((item) => ({ ...item }));
        saveBotReplies();
      }

      const loadedConversations = dataManager.loadSync('bot_conversations', null);
      if (loadedConversations && typeof loadedConversations === 'object') {
        const now = Date.now();
        activeConversations.clear();
        if (loadedConversations.sessions && typeof loadedConversations.sessions === 'object') {
          for (const [k, v] of Object.entries(loadedConversations.sessions)) {
            if (v && v.botId && now - (Number(v.updatedAt) || 0) <= ACTIVE_CONVERSATION_TTL_MS) {
              activeConversations.set(k, { botId: v.botId, updatedAt: Number(v.updatedAt) });
            }
          }
        }
        if (loadedConversations.memories && typeof loadedConversations.memories === 'object') {
          hydrateConversationMemory(loadedConversations.memories);
        }
      }

      syncAllBotsToChat();
      notifyStateChanged();
      if (!isBoot) {
        console.log(`🤖 [BotEngine] Rehydrated ${bots.length} bots and ${botReplies.length} replies from storage.`);
      }
    } catch (err) {
      console.error('[BotEngine] Error rehydrating from storage:', err);
    }
  }

  function onRoomDeleted(deletedRoomId) {
    const cleanDeleted = String(deletedRoomId || '').trim();
    if (!cleanDeleted) return;

    if (Array.isArray(botSettings.selectedHopRooms) && botSettings.selectedHopRooms.includes(cleanDeleted)) {
      botSettings.selectedHopRooms = botSettings.selectedHopRooms.filter((r) => r !== cleanDeleted);
      saveBotSettings();
    }

    const affectedRooms = new Set();
    let botsChanged = false;
    const fallbackRoom = resolveValidRoom('الغرفة العامة');

    for (const bot of bots) {
      if (!bot) continue;
      const hadDeletedDefault = bot.defaultRoom === cleanDeleted;
      const hadDeletedCurrent = bot.currentRoom === cleanDeleted;
      if (!hadDeletedDefault && !hadDeletedCurrent) continue;

      botsChanged = true;
      stopAllTypingForBot(bot);
      if (hadDeletedDefault) {
        bot.defaultRoom = fallbackRoom;
      }
      if (hadDeletedCurrent) {
        const dest = resolveValidRoom(bot.defaultRoom);
        bot.currentRoom = dest;
        bot.updatedAt = Date.now();
        affectedRooms.add(dest);
        syncBotLiveUser(bot);
        if (botSettings.globalEnabled && bot.enabled && !kickedBotsPendingRejoin.has(bot.id)) {
          emitBotEnterMessage(bot, dest);
        }
      }
    }

    if (botsChanged) {
      saveBots();
      broadcastPresenceForRooms(affectedRooms);
      notifyStateChanged();
    }
  }

  function pruneStaleBotMaps() {
    const now = Date.now();
    for (const [k, ts] of welcomeCooldowns.entries()) {
      if (now - ts > 15 * 60 * 1000) welcomeCooldowns.delete(k);
    }
    for (const [k, ts] of replyCooldowns.entries()) {
      if (now - ts > 15 * 60 * 1000) replyCooldowns.delete(k);
    }
    for (const [k, until] of ambientSilenceUntil.entries()) {
      if (now >= until) ambientSilenceUntil.delete(k);
    }
    for (const [k, ts] of roomAmbientLastReplyAt.entries()) {
      if (now - ts > 10 * 60 * 1000) roomAmbientLastReplyAt.delete(k);
    }
    for (const [k, ts] of roomLastBotHopArrivalAt.entries()) {
      if (now - ts > 10 * 60 * 1000) roomLastBotHopArrivalAt.delete(k);
    }
    for (const [k, conv] of activeConversations.entries()) {
      if (!conv || now - (Number(conv.updatedAt) || 0) > ACTIVE_CONVERSATION_TTL_MS) {
        activeConversations.delete(k);
      }
    }
  }

  const botCleanupInterval = setInterval(pruneStaleBotMaps, 5 * 60 * 1000);
  botCleanupInterval.unref?.();

  // Initial load on module startup
  rehydrateFromStorage(true);

  return {
    getPublicState,
    rehydrateFromStorage,
    createBot,
    updateBot,
    deleteBot,
    toggleBotEnabled,
    updateSettings,
    addBotReply,
    updateBotReply,
    deleteBotReply,
    onUserJoinedRoom,
    onRoomMessage,
    onPrivateMessage,
    onBotKicked,
    onRoomDeleted,
    isBotUsername,
    onStateChanged,
    logMonitorEvent
  };
}
