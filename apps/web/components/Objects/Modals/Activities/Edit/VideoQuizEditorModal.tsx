'use client'
import React, { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import BarLoader from 'react-spinners/BarLoader'
import { Plus, Trash, Clock, ListChecks, Translate, ChartBar, GearSix } from '@phosphor-icons/react'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { SUPPORTED_QUIZ_LANGS, type LocalizedText, type QuizLang } from '@/lib/videoQuiz/localized'
import {
  deleteVideoQuiz,
  getVideoQuizAdmin,
  getVideoQuizStats,
  upsertVideoQuiz,
  type QuizQuestionUpsert,
  type QuizSettings,
  type VideoQuizAdmin,
} from '@services/courses/videoQuiz'
import { formatClock } from '@components/Objects/Activities/Video/watchPolicy'

interface Props {
  activity: any
  onClose: () => void
}

type Tab = 'checkpoints' | 'end' | 'settings' | 'results'

const LANG_LABEL: Record<QuizLang, string> = { en: 'EN', ko: '한국어', it: 'IT', fr: 'FR', es: 'ES', pt: 'PT' }
const inputCls = 'w-full h-9 px-3 text-sm rounded-lg bg-gray-50 border border-gray-200 outline-none focus:border-gray-300 focus:ring-1 focus:ring-gray-200'
const smallBtn = 'inline-flex items-center gap-1 h-8 px-3 text-xs font-medium rounded-lg transition-colors disabled:opacity-50'

const uid = (prefix: string) => `${prefix}_${Math.random().toString(36).slice(2, 8)}`

function emptyQuestion(kind: 'checkpoint' | 'end', timestamp?: number): QuizQuestionUpsert {
  return {
    id: uid('q'),
    kind,
    type: 'single',
    timestamp: kind === 'checkpoint' ? Math.max(0, Math.round(timestamp ?? 0)) : null,
    prompt: {},
    options: [
      { id: uid('o'), text: {}, correct: true },
      { id: uid('o'), text: {}, correct: false },
    ],
    required_correct: kind === 'checkpoint',
    explanation: null,
  }
}

function fromAdmin(admin: VideoQuizAdmin): QuizQuestionUpsert[] {
  return admin.questions.map((q) => ({
    id: q.id,
    kind: q.kind,
    type: q.type,
    timestamp: q.timestamp,
    prompt: q.prompt,
    required_correct: q.required_correct,
    explanation: q.explanation ?? null,
    options: q.options.map((o) => ({ id: o.id, text: o.text, correct: (admin.answerKey[q.id] || []).includes(o.id) })),
  }))
}

// Six-language text editor for one field.
function LocalizedInput({ value, onChange, lang, placeholder, multiline }: { value: LocalizedText; onChange: (_v: LocalizedText) => void; lang: QuizLang; placeholder: string; multiline?: boolean }) {
  const common = { value: value?.[lang] || '', placeholder, onChange: (e: any) => onChange({ ...value, [lang]: e.target.value }) }
  return multiline ? <textarea {...common} rows={2} className={`${inputCls} h-auto py-2`} /> : <input {...common} className={inputCls} />
}

function QuestionEditor({ q, lang, onChange, onRemove, onPickTime }: { q: QuizQuestionUpsert; lang: QuizLang; onChange: (_q: QuizQuestionUpsert) => void; onRemove: () => void; onPickTime?: () => number }) {
  const setType = (type: QuizQuestionUpsert['type']) => {
    let options = q.options
    if (type === 'true_false') {
      options = [
        { id: 'true', text: { en: 'True', ko: '참', it: 'Vero', fr: 'Vrai', es: 'Verdadero', pt: 'Verdadeiro' }, correct: true },
        { id: 'false', text: { en: 'False', ko: '거짓', it: 'Falso', fr: 'Faux', es: 'Falso', pt: 'Falso' }, correct: false },
      ]
    } else if (type === 'single') {
      let seen = false
      options = q.options.map((o) => {
        const c = o.correct && !seen
        if (o.correct) seen = true
        return { ...o, correct: c }
      })
    }
    onChange({ ...q, type, options })
  }
  const toggleCorrect = (idx: number) => {
    const options = q.options.map((o, i) => {
      if (q.type === 'multiple') return i === idx ? { ...o, correct: !o.correct } : o
      return { ...o, correct: i === idx }
    })
    onChange({ ...q, options })
  }
  const missing = SUPPORTED_QUIZ_LANGS.filter((l) => !q.prompt?.[l]?.trim() || q.options.some((o) => !o.text?.[l]?.trim()))

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {q.kind === 'checkpoint' && (
          <label className="inline-flex items-center gap-1 text-xs text-gray-600">
            <Clock size={14} />
            <input
              type="number"
              min={0}
              value={q.timestamp ?? 0}
              onChange={(e) => onChange({ ...q, timestamp: Math.max(0, Number(e.target.value) || 0) })}
              className={`${inputCls} w-24`}
            />
            <span className="text-gray-400">s ({formatClock(q.timestamp ?? 0)})</span>
            {onPickTime && (
              <button type="button" className={`${smallBtn} bg-gray-100 text-gray-700`} onClick={() => onChange({ ...q, timestamp: Math.round(onPickTime()) })}>
                Use player time
              </button>
            )}
          </label>
        )}
        <select value={q.type} onChange={(e) => setType(e.target.value as any)} className={`${inputCls} w-auto`}>
          <option value="single">Single choice</option>
          <option value="multiple">Multiple answers</option>
          <option value="true_false">True / False</option>
        </select>
        {q.kind === 'checkpoint' && (
          <label className="inline-flex items-center gap-1.5 text-xs text-gray-600">
            <input type="checkbox" checked={!!q.required_correct} onChange={(e) => onChange({ ...q, required_correct: e.target.checked })} />
            Must answer correctly to continue
          </label>
        )}
        <span className={`ms-auto rounded-full px-2 py-0.5 text-[11px] font-semibold ${missing.length ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>
          <Translate size={12} className="inline me-1" />
          {missing.length ? `missing: ${missing.join(', ')}` : 'all languages'}
        </span>
        <button type="button" onClick={onRemove} aria-label="Remove question" className="p-1 text-gray-400 hover:text-rose-600"><Trash size={16} /></button>
      </div>
      <LocalizedInput lang={lang} value={q.prompt} onChange={(prompt) => onChange({ ...q, prompt })} placeholder={`Question (${LANG_LABEL[lang]})`} multiline />
      <div className="space-y-2">
        {q.options.map((o, i) => (
          <div key={o.id} className="flex items-center gap-2">
            <input
              type={q.type === 'multiple' ? 'checkbox' : 'radio'}
              name={`correct-${q.id}`}
              checked={o.correct}
              onChange={() => toggleCorrect(i)}
              title="Correct answer"
              className="accent-emerald-600"
            />
            <LocalizedInput
              lang={lang}
              value={o.text}
              onChange={(text) => onChange({ ...q, options: q.options.map((x, k) => (k === i ? { ...x, text } : x)) })}
              placeholder={`Option ${i + 1} (${LANG_LABEL[lang]})`}
            />
            {q.type !== 'true_false' && q.options.length > 2 && (
              <button type="button" aria-label="Remove option" onClick={() => onChange({ ...q, options: q.options.filter((_, k) => k !== i) })} className="p-1 text-gray-400 hover:text-rose-600"><Trash size={14} /></button>
            )}
          </div>
        ))}
        {q.type !== 'true_false' && q.options.length < 8 && (
          <button type="button" onClick={() => onChange({ ...q, options: [...q.options, { id: uid('o'), text: {}, correct: false }] })} className={`${smallBtn} bg-gray-100 text-gray-700`}>
            <Plus size={14} /> Add option
          </button>
        )}
      </div>
      <LocalizedInput lang={lang} value={q.explanation || {}} onChange={(explanation) => onChange({ ...q, explanation })} placeholder={`Explanation shown after answering (optional, ${LANG_LABEL[lang]})`} />
    </div>
  )
}

export default function VideoQuizEditorModal({ activity, onClose }: Props) {
  const session = useLHSession() as any
  const token = session?.data?.tokens?.access_token
  const [tab, setTab] = useState<Tab>('checkpoints')
  const [lang, setLang] = useState<QuizLang>('ko')
  const [questions, setQuestions] = useState<QuizQuestionUpsert[]>([])
  const [settings, setSettings] = useState<QuizSettings>({ end_quiz_required: true, pass_score: 100, max_attempts: 0, show_wrong_questions: false, shuffle_options: false })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [stats, setStats] = useState<Awaited<ReturnType<typeof getVideoQuizStats>> | null>(null)
  const [previewTime, setPreviewTime] = useState(0)
  const duration = Number(activity?.details?.durationSeconds) || 0

  useEffect(() => {
    let cancelled = false
    getVideoQuizAdmin(activity.activity_uuid, token)
      .then((admin) => {
        if (cancelled) return
        setQuestions(fromAdmin(admin))
        setSettings(admin.settings)
      })
      .catch(() => toast.error('Could not load the quiz'))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [activity.activity_uuid, token])

  useEffect(() => {
    if (tab !== 'results') return
    getVideoQuizStats(activity.activity_uuid, token).then(setStats).catch(() => setStats(null))
  }, [tab, activity.activity_uuid, token])

  const checkpoints = useMemo(() => questions.filter((q) => q.kind === 'checkpoint').sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0)), [questions])
  const endQuestions = useMemo(() => questions.filter((q) => q.kind === 'end'), [questions])

  const update = (q: QuizQuestionUpsert) => setQuestions((list) => list.map((x) => (x.id === q.id ? q : x)))
  const remove = (id: string) => setQuestions((list) => list.filter((x) => x.id !== id))

  const save = async () => {
    for (const q of questions) {
      if (!q.prompt?.en && !q.prompt?.ko) return toast.error('Every question needs text in English or Korean')
      if (!q.options.some((o) => o.correct)) return toast.error('Every question needs a correct answer')
    }
    setSaving(true)
    const id = toast.loading('Saving quiz…')
    try {
      const admin = await upsertVideoQuiz(activity.activity_uuid, { questions, settings }, token)
      setQuestions(fromAdmin(admin))
      toast.success(`Quiz saved (version ${admin.version})`, { id })
    } catch (e: any) {
      toast.error(e?.message || 'Could not save the quiz', { id })
    } finally {
      setSaving(false)
    }
  }

  const removeAll = async () => {
    if (!confirm('Delete the whole quiz for this video?')) return
    try {
      await deleteVideoQuiz(activity.activity_uuid, token)
      setQuestions([])
      toast.success('Quiz deleted')
      onClose()
    } catch (e: any) {
      toast.error(e?.message || 'Could not delete the quiz')
    }
  }

  if (loading) return <div className="flex justify-center py-12"><BarLoader color="#6b7280" width={120} /></div>

  const tabs: Array<[Tab, string, React.ReactNode]> = [
    ['checkpoints', `Checkpoints (${checkpoints.length})`, <Clock size={14} key="c" />],
    ['end', `End quiz (${endQuestions.length})`, <ListChecks size={14} key="e" />],
    ['settings', 'Settings', <GearSix size={14} key="s" />],
    ['results', 'Results', <ChartBar size={14} key="r" />],
  ]

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-200 pb-3">
        {tabs.map(([key, label, icon]) => (
          <button key={key} type="button" onClick={() => setTab(key)} className={`${smallBtn} ${tab === key ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-700'}`}>
            {icon} {label}
          </button>
        ))}
        <div className="ms-auto flex items-center gap-1 text-xs">
          <Translate size={14} className="text-gray-400" />
          {SUPPORTED_QUIZ_LANGS.map((l) => (
            <button key={l} type="button" onClick={() => setLang(l)} className={`rounded px-2 py-1 font-semibold ${lang === l ? 'bg-wyd-blue text-white' : 'text-gray-500 hover:bg-gray-100'}`}>
              {LANG_LABEL[l]}
            </button>
          ))}
        </div>
      </div>

      {tab === 'checkpoints' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 rounded-lg bg-gray-50 p-3 text-xs text-gray-600">
            <span>Video length: {duration ? formatClock(duration) : 'not set — save the trusted length in the video settings first'}</span>
            <label className="ms-auto inline-flex items-center gap-1">
              Timestamp
              <input type="number" min={0} max={duration || undefined} value={previewTime} onChange={(e) => setPreviewTime(Math.max(0, Number(e.target.value) || 0))} className={`${inputCls} w-24`} />
              <span>({formatClock(previewTime)})</span>
            </label>
            <button type="button" onClick={() => setQuestions((l) => [...l, emptyQuestion('checkpoint', previewTime)])} className={`${smallBtn} bg-wyd-blue text-white`}>
              <Plus size={14} /> Add checkpoint here
            </button>
          </div>
          {duration > 0 && checkpoints.length > 0 && (
            <div className="relative h-2 rounded-full bg-gray-200">
              {checkpoints.map((c) => (
                <span key={c.id} title={formatClock(c.timestamp || 0)} className="absolute top-1/2 h-3 w-3 -translate-y-1/2 rounded-full bg-wyd-red ring-2 ring-white" style={{ insetInlineStart: `calc(${Math.min(100, ((c.timestamp || 0) / duration) * 100)}% - 6px)` }} />
              ))}
            </div>
          )}
          {checkpoints.length === 0 && <p className="text-sm text-gray-500">No checkpoints yet. The video pauses at each checkpoint until the learner answers.</p>}
          {checkpoints.map((q) => (
            <QuestionEditor key={q.id} q={q} lang={lang} onChange={update} onRemove={() => remove(q.id)} onPickTime={() => previewTime} />
          ))}
        </div>
      )}

      {tab === 'end' && (
        <div className="space-y-3">
          <p className="text-sm text-gray-500">Shown after the video is verified-watched. Learners need {settings.pass_score}% to complete the lesson.</p>
          {endQuestions.map((q) => (
            <QuestionEditor key={q.id} q={q} lang={lang} onChange={update} onRemove={() => remove(q.id)} />
          ))}
          <button type="button" onClick={() => setQuestions((l) => [...l, emptyQuestion('end')])} className={`${smallBtn} bg-wyd-blue text-white`}>
            <Plus size={14} /> Add question
          </button>
        </div>
      )}

      {tab === 'settings' && (
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={settings.end_quiz_required} onChange={(e) => setSettings({ ...settings, end_quiz_required: e.target.checked })} />
            End quiz required to complete the lesson
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={settings.show_wrong_questions} onChange={(e) => setSettings({ ...settings, show_wrong_questions: e.target.checked })} />
            Show which questions were wrong
          </label>
          <label className="grid gap-1 text-sm text-gray-700">
            Pass score (%)
            <input type="number" min={1} max={100} value={settings.pass_score} onChange={(e) => setSettings({ ...settings, pass_score: Math.max(1, Math.min(100, Number(e.target.value) || 100)) })} className={inputCls} />
          </label>
          <label className="grid gap-1 text-sm text-gray-700">
            Max attempts (0 = unlimited)
            <input type="number" min={0} max={100} value={settings.max_attempts} onChange={(e) => setSettings({ ...settings, max_attempts: Math.max(0, Number(e.target.value) || 0) })} className={inputCls} />
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={settings.shuffle_options} onChange={(e) => setSettings({ ...settings, shuffle_options: e.target.checked })} />
            Shuffle option order
          </label>
        </div>
      )}

      {tab === 'results' && (
        <div className="space-y-3 text-sm">
          {!stats ? (
            <p className="text-gray-500">No results yet.</p>
          ) : (
            <>
              {stats.endQuiz && (
                <div className="grid grid-cols-3 gap-3">
                  <div className="rounded-lg bg-gray-50 p-3"><div className="text-[11px] text-gray-500">End-quiz attempts</div><div className="text-xl font-bold">{stats.endQuiz.attempts}</div></div>
                  <div className="rounded-lg bg-gray-50 p-3"><div className="text-[11px] text-gray-500">Pass rate</div><div className="text-xl font-bold">{stats.endQuiz.passRate === null ? '—' : `${Math.round(stats.endQuiz.passRate * 100)}%`}</div></div>
                  <div className="rounded-lg bg-gray-50 p-3"><div className="text-[11px] text-gray-500">Avg attempts / learner</div><div className="text-xl font-bold">{stats.endQuiz.avgAttemptsPerLearner ?? '—'}</div></div>
                </div>
              )}
              <table className="w-full text-start text-xs">
                <thead className="text-gray-500"><tr><th className="py-1 text-start">Question</th><th className="text-start">Kind</th><th className="text-end">Attempts</th><th className="text-end">Accuracy</th></tr></thead>
                <tbody>
                  {stats.questions.map((q) => (
                    <tr key={q.questionId} className="border-t border-gray-100">
                      <td className="py-1.5">{questions.find((x) => x.id === q.questionId)?.prompt?.[lang] || q.questionId}</td>
                      <td>{q.kind}</td>
                      <td className="text-end">{q.attempts}</td>
                      <td className="text-end">{q.accuracy === null ? '—' : `${Math.round(q.accuracy * 100)}%`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      )}

      <div className="flex items-center justify-between border-t border-gray-200 pt-3">
        <button type="button" onClick={removeAll} className={`${smallBtn} text-rose-600 hover:bg-rose-50`}><Trash size={14} /> Delete quiz</button>
        <div className="flex gap-2">
          <button type="button" onClick={onClose} className={`${smallBtn} h-9 bg-gray-100 text-gray-700`}>Close</button>
          <button type="button" onClick={save} disabled={saving} className={`${smallBtn} h-9 px-4 bg-wyd-blue text-white hover:bg-wyd-blue-dark`}>{saving ? 'Saving…' : 'Save quiz'}</button>
        </div>
      </div>
    </div>
  )
}
