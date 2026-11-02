import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { ApprovalQueue } from './approval-queue.mjs';
import { isOperatorTokenConfigured } from './authorization.mjs';
import { parseNaturalCommand } from './parser.mjs';

const operatorToken = process.env.DEBIAN13_CHAT_OPERATOR_TOKEN;
if (!isOperatorTokenConfigured(operatorToken)) {
  console.error('Set DEBIAN13_CHAT_OPERATOR_TOKEN to a private value of at least 32 bytes.');
  process.exitCode = 1;
} else {
  const queue = new ApprovalQueue({ operatorToken });
  const authorizationHeader = ['Bear', 'er ', operatorToken].join('');
  const readline = createInterface({ input: stdin, output: stdout, terminal: stdin.isTTY });

  console.log('Debian 13 chat-core demo. Type "quit" to exit. No system commands are executed.');
  stdout.write('> ');
  try {
    for await (const line of readline) {
      const input = line.trim();
      if (input.toLowerCase() === 'quit') break;

      const decision = input.match(/^(approve|reject) ([a-f0-9-]{36})$/i);
      if (decision) {
        try {
          const item = queue.list(authorizationHeader).find(({ id }) => id === decision[2]);
          if (!item) {
            console.log('No pending proposal with that ID.');
            continue;
          }
          const result = queue.decide(decision[2], decision[1].toLowerCase(), item.version, authorizationHeader);
          console.log(`${result.status}: recorded only; no system operation was executed.`);
        } catch (error) {
          console.log(`Decision rejected (${error.code || 'error'}).`);
        }
        continue;
      }

      const parsed = parseNaturalCommand(line);
      if (!parsed) {
        console.log('Unsupported request. No operation was created.');
      } else if (parsed.kind === 'read') {
        console.log('Read intent recognized; no live system-status provider is configured.');
      } else {
        try {
          const item = queue.submit(parsed.operation, authorizationHeader);
          console.log(`Pending approval: ${item.id} (${item.operation.type}).`);
          console.log('Approve or reject this ID explicitly. Approval will not execute it.');
        } catch (error) {
          console.log(`Proposal rejected (${error.code || 'error'}).`);
        }
      }
      stdout.write('> ');
    }
  } finally {
    readline.close();
  }
}
