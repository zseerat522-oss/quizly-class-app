export type Role = 'admin' | 'teacher' | 'student'

export interface User {
  _id: string
  name: string
  email: string
  role: Role
  active: boolean
  subjectIds?: Subject[]
  department?: string
  semester?: string
}

export interface Subject {
  _id: string
  name: string
  code: string
  semester?: string
  department?: string
}

export interface Question {
  _id?: string
  prompt: string
  options: string[]
  correctOption?: number
  marks: number
  bankQuestionId?: string | null
  questionType?: 'multiple-choice' | 'true-false'
  topic?: string
  difficulty?: 'easy' | 'medium' | 'hard'
}

export interface BankQuestion extends Question {
  _id: string
  subjectId: Subject
  questionType: 'multiple-choice' | 'true-false'
  correctOption: number
  difficulty: 'easy' | 'medium' | 'hard'
}

export interface Quiz {
  _id: string
  title: string
  description: string
  subjectId: Subject
  teacherId?: Pick<User, 'name'>
  durationMinutes: number
  passingMarks: number
  status: 'draft' | 'published'
  questions: Question[]
  startsAt: string | null
  endsAt: string | null
  shuffleQuestions: boolean
  shuffleOptions: boolean
  maxAttempts: number
  assignedStudentIds: string[]
  isUpcoming?: boolean
  isExpired?: boolean
  attemptCount?: number
  canAttempt?: boolean
  attempt?: { _id: string; submittedAt: string | null; obtainedMarks: number | null } | null
}

export interface Attempt {
  _id: string
  quizId: Quiz
  studentId?: Pick<User, '_id' | 'name' | 'email'>
  responses: { questionId: string; selectedOption: number }[]
  startedAt: string
  expiresAt: string
  submittedAt: string | null
  obtainedMarks: number | null
}

export interface Assignment {
  _id: string
  title: string
  description: string
  subjectId: Subject
  teacherId?: Pick<User, 'name'>
  dueAt: string
  maxMarks: number
  isPastDue?: boolean
  submissionCount?: number
  reviewedCount?: number
  submission?: AssignmentSubmission
}

export interface AssignmentSubmission {
  _id: string
  studentId?: Pick<User, '_id' | 'name' | 'email'>
  fileName: string
  submittedAt: string
  marks?: number | null
  feedback?: string
  reviewedAt?: string | null
}

export interface QuizBattle {
  _id: string
  quizTitle: string
  durationMinutes: number
  creatorId: string
  format: 'individual' | 'team'
  status: 'waiting' | 'active' | 'completed'
  teams: { name: string; members: { _id: string; name: string }[]; score: number }[]
  questions: { questionId: string; prompt: string; options: string[] }[]
  winners: { questionId: string; sideIndex: number }[]
  answeredSideIndexes: Record<string, number[]>
  readyCount: number
  participantCount: number
  isReady: boolean
  isParticipant: boolean
  mySideIndex: number | null
  startedAt: string | null
  expiresAt: string | null
  isDraw: boolean
  winningSideIndex: number | null
}

export interface WeeklyLeaderboard {
  timezone: 'Asia/Karachi'
  weekStart: string
  weekEnd: string
  students: {
    studentId: string
    name: string
    averagePercentage: number | null
    completedQuizCount: number
    rank: number | null
  }[]
}

const API_ROOT = import.meta.env.VITE_API_URL || ''

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem('quiz-token')
  const headers = new Headers(options.headers)
  if (token) headers.set('Authorization', `Bearer ${token}`)
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  const response = await fetch(`${API_ROOT}/api${path}`, { ...options, headers })
  if (response.status === 204) return undefined as T
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.message || 'Request failed. Please try again.')
  return data as T
}

export function getError(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong.'
}

export async function downloadAuthenticatedFile(path: string, fileName: string) {
  const token = localStorage.getItem('quiz-token')
  const response = await fetch(`${API_ROOT}/api${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  if (!response.ok) {
    const data = await response.json().catch(() => ({}))
    throw new Error(data.message || 'Could not download the file.')
  }
  const url = URL.createObjectURL(await response.blob())
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
