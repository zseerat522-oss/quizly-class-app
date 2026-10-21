import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import mongoose from 'mongoose'
import helmet from 'helmet'
import { rateLimit } from 'express-rate-limit'
import { authenticate, allow } from './auth.js'
import { Attempt, QuestionBank, Quiz, Subject, User } from './models.js'

const app = express()
const port = Number(process.env.PORT || 4000)
const roles = ['admin', 'teacher', 'student']
const serverDirectory = path.dirname(fileURLToPath(import.meta.url))
let databaseInitialization

app.use(cors({ origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173' }))
app.use(helmet())
app.use(express.json({ limit: '1mb' }))
if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1)
app.use('/api/auth', rateLimit({ windowMs: 15 * 60_000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false }))

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }))

app.use(async (_req, _res, next) => {
  try {
    await initializeDatabase()
    next()
  } catch (error) {
    next(error)
  }
})

app.post('/api/auth/register', async (req, res, next) => {
  try {
    const { name, email, password } = req.body
    if (!name?.trim() || !email?.trim() || !password || password.length < 8) {
      return res.status(400).json({ message: 'Name, email and a password of at least 8 characters are required.' })
    }
    const normalizedEmail = email.trim().toLowerCase()
    if (await User.exists({ email: normalizedEmail })) {
      return res.status(409).json({ message: 'An account with that email already exists.' })
    }
    const user = await User.create({
      name: name.trim(),
      email: normalizedEmail,
      passwordHash: await bcrypt.hash(password, 12),
      role: 'student',
      department: String(req.body.department || '').trim(),
      semester: String(req.body.semester || '').trim(),
    })
    res.status(201).json({ token: makeToken(user), user: publicUser(user) })
  } catch (error) {
    next(error)
  }
})

app.post('/api/auth/login', async (req, res, next) => {
  try {
    const email = req.body.email?.trim().toLowerCase()
    const user = await User.findOne({ email }).select('+passwordHash')
    if (!user || !user.active || !await bcrypt.compare(req.body.password || '', user.passwordHash)) {
      return res.status(401).json({ message: 'Email or password is incorrect.' })
    }
    res.json({ token: makeToken(user), user: publicUser(user) })
  } catch (error) {
    next(error)
  }
})

app.get('/api/auth/me', authenticate, (req, res) => res.json({ user: publicUser(req.user) }))

app.get('/api/subjects', authenticate, async (_req, res, next) => {
  try {
    res.json(await Subject.find().sort({ name: 1 }))
  } catch (error) {
    next(error)
  }
})

app.post('/api/subjects', authenticate, allow('admin'), async (req, res, next) => {
  try {
    const { name, code, semester = '', department = '' } = req.body
    if (!name?.trim() || !code?.trim()) return res.status(400).json({ message: 'Subject name and code are required.' })
    const subject = await Subject.create({ name, code, semester, department })
    res.status(201).json(subject)
  } catch (error) {
    next(error)
  }
})

app.delete('/api/subjects/:id', authenticate, allow('admin'), async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'Invalid subject.' })
    if (await Quiz.exists({ subjectId: req.params.id })) {
      return res.status(409).json({ message: 'This subject is used by existing quizzes and cannot be removed.' })
    }
    await Subject.findByIdAndDelete(req.params.id)
    res.status(204).end()
  } catch (error) {
    next(error)
  }
})

app.get('/api/users', authenticate, allow('admin'), async (_req, res, next) => {
  try {
    const users = await User.find().populate('subjectIds', 'name code').sort({ createdAt: -1 })
    res.json(users.map(publicUser))
  } catch (error) {
    next(error)
  }
})

app.get('/api/students', authenticate, allow('teacher', 'admin'), async (req, res, next) => {
  try {
    const filter = { role: 'student', active: true }
    res.json(await User.find(filter).select('name email department semester subjectIds').sort({ name: 1 }))
  } catch (error) {
    next(error)
  }
})

