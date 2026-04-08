import json
import os
import threading
import traceback
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Dict, Optional

import ctranslate2
from transformers import AutoTokenizer


def log(level: str, message: str, **extra: Any) -> None:
    payload: Dict[str, Any] = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "level": level,
        "message": message,
        **extra,
    }
    print(json.dumps(payload, ensure_ascii=False), flush=True)


def env(name: str, fallback: Optional[str] = None) -> str:
    value = os.getenv(name, fallback)
    if value is None:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


class TranslationEngine:
    def __init__(self, model_path: str, tokenizer_path: str, source_lang: str, target_lang: str):
        self.model_path = model_path
        self.tokenizer_path = tokenizer_path
        self.default_source_lang = source_lang
        self.default_target_lang = target_lang
        self.lock = threading.Lock()

        log(
            "info",
            "Loading translation model",
            model_path=model_path,
            tokenizer_path=tokenizer_path,
            source_lang=source_lang,
            target_lang=target_lang,
        )

        self.translator = ctranslate2.Translator(model_path, device="cpu", inter_threads=1)
        self.tokenizer = AutoTokenizer.from_pretrained(tokenizer_path, use_fast=False)

        log("info", "Translation model loaded")

    def translate(self, text: str, source_lang: Optional[str], target_lang: Optional[str]) -> str:
        src_lang = source_lang or self.default_source_lang
        tgt_lang = target_lang or self.default_target_lang

        with self.lock:
            if hasattr(self.tokenizer, "src_lang") and src_lang:
                setattr(self.tokenizer, "src_lang", src_lang)

            encoded_ids = self.tokenizer.encode(text, add_special_tokens=True)
            source_tokens = self.tokenizer.convert_ids_to_tokens(encoded_ids)
            if not source_tokens:
                return ""

            translate_kwargs: Dict[str, Any] = {
                "beam_size": 4,
                "max_decoding_length": 256,
            }

            lang_code_to_id = getattr(self.tokenizer, "lang_code_to_id", None)
            if isinstance(lang_code_to_id, dict) and tgt_lang in lang_code_to_id:
                target_token_id = lang_code_to_id[tgt_lang]
                target_token = self.tokenizer.convert_ids_to_tokens([target_token_id])[0]
                translate_kwargs["target_prefix"] = [[target_token]]

            result = self.translator.translate_batch([source_tokens], **translate_kwargs)
            if not result or not result[0].hypotheses:
                return ""

            hypothesis_tokens = result[0].hypotheses[0]
            hypothesis_ids = self.tokenizer.convert_tokens_to_ids(hypothesis_tokens)
            translated = self.tokenizer.decode(hypothesis_ids, skip_special_tokens=True)
            return translated.strip()


class Handler(BaseHTTPRequestHandler):
    engine: TranslationEngine = None  # type: ignore
    default_source_lang: str = "en"
    default_target_lang: str = "ru"

    def do_GET(self) -> None:
        if self.path == "/health":
            self._write_json(200, {"ok": True})
            return
        self._write_json(404, {"error": "Not found"})

    def do_POST(self) -> None:
        if self.path != "/translate":
            self._write_json(404, {"error": "Not found"})
            return

        try:
            body = self._read_json_body()
            text = str(body.get("text", ""))
            source_lang = body.get("source_lang") or self.default_source_lang
            target_lang = body.get("target_lang") or self.default_target_lang

            translated = self.engine.translate(text, source_lang, target_lang)
            self._write_json(200, {"translated_text": translated})
        except Exception as exc:
            log("error", "Translation request failed", error=str(exc), traceback=traceback.format_exc())
            self._write_json(500, {"error": str(exc)})

    def log_message(self, _format: str, *_args: Any) -> None:
        return

    def _read_json_body(self) -> Dict[str, Any]:
        content_length = int(self.headers.get("Content-Length", "0"))
        if content_length <= 0:
            return {}
        raw = self.rfile.read(content_length)
        return json.loads(raw.decode("utf-8"))

    def _write_json(self, status: int, payload: Dict[str, Any]) -> None:
        raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)


def main() -> None:
    host = env("TRANSLATION_SERVICE_HOST", "127.0.0.1")
    if host not in {"127.0.0.1", "localhost"}:
        raise RuntimeError("TRANSLATION_SERVICE_HOST must be localhost or 127.0.0.1")
    port = int(env("TRANSLATION_SERVICE_PORT", "8765"))

    model_path = env("TRANSLATION_MODEL_PATH")
    tokenizer_path = env("TRANSLATION_TOKENIZER_PATH", model_path)
    source_lang = env("TRANSLATION_SOURCE_LANG", "en")
    target_lang = env("TRANSLATION_TARGET_LANG", "ru")

    if not Path(model_path).exists():
        raise RuntimeError(f"TRANSLATION_MODEL_PATH does not exist: {model_path}")
    if not Path(tokenizer_path).exists():
        raise RuntimeError(f"TRANSLATION_TOKENIZER_PATH does not exist: {tokenizer_path}")

    engine = TranslationEngine(model_path, tokenizer_path, source_lang, target_lang)
    Handler.engine = engine
    Handler.default_source_lang = source_lang
    Handler.default_target_lang = target_lang

    server = ThreadingHTTPServer((host, port), Handler)
    log("info", "CTranslate2 translation service started", host=host, port=port)
    server.serve_forever()


if __name__ == "__main__":
    main()
