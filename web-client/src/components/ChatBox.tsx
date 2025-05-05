import { useState } from "react";
import { chatWithLLM } from "../api";

export default function ChatBox() {
  const [messages, setMessages] = useState<any[]>([]);
  const [input, setInput] = useState("");
  const [streamedResponse, setStreamedResponse] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const newMessages = [...messages, { role: "user", content: input }];
    setMessages(newMessages);
    setInput("");
    setStreamedResponse("");

    for await (const chunk of chatWithLLM(newMessages)) {
      setStreamedResponse(prev => prev + chunk);
    }

    setMessages([...newMessages, { role: "assistant", content: streamedResponse }]);
  };

  return (
    <div className="p-4 max-w-xl mx-auto">
      <div className="border rounded p-4 mb-4 h-96 overflow-y-scroll">
        {messages.map((msg, idx) => (
          <div key={idx} className={`mb-2 ${msg.role === "user" ? "text-right" : "text-left"}`}>
            <b>{msg.role === "user" ? "You" : "Bot"}:</b> {msg.content}
          </div>
        ))}
        {streamedResponse && (
          <div className="text-left text-blue-600 whitespace-pre-wrap">{streamedResponse}</div>
        )}
      </div>
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          className="border rounded p-2 flex-1"
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="Ask something..."
        />
        <button className="bg-blue-500 text-white px-4 rounded" type="submit">Send</button>
      </form>
    </div>
  );
}
