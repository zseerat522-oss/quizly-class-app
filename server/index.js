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
import { Assignment, AssignmentSubmission, Attempt, QuestionBank, Quiz, QuizBattle, Subject, User } from './models.js'

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

app.post('/api/ai/generate-questions', authenticate, allow('teacher'), rateLimit({
  windowMs: 60 * 60_000,
  limit: 10,
  message: { message: 'AI generation limit reached. Please try again later.' },
}), async (req, res, next) => {
  try {
    const { subjectId, topic = '', difficulty = 'medium', questionType = 'multiple-choice', count = 3 } = req.body
    if (!mongoose.isValidObjectId(subjectId)
      || !['easy', 'medium', 'hard'].includes(difficulty)
      || !['multiple-choice', 'true-false'].includes(questionType)
      || !Number.isInteger(count) || count < 1 || count > 5
      || typeof topic !== 'string' || topic.length > 120) {
      return res.status(400).json({ message: 'Choose a valid subject, difficulty, question type and 1–5 questions.' })
    }
    const subject = await Subject.findById(subjectId).select('name')
    if (!subject) return res.status(400).json({ message: 'Choose a valid subject.' })
    if (!process.env.GEMINI_API_KEY) {
      return res.status(503).json({ message: 'AI generation is not configured yet. Add GEMINI_API_KEY in the hosting settings.' })
    }

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(30_000),
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: `Create ${count} original ${difficulty} ${questionType === 'true-false' ? 'true/false' : 'multiple-choice'} questions for the subject "${subject.name}"${topic.trim() ? `, about "${topic.trim()}"` : ''}. Keep questions appropriate for classroom assessment. Avoid ambiguity, make exactly one answer correct, and do not include explanations. For multiple choice, provide exactly four distinct options. For true/false, options must be exactly ["True", "False"]. Return only the requested structured data.`,
          }],
        }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'OBJECT',
            properties: {
              questions: {
                type: 'ARRAY',
                items: {
                  type: 'OBJECT',
                  properties: {
                    prompt: { type: 'STRING' },
                    options: { type: 'ARRAY', items: { type: 'STRING' } },
                    correctOption: { type: 'INTEGER' },
                  },
                  required: ['prompt', 'options', 'correctOption'],
                },
              },
            },
            required: ['questions'],
          },
        },
      }),
    })

    if (!response.ok) {
      if (response.status === 429) return res.status(429).json({ message: 'Gemini is busy or its free quota is temporarily limited. Please try again later.' })
      if (response.status === 401 || response.status === 403) {
        console.error('Gemini API authentication failed. Check GEMINI_API_KEY in hosting settings.')
        return res.status(503).json({ message: 'AI generation is not configured correctly. Please contact the administrator.' })
      }
      console.error(`Gemini API request failed with status ${response.status}.`)
      return res.status(502).json({ message: 'Gemini could not generate questions right now. Please try again.' })
    }

    const result = await response.json()
    const text = result.candidates?.[0]?.content?.parts?.[0]?.text
    let generated
    try {
      generated = JSON.parse(text)
    } catch {
      return res.status(502).json({ message: 'Gemini returned an invalid question format. Please try again.' })
    }
    const questions = generated?.questions
    const optionsCount = questionType === 'true-false' ? 2 : 4
    if (!Array.isArray(questions) || questions.length !== count || questions.some(question =>
      typeof question.prompt !== 'string' || !question.prompt.trim()
      || !Array.isArray(question.options) || question.options.length !== optionsCount
      || question.options.some(option => typeof option !== 'string' || !option.trim())
      || new Set(question.options.map(option => option.trim().toLowerCase())).size !== optionsCount
      || !Number.isInteger(question.correctOption) || question.correctOption < 0 || question.correctOption >= optionsCount
      || (questionType === 'true-false' && (question.options[0].trim() !== 'True' || question.options[1].trim() !== 'False'))
    )) {
      return res.status(502).json({ message: 'Gemini returned incomplete or invalid questions. Please try again.' })
    }

    res.json({
      questions: questions.map(question => ({
        prompt: question.prompt.trim(),
        options: question.options.map(option => option.trim()),
        correctOption: question.correctOption,
        subjectId,
        topic: topic.trim(),
        difficulty,
        questionType,
      })),
    })
  } catch (error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      return res.status(504).json({ message: 'Gemini took too long to respond. Please try again.' })
    }
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

