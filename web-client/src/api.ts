const BASE_URL = "http://chat.ezevals.com:34199"; // Your backend URL

export async function clearChat() {
  const response = await fetch("/clear", {
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(`Chat Clear failed: ${response.status}`);
  }

  return response.json();
}

export async function uploadFileToContext(...files: File[]) {
  const formData = new FormData();
  files.forEach(file => formData.append("files", file));

  const response = await fetch("/upload", {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    throw new Error(`Upload failed: ${response.status}`);
  }

  return response.json();
}

export async function chatWithLLM(messages: any[], model: string, onData: (chunk: string) => void) {
  const response = await fetch(`/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
    }),
  });

  if (!response.ok || !response.body) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  const reader = response.body.getReader();
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
  const res = await fetch(`/models`);
  const data = await res.json();
  return data.models || [];
}

export async function setModel(model: string) {
  await fetch(`/model`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model }),
  });
}
