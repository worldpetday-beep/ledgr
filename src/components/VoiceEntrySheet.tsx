import { useEffect, useRef, useState } from 'react'
import { db } from '../db'
import { money } from '../lib/format'
import { itemSearchMatches } from '../lib/itemMatch'
import { guessUnit } from '../lib/unitGuess'
import {
  buildCatalogSnapshot,
  findCatalogRow,
  parseVoiceTranscript,
  saveCorrection,
  VoiceEntryError,
  type NeedsInputItem,
  type ParsedLine,
} from '../lib/voiceEntry'
import type { CartLine } from '../pages/Sell'

// The Web Speech API has no bundled TS types in this project's lib target
// -- narrow ambient shape for just what's used here.
interface SpeechRecognitionResultLike {
  isFinal: boolean
  0: { transcript: string }
}
interface SpeechRecognitionEventLike extends Event {
  resultIndex: number
  results: ArrayLike<SpeechRecognitionResultLike>
}
interface SpeechRecognitionLike extends EventTarget {
  continuous: boolean
  interimResults: boolean
  lang: string
  start(): void
  stop(): void
  onresult: ((e: SpeechRecognitionEventLike) => void) | null
  onerror: ((e: Event) => void) | null
  onend: (() => void) | null
}
declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognitionLike
    webkitSpeechRecognition?: new () => SpeechRecognitionLike
  }
}

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

type Phase = 'record' | 'parsing' | 'review' | 'error'

