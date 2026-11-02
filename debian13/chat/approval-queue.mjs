import { randomUUID } from 'node:crypto';
import { isOperatorAuthorized } from './authorization.mjs';
import { validateOperation } from './parser.mjs';

export const DEFAULT_MAX_PENDING = 100;
export const DEFAULT_MAX_RECORDS = 500;
export const DEFAULT_TTL_MS = 10 * 60 * 1000;

export class ApprovalQueueError extends Error {
  constructor(code) {
    super(code);
    this.name = 'ApprovalQueueError';
    this.code = code;
  }
}

export class ApprovalQueue {
  #operatorToken;
  #items = new Map();
  #audit = [];
  #clock;
  #idGenerator;
  #maxPending;
  #maxRecords;
  #ttlMs;

  constructor({
    operatorToken,
    clock = Date.now,
    idGenerator = randomUUID,
    maxPending = DEFAULT_MAX_PENDING,
    maxRecords = DEFAULT_MAX_RECORDS,
    ttlMs = DEFAULT_TTL_MS,
  }) {
    if (
      typeof clock !== 'function' ||
      typeof idGenerator !== 'function' ||
      !Number.isInteger(maxPending) ||
      maxPending < 1 ||
      !Number.isInteger(maxRecords) ||
      maxRecords < maxPending ||
      !Number.isFinite(ttlMs) ||
      ttlMs <= 0
    ) {
      throw new TypeError('invalid_queue_configuration');
    }

    this.#operatorToken = operatorToken;
    this.#clock = clock;
    this.#idGenerator = idGenerator;
    this.#maxPending = maxPending;
    this.#maxRecords = maxRecords;
    this.#ttlMs = ttlMs;
  }

  submit(operation, authorizationHeader) {
    this.#assertAuthorized(authorizationHeader);
    this.#expirePending();

    const validatedOperation = validateOperation(operation);
    if (!validatedOperation) throw new ApprovalQueueError('invalid_operation');

    const pendingCount = [...this.#items.values()].filter((item) => item.status === 'pending_approval').length;
    if (pendingCount >= this.#maxPending) throw new ApprovalQueueError('queue_full');

    const now = this.#clock();
    const id = this.#idGenerator();
    if (typeof id !== 'string' || id.length === 0 || this.#items.has(id)) {
      throw new ApprovalQueueError('id_generation_failed');
    }
    const item = {
      id,
      operation: validatedOperation,
      risk: 'high',
      status: 'pending_approval',
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + this.#ttlMs).toISOString(),
      version: 1,
    };

    this.#items.set(item.id, item);
    this.#record('operation.proposed', item.id, now);
    this.#trimHistory();
    return structuredClone(item);
  }

  list(authorizationHeader) {
    this.#assertAuthorized(authorizationHeader);
    this.#expirePending();
    return [...this.#items.values()]
      .filter((item) => item.status === 'pending_approval')
      .map((item) => structuredClone(item));
  }

  decide(id, decision, expectedVersion, authorizationHeader) {
    this.#assertAuthorized(authorizationHeader);
    this.#expirePending();

    if (decision !== 'approve' && decision !== 'reject') {
      throw new ApprovalQueueError('invalid_decision');
    }

    const item = this.#items.get(id);
    if (!item) throw new ApprovalQueueError('not_found');
    if (item.status === 'expired') throw new ApprovalQueueError('expired');
    if (item.status !== 'pending_approval') throw new ApprovalQueueError('already_decided');
    if (!Number.isInteger(expectedVersion) || expectedVersion !== item.version) {
      throw new ApprovalQueueError('stale_version');
    }

    const now = this.#clock();
    item.status = decision === 'approve' ? 'approved' : 'rejected';
    item.decidedAt = new Date(now).toISOString();
    item.version += 1;
    this.#record(`operation.${item.status}`, item.id, now);
    return structuredClone(item);
  }

  auditEntries(authorizationHeader) {
    this.#assertAuthorized(authorizationHeader);
    this.#expirePending();
    return structuredClone(this.#audit);
  }

  #assertAuthorized(authorizationHeader) {
    if (!isOperatorAuthorized(this.#operatorToken, authorizationHeader)) {
      throw new ApprovalQueueError('unauthorized');
    }
  }

  #expirePending() {
    const now = this.#clock();
    for (const item of this.#items.values()) {
      if (item.status === 'pending_approval' && Date.parse(item.expiresAt) <= now) {
        item.status = 'expired';
        item.version += 1;
        this.#record('operation.expired', item.id, now);
      }
    }
  }

  #record(event, operationId, timestamp) {
    this.#audit.push({ event, operationId, at: new Date(timestamp).toISOString() });
    if (this.#audit.length > this.#maxRecords * 2) {
      this.#audit.splice(0, this.#audit.length - this.#maxRecords * 2);
    }
  }

  #trimHistory() {
    while (this.#items.size > this.#maxRecords) {
      const removableId = [...this.#items.values()].find((item) => item.status !== 'pending_approval')?.id;
      if (!removableId) break;
      this.#items.delete(removableId);
    }
  }
}
