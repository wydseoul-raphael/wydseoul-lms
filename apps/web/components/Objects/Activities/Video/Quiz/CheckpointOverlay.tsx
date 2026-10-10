'use client'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckCircle2, XCircle } from 'lucide-react'
import { pickLocale } from '@/lib/videoQuiz/localized'
import { newAttemptId, type QuizQuestionPublic } from '@services/courses/videoQuiz'
import { QuestionCard } from './QuestionCard'

interface Props {
  question: QuizQuestionPublic
  onAnswer: (_attemptId: string, _selected: string[]) => Promise<{ correct: boolean; canContinue: boolean; explanation: Record<string, string | undefined> | null }>
  onContinue: () => void
}

// Pauses the video at a checkpoint: the learner answers, sees feedback and
// continues (or retries when the checkpoint requires a correct answer).
export function CheckpointOverlay({ question, onAnswer, onContinue }: Props) {
  const { t, i18n } = useTranslation()
  const [selected, setSelected] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ correct: boolean; canContinue: boolean; explanation: Record<string, string | undefined> | null } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    if (!selected.length || busy) return
    setBusy(true)
    setError(null)
    try {
      setResult(await onAnswer(newAttemptId(), selected))
    } catch {
      setError(t('activities.video_quiz.failed_submit'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="wyd-checkpoint-title" className="absolute inset-0 z-40 grid place-items-center overflow-y-auto bg-black/85 p-4 text-wyd-ink">
      <div className="w-full max-w-[620px] space-y-3">
        <p id="wyd-checkpoint-title" className="text-center text-[12px] font-black uppercase tracking-[0.16em] text-wyd-yellow">
          {t('activities.video_quiz.checkpoint_title')}
        </p>
        <QuestionCard
          question={question}
          value={selected}
          onChange={setSelected}
          disabled={!!result?.canContinue}
          status={result ? (result.correct ? 'correct' : 'wrong') : 'idle'}
        />
        {result && (
          <div className={`flex items-start gap-2 rounded-lg px-4 py-3 text-[14px] font-semibold ${result.correct ? 'bg-[#e6f8f0] text-wyd-success' : 'bg-[#fff0f1] text-wyd-red'}`}>
            {result.correct ? <CheckCircle2 size={18} aria-hidden="true" /> : <XCircle size={18} aria-hidden="true" />}
            <div>
              <p>{result.correct ? t('activities.video_quiz.correct') : t('activities.video_quiz.incorrect')}</p>
              {!result.correct && !result.canContinue && <p className="font-normal">{t('activities.video_quiz.must_answer_correctly')}</p>}
              {result.explanation && <p className="mt-1 font-normal text-wyd-ink">{pickLocale(result.explanation, i18n.language)}</p>}
            </div>
          </div>
        )}
        {error && <p className="text-center text-[13px] font-semibold text-wyd-red">{error}</p>}
        <div className="flex justify-end gap-2">
          {!result || (!result.correct && !result.canContinue) ? (
            <button
              type="button"
              onClick={result ? () => { setResult(null); setSelected([]) } : submit}
              disabled={busy || (!result && !selected.length)}
              className="inline-flex min-h-[44px] items-center justify-center rounded-xl bg-wyd-blue px-5 text-[14px] font-extrabold text-white hover:bg-wyd-blue-dark disabled:opacity-50"
            >
              {busy ? t('activities.video_quiz.submitting') : result ? t('activities.video_quiz.retry') : t('activities.video_quiz.submit')}
            </button>
          ) : (
            <button type="button" onClick={onContinue} className="inline-flex min-h-[44px] items-center justify-center rounded-xl bg-wyd-success px-5 text-[14px] font-extrabold text-white hover:brightness-95">
              {t('activities.video_quiz.continue')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export default CheckpointOverlay