export function VoiceEntrySheet({ onClose, onStage }: { onClose: () => void; onStage: (lines: CartLine[]) => void }) {
  const [phase, setPhase] = useState<Phase>('record')
  const [listening, setListening] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)

  const [catalog, setCatalog] = useState<Awaited<ReturnType<typeof buildCatalogSnapshot>> | null>(null)
  const [lines, setLines] = useState<(ParsedLine & { key: string })[]>([])
  const [needsInput, setNeedsInput] = useState<NeedsInputItem[]>([])
  const [drawer, setDrawer] = useState<{ usd: number; lrd: number } | null>(null)
  const [momo, setMomo] = useState<{ usd: number; lrd: number } | null>(null)
  const [applyDrawer, setApplyDrawer] = useState(true)
  const [applyMomo, setApplyMomo] = useState(true)
  const [resolvingPhrase, setResolvingPhrase] = useState<string | null>(null)
  const [resolveQuery, setResolveQuery] = useState('')
  const [saving, setSaving] = useState(false)

  const speechSupported = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition)

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop()
    }
  }, [])

  function startListening() {
    const Ctor = window.SpeechRecognition ?? window.webkitSpeechRecognition
    if (!Ctor) {
      setErrorMsg('This device/browser has no built-in speech recognition. Type the transcript below instead.')
      return
    }
    const rec = new Ctor()
    rec.continuous = true
    rec.interimResults = true
    rec.lang = 'en-US'
    let finalText = transcript
    rec.onresult = (e) => {
      let interim = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]
        if (r.isFinal) finalText = `${finalText} ${r[0].transcript}`.trim()
        else interim += r[0].transcript
      }
      setTranscript(interim ? `${finalText} ${interim}`.trim() : finalText)
    }
    rec.onerror = () => setListening(false)
    rec.onend = () => setListening(false)
    recognitionRef.current = rec
    rec.start()
    setListening(true)
  }

  function stopListening() {
    recognitionRef.current?.stop()
    setListening(false)
  }

  async function submitTranscript() {
    if (!transcript.trim()) return
    setPhase('parsing')
    setErrorMsg('')
    try {
      const snap = await buildCatalogSnapshot()
      setCatalog(snap)
      const parsed = await parseVoiceTranscript(transcript)
      setLines(parsed.lines.map((l) => ({ ...l, key: uid() })))
      setNeedsInput(parsed.needsInput)
      setDrawer(parsed.drawer)
      setMomo(parsed.momo)
      setPhase('review')
    } catch (err) {
      setErrorMsg(err instanceof VoiceEntryError ? err.message : 'Something went wrong parsing that. Enter this sale by hand instead.')
      setPhase('error')
    }
  }

  function removeLine(key: string) {
    setLines((prev) => prev.filter((l) => l.key !== key))
  }

  function resolveResults(query: string) {
    if (!catalog || !query.trim()) return []
    return catalog.rows.filter((r) => itemSearchMatches(r.name, query)).slice(0, 8)
  }

  async function resolveNeedsInput(item: NeedsInputItem, row: NonNullable<ReturnType<typeof resolveResults>>[number]) {
    await saveCorrection(item.rawPhrase, row.productId, row.variantId)
    setLines((prev) => [
      ...prev,
      {
        key: uid(),
        productId: row.productId,
        variantId: row.variantId,
        qty: 1,
        priceUsd: row.currency === 'USD' ? row.price : 0,
        priceLrd: row.currency === 'LRD' ? row.price : 0,
        paidUsd: 0,
        paidLrd: 0,
        tbs: false,
        rawPhrase: item.rawPhrase,
      },
    ])
    setNeedsInput((prev) => prev.filter((n) => n.rawPhrase !== item.rawPhrase))
    setResolvingPhrase(null)
    setResolveQuery('')
  }

  function dismissNeedsInput(rawPhrase: string) {
    setNeedsInput((prev) => prev.filter((n) => n.rawPhrase !== rawPhrase))
  }

  async function confirmAndStage() {
    if (!catalog || lines.length === 0) return
    setSaving(true)
    try {
      if (drawer && applyDrawer) {
        const todayKey = new Date().toISOString().slice(0, 10)
        const existing = await db.drawerCounts.where('timestamp').between(new Date(`${todayKey}T00:00:00`).getTime(), new Date(`${todayKey}T23:59:59`).getTime()).first()
        if (existing?.id) await db.drawerCounts.update(existing.id, { usdActual: drawer.usd, lrdActual: drawer.lrd })
        else await db.drawerCounts.add({ timestamp: Date.now(), usdActual: drawer.usd, lrdActual: drawer.lrd, outs: [] })
      }
      if (momo && applyMomo) {
        const todayKey = new Date().toISOString().slice(0, 10)
        const existing = await db.drawerCounts.where('timestamp').between(new Date(`${todayKey}T00:00:00`).getTime(), new Date(`${todayKey}T23:59:59`).getTime()).first()
        if (existing?.id) await db.drawerCounts.update(existing.id, { momoUsd: momo.usd, momoLrd: momo.lrd })
        else await db.drawerCounts.add({ timestamp: Date.now(), usdActual: 0, lrdActual: 0, outs: [], momoUsd: momo.usd, momoLrd: momo.lrd })
      }

      const cartLines: CartLine[] = []
      for (const l of lines) {
        const row = findCatalogRow(catalog.rows, l.productId, l.variantId)
        const variant = catalog.variantById.get(l.variantId)
        const product = catalog.productById.get(l.productId)
        if (!row || !variant || !product) continue
        const currency = l.priceLrd > 0 ? 'LRD' : 'USD'
        const price = currency === 'LRD' ? l.priceLrd : l.priceUsd
        cartLines.push({
          key: uid(),
          productId: l.productId,
          variantId: l.variantId,
          label: row.name,
          qty: l.qty || 1,
          unitType: row.unit || guessUnit(row.name, product.category),
          factor: row.factor,
          price,
          currency,
          cost: row.cost,
          tbs: l.tbs,
          stock: variant.stockMyShop + variant.stockVishalShop,
        })
      }
      onStage(cartLines)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="sheet" onClick={phase === 'record' ? onClose : undefined}>
      <div className="sbox" onClick={(e) => e.stopPropagation()}>
        <div className="grab" />
        <div className="scroll" style={{ paddingBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <p className="eb" style={{ margin: 0 }}>Voice entry</p>
            <button onClick={onClose} aria-label="Close" style={{ fontSize: 18, color: 'var(--cl-ink-3)' }}>✕</button>
          </div>

          {phase === 'record' && (
            <>
              <p style={{ fontSize: 12, color: 'var(--cl-ink-3)', lineHeight: 1.5, marginTop: 0 }}>
                Read out today's sales like you would in the paper ledger. Tap the mic, speak, tap it again to stop —
                then check the transcript below before sending it off to be parsed.
              </p>
              <div style={{ display: 'flex', justifyContent: 'center', margin: '18px 0' }}>
                <button
                  onClick={listening ? stopListening : startListening}
                  disabled={!speechSupported}
                  style={{
                    width: 84, height: 84, borderRadius: '50%', border: 0, fontSize: 30,
                    background: listening ? 'var(--cl-alarm)' : 'var(--cl-amber)', color: 'var(--cl-ink)',
                    opacity: speechSupported ? 1 : 0.4,
                  }}
                >
                  🎙
                </button>
              </div>
              {!speechSupported && (
                <p className="warn"><span>⚠</span><span>No built-in speech recognition here — type the transcript instead.</span></p>
              )}
              {listening && <p style={{ textAlign: 'center', fontSize: 12, color: 'var(--cl-alarm)', fontWeight: 700 }}>● Listening…</p>}
              <textarea
                className="in"
                style={{ width: '100%', minHeight: 100, marginTop: 10, fontSize: 14, resize: 'vertical' }}
                placeholder="Transcript will appear here as you speak — or type/edit it directly"
                value={transcript}
                onChange={(e) => setTranscript(e.target.value)}
              />
              <button className="btn amber" style={{ marginTop: 10 }} disabled={!transcript.trim()} onClick={submitTranscript}>
                Parse this
              </button>
            </>
          )}

          {phase === 'parsing' && (
            <p style={{ textAlign: 'center', padding: '30px 0', fontSize: 14, color: 'var(--cl-ink-2)' }}>Parsing…</p>
          )}

          {phase === 'error' && (
            <>
              <div className="warn"><span>⚠</span><span>{errorMsg}</span></div>
              <button className="btn ghost" style={{ marginTop: 10 }} onClick={() => setPhase('record')}>Back</button>
            </>
          )}

          {phase === 'review' && catalog && (
            <>
              {needsInput.length > 0 && (
                <>
                  <p className="eb" style={{ color: 'var(--cl-alarm)' }}>Needs your input</p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
                    {needsInput.map((item) => (
                      <div key={item.rawPhrase} className="entry" style={{ borderColor: 'var(--cl-alarm)' }}>
                        <b style={{ fontSize: 13 }}>"{item.rawPhrase}"</b>
                        <div style={{ fontSize: 11, color: 'var(--cl-ink-3)', marginTop: 2 }}>{item.reason}</div>
                        {resolvingPhrase === item.rawPhrase ? (
                          <div style={{ marginTop: 8 }}>
                            <input
                              autoFocus
                              className="in"
                              placeholder="Search products…"
                              value={resolveQuery}
                              onChange={(e) => setResolveQuery(e.target.value)}
                            />
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6 }}>
                              {resolveResults(resolveQuery).map((r) => (
                                <button
                                  key={`${r.productId}-${r.variantId}`}
                                  className="btn ghost"
                                  style={{ textAlign: 'left', letterSpacing: 0, textTransform: 'none', fontSize: 13 }}
                                  onClick={() => resolveNeedsInput(item, r)}
                                >
                                  {r.name} <span className="m" style={{ color: 'var(--cl-ink-3)' }}>· {money(r.price, r.currency as 'USD' | 'LRD')}</span>
                                </button>
                              ))}
                            </div>
                          </div>
                        ) : (
                          <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
                            <button style={{ fontSize: 12, fontWeight: 700, color: 'var(--cl-amber-2)' }} onClick={() => { setResolvingPhrase(item.rawPhrase); setResolveQuery('') }}>
                              Pick product
                            </button>
                            <button style={{ fontSize: 12, color: 'var(--cl-ink-3)' }} onClick={() => dismissNeedsInput(item.rawPhrase)}>
                              Skip
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              )}

              {(drawer || momo) && (
                <>
                  <p className="eb">Also detected</p>
                  <div className="card">
                    {drawer && (
                      <label className="st" style={{ cursor: 'pointer' }}>
                        <span className="k">
                          <input type="checkbox" checked={applyDrawer} onChange={(e) => setApplyDrawer(e.target.checked)} style={{ marginRight: 6 }} />
                          Today's till
                        </span>
                        <span className="v m">{money(drawer.usd, 'USD')} + {money(drawer.lrd, 'LRD')}</span>
                      </label>
                    )}
                    {momo && (
                      <label className="st" style={{ cursor: 'pointer' }}>
                        <span className="k">
                          <input type="checkbox" checked={applyMomo} onChange={(e) => setApplyMomo(e.target.checked)} style={{ marginRight: 6 }} />
                          MoMo
                        </span>
                        <span className="v m">{money(momo.usd, 'USD')} + {money(momo.lrd, 'LRD')}</span>
                      </label>
                    )}
                  </div>
                </>
              )}

              <p className="eb">Sale lines ({lines.length})</p>
              {lines.length === 0 && <p style={{ fontSize: 12, color: 'var(--cl-ink-3)' }}>Nothing resolved yet — resolve items above, or go back and re-record.</p>}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {lines.map((l) => {
                  const row = findCatalogRow(catalog.rows, l.productId, l.variantId)
                  return (
                    <div key={l.key} className="entry" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                      <div style={{ minWidth: 0 }}>
                        <b style={{ fontSize: 13 }}>{l.qty} {row?.name ?? l.rawPhrase}</b>
                        <div style={{ fontSize: 11, color: 'var(--cl-ink-3)' }}>
                          {l.tbs ? 'TBS · ' : ''}
                          {l.priceUsd > 0 && money(l.priceUsd, 'USD')}
                          {l.priceLrd > 0 && money(l.priceLrd, 'LRD')}
                        </div>
                      </div>
                      <button className="rm" onClick={() => removeLine(l.key)}>✕</button>
                    </div>
                  )
                })}
              </div>

              <button className="btn amber" style={{ marginTop: 14 }} disabled={lines.length === 0 || saving} onClick={confirmAndStage}>
                {saving ? 'Staging…' : `Review & confirm ${lines.length} line${lines.length === 1 ? '' : 's'} →`}
              </button>
              <p style={{ fontSize: 11, color: 'var(--cl-ink-3)', marginTop: 8, lineHeight: 1.5 }}>
                Nothing is recorded yet — this opens the same Settle screen as a normal sale, with these items already added, for one last check before confirming.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
