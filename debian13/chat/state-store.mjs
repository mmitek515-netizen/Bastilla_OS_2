import { chmodSync, closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, isAbsolute, join, basename } from 'node:path';

export const MAX_STATE_BYTES = 8 * 1024 * 1024;
const MAX_SESSIONS = 100;
const MAX_RECORDS = 500;

function emptyState() {
  return {
    version: 1,
    sessions: {},
    approvals: [],
    audit: [],
    tasks: [],
    events: [],
  };
}

function validateState(state) {
  if (
    !state ||
    typeof state !== 'object' ||
    Array.isArray(state) ||
    state.version !== 1 ||
    !state.sessions ||
    typeof state.sessions !== 'object' ||
    Array.isArray(state.sessions) ||
    !Array.isArray(state.approvals) ||
    !Array.isArray(state.audit) ||
    !Array.isArray(state.tasks) ||
    !Array.isArray(state.events) ||
    Object.keys(state.sessions).length > MAX_SESSIONS ||
    state.approvals.length > MAX_RECORDS ||
    state.audit.length > MAX_RECORDS * 2 ||
    state.tasks.length > MAX_RECORDS ||
    state.events.length > MAX_RECORDS * 2
  ) {
    throw new Error('invalid_chat_state');
  }
}

export class JsonStateStore {
  #filePath;
  #state;

  constructor(filePath) {
    if (typeof filePath !== 'string' || !isAbsolute(filePath)) {
      throw new TypeError('absolute_state_path_required');
    }

    this.#filePath = filePath;
    mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 });
    if (!existsSync(filePath)) {
      this.#state = emptyState();
      this.#write(this.#state);
      return;
    }

    const file = lstatSync(filePath);
    if (!file.isFile() || file.isSymbolicLink() || file.size > MAX_STATE_BYTES) {
      throw new Error('invalid_chat_state_file');
    }

    try {
      this.#state = JSON.parse(readFileSync(filePath, 'utf8'));
      validateState(this.#state);
      if (Buffer.byteLength(JSON.stringify(this.#state), 'utf8') > MAX_STATE_BYTES) {
        throw new Error('chat_state_limit_exceeded');
      }
    } catch (error) {
      throw new Error('invalid_chat_state', { cause: error });
    }
    chmodSyncSafe(filePath);
  }

  read() {
    return structuredClone(this.#state);
  }

  update(mutator) {
    if (typeof mutator !== 'function') throw new TypeError('state_mutator_required');
    const next = structuredClone(this.#state);
    mutator(next);
    validateState(next);
    this.#write(next);
    this.#state = next;
    return structuredClone(next);
  }

  #write(state) {
    const serialized = JSON.stringify(state);
    if (Buffer.byteLength(serialized, 'utf8') > MAX_STATE_BYTES) {
      throw new Error('chat_state_limit_exceeded');
    }

    const directory = dirname(this.#filePath);
    const temporaryPath = join(directory, `.${basename(this.#filePath)}.${randomUUID()}.tmp`);
    const descriptor = openSync(temporaryPath, 'wx', 0o600);
    try {
      writeFileSync(descriptor, serialized, 'utf8');
      fsyncSync(descriptor);
    } catch (error) {
      try {
        unlinkSync(temporaryPath);
      } catch {
        // Keep the original write error.
      }
      throw error;
    } finally {
      closeSync(descriptor);
    }

    try {
      renameSync(temporaryPath, this.#filePath);
      const directoryDescriptor = openSync(directory, 'r');
      try {
        fsyncSync(directoryDescriptor);
      } finally {
        closeSync(directoryDescriptor);
      }
      chmodSyncSafe(this.#filePath);
    } catch (error) {
      try {
        unlinkSync(temporaryPath);
      } catch {
        // The atomic rename may already have completed.
      }
      throw error;
    }
  }
}

function chmodSyncSafe(filePath) {
  chmodSync(filePath, 0o600);
}
