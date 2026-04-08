import { NormalizedPost, PostType } from "../types/post";

const TYPE_LABELS: Record<PostType, string> = {
  post: "Пост",
  repost: "Репост",
  quote: "Цитата",
  reply: "Ответ"
};

export interface TelegramFormatOptions {
  sendOriginalText: boolean;
  sendTranslation: boolean;
  translationFailed: boolean;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatTimestamp(isoTimestamp: string): string {
  const date = new Date(isoTimestamp);
  if (Number.isNaN(date.getTime())) {
    return isoTimestamp;
  }

  return date.toLocaleString("ru-RU", {
    dateStyle: "short",
    timeStyle: "medium",
    timeZone: "UTC"
  });
}

export function formatTelegramMessage(post: NormalizedPost, options: TelegramFormatOptions): string {
  const lines: string[] = [];
  const originalText = post.text.trim() || "—";
  const translatedText = post.translatedText?.trim() || "—";

  lines.push(`<b>Аккаунт:</b> @${escapeHtml(post.accountHandle)}`);
  lines.push(`<b>Тип:</b> ${TYPE_LABELS[post.postType]}`);

  if (post.originalAuthorHandle) {
    lines.push(`<b>Оригинальный автор:</b> @${escapeHtml(post.originalAuthorHandle)}`);
  }

  if (options.sendOriginalText) {
    lines.push(`<b>Оригинал:</b>`);
    lines.push(escapeHtml(originalText));
  }

  if (options.sendTranslation) {
    lines.push(`<b>Перевод:</b>`);
    lines.push(escapeHtml(translatedText));
  }

  if (options.translationFailed) {
    lines.push("Внимание: перевод не выполнен, отправлен оригинал.");
  }

  lines.push(`<b>Ссылка:</b> <a href="${escapeHtml(post.url)}">Открыть в X</a>`);
  lines.push(`<b>Время (UTC):</b> ${escapeHtml(formatTimestamp(post.createdAt))}`);

  return lines.join("\n");
}