app.post('/api/users', authenticate, allow('admin'), async (req, res, next) => {
  try {
    const { name, email, password, role, subjectIds = [], department = '', semester = '' } = req.body
    if (!name?.trim() || !email?.trim() || !password || password.length < 8 || !roles.includes(role)) {
      return res.status(400).json({ message: 'Name, valid email, role and a password of at least 8 characters are required.' })
    }
    const user = await User.create({
      name: name.trim(),
      email: email.trim().toLowerCase(),
      passwordHash: await bcrypt.hash(password, 12),
      role,
      subjectIds: role === 'student' ? subjectIds : [],
      department,
      semester,
    })
    res.status(201).json(publicUser(user))
  } catch (error) {
    next(error)
  }
})

app.patch('/api/users/:id', authenticate, allow('admin'), async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'Invalid user.' })
    if (req.params.id === String(req.user._id) && req.body.active === false) {
      return res.status(400).json({ message: 'You cannot deactivate your own account.' })
    }
    const update = {}
    if (typeof req.body.active === 'boolean') update.active = req.body.active
    if (Array.isArray(req.body.subjectIds)) update.subjectIds = req.body.subjectIds
    if (typeof req.body.department === 'string') update.department = req.body.department.trim()
    if (typeof req.body.semester === 'string') update.semester = req.body.semester.trim()
    if (typeof req.body.name === 'string' && req.body.name.trim()) update.name = req.body.name.trim()
    const user = await User.findByIdAndUpdate(req.params.id, update, { new: true, runValidators: true }).populate('subjectIds', 'name code')
    if (!user) return res.status(404).json({ message: 'User not found.' })
    res.json(publicUser(user))
  } catch (error) {
    next(error)
  }
})

app.get('/api/quizzes', authenticate, async (req, res, next) => {
  try {
    const filter = req.user.role === 'teacher'
      ? { teacherId: req.user._id }
      : req.user.role === 'student' ? { status: 'published' } : {}
    if (req.user.role === 'student') {
      const visibilityRules = [
        { $or: [{ assignedStudentIds: { $size: 0 } }, { assignedStudentIds: req.user._id }] },
      ]
      if (req.user.subjectIds.length) {
        visibilityRules.push({ $or: [{ subjectId: { $in: req.user.subjectIds } }, { assignedStudentIds: req.user._id }] })
      } else {
        visibilityRules.push({ assignedStudentIds: req.user._id })
      }
      filter.$and = visibilityRules
    }
    const quizzes = await Quiz.find(filter).populate('subjectId', 'name code semester department').populate('teacherId', 'name').sort({ createdAt: -1 })
    const attempts = req.user.role === 'student'
      ? await Attempt.find({ studentId: req.user._id }).select('quizId submittedAt obtainedMarks createdAt').sort({ createdAt: -1 })
      : []
    const attemptByQuiz = new Map()
    const attemptCounts = new Map()
    for (const attempt of attempts) {
      const key = String(attempt.quizId)
      attemptCounts.set(key, (attemptCounts.get(key) || 0) + 1)
      if (!attemptByQuiz.has(key)) attemptByQuiz.set(key, attempt)
    }
    const now = Date.now()
    res.json(quizzes.map(quiz => ({
      ...quiz.toObject(),
      questions: quiz.questions.map(question => redactQuestion(question, req.user.role)),
      attempt: attemptByQuiz.get(String(quiz._id)) || null,
      attemptCount: attemptCounts.get(String(quiz._id)) || 0,
      isUpcoming: Boolean(quiz.startsAt && new Date(quiz.startsAt).getTime() > now),
      isExpired: Boolean(quiz.endsAt && new Date(quiz.endsAt).getTime() < now),
      canAttempt: Boolean(
        quiz.status === 'published'
        && (!quiz.startsAt || new Date(quiz.startsAt).getTime() <= now)
        && (!quiz.endsAt || new Date(quiz.endsAt).getTime() >= now)
        && (!attemptByQuiz.get(String(quiz._id))?.submittedAt || (attemptCounts.get(String(quiz._id)) || 0) < quiz.maxAttempts),
      ),
    })))
  } catch (error) {
    next(error)
  }
})

