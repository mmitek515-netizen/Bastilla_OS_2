#!/usr/bin/env bash
set -euo pipefail
api_base="${OLLAMA_BASE_URL:-http://127.0.0.1:11434}"
api_base="${api_base%/}"
if [[ "$api_base" != 'http://127.0.0.1:11434' && "$api_base" != 'http://localhost:11434' ]]; then
  printf '%s\n' 'Ten instalator konfiguruje lokalną Ollamę na porcie 11434. Zdalny OLLAMA_BASE_URL wymaga konfiguracji na wskazanym hoście.' >&2
  exit 1
fi
if ! command -v ollama >/dev/null 2>&1; then
  if ! command -v zstd >/dev/null 2>&1; then
    if [[ "$(id -u)" == '0' ]] && command -v apt-get >/dev/null 2>&1; then
      apt-get update
      apt-get install -y zstd
    else
      printf '%s\n' 'Brakuje zstd. Zainstaluj pakiet zstd w systemie i ponów próbę.' >&2
      exit 1
    fi
  fi
  install_file="$(mktemp)"
  trap 'rm -f -- "$install_file"' EXIT
  curl --fail --silent --show-error --location --retry 2 --connect-timeout 15 https://ollama.com/install.sh --output "$install_file"
  sh "$install_file"
fi
if ! curl --fail --silent --max-time 3 "$api_base/api/version" >/dev/null; then
  nohup env OLLAMA_HOST=127.0.0.1:11434 ollama serve >/tmp/bastilla-ollama.log 2>&1 </dev/null &
fi
ready=false
for attempt in {1..30}; do
  if curl --fail --silent --max-time 2 "$api_base/api/version" >/dev/null; then ready=true; break; fi
  sleep 1
done
if [[ "$ready" != true ]]; then
  printf '%s\n' 'Ollama nie uruchomiła się. Sprawdź /tmp/bastilla-ollama.log.' >&2
  exit 1
fi
model="${OLLAMA_MODEL:-qwen3:0.6b}"
if [[ "$model" == 'auto' || -z "$model" ]]; then model='qwen3:0.6b'; fi
OLLAMA_HOST=127.0.0.1:11434 ollama pull "$model"
printf 'Ollama gotowa, pobrany model: %s\n' "$model"
curl --fail --silent --show-error "$api_base/api/tags"
printf '\n%s\n' 'Lista modeli nie jest testem generowania odpowiedzi. Przetestuj każdego agenta w czacie.'
