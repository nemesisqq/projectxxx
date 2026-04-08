import assert from "node:assert/strict";
import { formatTelegramMessage } from "../src/services/TelegramFormatter";
import { createPost } from "./fixtures";

export function runTelegramFormatterTests(): void {
  const quotePost = createPost({
    accountHandle: "bcherny",
    postType: "quote",
    originalAuthorHandle: "karpathy",
    text: "Original text",
    translatedText: "Переведенный текст"
  });

  const quoteMessage = formatTelegramMessage(quotePost, {
    sendOriginalText: true,
    sendTranslation: true,
    translationFailed: false
  });

  assert.match(quoteMessage, /Аккаунт/u);
  assert.match(quoteMessage, /@bcherny/u);
  assert.match(quoteMessage, /Цитата/u);
  assert.match(quoteMessage, /@karpathy/u);
  assert.match(quoteMessage, /Original text/u);
  assert.match(quoteMessage, /Переведенный текст/u);
  assert.match(quoteMessage, /Открыть в X/u);

  const emptyPost = createPost({
    text: "",
    translatedText: null
  });
  const emptyMessage = formatTelegramMessage(emptyPost, {
    sendOriginalText: true,
    sendTranslation: true,
    translationFailed: true
  });

  assert.match(emptyMessage, /—/u);
  assert.match(emptyMessage, /перевод не выполнен/ui);
}