app.get('/api/assignments', authenticate, allow('teacher', 'student'), async (req, res, next) => {
  try {
    if (req.user.role === 'teacher') {
      const assignments = await Assignment.find({ teacherId: req.user._id })
        .populate('subjectId', 'name code')
        .sort({ createdAt: -1 })
      const submissions = await AssignmentSubmission.aggregate([
        { $match: { assignmentId: { $in: assignments.map(assignment => assignment._id) } } },
        { $group: { _id: '$assignmentId', count: { $sum: 1 }, reviewed: { $sum: { $cond: [{ $ne: ['$reviewedAt', null] }, 1, 0] } } } },
      ])
      const counts = new Map(submissions.map(item => [String(item._id), { count: item.count, reviewed: item.reviewed }]))
      return res.json(assignments.map(assignment => ({
        ...assignment.toObject(),
        submissionCount: counts.get(String(assignment._id))?.count || 0,
        reviewedCount: counts.get(String(assignment._id))?.reviewed || 0,
      })))
    }

    const assignments = await Assignment.find({ subjectId: { $in: req.user.subjectIds || [] } })
      .populate('subjectId', 'name code')
      .populate('teacherId', 'name')
      .sort({ dueAt: 1 })
    const submissions = await AssignmentSubmission.find({
      assignmentId: { $in: assignments.map(assignment => assignment._id) },
      studentId: req.user._id,
    }).select('-fileData')
    const byAssignment = new Map(submissions.map(submission => [String(submission.assignmentId), submission]))
    res.json(assignments.map(assignment => {
      const submission = byAssignment.get(String(assignment._id))
      const value = assignment.toObject()
      if (submission) {
        value.submission = {
          _id: submission._id,
          fileName: submission.fileName,
          submittedAt: submission.submittedAt,
          reviewedAt: submission.reviewedAt,
          marks: submission.reviewedAt ? submission.marks : null,
          feedback: submission.reviewedAt ? submission.feedback : '',
        }
      }
      value.isPastDue = Date.now() > assignment.dueAt.getTime()
      return value
    }))
  } catch (error) {
    next(error)
  }
})

app.post('/api/assignments', authenticate, allow('teacher'), async (req, res, next) => {
  try {
    const { title, description = '', subjectId, dueAt, maxMarks } = req.body
    const dueDate = new Date(dueAt)
    if (typeof title !== 'string' || !title.trim() || title.trim().length > 160
      || typeof description !== 'string' || description.length > 5000
      || !mongoose.isValidObjectId(subjectId) || Number.isNaN(dueDate.getTime())
      || !Number.isFinite(maxMarks) || maxMarks < 0.5 || maxMarks > 1000) {
      return res.status(400).json({ message: 'Enter an assignment title, subject, due date and total marks (0.5–1000).' })
    }
    if (!await Subject.exists({ _id: subjectId })) return res.status(400).json({ message: 'Choose a valid subject.' })
    const assignment = await Assignment.create({
      title: title.trim(),
      description: description.trim(),
      subjectId,
      teacherId: req.user._id,
      dueAt: dueDate,
      maxMarks,
    })
    res.status(201).json(await assignment.populate('subjectId', 'name code'))
  } catch (error) {
    next(error)
  }
})

app.get('/api/assignments/:id/submissions', authenticate, allow('teacher'), async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'Invalid assignment.' })
    const assignment = await Assignment.findOne({ _id: req.params.id, teacherId: req.user._id })
    if (!assignment) return res.status(404).json({ message: 'Assignment not found.' })
    const submissions = await AssignmentSubmission.find({ assignmentId: assignment._id })
      .select('-fileData')
      .populate('studentId', 'name email')
      .sort({ submittedAt: -1 })
    res.json({ assignment, submissions })
  } catch (error) {
    next(error)
  }
})

