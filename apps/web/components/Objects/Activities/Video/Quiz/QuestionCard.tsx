'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { pickLocale } from '@/lib/videoQuiz/localized'
import type { QuizQuestionPublic } from '@services/courses/videoQuiz'

interface Props {
  question: QuizQuestionPublic
  index?: number
  total?: number
  value: string[]
  onChange: (_selected: string[]) => void
  disabled?: boolean
  status?: 'idle' | 'correct' | 'wrong'
  wrong?: boolean
}

// One quiz question: radio rows (single / true-false) or checkbox rows
// (multiple). Keyboard accessible out of the box via native inputs.
export function QuestionCard({ question, index, total, value, onChange, disabled, status = 'idle', wrong }: Props) {
  const { t, i18n } = useTranslation()
  const multiple = question.type === 'multiple'
  const prompt = pickLocale(question.prompt, i18n.language)
  const options = question.type === 'true_false' ? [...question.options].sort((a) => (a.id === 'true' ? -1 : 1)) : question.options

  const toggle = (id: string) => {
    if (disabled) return
    if (multiple) onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id])
    else onChange([id])
  }

  return (
    <fieldset
      className={cn(
        'rounded-wyd border bg-white p-4 sm:p-5',
        status === 'correct' ? 'border-wyd-success' : status === 'wrong' || wrong ? 'border-wyd-red' : 'border-wyd-line'
      )}
    >
      <legend className="px-1 text-[15px] font-black text-wyd-navy">
        {index !== undefined && total !== undefined && (
          <span className="me-2 text-[12px] font-extrabold uppercase tracking-wider text-wyd-blue">
            {t('activities.video_quiz.question_n_of_m', { n: index + 1, m: total })}
          </span>
        )}
        {prompt}
      </legend>
      <p className="mb-3 text-[12px] font-semibold text-wyd-muted">
        {multiple ? t('activities.video_quiz.select_all_that_apply') : t('activities.video_quiz.select_one')}
      </p>
      <div className="grid gap-2">
        {options.map((o) => {
          const checked = value.includes(o.id)
          const label = question.type === 'true_false' ? t(`activities.video_quiz.${o.id}`, { defaultValue: pickLocale(o.text, i18n.language) }) : pickLocale(o.text, i18n.language)
          return (
            <label
              key={o.id}
              className={cn(
                'flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 text-[15px] transition-colors',
                checked ? 'border-wyd-blue bg-[#eef4ff]' : 'border-wyd-line hover:border-wyd-blue/50',
                disabled && 'cursor-default opacity-80'
              )}
            >
              <input
                type={multiple ? 'checkbox' : 'radio'}
                name={question.id}
                value={o.id}
                checked={checked}
                disabled={disabled}
                onChange={() => toggle(o.id)}
                className="mt-1 accent-wyd-blue"
              />
              <span>{label}</span>
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}

export default QuestionCard
