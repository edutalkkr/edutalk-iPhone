import { useState, useEffect, useCallback } from "react";
import { DEMO_MESSAGES } from "../mock/demoData";
import BzTooltip from "./ui/BzTooltip";

export interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  senderDepartment: string;
  content: string;
  createdAt: string;
  messageType: "text" | "file";
  isMine?: boolean;
}

export interface ChatRoom {
  id: string;
  name: string;
  type: "direct" | "group" | "department";
  participantIds: string[];
}

interface Props {
  openChatWith: (teacherId: string, teacherName: string) => void;
  closeChat: () => void;
}

export default function ChatWindow({ openChatWith, closeChat }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [scrollToBottom, setScrollToBottom] = useState(false);

  useEffect(() => {
    const loadInitialMessages = async () => {
      const sampleMessages = DEMO_MESSAGES.map((msg) => ({
        id: msg.id,
        senderId: msg.senderId,
        senderName: msg.senderName,
        senderDepartment: msg.senderDepartment,
        content: msg.content,
        createdAt: msg.createdAt,
        messageType: msg.messageType,
        isMine: msg.senderId === "me",
      }));
      setMessages(sampleMessages);
      setScrollToBottom(true);
    };
    loadInitialMessages();
  }, []);

  const handleSend = async () => {
    if (!input.trim()) return;
    setLoading(true);
    const newMessage: ChatMessage = {
      id: `m-${Date.now()}`,
      senderId: "me",
      senderName: "내",
      senderDepartment: "내",
      content: input,
      createdAt: new Date().toISOString(),
      messageType: "text",
      isMine: true,
    };
    setMessages((prev) => [...prev, newMessage]);
    setInput("");
    setLoading(false);
    setScrollToBottom(true);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="w-[380px] h-[500px] bg-white border border-edu-line shadow-xl flex flex-col overflow-hidden">
      {/* Chat Header */}
      <div className="h-14 border-b border-edu-line px-3 py-2 flex items-center justify-between bg-edu-bg">
        <h3 className="text-[14px] text-edu-ink font-medium">대화</h3>
        <button onClick={closeChat} className="text-slate-400 hover:text-edu-blue transition-colors">
          ✕
        </button>
      </div>

      {/* Messages Area */}
      <div className="flex-1 p-3 overflow-y-auto space-y-3 scrollbar">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.isMine ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[80%] rounded-2xl ${
                msg.isMine
                  ? "bg-blue-600 text-white"
                  : "bg-slate-100 text-slate-700"
              } px-3 py-2`}
            >
              <div className="text-[12px] leading-tight">
                {msg.content}
              </div>
              <div className="text-[10px] text-slate-400 mt-1">
                {msg.senderName}
              </div>
            </div>
          </div>
        ))}

        {!messages.length && (
          <div className="text-center text-slate-400 py-8">
            <p>메시지가 없어요.</p>
            <p>교사를 선택해 주세요.</p>
          </div>
        )}
      </div>

      {/* Input Area */}
      <div className="p-3 border-t border-edu-line bg-white flex items-center gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="메시지를 입력해 주세요..."
          className="edu-input flex-1 !text-[13px] rounded-xl focus-ring-2 focus-ring-[#0082C8]/30"
          disabled={loading}
        />
        <button
          onClick={handleSend}
          className="edu-btn py-2.5 px-4 text-[13px] font-medium text-edu-white rounded-2xl bg-edu-bg hover:bg-[#0069A8] transition-colors"
          disabled={loading}
        >
          {loading ? "전송 중..." : "전송"}
        </button>

        {/* File Attachment Zone */}
        <BzTooltip content="파일 첨부" position="top">
          <div
            className="w-10 h-10 rounded-2xl bg-edu-chip flex items-center justify-center hover:bg-edu-hover transition-colors cursor-pointer"
            aria-label="파일 첨부"
          >
            &#x1F4E6;
          </div>
        </BzTooltip>
      </div>
    </div>
  );
}