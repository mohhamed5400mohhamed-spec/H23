/**
 * Web Notifications API Engine & Background Service Worker Connector
 * Ensures users receive native system push/browser notifications when:
 * 1. A new private message arrives
 * 2. A mention (@) is made in the chat
 * Works seamlessly even when:
 * - Tab is in the background
 * - Phone screen is locked / phone is sleeping
 * - Browser is minimized
 */

let swRegistration: ServiceWorkerRegistration | null = null;
let clickListenerRegistered = false;

/**
 * Check if Web Notifications API is supported by the current browser
 */
export function isNotificationSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

/**
 * Get current notification permission state
 */
export function getNotificationPermission(): NotificationPermission | 'unsupported' {
  if (!isNotificationSupported()) return 'unsupported';
  return Notification.permission;
}

/**
 * Register Service Worker for background notifications and click handling
 */
export async function registerNotificationServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return null;
  }

  try {
    const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    swRegistration = reg;
    return reg;
  } catch (err) {
    console.warn('Service worker registration for notifications:', err);
    return null;
  }
}

/**
 * Request notification permission from user
 */
export async function requestNotificationPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (!isNotificationSupported()) return 'unsupported';

  // If already granted, ensure SW is registered
  if (Notification.permission === 'granted') {
    registerNotificationServiceWorker().catch(() => {});
    return 'granted';
  }

  if (Notification.permission === 'denied') {
    return 'denied';
  }

  try {
    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
      await registerNotificationServiceWorker();
      try {
        localStorage.setItem('soqoor_notifications_granted', 'true');
      } catch {}
    }
    return permission;
  } catch (err) {
    console.warn('Error requesting notification permission:', err);
    return Notification.permission;
  }
}

export interface NotificationPayload {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  tag?: string;
  renotify?: boolean;
  data?: any;
  requireInteraction?: boolean;
}

const DEFAULT_NOTIF_PNG = '/pwa-192x192.png';

