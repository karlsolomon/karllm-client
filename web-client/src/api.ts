import os from 'os'
import path from 'path'
import fs from 'fs'
import yaml from 'js-yaml'
import { importJWK, SignJWT } from 'jose'
import { loadJwkFromFS } from './fsKey'



// const BASE_URL = "https://chat.ezevals.com:54269"; // Your backend URL
const BASE_URL = "http://10.224.174.3:34199"; // Your backend URL
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
export async function loadJwtToken(username: string): Promise<string> {
  console.log("loadJwtToken")
  const privJwk = await loadJwkFromFS('client.key.jwk');
  const privateKey = await importJWK(privJwk, ALGORITHM);
  const exp = Math.floor(Date.now() / 1000) + 36000;
  jwtToken = await new SignJWT({ sub: username, exp })
    .setProtectedHeader({ alg: ALGORITHM })
    .sign(privateKey);
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
    },
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
  const res = await fetch(`${BASE_URL}/session/clear`, {
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

  const res = await fetch(`${BASE_URL}/file/upload`, {
    method: "POST",
    body: formData,
  });

  if (!res.ok) {
    throw new Error(`Upload failed: ${res.status}`);
  }

  return res.json();
}

export async function chatWithLLM(
  prompt: string,
  onChunk: (chunk: string) => void,
  signal?: AbortSignal
): Promise<void> {
  const res = await fetch(`${BASE_URL}/chat/stream`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({prompt: prompt}),
    signal,
  });

  if (!res.ok) {
    throw new Error(`Stream request failed: ${res.status}`);
  }
  if (!res.body) {
    throw new Error("No response body");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split(/\r?\n\r?\n/);
    buffer = events.pop()!;
    for (const event of events) {
      for (const line of event.split(/\r?\n/)) {
        if (!line.startsWith("data:")) continue;
        const raw = line.slice("data:".length).trim();
        if (raw === "[DONE]") {
          await reader.cancel();
          return;
        }
        let msg: any;
        try {
          msg = JSON.parse(raw);
          if(msg.text === "[DONE]") {
            (Array.isArray(msg.text) && msg.text.length === 1 && msg.text[0] === "[DONE]")
            await reader.cancel();
            return;
          }
        } catch (e) {
          onChunk(raw);
          continue;
        }
        let text = msg.text;
        if (Array.isArray(text)) {
          text = text.join("");
        } else if (typeof text !== "string") {
          text = String(text);
        }
        onChunk(text);
      }
    }
  }
}

export async function fetchModelList(): Promise<string[]> {
  const res = await fetch(`/model/models`, {
    headers: getAuthHeaders()
  });
  if (!res.ok) {
    throw new Error(`Model list fetch failed: ${res.status}`);
  }
  const data = await res.json();
  const raw = data.supported_models;
  if (Array.isArray(raw)) {
    return raw;
  }

  if (typeof raw === "string") {
    const models: string[] = [];
    const re = /'([^']+)'/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(raw)) !== null) {
      models.push(m[1]);
    }
  return models;

  }
  return [];
}

export async function setModel(model: string) {
  await fetch(`/model/set`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...getAuthHeaders()
    },
    body: JSON.stringify({ model }),
  });
}

export async function getModel(): Promise<string> {
  res = await fetch(`/model/get`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
    },
  });
  console.log("model: ", res.model);
  return res.model;
}
