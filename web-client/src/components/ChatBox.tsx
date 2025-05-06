import { useEffect, useRef, useState, forwardRef, useImperativeHandle } from "react";
import { chatWithLLM } from "../api";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import rehypePrism from "rehype-prism-plus";
import "katex/dist/katex.min.css";
import "../chat-theme.css";

interface Message {
  role: "user" | "assistant";
  content: string;
}

export interface ChatBoxHandle {
  handleSend: (input: string) => void;
  streaming: boolean;
}

const ChatBox = forwardRef<ChatBoxHandle>((_, ref) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [abortController, setAbortController] = useState<AbortController | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [messages]);

  async function handleSend(input: string) {
    if (!input.trim()) return;
    const userMessage: Message = { role: "user", content: input };
    const placeholderAssistant: Message = { role: "assistant", content: "" };
    setMessages((prev) => [...prev, userMessage, placeholderAssistant]);
    setStreaming(true);

    const controller = new AbortController();
    setAbortController(controller);

    try {
      await chatWithLLM(
        prompt,
        (chunk) => {
          setMessages((message_state) => [
            ...message_state,
            {role: "assistant", content: chunk},

          ]);
        },
        controller.signal
      );
    } catch (err) {
      console.error("Streaming error:", err);
    } finally {
      setStreaming(false);
    }
  }

  useImperativeHandle(ref, () => ({
    handleSend,
    streaming,
  }));

  // Updated to handle <think>/</think> tags
  const renderMessageContent = (content: string) => {
    const parts = content.split("<think>");
    if (parts.length <= 1) {
      return <ReactMarkdown>{content}</ReactMarkdown>;
    }

    const [before, thoughtsAndResponse] = parts;
    const [thoughts, response] = thoughtsAndResponse.split("</think>");

    return (
      <>
        <ReactMarkdown>{before}</ReactMarkdown>
        <div className="thoughts">
          <ReactMarkdown>{thoughts}</ReactMarkdown>
        </div>
        <ReactMarkdown>{response}</ReactMarkdown>
      </>
    );
  };

  return (
    <div className="d-flex flex-column h-100 px-3 pt-3">
      <div className="flex-grow-1 overflow-auto mb-3 border rounded p-3" ref={containerRef}>
        {messages.map((msg, i) => (
          <div key={i} className={`chat-message ${msg.role}`}>
            <div className={`bubble ${msg.role}`}>
              {msg.role === "assistant" ? (
                renderMessageContent(msg.content)
              ) : (
                <ReactMarkdown>{msg.content}</ReactMarkdown>
              )}
            </div>
          </
          div>
        ))}
        {streaming && <div className="text-muted text-center">Streaming...</div>}
      </div>
    </div>
  );
});

export default ChatBox;
