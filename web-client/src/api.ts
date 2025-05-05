import os from 'os'
import path from 'path'
import fs from 'fs'
import yaml from 'js-yaml'
import { importJWK, SignJWT, JWK } from 'jose'


const BASE_URL = "http://chat.ezevals.com:54269"; // Your backend URL
const ALGORITHM = "EdDSA"

let clientConfig: {
  username: string
  secret: string
  saveInteractions?: boolean
}
let jwtToken: string
let sessionId: string | null = null

/** 
 * Load ~/.config/karllm/karllm.conf, read your EdDSA JWK and
 * produce a signed JWT (10 hr expiry). 
 */
export async function loadJwtToken(): Promise<string> {
  // Find & Validate CFG
  const xdg = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config")
  const cfgPath = path.join(xdg, 'karllm', 'karllm.conf')
  if(!fs.existsSync(cfgPath)) {
    throw new Error(`Missing config file: ${cfgPath}`)
  }
  clientConfig = yaml.load(fs.readFileSync(cfgPath, 'utf8')) as typeof clientConfig
  const {username, secret} = clientConfig
  if (!username || !secret) {
    throw new Error("Missing username or secret in config")
  }

  // Find Key
  const keyPath = secret.startsWith('~')
    ? path.join(os.homedir(), secret.slice(1))
    : secret
  if(!fs.existsSync(keyPath)) {
    throw new Error(`Missing key file: ${keyPath}`)
  }

  // Validate Key
  const jwkJson = fs.readFileSync(keyPath, 'utf8')
  const jwk: JWK = JSON.parse(jwkJson)
  const key = await importJWK(jwk, ALGORITHM)

  // Rotate key in 10 hours
  const exp = Math.floor(Date.now() / 1000) + 36000
  jwtToken = await new SignJWT({sub: username, exp})
    .setProtectedHeader({alg: ALGORITHM})
    .sign(key)
  return jwtToken
}

/**
 * POST /connect with Bearer <JWT> to retrieve a session token.
 */
export async function connectAndGetSession(): Promise<void> {
  if(!jwtToken) {
    throw new Error("JWT Token not loaded; call loadJwtToken first")
  }
  const res = await fetch('/connect', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${jwtToken}`
    },
    body: JSON.stringify({
      saveInteractions: clientConfig.saveInteractions || false
    })
  })
  if(!res.ok) {
    throw new Error(`Connection failed: ${res.status}`)
  }
  const { session_id } = await res.json()
  sessionId = session_id
}

/** Helper to inject X-Session-Token on every request */
function getAuthHeaders(): Record<string,string> {
  return sessionId ? { 'X-Session-Token': sessionId } : {}
}

export async function clearChat() {
  const res = await fetch("/clear", {
    method: "POST",
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders()
    }
  });

  if (!res.ok) {
    throw new Error(`Chat Clear failed: ${res.status}`);
  }
  return res.json();
}

export async function uploadFileToContext(...files: File[]) {
  const formData = new FormData();
  files.forEach(file => formData.append("files", file));

  const res = await fetch("/upload", {
    method: "POST",
    headers: { ...getAuthHeaders() },
    body: formData,
  });

  if (!res.ok) {
    throw new Error(`Upload failed: ${res.status}`);
  }

  return res.json();
}

export async function chatWithLLM(messages: any[], model: string, onData: (chunk: string) => void) {
  const res = await fetch(`/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...getAuthHeaders()
    },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
    }),
  });

  if (!res.ok || !res.body) {
    throw new Error(`HTTP error! status: ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    chunk
      .split("data: ")
      .filter(line => line.trim())
      .forEach((line) => {
        try {
          const json = JSON.parse(line.trim());
          onData(json.message?.content ?? "");
        } catch (e) {
          console.warn("Non-JSON line:", line.trim());
        }
      });
  }
}

export async function fetchModelList(): Promise<string[]> {
  const res = await fetch(`/models`, {
    headers: getAuthHeaders()
  });
  const data = await res.json();
  return data.models || [];
}

export async function setModel(model: string) {
  await fetch(`/model`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
      ...getAuthHeaders()
    },
    body: JSON.stringify({ model }),
  });
}
