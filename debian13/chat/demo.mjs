import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { ApprovalQueue } from './approval-queue.mjs';
import { isOperatorTokenConfigured } from './authorization.mjs';
import { ChatService } from './chat-service.mjs';
import { OllamaClient } from './ollama-client.mjs';

const operatorToken = process.env.DEBIAN13_CHAT_OPERATOR_TOKEN;
if (!isOperatorTokenConfigured(operatorToken)) {
  console.error('Set DEBIAN13_CHAT_OPERATOR_TOKEN to a private value of at least 32 bytes.');
  process.exitCode = 1;
} else {
  const queue = new ApprovalQueue({ operatorToken });
  const authorizationHeader = ['Bear', 'er ', operatorToken].join('');
  let model = null;
  const modelName = process.env.DEBIAN13_OLLAMA_MODEL;
  if (modelName) {
    try {
      const ollama = new OllamaClient({
        model: modelName,
      });
      const installedModels = await ollama.listModels();
      if (installedModels.includes(modelName)) {
        model = ollama;
        console.log(`Local AI provider ready: Ollama model ${modelName}.`);
      } else {
        console.error(`AI unavailable: configured Ollama model ${modelName} is not installed.`);
      }
    } catch (error) {
      console.error(`AI unavailable: ${error.code || error.message || 'provider_error'}.`);
    }
  } else {
    console.error('AI unavailable: set DEBIAN13_OLLAMA_MODEL and start local Ollama.');
  }
  const chat = new ChatService({ model, queue, operatorToken });
  const readline = createInterface({ input: stdin, output: stdout, terminal: stdin.isTTY });

  console.log('Debian 13 chat demo. Type "history" or "quit". Approved proposals are not executed.');
  stdout.write('> ');
  try {
    for await (const line of readline) {
      const input = line.trim();
      if (input.toLowerCase() === 'quit') break;

      if (input.toLowerCase() === 'history') {
        for (const message of chat.history(authorizationHeader).messages) {
          console.log(`${message.role}: ${message.content}`);
        }
        stdout.write('> ');
        continue;
      }

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

      try {
        const result = await chat.sendMessage(line, authorizationHeader);
        console.log(result.source === 'local-model'
          ? `[AI response — unverified] ${result.reply}`
          : result.reply);
        if (result.notice) console.log(result.notice);
        if (result.operation?.operation.type === 'service.restart' && result.operation.operation.service === 'ssh') {
          console.warn('Warning: restarting ssh may terminate this remote session.');
        }
      } catch (error) {
        const code = error.code || 'chat_error';
        console.error(code === 'model_unavailable'
          ? 'No model response was generated; configure local Ollama for general chat.'
          : `Chat request rejected (${code}).`);
      }
      stdout.write('> ');
    }
  } finally {
    readline.close();
  }
}
