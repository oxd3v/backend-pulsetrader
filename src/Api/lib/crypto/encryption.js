import { encodeBase64, decodeBase64, toUtf8Bytes, toUtf8String } from "ethers";
import {
  createCipheriv,
  createHash,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "crypto";
import "dotenv/config";
const ENCRYPTION_ALGORITHM = process.env.SECURITY_ALGORITHM;

export const encodeText = (text) => {
  return encodeBase64(toUtf8Bytes(text));
};

export const decodeText = (signature) => {
  return toUtf8String(decodeBase64(signature));
};

export function encrypt(text, password) {
  // Generate salt (random bytes)
  const salt = randomBytes(16);
  // Derive key from password using salt
  const key = scryptSync(password, salt, 32);

  // Generate random initialization vector
  const iv = randomBytes(16);

  // Create cipher
  const cipher = createCipheriv(ENCRYPTION_ALGORITHM, key, iv);

  // Encrypt the text
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");

  // Combine salt + iv + encrypted text
  // Format: salt.iv.encrypted
  return `${salt.toString("hex")}.${iv.toString("hex")}.${encrypted}`;
}

export function decrypt(encryptedText, password) {
  // Split the encrypted string into parts
  const parts = encryptedText.split(".");

  if (parts.length !== 3) {
    throw new Error("Invalid encrypted text format to decrypt");
  }

  // Extract components
  const salt = Buffer.from(parts[0], "hex");
  const iv = Buffer.from(parts[1], "hex");
  const encrypted = parts[2];
  // Derive key from password using salt
  const key = scryptSync(password, salt, 32);

  // Create decipher
  const decipher = createDecipheriv(ENCRYPTION_ALGORITHM, key, iv);

  // Decrypt the text
  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}

export function decryptAuthToken(encryptedBase64, password) {
  const ciphertextBuffer = Buffer.from(encryptedBase64, "base64");

  // 1. Verify header and extract salt
  // CryptoJS prepends "Salted__" (8 bytes) + 8 bytes of salt
  const salt = ciphertextBuffer.subarray(8, 16);
  const actualCiphertext = ciphertextBuffer.subarray(16);

  // 2. Derive Key and IV using OpenSSL's EVP_BytesToKey (MD5)
  // We need 32 bytes for the key and 16 bytes for the IV (total 48 bytes)
  let derivedBytes = Buffer.alloc(0);
  let currentHash = Buffer.alloc(0);

  while (derivedBytes.length < 48) {
    const hasher = createHash("md5");
    hasher.update(currentHash);
    hasher.update(password, "utf8");
    hasher.update(salt);
    currentHash = hasher.digest();
    derivedBytes = Buffer.concat([derivedBytes, currentHash]);
  }

  const key = derivedBytes.subarray(0, 32);
  const iv = derivedBytes.subarray(32, 48);

  // 3. Decrypt using AES-256-CBC
  const decipher = createDecipheriv("aes-256-cbc", key, iv);
  let decrypted = decipher.update(actualCiphertext, undefined, "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}
