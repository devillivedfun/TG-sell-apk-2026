import crypto from 'node:crypto';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const KEY_LENGTH = 6;
const PREFIX = "NYXGRAM-V1:";

/**
 * Generates a random 6-character alphanumeric key.
 * @returns {string}
 */
export function generateKey() {
  let key = "";

  while (key.length < KEY_LENGTH) {
    for (const byte of crypto.randomBytes(16)) {
      // 252 is divisible by 36, avoiding modulo bias.
      if (byte >= 252) continue;

      key += ALPHABET[byte % ALPHABET.length];

      if (key.length === KEY_LENGTH) break;
    }
  }

  return key;
}

/**
 * Generates an HMAC SHA-256 signature for the key.
 * @param {string} key
 * @param {string} [secret]
 * @returns {string}
 */
export function generateSignature(key, secret = process.env.SECRET_KEY) {
  if (!secret) return '';
  return crypto
    .createHmac("sha256", secret)
    .update(PREFIX + key, "utf8")
    .digest("hex");
}

// Check if this script is being executed directly via CLI
const isDirectExecution =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isDirectExecution) {
  const SECRET = process.env.SECRET_KEY;
  if (!SECRET || Buffer.byteLength(SECRET, "utf8") < 32) {
    console.error("Set SECRET_KEY to a secret of at least 32 bytes.");
    process.exit(1);
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  rl.question("How many keys should be generated? ", (answer) => {
    const count = Number(answer);

    if (!Number.isSafeInteger(count) || count < 1 || count > 1000) {
      console.error("Enter a number between 1 and 1000.");
      rl.close();
      process.exitCode = 1;
      return;
    }

    console.log("\nNyxGram Access Keys\n");

    for (let i = 0; i < count; i++) {
      const key = generateKey();
      const signature = generateSignature(key, SECRET);

      console.log(`Key ${i + 1}: ${key}`);
      console.log(`Signature: ${signature}\n`);
    }

    rl.close();
  });
}