app.post('/api/quizzes', authenticate, allow('teacher'), async (req, res, next) => {
  try {
    const quizData = validateQuiz(req.body)
    if (quizData instanceof Error) return res.status(400).json({ message: quizData.message })
    if (!await Subject.exists({ _id: quizData.subjectId })) return res.status(400).json({ message: 'Choose a valid subject.' })
    if (quizData.assignedStudentIds.length !== await User.countDocuments({ _id: { $in: quizData.assignedStudentIds }, role: 'student', active: true })) {
      return res.status(400).json({ message: 'Only active student accounts can be assigned to a quiz.' })
    }
    if (quizData.passingMarks > quizData.questions.reduce((sum, question) => sum + question.marks, 0)) {
      return res.status(400).json({ message: 'Passing marks cannot exceed total marks.' })
    }
    const quiz = await Quiz.create({ ...quizData, teacherId: req.user._id })
    res.status(201).json(quiz)
  } catch (error) {
    next(error)
  }
})

app.patch('/api/quizzes/:id', authenticate, allow('teacher'), async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'Invalid quiz.' })
    const quiz = await Quiz.findOne({ _id: req.params.id, teacherId: req.user._id })
    if (!quiz) return res.status(404).json({ message: 'Quiz not found.' })
    if (await Attempt.exists({ quizId: quiz._id })) {
      return res.status(409).json({ message: 'A quiz with attempts cannot be edited.' })
    }
    const quizData = validateQuiz(req.body)
    if (quizData instanceof Error) return res.status(400).json({ message: quizData.message })
    if (!await Subject.exists({ _id: quizData.subjectId })) return res.status(400).json({ message: 'Choose a valid subject.' })
    if (quizData.assignedStudentIds.length !== await User.countDocuments({ _id: { $in: quizData.assignedStudentIds }, role: 'student', active: true })) {
      return res.status(400).json({ message: 'Only active student accounts can be assigned to a quiz.' })
    }
    const totalMarks = quizData.questions.reduce((sum, question) => sum + question.marks, 0)
    if (quizData.passingMarks > totalMarks) return res.status(400).json({ message: 'Passing marks cannot exceed total marks.' })
    Object.assign(quiz, quizData)
    await quiz.save()
    res.json(quiz)
  } catch (error) {
    next(error)
  }
})

app.get('/api/question-bank', authenticate, allow('teacher', 'admin'), async (req, res, next) => {
  try {
    const filter = req.user.role === 'teacher' ? { authorId: req.user._id } : {}
    if (req.query.subjectId && mongoose.isValidObjectId(req.query.subjectId)) filter.subjectId = req.query.subjectId
    if (req.query.difficulty) filter.difficulty = req.query.difficulty
    if (req.query.topic) filter.topic = { $regex: escapeRegex(String(req.query.topic)), $options: 'i' }
    res.json(await QuestionBank.find(filter).populate('subjectId', 'name code').sort({ updatedAt: -1 }))
  } catch (error) {
    next(error)
  }
})

app.post('/api/question-bank', authenticate, allow('teacher'), async (req, res, next) => {
  try {
    const question = validateBankQuestion(req.body)
    if (question instanceof Error) return res.status(400).json({ message: question.message })
    if (!await Subject.exists({ _id: question.subjectId })) return res.status(400).json({ message: 'Choose a valid subject.' })
    res.status(201).json(await QuestionBank.create({ ...question, authorId: req.user._id }))
  } catch (error) {
    next(error)
  }
})

app.patch('/api/question-bank/:id', authenticate, allow('teacher', 'admin'), async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'Invalid question.' })
    const questionData = validateBankQuestion(req.body)
    if (questionData instanceof Error) return res.status(400).json({ message: questionData.message })
    const filter = req.user.role === 'admin'
      ? { _id: req.params.id }
      : { _id: req.params.id, authorId: req.user._id }
    const question = await QuestionBank.findOneAndUpdate(filter, questionData, { new: true, runValidators: true }).populate('subjectId', 'name code')
    if (!question) return res.status(404).json({ message: 'Question not found.' })
    res.json(question)
  } catch (error) {
    next(error)
  }
})