app.post('/api/assignments/:id/submissions', authenticate, allow('student'), express.raw({
  type: ['application/pdf', 'image/jpeg'],
  limit: '5mb',
}), async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'Invalid assignment.' })
    const assignment = await Assignment.findById(req.params.id)
    if (!assignment || !req.user.subjectIds.some(id => String(id) === String(assignment.subjectId))) {
      return res.status(404).json({ message: 'Assignment not found.' })
    }
    if (new Date() > assignment.dueAt) return res.status(409).json({ message: 'The assignment deadline has passed.' })
    const existing = await AssignmentSubmission.findOne({ assignmentId: assignment._id, studentId: req.user._id })
    if (existing?.reviewedAt) return res.status(409).json({ message: 'This submission has already been reviewed. Contact your teacher if you need to resubmit.' })
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(400).json({ message: 'Choose a PDF or JPG file to submit.' })
    }

    const mimeType = req.headers['content-type']
    const fileNameHeader = req.headers['x-file-name']
    let fileName
    try {
      fileName = decodeURIComponent(String(fileNameHeader || ''))
    } catch {
      return res.status(400).json({ message: 'Invalid file name.' })
    }
    fileName = path.basename(fileName.replace(/\\/g, '/')).replace(/[\r\n"]/g, '').trim()
    const isPdf = mimeType === 'application/pdf'
      && fileName.toLowerCase().endsWith('.pdf')
      && req.body.subarray(0, 5).toString('ascii') === '%PDF-'
    const isJpeg = mimeType === 'image/jpeg'
      && /\.(jpe?g)$/i.test(fileName)
      && req.body[0] === 0xff && req.body[1] === 0xd8 && req.body[2] === 0xff
    if ((!isPdf && !isJpeg) || !fileName || fileName.length > 180) {
      return res.status(400).json({ message: 'Only valid PDF and JPG files up to 5 MB are accepted.' })
    }

    const submission = existing || new AssignmentSubmission({ assignmentId: assignment._id, studentId: req.user._id })
    submission.fileName = fileName
    submission.fileMimeType = mimeType
    submission.fileData = req.body
    submission.submittedAt = new Date()
    submission.marks = null
    submission.feedback = ''
    submission.reviewedAt = null
    await submission.save()
    res.status(existing ? 200 : 201).json({
      _id: submission._id,
      fileName: submission.fileName,
      submittedAt: submission.submittedAt,
      reviewedAt: null,
    })
  } catch (error) {
    next(error)
  }
})

app.patch('/api/assignments/:id/submissions/:submissionId/review', authenticate, allow('teacher'), async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id) || !mongoose.isValidObjectId(req.params.submissionId)) {
      return res.status(400).json({ message: 'Invalid assignment submission.' })
    }
    const assignment = await Assignment.findOne({ _id: req.params.id, teacherId: req.user._id })
    if (!assignment) return res.status(404).json({ message: 'Assignment not found.' })
    const { marks, feedback = '' } = req.body
    if (!Number.isFinite(marks) || marks < 0 || marks > assignment.maxMarks
      || typeof feedback !== 'string' || feedback.length > 5000) {
      return res.status(400).json({ message: `Enter marks from 0 to ${assignment.maxMarks} and feedback under 5000 characters.` })
    }
    const submission = await AssignmentSubmission.findOne({
      _id: req.params.submissionId,
      assignmentId: assignment._id,
    })
    if (!submission) return res.status(404).json({ message: 'Submission not found.' })
    submission.marks = marks
    submission.feedback = feedback.trim()
    submission.reviewedAt = new Date()
    await submission.save()
    res.json({
      _id: submission._id,
      marks: submission.marks,
      feedback: submission.feedback,
      reviewedAt: submission.reviewedAt,
    })
  } catch (error) {
    next(error)
  }
})

