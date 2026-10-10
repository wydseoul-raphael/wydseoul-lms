'use client'
import React, { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Lock, CheckCircle2 } from 'lucide-react'
import { newAttemptId, type VideoQuizPublic } from '@services/courses/videoQuiz'
import { QuestionCard } from './QuestionCard'

interface Props {
  quiz: VideoQuizPublic
  videoComplete: boolean
  onSubmit: (_attemptId: string, _answers: Record<string, string[]>) => Promise<{
    score: number
    passed: boolean
    correctCount: number
    total: number
    wrongQuestionIds?: string[]
    attemptsUsed: number
    attemptsRemaining: number | null
    activityCompleted: boolean
  }>
}

// End-of-video quiz (reference QuizPage): locked until the video is verified,
// 100 % (pass_score) to complete the lesson, retries per settings.
export function EndQuizPanel({ quiz, videoComplete, onSubmit }: Props) {
  const { t } = useTranslation()
  const questions = useMemo(() => quiz.questions.filter((q) => q.kind === 'end'), [quiz.questions])
  const [answers, setAnswers] = useState<Record<string, string[]>>({})
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<Awaited<ReturnType<Props['onSubmit']>> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const passScore = quiz.settings.pass_score ?? 100
  const state = quiz.state?.end
  const alreadyPassed = !!state?.passed
  const remaining = result?.attemptsRemaining ?? state?.attemptsRemaining ?? null
  const outOfAttempts = remaining !== null && remaining <= 0 && !alreadyPassed && !result?.passed

  if (questions.length === 0) return null

  const submit = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      setResult(await onSubmit(newAttemptId(), answers))
    } catch {
      setError(t('activities.video_quiz.failed_submit'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-labelledby="wyd-end-quiz-title" className="mt-6 rounded-wyd-lg border border-wyd-line bg-white p-5 shadow-[0_16px_45px_rgba(18,40,76,0.08)] sm:p-8">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="wyd-end-quiz-title" className="text-[22px] font-black text-wyd-navy">{t('activities.video_quiz.end_title')}</h2>
          <p className="text-[14px] text-wyd-muted">{t('activities.video_quiz.end_description', { score: passScore })}</p>
        </div>
        {(alreadyPassed || result?.passed) && (
          <span className="inline-flex items-center gap-1 rounded-full bg-[#e6f8f0] px-3 py-1 text-[13px] font-bold text-wyd-success">
            <CheckCircle2 size={14} aria-hidden="true" /> {t('activities.video_quiz.passed')}
          </span>
        )}
      </div>

      {!videoComplete && !alreadyPassed ? (
        <p className="inline-flex items-center gap-2 rounded-lg bg-wyd-canvas px-4 py-3 text-[14px] font-semibold text-wyd-muted">
          <Lock size={16} aria-hidden="true" /> {t('activities.video_quiz.end_locked')}
        </p>
      ) : (
        <>
          <div className="grid gap-4">
            {questions.map((q, i) => (
              <QuestionCard
                key={q.id}
                question={q}
                index={i}
                total={questions.length}
                value={answers[q.id] || []}
                onChange={(sel) => setAnswers((a) => ({ ...a, [q.id]: sel }))}
                disabled={busy || !!result?.passed || alreadyPassed}
                wrong={!!result?.wrongQuestionIds?.includes(q.id)}
              />
            ))}
          </div>
          {result && (
            <div role="status" className={`mt-4 rounded-lg px-4 py-3 text-[14px] font-semibold ${result.passed ? 'bg-[#e6f8f0] text-wyd-success' : 'bg-[#fff8d8] text-wyd-navy'}`}>
              {t('activities.video_quiz.score')}: {result.score}% ({result.correctCount}/{result.total}) · {result.passed ? t('activities.video_quiz.passed') : t('activities.video_quiz.failed')}
              {result.passed && result.activityCompleted && <span className="ms-2">🎉 {t('activities.video_quiz.activity_completed')}</span>}
              {!result.passed && result.wrongQuestionIds && result.wrongQuestionIds.length > 0 && (
                <span className="block font-normal">{t('activities.video_quiz.wrong_questions')} {result.wrongQuestionIds.length}</span>
              )}
            </div>
          )}
          {error && <p className="mt-3 text-[13px] font-semibold text-wyd-red">{error}</p>}
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 text-[13px] text-wyd-muted">
            <span>
              {remaining === null
                ? t('activities.video_quiz.unlimited_attempts')
                : t('activities.video_quiz.attempts_remaining', { n: remaining })}
              {' · '}
              {t('activities.video_quiz.attempts_used', { used: result?.attemptsUsed ?? state?.attemptsUsed ?? 0 })}
            </span>
            {!(alreadyPassed || result?.passed) && (
              outOfAttempts ? (
                <span className="font-semibold text-wyd-red">{t('activities.video_quiz.no_attempts_left')}</span>
              ) : (
                <button
                  type="button"
                  onClick={result && !result.passed ? () => { setResult(null); setAnswers({}) } : submit}
                  disabled={busy || (!result && Object.keys(answers).length < questions.length)}
                  className="inline-flex min-h-[44px] items-center justify-center rounded-xl bg-wyd-blue px-5 text-[14px] font-extrabold text-white hover:bg-wyd-blue-dark disabled:opacity-50"
                >
                  {busy ? t('activities.video_quiz.submitting') : result && !result.passed ? t('activities.video_quiz.retry') : t('activities.video_quiz.submit')}
                </button>
              )
            )}
          </div>
        </>
      )}
    </section>
  )
}

export default EndQuizPanel
