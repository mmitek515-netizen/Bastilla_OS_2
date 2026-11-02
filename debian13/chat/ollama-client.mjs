const OLLAMA_ORIGIN = 'http://127.0.0.1:11434';
const MAX_RESPONSE_BYTES = 1_000_000;

export class OllamaClientError extends Error {
  constructor(code) {
    super(code);
    this.name = 'OllamaClientError';
    this.code = code;
  }
}

async function readBoundedBody(response) {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    throw new OllamaClientError('provider_response_too_large');
  }

  if (!response.body?.getReader) {
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) {
      throw new OllamaClientError('provider_response_too_large');
    }
    return text;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new OllamaClientError('provider_response_too_large');
    }
    chunks.push(value);
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}

export class OllamaClient {
  #baseUrl;
  #model;
  #fetch;
  #timeoutMs;
  #inferenceVerified = false;

  get modelName() {
    return this.#model;
  }

  get inferenceVerified() {
    return this.#inferenceVerified;
  }

  constructor({
    baseUrl = OLLAMA_ORIGIN,
    model,
    fetchImpl = globalThis.fetch,
    timeoutMs = 30_000,
  } = {}) {
    let url;
    try {
      url = new URL(baseUrl);
    } catch {
      throw new TypeError('invalid_ollama_url');
    }

    if (
      url.origin !== OLLAMA_ORIGIN ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    ) {
      throw new TypeError('ollama_must_use_loopback_http');
    }
    if (
      typeof model !== 'string' ||
      !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/.test(model)
    ) {
      throw new TypeError('invalid_ollama_model');
    }
    if (typeof fetchImpl !== 'function') throw new TypeError('fetch_unavailable');
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 120_000) {
      throw new TypeError('invalid_provider_timeout');
    }

    this.#baseUrl = url.origin;
    this.#model = model;
    this.#fetch = fetchImpl;
    this.#timeoutMs = timeoutMs;
  }

  async listModels() {
    const result = await this.#request('/api/tags');
    if (!result || !Array.isArray(result.models)) {
      throw new OllamaClientError('invalid_provider_response');
    }
    return result.models
      .map((entry) => entry?.name ?? entry?.model)
      .filter((name) => typeof name === 'string');
  }

  async chat(messages) {
    if (!Array.isArray(messages) || messages.length === 0) {
      throw new OllamaClientError('invalid_chat_context');
    }

    const result = await this.#request('/api/chat', {
      model: this.#model,
      stream: false,
      format: 'json',
      messages,
    });
    const content = result?.message?.content;
    if (typeof content !== 'string' || Buffer.byteLength(content, 'utf8') > 16_000) {
      throw new OllamaClientError('invalid_provider_response');
    }
    this.#inferenceVerified = true;
    return content;
  }

  async #request(path, body) {
    let response;
    try {
      response = await this.#fetch(new URL(path, this.#baseUrl), {
        method: body === undefined ? 'GET' : 'POST',
        headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: 'error',
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
    } catch {
      throw new OllamaClientError('provider_unavailable');
    }

    let text;
    try {
      text = await readBoundedBody(response);
    } catch (error) {
      if (error instanceof OllamaClientError) throw error;
      throw new OllamaClientError('invalid_provider_response');
    }
    if (!response.ok) throw new OllamaClientError('provider_request_failed');

    try {
      return JSON.parse(text);
    } catch {
      throw new OllamaClientError('invalid_provider_response');
    }
  }
}