app.get('/api/assignments/:id/submissions/:submissionId/file', authenticate, allow('teacher', 'student'), async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id) || !mongoose.isValidObjectId(req.params.submissionId)) {
      return res.status(400).json({ message: 'Invalid assignment submission.' })
    }
    const submission = await AssignmentSubmission.findOne({
      _id: req.params.submissionId,
      assignmentId: req.params.id,
      ...(req.user.role === 'student' ? { studentId: req.user._id } : {}),
    }).select('+fileData')
    if (!submission) return res.status(404).json({ message: 'Submission file not found.' })
    if (req.user.role === 'teacher' && !await Assignment.exists({ _id: req.params.id, teacherId: req.user._id })) {
      return res.status(404).json({ message: 'Submission file not found.' })
    }
    res.set({
      'Content-Type': submission.fileMimeType,
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(submission.fileName)}`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    }).send(submission.fileData)
  } catch (error) {
    next(error)
  }
})

app.get('/api/battles/eligible-students', authenticate, allow('teacher', 'student'), async (req, res, next) => {
  try {
    const { quizId } = req.query
    if (!mongoose.isValidObjectId(quizId)) return res.status(400).json({ message: 'Choose a valid quiz.' })
    const quiz = await Quiz.findOne({ _id: quizId, status: 'published' })
    if (!quiz) return res.status(404).json({ message: 'Published quiz not found.' })
    if (req.user.role === 'teacher' && String(quiz.teacherId) !== String(req.user._id)) {
      return res.status(404).json({ message: 'Quiz not found.' })
    }
    if (req.user.role === 'student' && !studentCanAccessQuiz(quiz, req.user)) {
      return res.status(403).json({ message: 'This quiz is not available to your account.' })
    }

    const students = await User.find({
      role: 'student',
      active: true,
      $or: [
        { subjectIds: quiz.subjectId },
        { _id: { $in: quiz.assignedStudentIds } },
      ],
    }).select('name').sort({ name: 1 })
    res.json(students.map(student => ({ _id: student._id, name: student.name })))
  } catch (error) {
    next(error)
  }
})

app.get('/api/battles', authenticate, allow('teacher', 'student'), async (req, res, next) => {
  try {
    const filter = req.user.role === 'teacher'
      ? { teacherId: req.user._id }
      : { 'participants.userId': req.user._id }
    const battles = await QuizBattle.find(filter).sort({ createdAt: -1 }).limit(30)
    res.json(await Promise.all(battles.map(battle => serializeBattle(battle, req.user))))
  } catch (error) {
    next(error)
  }
})

app.post('/api/battles', authenticate, allow('teacher', 'student'), rateLimit({
  windowMs: 60 * 60_000,
  limit: 10,
  message: { message: 'Battle creation limit reached. Please try again later.' },
}), async (req, res, next) => {
  try {
    const { quizId, format, teams } = req.body
    if (!mongoose.isValidObjectId(quizId) || !['individual', 'team'].includes(format)
      || !Array.isArray(teams) || teams.length !== 2) {
      return res.status(400).json({ message: 'Choose a published quiz and set up two players or two teams.' })
    }
    const quiz = await Quiz.findOne({ _id: quizId, status: 'published' })
    if (!quiz) return res.status(404).json({ message: 'Published quiz not found.' })
    if (req.user.role === 'teacher' && String(quiz.teacherId) !== String(req.user._id)) {
      return res.status(404).json({ message: 'Quiz not found.' })
    }
    if (req.user.role === 'student' && !studentCanAccessQuiz(quiz, req.user)) {
      return res.status(403).json({ message: 'This quiz is not available to your account.' })
    }

    const normalizedTeams = []
    for (const [index, team] of teams.entries()) {
      const memberIds = team?.memberIds
      const minMembers = format === 'team' ? 2 : 1
      const maxMembers = format === 'team' ? 5 : 1
      if (typeof team?.name !== 'string' || !team.name.trim() || team.name.trim().length > 40
        || !Array.isArray(memberIds) || memberIds.length < minMembers || memberIds.length > maxMembers
        || memberIds.some(id => !mongoose.isValidObjectId(id))) {
        return res.status(400).json({ message: format === 'team'
          ? 'Each team must have a name and 2–5 students.'
          : 'Choose exactly one student for each side.' })
      }
      const uniqueMemberIds = [...new Set(memberIds.map(String))]
      if (uniqueMemberIds.length !== memberIds.length) return res.status(400).json({ message: 'A student cannot be selected more than once on the same side.' })
      normalizedTeams.push({ name: team.name.trim(), memberIds: uniqueMemberIds, sideIndex: index })
    }

    const allMemberIds = normalizedTeams.flatMap(team => team.memberIds)
    if (new Set(allMemberIds).size !== allMemberIds.length) {
      return res.status(400).json({ message: 'A student cannot be placed on both sides.' })
    }
    if (req.user.role === 'student' && !allMemberIds.includes(String(req.user._id))) {
      return res.status(400).json({ message: 'Include yourself on one side of the battle.' })
    }

    const students = await User.find({
      _id: { $in: allMemberIds },
      role: 'student',
      active: true,
    }).select('_id subjectIds')
    if (students.length !== allMemberIds.length) {
      return res.status(400).json({ message: 'Every selected player must have an active student account.' })
    }
    if (students.some(student => !studentCanAccessQuiz(quiz, student))) {
      return res.status(400).json({ message: 'All players must be assigned to this quiz or its subject.' })
    }

    const participants = normalizedTeams.flatMap(team => team.memberIds.map(userId => ({
      userId,
      sideIndex: team.sideIndex,
    })))
    const battle = await QuizBattle.create({
      quizId: quiz._id,
      quizTitle: quiz.title,
      durationMinutes: quiz.durationMinutes,
      teacherId: quiz.teacherId,
      creatorId: req.user._id,
      creatorRole: req.user.role,
      format,
      teams: normalizedTeams.map(({ name, memberIds }) => ({ name, memberIds })),
      participants,
      readyUserIds: req.user.role === 'student' ? [req.user._id] : [],
      questions: quiz.questions.map(question => ({
        questionId: question._id,
        prompt: question.prompt,
        options: question.options,
        correctOption: question.correctOption,
      })),
    })
    res.status(201).json(await serializeBattle(battle, req.user))
  } catch (error) {
    next(error)
  }
})

app.get('/api/battles/:id', authenticate, allow('teacher', 'student'), async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'Invalid battle.' })
    const battle = await QuizBattle.findById(req.params.id)
    if (!battle || !canViewBattle(battle, req.user)) return res.status(404).json({ message: 'Battle not found.' })
    res.json(await serializeBattle(battle, req.user))
  } catch (error) {
    next(error)
  }
})

app.post('/api/battles/:id/ready', authenticate, allow('student'), async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'Invalid battle.' })
    let battle = await QuizBattle.findOneAndUpdate({
      _id: req.params.id,
      status: 'waiting',
      'participants.userId': req.user._id,
    }, { $addToSet: { readyUserIds: req.user._id } }, { new: true })
    if (!battle) {
      const exists = await QuizBattle.exists({ _id: req.params.id, 'participants.userId': req.user._id })
      return res.status(exists ? 409 : 404).json({ message: exists ? 'This battle is no longer waiting for players.' : 'Battle not found.' })
    }
    if (battle.readyUserIds.length === battle.participants.length) {
      const startedAt = new Date()
      const startedBattle = await QuizBattle.findOneAndUpdate({
        _id: battle._id,
        status: 'waiting',
      }, {
        $set: {
          status: 'active',
          startedAt,
          expiresAt: new Date(startedAt.getTime() + battle.durationMinutes * 60_000),
        },
      }, { new: true })
      battle = startedBattle || await QuizBattle.findById(battle._id)
    }
    if (!battle) return res.status(404).json({ message: 'Battle not found.' })
    res.json(await serializeBattle(battle, req.user))
  } catch (error) {
    next(error)
  }
})

app.post('/api/battles/:id/answers', authenticate, allow('student'), async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id) || !mongoose.isValidObjectId(req.body.questionId)) {
      return res.status(400).json({ message: 'Invalid battle question.' })
    }
    const { questionId, selectedOption } = req.body
    if (!Number.isInteger(selectedOption) || selectedOption < 0) {
      return res.status(400).json({ message: 'Choose one of the answer options.' })
    }
    const battle = await QuizBattle.findOne({
      _id: req.params.id,
      status: 'active',
      expiresAt: { $gt: new Date() },
      'participants.userId': req.user._id,
    })
    if (!battle) return res.status(409).json({ message: 'This battle is not active or has already ended.' })
    const participant = battle.participants.find(item => String(item.userId) === String(req.user._id))
    const question = battle.questions.find(item => String(item.questionId) === String(questionId))
    if (!question || selectedOption >= question.options.length) {
      return res.status(400).json({ message: 'Choose a valid answer for this battle question.' })
    }
    const submittedAt = new Date()
    const isCorrect = selectedOption === question.correctOption
    const update = { $push: { answers: {
      questionId: question.questionId,
      sideIndex: participant.sideIndex,
      submittedBy: req.user._id,
      selectedOption,
      isCorrect,
      submittedAt,
    } } }
    if (isCorrect) {
      update.$push.winners = { questionId: question.questionId, sideIndex: participant.sideIndex }
    }
    const updatedBattle = await QuizBattle.findOneAndUpdate({
      _id: battle._id,
      status: 'active',
      expiresAt: { $gt: submittedAt },
      answers: { $not: { $elemMatch: { questionId: question.questionId, sideIndex: participant.sideIndex } } },
      winners: { $not: { $elemMatch: { questionId: question.questionId } } },
    }, update, { new: true })
    if (!updatedBattle) return res.status(409).json({ message: 'Your side has answered this question or another side won it already.' })

    const finishedAllRounds = updatedBattle.questions.every(round => {
      if (updatedBattle.winners.some(winner => String(winner.questionId) === String(round.questionId))) return true
      return [0, 1].every(sideIndex => updatedBattle.answers.some(answer =>
        String(answer.questionId) === String(round.questionId) && answer.sideIndex === sideIndex))
    })
    if (finishedAllRounds) {
      updatedBattle.status = 'completed'
      updatedBattle.completedAt = new Date()
      await updatedBattle.save()
    }
    res.json(await serializeBattle(updatedBattle, req.user))
  } catch (error) {
    next(error)
  }
})

app.get('/api/leaderboard/weekly', authenticate, allow('admin', 'teacher', 'student'), async (_req, res, next) => {
  try {
    const { start, end } = getKarachiWeekBounds(new Date())
    const students = await User.find({ role: 'student', active: true }).select('name').sort({ name: 1 })
    const attempts = await Attempt.find({
      submittedAt: { $gte: start, $lt: end },
      obtainedMarks: { $ne: null },
    }).select('studentId quizId obtainedMarks').populate('quizId', 'questions.marks')

    const bestScoresByStudent = new Map()
    for (const attempt of attempts) {
      if (!attempt.quizId || !attempt.studentId) continue
      const totalMarks = attempt.quizId.questions.reduce((sum, question) => sum + question.marks, 0)
      if (!totalMarks) continue
      const studentId = String(attempt.studentId)
      const quizId = String(attempt.quizId._id)
      const percentage = Math.max(0, Math.min(100, attempt.obtainedMarks / totalMarks * 100))
      if (!bestScoresByStudent.has(studentId)) bestScoresByStudent.set(studentId, new Map())
      const quizScores = bestScoresByStudent.get(studentId)
      quizScores.set(quizId, Math.max(quizScores.get(quizId) || 0, percentage))
    }

    const rankedStudents = students.map(student => {
      const quizScores = bestScoresByStudent.get(String(student._id))
      const completedQuizCount = quizScores?.size || 0
      const averagePercentage = completedQuizCount
        ? Number((Array.from(quizScores.values()).reduce((sum, score) => sum + score, 0) / completedQuizCount).toFixed(2))
        : null
      return { studentId: student._id, name: student.name, averagePercentage, completedQuizCount, rank: null }
    }).sort((first, second) => {
      if (first.averagePercentage === null) return second.averagePercentage === null ? first.name.localeCompare(second.name) : 1
      if (second.averagePercentage === null) return -1
      return second.averagePercentage - first.averagePercentage
        || second.completedQuizCount - first.completedQuizCount
        || first.name.localeCompare(second.name)
    })

    let previousRankKey = ''
    let previousRank = 0
    rankedStudents.forEach((student, index) => {
      if (student.averagePercentage === null) return
      const rankKey = String(student.averagePercentage)
      if (rankKey !== previousRankKey) previousRank = index + 1
      student.rank = previousRank
      previousRankKey = rankKey
    })

    res.json({
      timezone: 'Asia/Karachi',
      weekStart: start,
      weekEnd: end,
      students: rankedStudents,
    })
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
  if (error.status === 413 || error.code === 'entity.too.large') {
    return res.status(413).json({ message: 'The uploaded file must be 5 MB or smaller.' })
  }
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

function studentCanAccessQuiz(quiz, student) {
  const explicitlyAssigned = quiz.assignedStudentIds.some(id => String(id) === String(student._id))
  if (quiz.assignedStudentIds.length && !explicitlyAssigned) return false
  return explicitlyAssigned || student.subjectIds.some(id => String(id) === String(quiz.subjectId))
}

function canViewBattle(battle, user) {
  if (user.role === 'teacher') return String(battle.teacherId) === String(user._id)
  return battle.participants.some(participant => String(participant.userId) === String(user._id))
}

async function serializeBattle(battle, user) {
  if (battle.status === 'active' && battle.expiresAt && battle.expiresAt <= new Date()) {
    battle.status = 'completed'
    battle.completedAt = battle.expiresAt
    await battle.save()
  }

  const participantIds = battle.participants.map(participant => participant.userId)
  const users = await User.find({ _id: { $in: participantIds } }).select('name')
  const usersById = new Map(users.map(participant => [String(participant._id), participant]))
  const teams = battle.teams.map((team, sideIndex) => ({
    name: team.name,
    members: team.memberIds.map(id => {
      const participant = usersById.get(String(id))
      return { _id: String(id), name: participant?.name || 'Student' }
    }),
    score: battle.winners.filter(winner => winner.sideIndex === sideIndex).length,
  }))
  const currentParticipant = battle.participants.find(participant => String(participant.userId) === String(user._id))
  const answeredSideIndexes = {}
  for (const answer of battle.answers) {
    const key = String(answer.questionId)
    answeredSideIndexes[key] ||= []
    if (!answeredSideIndexes[key].includes(answer.sideIndex)) answeredSideIndexes[key].push(answer.sideIndex)
  }

  return {
    _id: String(battle._id),
    quizTitle: battle.quizTitle,
    durationMinutes: battle.durationMinutes,
    creatorId: String(battle.creatorId),
    format: battle.format,
    status: battle.status,
    teams,
    questions: battle.status === 'waiting' ? [] : battle.questions.map(question => ({
      questionId: String(question.questionId),
      prompt: question.prompt,
      options: question.options,
    })),
    winners: battle.winners.map(winner => ({
      questionId: String(winner.questionId),
      sideIndex: winner.sideIndex,
    })),
    answeredSideIndexes,
    readyCount: battle.readyUserIds.length,
    participantCount: battle.participants.length,
    isReady: battle.readyUserIds.some(id => String(id) === String(user._id)),
    isParticipant: Boolean(currentParticipant),
    mySideIndex: currentParticipant?.sideIndex ?? null,
    startedAt: battle.startedAt,
    expiresAt: battle.expiresAt,
    isDraw: battle.status === 'completed' && teams[0].score === teams[1].score,
    winningSideIndex: battle.status === 'completed' && teams[0].score !== teams[1].score
      ? teams[0].score > teams[1].score ? 0 : 1
      : null,
  }
}

function getKarachiWeekBounds(now) {
  const karachiOffset = 5 * 60 * 60_000
  const localNow = new Date(now.getTime() + karachiOffset)
  const daysSinceMonday = (localNow.getUTCDay() + 6) % 7
  const mondayUtc = Date.UTC(
    localNow.getUTCFullYear(),
    localNow.getUTCMonth(),
    localNow.getUTCDate() - daysSinceMonday,
  )
  const start = new Date(mondayUtc - karachiOffset)
  return { start, end: new Date(start.getTime() + 7 * 24 * 60 * 60_000) }
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