app.delete('/api/question-bank/:id', authenticate, allow('teacher', 'admin'), async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'Invalid question.' })
    const filter = req.user.role === 'admin'
      ? { _id: req.params.id }
      : { _id: req.params.id, authorId: req.user._id }
    const removed = await QuestionBank.findOneAndDelete(filter)
    if (!removed) return res.status(404).json({ message: 'Question not found.' })
    res.status(204).end()
  } catch (error) {
    next(error)
  }
})

app.post('/api/quizzes/:id/attempts', authenticate, allow('student'), async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'Invalid quiz.' })
    const quiz = await Quiz.findOne({ _id: req.params.id, status: 'published' })
    if (!quiz) return res.status(404).json({ message: 'Quiz is not available.' })
    const now = new Date()
    if (quiz.startsAt && now < quiz.startsAt) return res.status(403).json({ message: 'This quiz is not open yet.' })
    if (quiz.endsAt && now > quiz.endsAt) return res.status(403).json({ message: 'The quiz closing time has passed.' })
    const explicitlyAssigned = quiz.assignedStudentIds.some(id => String(id) === String(req.user._id))
    if (quiz.assignedStudentIds.length && !explicitlyAssigned) {
      return res.status(403).json({ message: 'This quiz is not assigned to your account.' })
    }
    if (!explicitlyAssigned && !req.user.subjectIds.some(id => String(id) === String(quiz.subjectId))) {
      return res.status(403).json({ message: 'This quiz is not assigned to your subjects.' })
    }
    let attempt = await Attempt.findOne({ quizId: quiz._id, studentId: req.user._id, submittedAt: null }).sort({ createdAt: -1 })
    if (!attempt) {
      const submittedCount = await Attempt.countDocuments({ quizId: quiz._id, studentId: req.user._id, submittedAt: { $ne: null } })
      if (submittedCount >= quiz.maxAttempts) return res.status(409).json({ message: 'You have used all attempts for this quiz.' })
      const questionOrder = quiz.questions.map(question => question._id)
      if (quiz.shuffleQuestions) shuffle(questionOrder)
      const optionOrders = {}
      for (const question of quiz.questions) {
        const order = question.options.map((_, index) => index)
        if (quiz.shuffleOptions) shuffle(order)
        optionOrders[String(question._id)] = order
      }
      try {
        attempt = await Attempt.create({
          quizId: quiz._id,
          studentId: req.user._id,
          startedAt: now,
          expiresAt: new Date(now.getTime() + quiz.durationMinutes * 60_000),
          questionOrder,
          optionOrders,
        })
      } catch (error) {
        if (error.code !== 11000) throw error
        attempt = await Attempt.findOne({ quizId: quiz._id, studentId: req.user._id, submittedAt: null }).sort({ createdAt: -1 })
      }
    }
    if (new Date() >= attempt.expiresAt) {
      await gradeAttempt(attempt, quiz)
      return res.status(409).json({ message: 'Time expired; your saved answers have been submitted.' })
    }
    const safeQuiz = quiz.toObject()
    const questionsById = new Map(quiz.questions.map(question => [String(question._id), question]))
    safeQuiz.questions = attempt.questionOrder.map(id => {
      const question = questionsById.get(String(id))
      const order = attempt.optionOrders.get(String(id)) || question.options.map((_, index) => index)
      const safeQuestion = redactQuestion(question, 'student')
      safeQuestion.options = order.map(index => question.options[index])
      return safeQuestion
    })
    res.json({ attempt, quiz: safeQuiz })
  } catch (error) {
    next(error)
  }
})

