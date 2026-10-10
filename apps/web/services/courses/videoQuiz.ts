import { RequestBodyWithAuthHeader, errorHandling } from '@services/utils/ts/requests'
import { getAPIUrl } from '@services/config/config'
import type { LocalizedText } from '@/lib/videoQuiz/localized'

export interface QuizOptionPublic {
  id: string
  text: LocalizedText
}

export interface QuizQuestionPublic {
  id: string
  kind: 'checkpoint' | 'end'
  timestamp: number | null
  type: 'single' | 'multiple' | 'true_false'
  prompt: LocalizedText
  required_correct: boolean
  options: QuizOptionPublic[]
}

export interface QuizSettings {
  end_quiz_required: boolean
  pass_score: number
  max_attempts: number
  show_wrong_questions: boolean
  shuffle_options: boolean
}

export interface QuizLearnerState {
  checkpoints: Record<string, { answered: boolean; correct: boolean; attempts: number }>
  end: {
    attemptsUsed: number
    attemptsRemaining: number | null
    bestScore: number
    passed: boolean
    lastAttempt: { attemptUuid: string; score: number; passed: boolean; submittedAt: string | null; wrongQuestionIds?: string[] } | null
  }
}

export interface VideoQuizPublic {
  activityUuid: string
  version: number
  questions: QuizQuestionPublic[]
  settings: Partial<QuizSettings>
  state: QuizLearnerState | null
  hasEndQuiz: boolean
}

export interface QuizQuestionAdmin extends QuizQuestionPublic {
  explanation?: LocalizedText | null
}

export interface VideoQuizAdmin {
  videoQuizUuid: string | null
  version: number
  questions: QuizQuestionAdmin[]
  answerKey: Record<string, string[]>
  settings: QuizSettings
  translationStatus: Record<string, { missing: string[]; complete: boolean }>
  updatedAt: string | null
}

export interface QuizQuestionUpsert {
  id: string
  kind: 'checkpoint' | 'end'
  timestamp?: number | null
  type: 'single' | 'multiple' | 'true_false'
  prompt: LocalizedText
  options: Array<{ id: string; text: LocalizedText; correct: boolean }>
  required_correct?: boolean
  explanation?: LocalizedText | null
}

const base = () => `${getAPIUrl()}video-quiz`

export async function getVideoQuiz(activityUuid: string, accessToken?: string): Promise<VideoQuizPublic> {
  return errorHandling(await fetch(`${base()}/${activityUuid}`, RequestBodyWithAuthHeader('GET', null, null, accessToken)))
}

export async function answerCheckpoint(activityUuid: string, questionId: string, attemptId: string, selected: string[], accessToken?: string) {
  return errorHandling(
    await fetch(`${base()}/${activityUuid}/checkpoint/${encodeURIComponent(questionId)}/answer`, RequestBodyWithAuthHeader('POST', { attempt_id: attemptId, selected }, null, accessToken))
  ) as Promise<{ attemptUuid: string; correct: boolean; canContinue: boolean; requiredCorrect: boolean; explanation: LocalizedText | null; attempts: number }>
}

export async function submitEndQuiz(activityUuid: string, attemptId: string, answers: Record<string, string[]>, accessToken?: string) {
  return errorHandling(await fetch(`${base()}/${activityUuid}/submit`, RequestBodyWithAuthHeader('POST', { attempt_id: attemptId, answers }, null, accessToken))) as Promise<{
    attemptUuid: string
    score: number
    passed: boolean
    correctCount: number
    total: number
    wrongQuestionIds?: string[]
    attemptsUsed: number
    attemptsRemaining: number | null
    bestScore: number
    activityCompleted: boolean
  }>
}

export async function getVideoQuizAdmin(activityUuid: string, accessToken?: string): Promise<VideoQuizAdmin> {
  return errorHandling(await fetch(`${base()}/${activityUuid}/admin`, RequestBodyWithAuthHeader('GET', null, null, accessToken)))
}

export async function upsertVideoQuiz(activityUuid: string, body: { questions: QuizQuestionUpsert[]; settings: Partial<QuizSettings> }, accessToken?: string): Promise<VideoQuizAdmin> {
  return errorHandling(await fetch(`${base()}/${activityUuid}`, RequestBodyWithAuthHeader('PUT', body, null, accessToken)))
}

export async function deleteVideoQuiz(activityUuid: string, accessToken?: string) {
  return errorHandling(await fetch(`${base()}/${activityUuid}`, RequestBodyWithAuthHeader('DELETE', null, null, accessToken)))
}

export async function getVideoQuizStats(activityUuid: string, accessToken?: string) {
  return errorHandling(await fetch(`${base()}/${activityUuid}/stats`, RequestBodyWithAuthHeader('GET', null, null, accessToken))) as Promise<{
    questions: Array<{ questionId: string; kind: string; attempts: number; correct: number; accuracy: number | null }>
    endQuiz: { attempts: number; passed: number; passRate: number | null; avgAttemptsPerLearner: number | null; scoreHistogram: Record<string, number> } | null
  }>
}

export function newAttemptId(): string {
  const rnd = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`
  return `att-${rnd}`
}
