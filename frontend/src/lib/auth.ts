import type { AuthProvider } from './api';

export const providerNames: Record<AuthProvider, string> = { yandex: 'Яндекс', vk: 'VK ID', telegram: 'Telegram' };
export const providerOrder: AuthProvider[] = ['yandex', 'telegram', 'vk'];
export function authError(code: string | null) {
  return ({expired:'Время входа истекло. Попробуйте ещё раз.',session:'Аккаунт или сессия изменились. Начните действие заново.',cancelled:'Вход отменён. Можно повторить или выбрать другой способ.',provider:'Сервис входа сейчас не ответил или не подтвердил аккаунт. Попробуйте ещё раз или выберите другой способ.',conflict:'Этот способ уже подключён к аккаунту. Войдите через него отдельно, чтобы проверить аккаунт. Объединение автоматически не выполняется.',failed:'Не удалось завершить действие. Попробуйте ещё раз.'} as Record<string,string>)[code || ''] || '';
}
export function safeAuthNext(value: string | null | undefined) {
  return value && (/^\/join#[a-f0-9]{64}$/.test(value) || /^\/(m|s|w)\/[a-zA-Z0-9_-]+$/.test(value) || ['/me','/studio','/salon','/access'].includes(value)) ? value : undefined;
}