function sanitizeNotificationIcon(rawIcon?: string): string {
  const val = (rawIcon || '').trim();
  if (!val || /\.svg(\?|#|$)/i.test(val) || val.startsWith('data:image/svg')) {
    return DEFAULT_NOTIF_PNG;
  }
  return val;
}

/**
 * Send a web notification via ServiceWorker (background/screen-off resilient) or window.Notification
 */
export async function sendBrowserNotification(payload: NotificationPayload): Promise<boolean> {
  if (!isNotificationSupported() || Notification.permission !== 'granted') {
    return false;
  }

  const {
    title,
    body,
    icon,
    badge,
    tag,
    renotify = true,
    data = {},
    requireInteraction = false
  } = payload;

  const safeIcon = sanitizeNotificationIcon(icon);
  const safeBadge = sanitizeNotificationIcon(badge);
  const { onAction, ...serializableData } = data || {};

  const options: NotificationOptions & { renotify?: boolean; vibrate?: number[] } = {
    body,
    icon: safeIcon,
    badge: safeBadge,
    tag: tag || `soqoor-notif-${Date.now()}`,
    renotify,
    data: {
      ...serializableData,
      url: typeof window !== 'undefined' ? window.location.origin + '/' : '/'
    },
    requireInteraction,
    silent: false,
    // Vibration pattern for mobile devices: 200ms vibrate, 100ms pause, 200ms vibrate
    vibrate: [200, 100, 200]
  };

  // Try service worker showNotification first (essential for background & screen-off wakeups)
  if ('serviceWorker' in navigator) {
    try {
      const reg = swRegistration || (await navigator.serviceWorker.ready);
      if (reg && 'showNotification' in reg) {
        await reg.showNotification(title, options);
        return true;
      }
    } catch {
      // Fall through to window Notification
    }
  }

  // Fallback to standard window Notification constructor
  try {
    const notif = new Notification(title, options);
    notif.onclick = () => {
      window.focus();
      if (typeof onAction === 'function') {
        try {
          onAction();
        } catch {}
      }
      notif.close();
    };
    return true;
  } catch (err) {
    console.warn('Notification instantiation fallback failed:', err);
    return false;
  }
}

/**
 * Notify user of a new incoming Private Message
 */
export async function notifyPrivateMessage(
  fromUsername: string,
  messageText: string,
  options?: {
    avatarUrl?: string;
    onOpenPm?: () => void;
  }
): Promise<boolean> {
  const cleanText = messageText ? messageText.trim() : 'أرسل لك وسائط أو رسالة خاصة';
  const displayBody = cleanText.length > 80 ? `${cleanText.slice(0, 80)}...` : cleanText;

  return sendBrowserNotification({
    title: `💬 رسالة خاصة من ${fromUsername}`,
    body: displayBody,
    icon: sanitizeNotificationIcon(options?.avatarUrl),
    tag: `pm-${fromUsername.toLowerCase().trim()}`,
    renotify: true,
    data: {
      type: 'pm',
      fromUsername,
      timestamp: Date.now(),
      onAction: options?.onOpenPm
    },
    requireInteraction: true
  });
}

/**
 * Notify user of an @mention in a chat message
 */
export async function notifyMention(
  fromUsername: string,
  messageText: string,
  roomName: string = 'الغرفة العامة',
  options?: {
    avatarUrl?: string;
  }
): Promise<boolean> {
  const cleanText = messageText ? messageText.trim() : 'قام بالإشارة إليك';
  const displayBody = cleanText.length > 80 ? `${cleanText.slice(0, 80)}...` : cleanText;

  return sendBrowserNotification({
    title: `🔔 تم ذكرك بواسطة @${fromUsername} في ${roomName}`,
    body: displayBody,
    icon: sanitizeNotificationIcon(options?.avatarUrl),
    tag: `mention-${fromUsername.toLowerCase().trim()}-${Date.now()}`,
    renotify: true,
    data: {
      type: 'mention',
      fromUsername,
      room: roomName,
      timestamp: Date.now()
    },
    requireInteraction: true
  });
}

/**
 * Test notification helper
 */
export async function sendTestNotification(): Promise<boolean> {
  return sendBrowserNotification({
    title: '🦅 تجربة إشعارات شات حسان برو',
    body: 'نظام تنبيهات المتصفح يعمل بنجاح! ستصلك التنبيهات حتى عند قفل الشاشة أو خروجك من التطبيق 🔔',
    icon: DEFAULT_NOTIF_PNG,
    tag: 'test-notification'
  });
}

let notificationClickCallback: ((data: { type: string; fromUsername?: string; room?: string }) => void) | null = null;

export function consumePendingNotificationActionFromUrl(): {
  type: string;
  fromUsername?: string;
  room?: string;
} | null {
  if (typeof window === 'undefined') return null;
  try {
    const url = new URL(window.location.href);
    const notifType = url.searchParams.get('notif_type');
    if (!notifType) return null;
    const fromUsername = url.searchParams.get('notif_from') || undefined;
    const room = url.searchParams.get('notif_room') || undefined;
    url.searchParams.delete('notif_type');
    url.searchParams.delete('notif_from');
    url.searchParams.delete('notif_room');
    const cleanSearch = url.searchParams.toString();
    const cleanUrl = `${url.pathname}${cleanSearch ? `?${cleanSearch}` : ''}${url.hash}`;
    window.history.replaceState({}, '', cleanUrl);
    return { type: notifType, fromUsername, room };
  } catch {
    return null;
  }
}

/**
 * Attach global listener for notifications clicked via Service Worker
 */
export function listenToNotificationClicks(
  callback: (data: { type: string; fromUsername?: string; room?: string }) => void
): () => void {
  notificationClickCallback = callback;
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return () => {
      if (notificationClickCallback === callback) notificationClickCallback = null;
    };
  }

  if (!clickListenerRegistered) {
    clickListenerRegistered = true;
    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data?.type === 'NOTIFICATION_CLICKED' && event.data.data && notificationClickCallback) {
        notificationClickCallback(event.data.data);
      }
    });
  }

  return () => {
    if (notificationClickCallback === callback) {
      notificationClickCallback = null;
    }
  };
}
