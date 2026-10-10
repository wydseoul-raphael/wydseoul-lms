'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { ListNumbers, GraduationCap } from '@phosphor-icons/react'

interface Props {
  value: Record<string, any>
  disabled?: boolean
  onChange: (_next: Record<string, any>) => void
}

// Learning-management switches stored in course.extra_metadata:
//   progression.mode = "sequential"      → learners unlock activities in order
//   learning_management.required = true  → counts toward the volunteer's
//                                           mandatory training (이수관리)
//   learning_management.deadline          → ISO date the course must be done by
export default function WydCourseSettingsCard({ value, disabled, onChange }: Props) {
  const { t } = useTranslation()
  const sequential = value?.progression?.mode === 'sequential'
  const lm = value?.learning_management || {}

  const set = (patch: Record<string, any>) => onChange({ ...value, ...patch })

  return (
    <div className="rounded-xl border border-wyd-line bg-white p-4 space-y-4">
      <h3 className="text-sm font-semibold text-wyd-navy inline-flex items-center gap-2">
        <GraduationCap size={16} weight="duotone" className="text-wyd-blue" />
        {t('dashboard.courses.wyd.title', { defaultValue: 'WYD learning settings' })}
      </h3>

      <label className="flex items-start gap-3 cursor-pointer">
        <input
          type="checkbox"
          className="mt-1 rounded border-gray-300"
          disabled={disabled}
          checked={sequential}
          onChange={(e) => set({ progression: { ...(value?.progression || {}), mode: e.target.checked ? 'sequential' : 'free' } })}
        />
        <span>
          <span className="block text-sm font-medium text-gray-800 inline-flex items-center gap-1.5">
            <ListNumbers size={14} /> {t('dashboard.courses.wyd.sequential', { defaultValue: 'Sequential progression' })}
          </span>
          <span className="block text-xs text-gray-500">
            {t('dashboard.courses.wyd.sequential_help', { defaultValue: 'Each lesson unlocks only after the previous one is completed (verified video / passed quiz).' })}
          </span>
        </span>
      </label>

      <label className="flex items-start gap-3 cursor-pointer">
        <input
          type="checkbox"
          className="mt-1 rounded border-gray-300"
          disabled={disabled}
          checked={!!lm.required}
          onChange={(e) => set({ learning_management: { ...lm, required: e.target.checked } })}
        />
        <span>
          <span className="block text-sm font-medium text-gray-800">
            {t('dashboard.courses.wyd.required', { defaultValue: 'Required course (counts toward mandatory training)' })}
          </span>
          <span className="block text-xs text-gray-500">
            {t('dashboard.courses.wyd.required_help', { defaultValue: 'Required courses appear in the completion dashboard and trigger the logistics notification when all are done.' })}
          </span>
        </span>
      </label>

      <div className="grid gap-1.5 sm:max-w-xs">
        <label className="text-xs font-medium text-gray-500">{t('dashboard.courses.wyd.deadline', { defaultValue: 'Completion deadline' })}</label>
        <input
          type="date"
          disabled={disabled}
          value={lm.deadline || ''}
          onChange={(e) => set({ learning_management: { ...lm, deadline: e.target.value || null } })}
          className="h-9 px-3 text-sm rounded-lg bg-gray-50 border border-gray-200 outline-none focus:border-gray-300"
        />
      </div>
    </div>
  )
}
