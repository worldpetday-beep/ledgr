import { useEffect, useRef, useState } from 'react'
import { BottomSheet, Button, inputClass } from './ui'
import { answerInsightQuery } from '../lib/insights'

interface ChatMessage {
  id: number
  role: 'user' | 'assistant'
  text: string
}

const GREETING =
  'Ask me things like "what\'s my highest revenue day", "who\'s my top customer", or "which customer bought zinc in the last 15 days".'

export function InsightsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const nextId = useRef(1)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open && messages.length === 0) {
      setMessages([{ id: nextId.current++, role: 'assistant', text: GREETING }])
    }
  }, [open, messages.length])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  async function send() {
    const text = input.trim()
    if (!text || busy) return
    setMessages((m) => [...m, { id: nextId.current++, role: 'user', text }])
    setInput('')
    setBusy(true)
    try {
      const answer = await answerInsightQuery(text)
      setMessages((m) => [...m, { id: nextId.current++, role: 'assistant', text: answer }])
    } finally {
      setBusy(false)
    }
  }

  return (
    <BottomSheet open={open} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">Ask about your sales</h2>
        <div ref={scrollRef} className="flex max-h-[50vh] flex-col gap-2 overflow-y-auto pr-1">
          {messages.map((m) => (
            <div
              key={m.id}
              className={`max-w-[85%] whitespace-pre-line rounded-2xl px-3.5 py-2.5 text-sm ${
                m.role === 'user'
                  ? 'ml-auto bg-[var(--series-1)] text-white'
                  : 'mr-auto bg-[var(--page-plane)] text-[var(--text-primary)]'
              }`}
            >
              {m.text}
            </div>
          ))}
          {busy && (
            <div className="mr-auto rounded-2xl bg-[var(--page-plane)] px-3.5 py-2.5 text-sm text-[var(--text-muted)]">
              Thinking…
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <input
            className={inputClass}
            placeholder="e.g. which customer bought zinc in the last 15 days"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && send()}
          />
          <Button onClick={send} disabled={!input.trim() || busy}>
            Ask
          </Button>
        </div>
      </div>
    </BottomSheet>
  )
}