app.put('/api/attempts/:id/responses', authenticate, allow('student'), async (req, res, next) => {
  try {
    const attempt = await Attempt.findOne({ _id: req.params.id, studentId: req.user._id })
    if (!attempt) return res.status(404).json({ message: 'Attempt not found.' })
    if (attempt.submittedAt) return res.status(409).json({ message: 'This attempt is already submitted.' })
    const quiz = await Quiz.findById(attempt.quizId)
    if (!quiz) return res.status(404).json({ message: 'Quiz not found.' })
    if (new Date() >= attempt.expiresAt) {
      await gradeAttempt(attempt, quiz)
      return res.status(409).json({ message: 'Time expired; your saved answers have been submitted.' })
    }
    const answers = req.body.responses
    if (!Array.isArray(answers)) return res.status(400).json({ message: 'Responses must be a list.' })
    const validIds = new Set(quiz.questions.map(question => String(question._id)))
    const seen = new Set()
    for (const answer of answers) {
      if (!validIds.has(String(answer.questionId)) || seen.has(String(answer.questionId))
        || !Number.isInteger(answer.selectedOption) || answer.selectedOption < 0
        || answer.selectedOption >= quiz.questions.find(question => String(question._id) === String(answer.questionId)).options.length) {
        return res.status(400).json({ message: 'One or more answers are invalid.' })
      }
      seen.add(String(answer.questionId))
    }
    attempt.responses = answers
    await attempt.save()
    res.json({ attempt })
  } catch (error) {
    next(error)
  }
})

app.post('/api/attempts/:id/submit', authenticate, allow('student'), async (req, res, next) => {
  try {
    const attempt = await Attempt.findOne({ _id: req.params.id, studentId: req.user._id })
    if (!attempt) return res.status(404).json({ message: 'Attempt not found.' })
    if (!attempt.submittedAt) {
      const quiz = await Quiz.findById(attempt.quizId)
      if (!quiz) return res.status(404).json({ message: 'Quiz not found.' })
      await gradeAttempt(attempt, quiz)
    }
    res.json({ attempt })
  } catch (error) {
    next(error)
  }
})

app.get('/api/attempts/mine', authenticate, allow('student'), async (req, res, next) => {
  try {
    const attempts = await Attempt.find({ studentId: req.user._id }).populate({
      path: 'quizId',
      select: 'title subjectId questions passingMarks',
      populate: { path: 'subjectId', select: 'name code' },
    }).sort({ updatedAt: -1 })
    res.json(attempts.map(attempt => {
      const value = attempt.toObject()
      if (value.quizId) value.quizId.questions = value.quizId.questions.map(question => redactQuestion(question, 'student'))
      return value
    }))
  } catch (error) {
    next(error)
  }
})

app.get('/api/quizzes/:id/attempts', authenticate, allow('teacher', 'admin'), async (req, res, next) => {
  try {
    const quiz = req.user.role === 'admin'
      ? await Quiz.findById(req.params.id)
      : await Quiz.findOne({ _id: req.params.id, teacherId: req.user._id })
    if (!quiz) return res.status(404).json({ message: 'Quiz not found.' })
    const attempts = await Attempt.find({ quizId: quiz._id }).populate('studentId', 'name email').sort({ submittedAt: -1 })
    res.json(attempts)
  } catch (error) {
    next(error)
  }
})

