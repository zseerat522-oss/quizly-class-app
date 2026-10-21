import mongoose from 'mongoose'

const { Schema, model } = mongoose

const userSchema = new Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true, select: false },
  role: { type: String, enum: ['admin', 'teacher', 'student'], default: 'student' },
  subjectIds: [{ type: Schema.Types.ObjectId, ref: 'Subject' }],
  department: { type: String, trim: true, default: '' },
  semester: { type: String, trim: true, default: '' },
  active: { type: Boolean, default: true },
}, { timestamps: true })

const subjectSchema = new Schema({
  name: { type: String, required: true, trim: true },
  code: { type: String, required: true, uppercase: true, trim: true, unique: true },
  department: { type: String, trim: true, default: '' },
  semester: { type: String, trim: true, default: '' },
}, { timestamps: true })

const questionSchema = new Schema({
  bankQuestionId: { type: Schema.Types.ObjectId, ref: 'QuestionBank', default: null },
  prompt: { type: String, required: true, trim: true },
  questionType: { type: String, enum: ['multiple-choice', 'true-false'], default: 'multiple-choice' },
  options: { type: [String], validate: value => value.length >= 2 },
  correctOption: { type: Number, required: true, min: 0 },
  marks: { type: Number, default: 1, min: 1 },
  topic: { type: String, trim: true, default: '' },
  difficulty: { type: String, enum: ['easy', 'medium', 'hard'], default: 'medium' },
})

const questionBankSchema = new Schema({
  prompt: { type: String, required: true, trim: true },
  questionType: { type: String, enum: ['multiple-choice', 'true-false'], default: 'multiple-choice' },
  options: { type: [String], validate: value => value.length >= 2 },
  correctOption: { type: Number, required: true, min: 0 },
  subjectId: { type: Schema.Types.ObjectId, ref: 'Subject', required: true },
  topic: { type: String, trim: true, default: '' },
  difficulty: { type: String, enum: ['easy', 'medium', 'hard'], default: 'medium' },
  authorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true })

const quizSchema = new Schema({
  title: { type: String, required: true, trim: true },
  description: { type: String, trim: true, default: '' },
  subjectId: { type: Schema.Types.ObjectId, ref: 'Subject', required: true },
  teacherId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  durationMinutes: { type: Number, required: true, min: 1 },
  passingMarks: { type: Number, default: 0, min: 0 },
  startsAt: { type: Date, default: null },
  endsAt: { type: Date, default: null },
  shuffleQuestions: { type: Boolean, default: false },
  shuffleOptions: { type: Boolean, default: false },
  maxAttempts: { type: Number, default: 1, min: 1 },
  assignedStudentIds: [{ type: Schema.Types.ObjectId, ref: 'User' }],
  status: { type: String, enum: ['draft', 'published'], default: 'draft' },
  questions: { type: [questionSchema], validate: value => value.length > 0 },
}, { timestamps: true })

const responseSchema = new Schema({
  questionId: { type: Schema.Types.ObjectId, required: true },
  selectedOption: { type: Number, min: 0 },
}, { _id: false })

const attemptSchema = new Schema({
  quizId: { type: Schema.Types.ObjectId, ref: 'Quiz', required: true },
  studentId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  responses: { type: [responseSchema], default: [] },
  questionOrder: [{ type: Schema.Types.ObjectId }],
  optionOrders: { type: Map, of: [Number], default: {} },
  startedAt: { type: Date, required: true },
  expiresAt: { type: Date, required: true },
  submittedAt: { type: Date, default: null },
  obtainedMarks: { type: Number, default: null },
}, { timestamps: true })

attemptSchema.index({ quizId: 1, studentId: 1, createdAt: -1 })
attemptSchema.index(
  { quizId: 1, studentId: 1 },
  { unique: true, partialFilterExpression: { submittedAt: null } },
)

export const User = model('User', userSchema)
export const Subject = model('Subject', subjectSchema)
export const QuestionBank = model('QuestionBank', questionBankSchema)
export const Quiz = model('Quiz', quizSchema)
export const Attempt = model('Attempt', attemptSchema)
