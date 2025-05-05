// ---------- web-client/src/App.tsx ----------
import ChatBox from "./components/ChatBox";
export default function App() {
  return (
    <main className="bg-gray-50 min-h-screen p-6">
      <h1 className="text-2xl font-bold mb-4 text-center">🧠 Chat with Ollama</h1>
      <ChatBox />
    </main>
  );
}