app.get('/api/quizzes/:id/analytics', authenticate, allow('teacher', 'admin'), async (req, res, next) => {
  try {
    const quiz = req.user.role === 'admin'
      ? await Quiz.findById(req.params.id)
      : await Quiz.findOne({ _id: req.params.id, teacherId: req.user._id })
    if (!quiz) return res.status(404).json({ message: 'Quiz not found.' })
    const attempts = await Attempt.find({ quizId: quiz._id, submittedAt: { $ne: null } })
    const totalMarks = quiz.questions.reduce((sum, question) => sum + question.marks, 0)
    const averageMarks = attempts.length
      ? attempts.reduce((sum, attempt) => sum + (attempt.obtainedMarks || 0), 0) / attempts.length
      : 0
    const questionStats = quiz.questions.map(question => {
      let answered = 0
      let correct = 0
      for (const attempt of attempts) {
        const response = attempt.responses.find(item => String(item.questionId) === String(question._id))
        if (!response) continue
        answered += 1
        const order = attempt.optionOrders.get(String(question._id)) || question.options.map((_, index) => index)
        if (order[response.selectedOption] === question.correctOption) correct += 1
      }
      return {
        questionId: question._id,
        prompt: question.prompt,
        topic: question.topic,
        difficulty: question.difficulty,
        answered,
        correct,
        correctRate: answered ? Math.round(correct / answered * 100) : 0,
      }
    })
    res.json({
      submissions: attempts.length,
      totalMarks,
      averageMarks: Number(averageMarks.toFixed(2)),
      averagePercentage: totalMarks ? Math.round(averageMarks / totalMarks * 100) : 0,
      passRate: attempts.length ? Math.round(attempts.filter(attempt => attempt.obtainedMarks >= quiz.passingMarks).length / attempts.length * 100) : 0,
      questions: questionStats,
    })
  } catch (error) {
    next(error)
  }
})

app.use('/api', (_req, res) => res.status(404).json({ message: 'API endpoint not found.' }))

if (process.env.NODE_ENV === 'production' && !process.env.VERCEL) {
  const buildDirectory = path.resolve(serverDirectory, '../dist')
  app.use(express.static(buildDirectory))
  app.get(/.*/, (_req, res, next) => {
    res.sendFile(path.join(buildDirectory, 'index.html'), error => {
      if (error) next(error)
    })
  })
}

app.use((error, _req, res, _next) => {
  if (error.code === 11000) return res.status(409).json({ message: 'That email or subject code is already in use.' })
  if (error.name === 'ValidationError' || error.name === 'CastError') {
    return res.status(400).json({ message: error.message })
  }
  console.error(error)
  res.status(500).json({ message: 'Something went wrong. Please try again.' })
})

function makeToken(user) {
  return jwt.sign({ sub: user.id }, process.env.JWT_SECRET, { expiresIn: '8h' })
}

function publicUser(user) {
  const value = user.toObject ? user.toObject() : user
  delete value.passwordHash
  return value
}

function redactQuestion(question, role) {
  const value = question.toObject ? question.toObject() : question
  if (role === 'student') delete value.correctOption
  return value
}

function validateQuiz(body) {
  const {
    title, description = '', subjectId, durationMinutes, passingMarks = 0, status = 'draft', questions,
    startsAt = null, endsAt = null, shuffleQuestions = false, shuffleOptions = false, maxAttempts = 1,
    assignedStudentIds = [],
  } = body
  if (!title?.trim() || !mongoose.isValidObjectId(subjectId)
    || !Number.isInteger(durationMinutes) || durationMinutes < 1
    || !Number.isFinite(passingMarks) || passingMarks < 0
    || !['draft', 'published'].includes(status)
    || !Array.isArray(questions) || questions.length === 0
    || !Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10
    || (startsAt && Number.isNaN(new Date(startsAt).getTime()))
    || (endsAt && Number.isNaN(new Date(endsAt).getTime()))
    || (startsAt && endsAt && new Date(startsAt) >= new Date(endsAt))
    || !Array.isArray(assignedStudentIds)
    || assignedStudentIds.some(id => !mongoose.isValidObjectId(id))) {
    return new Error('Enter a title, subject, valid duration and at least one question.')
  }
  const normalized = []
  for (const question of questions) {
    if (!question.prompt?.trim() || !['multiple-choice', 'true-false'].includes(question.questionType || 'multiple-choice')
      || !Array.isArray(question.options) || question.options.length < 2
      || question.options.some(option => !option?.trim())
      || !Number.isInteger(question.correctOption) || question.correctOption < 0
      || question.correctOption >= question.options.length
      || !Number.isInteger(question.marks) || question.marks < 1) {
      return new Error('Each question needs a prompt, two options, a correct option and positive marks.')
    }
    if (question.questionType === 'true-false' && question.options.length !== 2) {
      return new Error('True/False questions must have exactly two options.')
    }
    normalized.push({
      prompt: question.prompt.trim(),
      questionType: question.questionType || 'multiple-choice',
      options: question.options.map(option => option.trim()),
      correctOption: question.correctOption,
      marks: question.marks,
      bankQuestionId: question.bankQuestionId && mongoose.isValidObjectId(question.bankQuestionId) ? question.bankQuestionId : null,
      topic: String(question.topic || '').trim(),
      difficulty: ['easy', 'medium', 'hard'].includes(question.difficulty) ? question.difficulty : 'medium',
    })
  }
  return {
    title: title.trim(),
    description: String(description).trim(),
    subjectId,
    durationMinutes,
    passingMarks,
    startsAt: startsAt ? new Date(startsAt) : null,
    endsAt: endsAt ? new Date(endsAt) : null,
    shuffleQuestions: Boolean(shuffleQuestions),
    shuffleOptions: Boolean(shuffleOptions),
    maxAttempts,
    assignedStudentIds,
    status,
    questions: normalized,
  }
}

