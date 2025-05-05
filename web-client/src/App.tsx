import { useEffect, useRef, useState } from "react";
import ChatBox, { ChatBoxHandle } from "./components/ChatBox";
import "bootstrap/dist/css/bootstrap.min.css";
import "./chat-theme.css";
import { fetchModelList, setModel, uploadFileToContext } from "./api";

// Data structure to represent a model
export interface Model {
  name: string;
  nickname: string;
  context: number;
  maxContext: number;
}

function App() {
  // Hard-coded initial set of models
  const initialHcModels: Model[] = [
    { name: "qwen3-ctx:30b", nickname: "thinking-VeryFast (MoE)", context: 68608, maxContext: 131072 },
    { name: "qwen3-ctx:32b", nickname: "thinking-Fast (qwen)", context: 22528, maxContext: 131072 },
    { name: "deepseek-r1-ctx:32b", nickname: "thinking-Fast (deepseek)", context: 47104, maxContext: 131072  },
    { name: "r1-1776-ctx:70b", nickname: "thinking-Large", context: 2048, maxContext: 131072  },
    { name: "gemma3-ctx:27b", nickname: "Q&A-Fast", context: 100352, maxContext: 131072 },
    { name: "cogito-ctx:32b", nickname: "reasoning-Fast", context: 47104, maxContext: 131072 },
    { name: "cogito-ctx:70b", nickname: "reasoning-Large", context: 2048, maxContext: 131072  },
    { name: "qwen2.5-coder-ctx:32b", nickname: "code-Fast", context: 47104, maxContext: 131072 },
    { name: "qwen2.5-coder-large-ctx:32b", nickname: "code-Large", context: 34816, maxContext: 131072 },
    { name: "qwen2-math-ctx:72b", nickname: "math-Large", context: 1024, maxContext: 131072 },
  ];

  // State for merged hard-coded + fetched models
  const [hcModels, setHcModels] = useState<Model[]>(initialHcModels);
  // Currently selected model name
  const [selectedModel, setSelectedModel] = useState<string>(initialHcModels[0]?.name || "");
  const [input, setInput] = useState("");
  const chatRef = useRef<ChatBoxHandle>(null);
  const [isUploadComplete, setIsUploadComplete] = useState(true);
  const [isStreamingComplete, setIsStreamingComplete] = useState(true);

  // Fetch model names and merge into hcModels
  useEffect(() => {
    fetchModelList().then((modelList: string[]) => {
      setHcModels((prev) => {
        const updated = [...prev];
        modelList.forEach((name) => {
          if (!updated.some((m) => m.name === name)) {
            updated.push({ name, nickname: name, context: 2048 });
          }
        });
        return updated;
      });
    });
  }, []);

  const handleModelChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newModel = e.target.value;
    setSelectedModel(newModel);
    await setModel(newModel);
    // Optionally: trigger a warmup call or other logic here
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    setIsUploadComplete(false);
    try {
      await uploadFileToContext(...Array.from(files));
      setInput("Please read these uploaded files.");
      handleSend();
      setIsUploadComplete(true);
    } catch (error) {
      console.error("File upload failed:", error);
      setIsUploadComplete(true);
    }
  };

  const handleSend = async () => {
    setIsStreamingComplete(false);
    try{
        const text = input.trim();
        if (!text || !chatRef.current) return;
        await chatRef.current.handleSend(text);
        setInput("");
    }
    catch (error) {
        console.error("Error sending message:", error);
    }
    finally {
        setIsStreamingComplete(true);
    }
  };

  // —— Directory picker (Chromium-only) ——
  const handleDirectoryPick = async () => {
    if (!("showDirectoryPicker" in window)) {
      alert(
        "Folder uploads only work in Chromium-based browsers at the moment."
      );
      return;
    }

    try {
      // @ts-ignore
      const dirHandle: FileSystemDirectoryHandle =
        await window.showDirectoryPicker();
      const files: File[] = [];

      // recursive traversal
      const recurse = async (handle: FileSystemHandle) => {
        if (handle.kind === "file") {
          // @ts-ignore
          files.push(await handle.getFile());
        } else {
          // @ts-ignore
          for await (const entry of handle.values()) {
            await recurse(entry);
          }
        }
      };

      await recurse(dirHandle);
      if (files.length) uploadFileToContext(...files);
    } catch (err) {
      console.error("Directory pick failed:", err);
    }
  };

  const handleClearChat = async () => {
    try {
      const response = await fetch("/clear", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });
      if (response.ok) {
        console.info("Cleared chat history");
      }
      else {
        console.error("Failed to clear chat history!");
      }
    }
    catch(error) {
      console.error("Error clearing chat history:", error);
    } 
  };


  

  return (
    <div
      className="container-fluid min-vh-100 d-flex flex-column"
      style={{ backgroundColor: '#2b2d31', color: '#ddd' }}
    >
      <header
        className="py-3 sticky-top shadow"
        style={{ backgroundColor: '#1e1f22', borderBottom: '1px solid #444' }}
      >
        <div className="container">
          <h1 className="h3 mb-2" style={{ color: '#fff' }}>
            LLM Chat Interface
          </h1>
          <div className="d-flex gap-2 flex-wrap">
            {/* Model selection shows nickname */}
            <select
              className="form-select form-select-sm w-auto bg-dark text-light border-secondary"
              value={selectedModel}
              onChange={handleModelChange}
            >
              {hcModels.map((m) => (
                <option key={m.name} value={m.name}>
                  {m.nickname}
                </option>
              ))}
            </select>

            {/* File upload button */}
            <input
              type="file"
              accept=".pdf"
              multiple
              webkitdirectory
              mozdirectory
              directory
              onChange={handleFileUpload}
              className="form-control form-control-sm w-auto bg-dark text-light border-secondary"
            />
            {/* new “Select Folder” button */}
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              onClick={handleDirectoryPick}
            >
              Select Folder…
            </button>
          </div>
        </div>
      </header>

      <main className="flex-grow-1">
        <ChatBox ref={chatRef} />
      </main>
      <footer className="border-top mt-auto sticky-bottom" style={{ backgroundColor: '#1e1f22', borderTop: '1px solid #444' }}>
        <div className="container py-2">
          <div className="d-flex gap-2">
            <button
              className="btn btn-danger"
              onClick={handleClearChat}
              style={{ marginRight: '10px' }}
            >
              Clear Chat
            </button>
            <textarea
              className="form-control bg-dark text-light border-secondary"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) =>
                e.key === "Enter" && !e.shiftKey && (e.preventDefault(), handleSend())
              }
              placeholder="Type your message..."
            />
            <button
              className="btn btn-primary"
              onClick={handleSend}
              disabled={chatRef.current?.streaming || !isUploadComplete || !isStreamingComplete}
            >
              Send
            </button>
          </div>
        </div>
        <div className="container text-center text-muted small pb-2">
          &copy; {new Date().getFullYear()} Ezevals LLM Chat
        </div>
      </footer>

    </div>
  );
}

export default App;