async function gradeAttempt(attempt, quiz) {
  const selected = new Map(attempt.responses.map(response => [String(response.questionId), response.selectedOption]))
  attempt.obtainedMarks = quiz.questions.reduce(
    (total, question) => {
      const response = selected.get(String(question._id))
      const order = attempt.optionOrders.get(String(question._id)) || question.options.map((_, index) => index)
      return total + (order[response] === question.correctOption ? question.marks : 0)
    },
    0,
  )
  attempt.submittedAt = new Date()
  await attempt.save()
}

function validateBankQuestion(body) {
  const { prompt, questionType = 'multiple-choice', options, correctOption, subjectId, topic = '', difficulty = 'medium' } = body
  if (!prompt?.trim() || !mongoose.isValidObjectId(subjectId)
    || !['multiple-choice', 'true-false'].includes(questionType)
    || !Array.isArray(options) || options.length < 2 || options.some(option => !option?.trim())
    || !Number.isInteger(correctOption) || correctOption < 0 || correctOption >= options.length
    || !['easy', 'medium', 'hard'].includes(difficulty)) {
    return new Error('Enter a question, valid options, correct answer, subject and difficulty.')
  }
  if (questionType === 'true-false' && options.length !== 2) return new Error('True/False questions must have exactly two options.')
  return { prompt: prompt.trim(), questionType, options: options.map(option => option.trim()), correctOption, subjectId, topic: String(topic).trim(), difficulty }
}

function shuffle(values) {
  for (let index = values.length - 1; index > 0; index -= 1) {
    const target = Math.floor(Math.random() * (index + 1))
    ;[values[index], values[target]] = [values[target], values[index]]
  }
  return values
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function initializeDatabase() {
  if (mongoose.connection.readyState === 1) return
  if (!process.env.MONGODB_URI || !process.env.JWT_SECRET) {
    throw new Error('MONGODB_URI and JWT_SECRET must be configured before starting the API.')
  }
  if (!databaseInitialization) {
    databaseInitialization = (async () => {
      await mongoose.connect(process.env.MONGODB_URI)
      if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
        const email = process.env.ADMIN_EMAIL.trim().toLowerCase()
        if (!await User.exists({ email })) {
          await User.create({
            name: process.env.ADMIN_NAME || 'System Admin',
            email,
            passwordHash: await bcrypt.hash(process.env.ADMIN_PASSWORD, 12),
            role: 'admin',
          })
          console.log(`Initial admin account created: ${email}`)
        }
      }
    })()
  }
  try {
    await databaseInitialization
  } catch (error) {
    databaseInitialization = undefined
    throw error
  }
}

async function start() {
  await initializeDatabase()
  app.listen(port, () => console.log(`Quiz app API listening on http://localhost:${port}`))
}

if (!process.env.VERCEL) {
  start().catch(error => {
    console.error('Unable to start the API:', error)
    process.exitCode = 1
  })
}

export default app
