import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { api, getError } from './api'
import type { Attempt, BankQuestion, Question, Quiz, Role, Subject, User } from './api'
import './App.css'

type View = 'overview' | 'quizzes' | 'results' | 'people' | 'subjects' | 'question-bank'
type QuizSession = { attempt: Attempt; quiz: Quiz }

function App() {
  const [user, setUser] = useState<User | null>(null)
  const [checkingSession, setCheckingSession] = useState(Boolean(localStorage.getItem('quiz-token')))
  const [authError, setAuthError] = useState('')

  useEffect(() => {
    if (!localStorage.getItem('quiz-token')) return
    api<{ user: User }>('/auth/me')
      .then(({ user: currentUser }) => setUser(currentUser))
      .catch(() => localStorage.removeItem('quiz-token'))
      .finally(() => setCheckingSession(false))
  }, [])

  async function signIn(email: string, password: string, registerName?: string, department = '', semester = '') {
    setAuthError('')
    try {
      const route = registerName ? '/auth/register' : '/auth/login'
      const data = await api<{ token: string; user: User }>(route, {
        method: 'POST',
        body: JSON.stringify(registerName ? { name: registerName, email, password, department, semester } : { email, password }),
      })
      localStorage.setItem('quiz-token', data.token)
      setUser(data.user)
    } catch (error) {
      setAuthError(getError(error))
    }
  }

  function signOut() {
    localStorage.removeItem('quiz-token')
    setUser(null)
  }

  if (checkingSession) return <div className="page-loader"><span className="spinner" /> Loading your workspace</div>
  if (!user) return <LoginScreen onSubmit={signIn} error={authError} />
  return <Workspace user={user} onSignOut={signOut} />
}

function LoginScreen({ onSubmit, error }: {
  onSubmit: (email: string, password: string, name?: string, department?: string, semester?: string) => Promise<void>
  error: string
}) {
  const [registering, setRegistering] = useState(false)
  const [busy, setBusy] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setBusy(true)
    await onSubmit(
      String(form.get('email')),
      String(form.get('password')),
      registering ? String(form.get('name')) : undefined,
      String(form.get('department') || ''),
      String(form.get('semester') || ''),
    )
    setBusy(false)
  }

  return (
    <main className="auth-layout">
      <section className="auth-visual">
        <div className="brand brand-light"><span className="brand-mark">Q</span> quizly</div>
        <div className="auth-copy">
          <span className="eyebrow">A smarter way to assess</span>
          <h1>Learning, measured<br />one quiz at a time.</h1>
          <p>Bring your classrooms, assessments and progress together in one calm, focused space.</p>
          <div className="auth-proof">
            <div className="avatar-stack"><span>AM</span><span>SK</span><span>RJ</span><span>+</span></div>
            <span>Made for curious minds<br /><strong>Teachers & learners</strong></span>
          </div>
        </div>
        <div className="visual-foot">Thoughtful assessments. Better outcomes.</div>
      </section>
      <section className="auth-panel">
        <div className="mobile-brand brand"><span className="brand-mark">Q</span> quizly</div>
        <div className="auth-form-wrap">
          <span className="eyebrow">{registering ? 'Create your account' : 'Welcome back'}</span>
          <h2>{registering ? 'Start learning today' : 'Sign in to Quizly'}</h2>
          <p className="muted">{registering ? 'Set up your student account in a few seconds.' : 'Enter your details to access your workspace.'}</p>
          <form className="stack-form" onSubmit={handleSubmit}>
            {registering && <>
              <label>Full name<input name="name" placeholder="e.g. Ayesha Khan" required autoComplete="name" /></label>
              <label>Department<input name="department" placeholder="e.g. Computer Science" /></label>
              <label>Semester<input name="semester" placeholder="e.g. Semester 1" /></label>
            </>}
            <label>Email address<input name="email" type="email" placeholder="you@university.edu" required autoComplete="email" /></label>
            <label>Password<input name="password" type="password" placeholder={registering ? 'At least 8 characters' : 'Enter your password'} minLength={registering ? 8 : undefined} required autoComplete={registering ? 'new-password' : 'current-password'} /></label>
            {error && <div className="alert">{error}</div>}
            <button className="button button-primary button-wide" disabled={busy}>{busy ? 'Please wait…' : registering ? 'Create account' : 'Sign in'} <span aria-hidden="true">→</span></button>
          </form>
          <p className="auth-switch">{registering ? 'Already have an account?' : 'New to Quizly?'} <button onClick={() => setRegistering(value => !value)}>{registering ? 'Sign in' : 'Create a student account'}</button></p>
          <p className="auth-note">Your institution's administrator can create teacher and admin accounts.</p>
        </div>
      </section>
    </main>
  )
}

function Workspace({ user, onSignOut }: { user: User; onSignOut: () => void }) {
  const [view, setView] = useState<View>('overview')
  const [quizzes, setQuizzes] = useState<Quiz[]>([])
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [attempts, setAttempts] = useState<Attempt[]>([])
  const [session, setSession] = useState<QuizSession | null>(null)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setError('')
    try {
      const nextSubjects = await api<Subject[]>('/subjects')
      setSubjects(nextSubjects)
      if (user.role === 'admin') {
        const [nextUsers, nextQuizzes] = await Promise.all([api<User[]>('/users'), api<Quiz[]>('/quizzes')])
        setUsers(nextUsers)
        setQuizzes(nextQuizzes)
      } else if (user.role === 'teacher') {
        setQuizzes(await api<Quiz[]>('/quizzes'))
      } else {
        const [nextQuizzes, nextAttempts] = await Promise.all([api<Quiz[]>('/quizzes'), api<Attempt[]>('/attempts/mine')])
        setQuizzes(nextQuizzes)
        setAttempts(nextAttempts)
      }
    } catch (cause) {
      setError(getError(cause))
    } finally {
      setLoading(false)
    }
  }, [user.role])

  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => {
    if (!notice) return
    const timeout = window.setTimeout(() => setNotice(''), 3800)
    return () => window.clearTimeout(timeout)
  }, [notice])

  const navItems: { id: View; label: string; icon: string }[] = user.role === 'admin'
    ? [{ id: 'overview', label: 'Overview', icon: '◫' }, { id: 'people', label: 'People', icon: '♙' }, { id: 'subjects', label: 'Subjects', icon: '▤' }, { id: 'quizzes', label: 'All quizzes', icon: '☷' }, { id: 'results', label: 'Results & reports', icon: '▥' }]
    : user.role === 'teacher'
      ? [{ id: 'overview', label: 'Overview', icon: '◫' }, { id: 'quizzes', label: 'My quizzes', icon: '☷' }, { id: 'question-bank', label: 'Question bank', icon: '▤' }, { id: 'results', label: 'Class results', icon: '▥' }]
      : [{ id: 'overview', label: 'Overview', icon: '◫' }, { id: 'quizzes', label: 'Explore quizzes', icon: '☷' }, { id: 'results', label: 'My results', icon: '▥' }]

  async function startQuiz(quizId: string) {
    setError('')
    try {
      const result = await api<QuizSession>(`/quizzes/${quizId}/attempts`, { method: 'POST' })
      setSession(result)
    } catch (cause) {
      setError(getError(cause))
      await refresh()
    }
  }

  async function finishQuiz() {
    if (!session) return
    try {
      await api(`/attempts/${session.attempt._id}/submit`, { method: 'POST' })
      setSession(null)
      setNotice('Quiz submitted. Your result is ready.')
      setView('results')
      await refresh()
    } catch (cause) {
      setError(getError(cause))
      throw cause
    }
  }

  if (session) return <QuizRunner session={session} onExit={() => setSession(null)} onSubmit={finishQuiz} />

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#" onClick={event => event.preventDefault()}><span className="brand-mark">Q</span> quizly</a>
        <div className="workspace-label">WORKSPACE</div>
        <nav className="side-nav">
          {navItems.map(item => <button key={item.id} className={view === item.id ? 'nav-item active' : 'nav-item'} onClick={() => setView(item.id)}><span className="nav-icon">{item.icon}</span>{item.label}{item.id === 'quizzes' && user.role === 'student' && <span className="nav-count">{quizzes.length}</span>}</button>)}
        </nav>
        <div className="sidebar-bottom">
          <div className="help-card"><span className="help-spark">✳</span><strong>Need a hand?</strong><span>Take a look at our getting started guide.</span><button onClick={() => setNotice('Ask your institution administrator if you need account or access help.')}>Get help <span>↗</span></button></div>
          <div className="account-row"><div className="user-avatar">{initials(user.name)}</div><div className="account-info"><strong>{user.name}</strong><span>{capitalize(user.role)}</span></div><button className="icon-button logout" title="Sign out" onClick={onSignOut}>↪</button></div>
        </div>
      </aside>
      <main className="main-area">
        <header className="topbar">
          <div className="breadcrumb">Workspace <span>/</span> <strong>{navItems.find(item => item.id === view)?.label}</strong></div>
          <div className="topbar-actions"><span className="today">{new Intl.DateTimeFormat('en', { weekday: 'short', month: 'short', day: 'numeric' }).format(new Date())}</span><div className="user-avatar small">{initials(user.name)}</div></div>
        </header>
        <div className="content-wrap">
          {notice && <div className="toast success-toast">{notice}<button onClick={() => setNotice('')}>×</button></div>}
          {error && <div className="toast error-toast">{error}<button onClick={() => setError('')}>×</button></div>}
          {loading ? <div className="loading-line"><span className="spinner" /> Loading workspace…</div> : (
            <PageContent
              view={view}
              user={user}
              quizzes={quizzes}
              subjects={subjects}
              users={users}
              attempts={attempts}
              onStart={startQuiz}
              onRefresh={refresh}
              onNotice={setNotice}
              onError={setError}
              onSelectView={setView}
            />
          )}
        </div>
      </main>
    </div>
  )
}

function PageContent(props: {
  view: View
  user: User
  quizzes: Quiz[]
  subjects: Subject[]
  users: User[]
  attempts: Attempt[]
  onStart: (id: string) => void
  onRefresh: () => Promise<void>
  onNotice: (message: string) => void
  onError: (message: string) => void
  onSelectView: (view: View) => void
}) {
  const { view, user } = props
  if (view === 'people') return <PeoplePage {...props} />
  if (view === 'subjects') return <SubjectsPage {...props} />
  if (view === 'question-bank') return <QuestionBankPage {...props} />
  if (view === 'quizzes') return user.role === 'teacher' ? <TeacherQuizzes {...props} /> : user.role === 'admin' ? <AdminQuizzes {...props} /> : <QuizCatalog {...props} />
  if (view === 'results') return user.role === 'teacher' ? <TeacherResults {...props} /> : user.role === 'admin' ? <AdminResults {...props} /> : <StudentResults {...props} />
  return <Overview {...props} />
}

function Overview(props: Parameters<typeof PageContent>[0]) {
  const { user, quizzes, users, attempts, onSelectView } = props
  const student = user.role === 'student'
  const completed = student ? attempts.filter(attempt => attempt.submittedAt) : []
  const average = completed.length
    ? Math.round(completed.reduce((sum, attempt) => {
      const total = attempt.quizId?.questions.reduce((quizSum, question) => quizSum + question.marks, 0) || 0
      return sum + (total ? (attempt.obtainedMarks || 0) / total * 100 : 0)
    }, 0) / completed.length)
    : 0
  const greeting = new Date().getHours() < 12 ? 'Good morning' : new Date().getHours() < 18 ? 'Good afternoon' : 'Good evening'
  const latest = student
    ? quizzes.slice(0, 3)
    : quizzes.slice(0, 4)

  return (
    <>
      <section className="welcome-banner">
        <div><span className="eyebrow">{greeting}, {user.name.split(' ')[0]}</span><h1>{student ? 'Ready to learn something new?' : 'Your learning hub, at a glance.'}</h1><p>{student ? 'A little progress each day adds up to big results.' : user.role === 'admin' ? 'Here’s what’s happening across your learning community.' : 'Create engaging assessments and keep your class moving forward.'}</p></div>
        <div className="welcome-art"><div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="art-card"><span>✦</span><strong>{student ? 'Keep it up!' : 'Make today count'}</strong><small>{student ? 'You’ve got this' : 'One step at a time'}</small></div><span className="art-dot dot-one" /><span className="art-dot dot-two" /></div>
      </section>
      <div className="stats-grid">
        {student ? <>
          <StatCard label="Available quizzes" value={quizzes.filter(quiz => !quiz.attempt).length} icon="☷" tone="lavender" detail="Ready when you are" />
          <StatCard label="Completed" value={completed.length} icon="✓" tone="mint" detail="Quizzes submitted" />
          <StatCard label="Average score" value={`${average}%`} icon="↗" tone="peach" detail="Across your attempts" />
          <StatCard label="Subjects" value={new Set(quizzes.map(quiz => quiz.subjectId?.code)).size} icon="▤" tone="blue" detail="In your workspace" />
        </> : user.role === 'teacher' ? <>
          <StatCard label="Total quizzes" value={quizzes.length} icon="☷" tone="lavender" detail="Created by you" />
          <StatCard label="Published" value={quizzes.filter(quiz => quiz.status === 'published').length} icon="✓" tone="mint" detail="Visible to students" />
          <StatCard label="Drafts" value={quizzes.filter(quiz => quiz.status === 'draft').length} icon="◷" tone="peach" detail="Still in progress" />
          <StatCard label="Subjects" value={props.subjects.length} icon="▤" tone="blue" detail="Available to teach" />
        </> : <>
          <StatCard label="People" value={users.length} icon="♙" tone="lavender" detail={`${users.filter(item => item.active).length} active accounts`} />
          <StatCard label="Teachers" value={users.filter(item => item.role === 'teacher').length} icon="♧" tone="mint" detail="Across your institution" />
          <StatCard label="Subjects" value={props.subjects.length} icon="▤" tone="peach" detail="Academic catalog" />
          <StatCard label="Quizzes" value={quizzes.length} icon="☷" tone="blue" detail="Across all classes" />
        </>}
      </div>
      <section className="section-block">
        <div className="section-heading"><div><h2>{student ? 'Pick up where you left off' : user.role === 'teacher' ? 'Recent quizzes' : 'Recent activity'}</h2><p>{student ? 'Your next small win is just a quiz away.' : user.role === 'teacher' ? 'Your assessments, all in one place.' : 'A snapshot of the Quizly community.'}</p></div><button className="text-button" onClick={() => onSelectView(user.role === 'admin' ? 'people' : 'quizzes')}>{student ? 'Browse quizzes' : user.role === 'admin' ? 'Manage people' : 'View all quizzes'} <span>→</span></button></div>
        {latest.length ? <div className="quiz-card-grid">{latest.map(quiz => <QuizCard key={quiz._id} quiz={quiz} student={student} onStart={props.onStart} onSelect={() => onSelectView('quizzes')} />)}</div> : <EmptyState title={student ? 'No quizzes yet' : 'Nothing here just yet'} text={student ? 'Published quizzes will appear here when they’re ready.' : user.role === 'teacher' ? 'Create your first quiz to get started.' : 'Once teachers publish quizzes, they’ll show up here.'} action={user.role === 'teacher' ? 'Create a quiz' : undefined} onAction={() => onSelectView('quizzes')} />}
      </section>
    </>
  )
}

function StatCard({ label, value, icon, tone, detail }: { label: string; value: string | number; icon: string; tone: string; detail: string }) {
  return <article className="stat-card"><div className={`stat-icon ${tone}`}>{icon}</div><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>
}

function QuizCatalog({ quizzes, onStart }: Parameters<typeof PageContent>[0]) {
  const [filter, setFilter] = useState('All')
  const filters = ['All', 'Available', 'Upcoming', 'Completed']
  const visible = quizzes.filter(quiz => filter === 'All'
    || (filter === 'Available' ? Boolean(quiz.canAttempt && !quiz.isUpcoming) : false)
    || (filter === 'Upcoming' ? Boolean(quiz.isUpcoming) : false)
    || (filter === 'Completed' ? Boolean(quiz.attempt?.submittedAt && !quiz.canAttempt) : false))
  return (
    <>
      <PageHeading eyebrow="LEARN & GROW" title="Explore quizzes" description="Choose a quiz, find your focus, and show what you know." />
      <div className="filter-row">{filters.map(item => <button key={item} className={filter === item ? 'filter-chip selected' : 'filter-chip'} onClick={() => setFilter(item)}>{item}{item === 'All' && <span>{quizzes.length}</span>}</button>)}</div>
      {visible.length ? <div className="quiz-card-grid catalog-grid">{visible.map(quiz => <QuizCard key={quiz._id} quiz={quiz} student onStart={onStart} />)}</div> : <EmptyState title="No quizzes in this view" text="Try another filter or check back later." />}
    </>
  )
}

function QuizCard({ quiz, student, onStart, onSelect }: { quiz: Quiz; student: boolean; onStart: (id: string) => void; onSelect?: () => void }) {
  const submitted = Boolean(quiz.attempt?.submittedAt)
  const canResume = Boolean(quiz.attempt && !submitted)
  const locked = Boolean(quiz.isUpcoming || quiz.isExpired || (quiz.attempt?.submittedAt && !quiz.canAttempt))
  return (
    <article className="quiz-card">
      <div className="quiz-card-top"><span className="subject-pill">{quiz.subjectId?.code || 'SUBJECT'}</span><span className={quiz.status === 'published' ? 'status-dot published' : 'status-dot draft'}>{quiz.status === 'published' ? 'Published' : 'Draft'}</span></div>
      <h3>{quiz.title}</h3><p className="quiz-description">{quiz.description || `Test your knowledge in ${quiz.subjectId?.name || 'this subject'}.`}</p>
      <div className="quiz-meta"><span>◷ {quiz.durationMinutes} min</span><span>☷ {quiz.questions.length} questions</span><span>✦ {quiz.questions.reduce((sum, question) => sum + question.marks, 0)} marks</span></div>
      <div className="quiz-card-footer">
        <span className="quiz-subject">{quiz.subjectId?.name || 'Subject'}{quiz.teacherId?.name ? ` · ${quiz.teacherId.name}` : ''}</span>
        {student
          ? locked ? <span className="completed-label">{quiz.isUpcoming ? 'Upcoming' : quiz.isExpired ? 'Closed' : '✓ Completed'}</span> : <button className="mini-action" onClick={() => onStart(quiz._id)}>{canResume ? 'Resume' : submitted ? 'Try again' : 'Start quiz'} <span>→</span></button>
          : <button className="mini-action" onClick={onSelect}>{quiz.status === 'draft' ? 'Draft' : 'View results'} <span>→</span></button>}
      </div>
    </article>
  )
}

function TeacherQuizzes(props: Parameters<typeof PageContent>[0]) {
  const { quizzes, subjects, onRefresh, onNotice, onError } = props
  const [showForm, setShowForm] = useState(false)
  const [selected, setSelected] = useState<Quiz | null>(null)
  const [editing, setEditing] = useState<Quiz | null>(null)
  const [bankQuestions, setBankQuestions] = useState<BankQuestion[]>([])
  const [students, setStudents] = useState<User[]>([])
  const [busy, setBusy] = useState(false)
  const [questions, setQuestions] = useState<Question[]>([{ prompt: '', options: ['', '', '', ''], correctOption: 0, marks: 1, questionType: 'multiple-choice', difficulty: 'medium' }])
  const [formDefaults, setFormDefaults] = useState<Quiz | null>(null)

  useEffect(() => {
    if (!showForm) return
    Promise.all([api<BankQuestion[]>('/question-bank'), api<User[]>('/students')])
      .then(([bank, roster]) => { setBankQuestions(bank); setStudents(roster) })
      .catch(error => onError(getError(error)))
  }, [showForm, onError])

  function beginCreate() {
    setEditing(null)
    setFormDefaults(null)
    setQuestions([{ prompt: '', options: ['', '', '', ''], correctOption: 0, marks: 1, questionType: 'multiple-choice', difficulty: 'medium' }])
    setShowForm(true)
  }

  function beginEdit(quiz: Quiz) {
    setEditing(quiz)
    setFormDefaults(quiz)
    setQuestions(quiz.questions.map(question => ({ ...question, options: [...question.options] })))
    setSelected(null)
    setShowForm(true)
  }

  function addQuestion() {
    setQuestions(current => [...current, { prompt: '', options: ['', '', '', ''], correctOption: 0, marks: 1, questionType: 'multiple-choice', difficulty: 'medium' }])
  }

  function changeQuestion(index: number, patch: Partial<Question>) {
    setQuestions(current => current.map((question, i) => i === index ? { ...question, ...patch } : question))
  }

  function changeOption(questionIndex: number, optionIndex: number, value: string) {
    setQuestions(current => current.map((question, i) => i === questionIndex
      ? { ...question, options: question.options.map((option, j) => j === optionIndex ? value : option) }
      : question))
  }

  function addQuestionFromBank(id: string) {
    const bankQuestion = bankQuestions.find(question => question._id === id)
    if (!bankQuestion) return
    setQuestions(current => [...current, {
      bankQuestionId: bankQuestion._id,
      prompt: bankQuestion.prompt,
      questionType: bankQuestion.questionType,
      options: [...bankQuestion.options],
      correctOption: bankQuestion.correctOption,
      marks: 1,
      topic: bankQuestion.topic,
      difficulty: bankQuestion.difficulty,
    }])
  }

  async function saveQuiz(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const rawStart = String(form.get('startsAt') || '')
    const rawEnd = String(form.get('endsAt') || '')
    const payload = {
      title: String(form.get('title')),
      description: String(form.get('description')),
      subjectId: String(form.get('subjectId')),
      durationMinutes: Number(form.get('durationMinutes')),
      passingMarks: Number(form.get('passingMarks')),
      startsAt: rawStart ? new Date(rawStart).toISOString() : null,
      endsAt: rawEnd ? new Date(rawEnd).toISOString() : null,
      maxAttempts: Number(form.get('maxAttempts')),
      shuffleQuestions: form.get('shuffleQuestions') === 'on',
      shuffleOptions: form.get('shuffleOptions') === 'on',
      assignedStudentIds: form.getAll('assignedStudentIds').map(String),
      status: String(form.get('status')),
      questions,
    }
    setBusy(true)
    try {
      await api(editing ? `/quizzes/${editing._id}` : '/quizzes', {
        method: editing ? 'PATCH' : 'POST',
        body: JSON.stringify(payload),
      })
      await onRefresh()
      setShowForm(false)
      setEditing(null)
      setFormDefaults(null)
      onNotice(editing ? 'Quiz changes saved.' : 'Your quiz has been saved.')
    } catch (error) {
      onError(getError(error))
    } finally {
      setBusy(false)
    }
  }

  if (showForm) return (
    <>
      <PageHeading eyebrow="QUIZ BUILDER" title={editing ? 'Edit quiz' : 'Create a quiz'} description="Set the assessment rules, schedule and questions." action={<button className="button button-ghost" onClick={() => { setShowForm(false); setEditing(null) }}>← Back to quizzes</button>} />
      <form className="builder-form" onSubmit={saveQuiz}>
        <div className="form-section"><div className="form-section-title"><span>01</span><div><h3>Quiz details</h3><p>Set up the assessment and who can take it.</p></div></div>
          <div className="field-grid"><label>Quiz title<input name="title" defaultValue={formDefaults?.title} placeholder="e.g. Introduction to Biology" required /></label><label>Subject<select name="subjectId" required defaultValue={formDefaults?.subjectId?._id || ''}><option value="" disabled>Select a subject</option>{subjects.map(subject => <option key={subject._id} value={subject._id}>{subject.name} ({subject.code})</option>)}</select></label>
          <label className="field-span">Description<textarea name="description" rows={2} defaultValue={formDefaults?.description} placeholder="A short note to help students prepare" /></label>
          <label>Duration (minutes)<input name="durationMinutes" type="number" min="1" max="240" defaultValue={formDefaults?.durationMinutes || 20} required /></label><label>Passing marks<input name="passingMarks" type="number" min="0" defaultValue={formDefaults?.passingMarks || 0} required /></label>
          <label>Opens at<input name="startsAt" type="datetime-local" defaultValue={toLocalInput(formDefaults?.startsAt)} /></label><label>Closes at<input name="endsAt" type="datetime-local" defaultValue={toLocalInput(formDefaults?.endsAt)} /></label>
          <label>Maximum attempts<input name="maxAttempts" type="number" min="1" max="10" defaultValue={formDefaults?.maxAttempts || 1} required /></label>
          <label>Publish status<select name="status" defaultValue={formDefaults?.status || 'draft'}><option value="draft">Save as draft</option><option value="published">Publish quiz</option></select></label>
          <label className="field-span">Assign to specific students <select name="assignedStudentIds" multiple size={Math.min(students.length || 2, 5)} defaultValue={formDefaults?.assignedStudentIds || []}>{students.map(student => <option key={student._id} value={student._id}>{student.name} · {student.email}</option>)}</select><small>Leave blank to make it available to all students in the selected subject.</small></label>
          <div className="field-span option-grid"><label className="inline-check"><input name="shuffleQuestions" type="checkbox" defaultChecked={formDefaults?.shuffleQuestions} /> Shuffle question order</label><label className="inline-check"><input name="shuffleOptions" type="checkbox" defaultChecked={formDefaults?.shuffleOptions} /> Shuffle answer options</label></div>
          </div>
        </div>
        <div className="form-section"><div className="form-section-title"><span>02</span><div><h3>Questions</h3><p>Write questions or add items from your question bank.</p></div></div>
          {bankQuestions.length > 0 && <label className="bank-import">Add from question bank<select defaultValue="" onChange={event => { if (event.target.value) addQuestionFromBank(event.target.value); event.target.value = '' }}><option value="">Choose a saved question…</option>{bankQuestions.map(question => <option key={question._id} value={question._id}>{question.prompt.slice(0, 90)}</option>)}</select></label>}
          <div className="question-builder-list">{questions.map((question, index) => <div className="question-builder" key={index}>
            <div className="question-builder-head"><strong>Question {String(index + 1).padStart(2, '0')}</strong><label className="marks-input">Marks <input type="number" min="1" value={question.marks} onChange={event => changeQuestion(index, { marks: Number(event.target.value) })} required /></label>{questions.length > 1 && <button type="button" className="table-link" onClick={() => setQuestions(current => current.filter((_, i) => i !== index))}>Remove</button>}</div>
            <div className="field-grid question-metadata"><label>Question type<select value={question.questionType || 'multiple-choice'} onChange={event => changeQuestion(index, { questionType: event.target.value as Question['questionType'], options: event.target.value === 'true-false' ? ['True', 'False'] : ['', '', '', ''], correctOption: 0 })}><option value="multiple-choice">Multiple choice</option><option value="true-false">True / False</option></select></label><label>Topic<input value={question.topic || ''} onChange={event => changeQuestion(index, { topic: event.target.value })} placeholder="e.g. Cell structure" /></label><label>Difficulty<select value={question.difficulty || 'medium'} onChange={event => changeQuestion(index, { difficulty: event.target.value as Question['difficulty'] })}><option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option></select></label></div>
            <label className="sr-only" htmlFor={`prompt-${index}`}>Question text</label><textarea id={`prompt-${index}`} value={question.prompt} onChange={event => changeQuestion(index, { prompt: event.target.value })} placeholder="Type your question here…" rows={2} required />
            <div className="option-grid">{question.options.map((option, optionIndex) => <label className={question.correctOption === optionIndex ? 'option-edit correct' : 'option-edit'} key={optionIndex}><input type="radio" name={`correct-${index}`} checked={question.correctOption === optionIndex} onChange={() => changeQuestion(index, { correctOption: optionIndex })} aria-label={`Set option ${optionIndex + 1} as correct`} /><span>{String.fromCharCode(65 + optionIndex)}</span><input value={option} onChange={event => changeOption(index, optionIndex, event.target.value)} placeholder={`Answer option ${optionIndex + 1}`} required /></label>)}</div>
          </div>)}</div>
          <button type="button" className="add-question" onClick={addQuestion}>＋ Add another question</button>
        </div>
        <div className="builder-footer"><span className="builder-note">Correct answers are hidden from students and graded on the server.</span><button className="button button-primary" disabled={busy || subjects.length === 0}>{busy ? 'Saving…' : editing ? 'Save changes' : 'Save quiz'} <span>→</span></button></div>
        {subjects.length === 0 && <p className="form-hint">Ask your administrator to add a subject before creating a quiz.</p>}
      </form>
    </>
  )

  if (selected) return <TeacherQuizDetail quiz={selected} onBack={() => setSelected(null)} onEdit={() => beginEdit(selected)} onError={onError} />

  return <>
    <PageHeading eyebrow="ASSESSMENTS" title="My quizzes" description="Create, organize, schedule and publish assessments." action={<button className="button button-primary" onClick={beginCreate}>＋ Create quiz</button>} />
    <div className="quiz-card-grid catalog-grid">{quizzes.map(quiz => <QuizCard key={quiz._id} quiz={quiz} student={false} onStart={() => {}} onSelect={() => setSelected(quiz)} />)}</div>
    {!quizzes.length && <EmptyState title="Your first quiz starts here" text="Build an assessment for your students in just a few steps." action="Create a quiz" onAction={beginCreate} />}
  </>
}

function TeacherQuizDetail({ quiz, onBack, onEdit, onError }: { quiz: Quiz; onBack: () => void; onEdit: () => void; onError: (message: string) => void }) {
  const [attempts, setAttempts] = useState<Attempt[]>([])
  const [analytics, setAnalytics] = useState<{ submissions: number; averageMarks: number; averagePercentage: number; passRate: number; questions: { questionId: string; prompt: string; difficulty: string; correctRate: number; answered: number }[] } | null>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    Promise.all([
      api<Attempt[]>(`/quizzes/${quiz._id}/attempts`),
      api<typeof analytics>(`/quizzes/${quiz._id}/analytics`),
    ])
      .then(([nextAttempts, nextAnalytics]) => { setAttempts(nextAttempts); setAnalytics(nextAnalytics) })
      .catch(error => onError(getError(error)))
      .finally(() => setLoading(false))
  }, [quiz._id, onError])
  return <>
    <PageHeading eyebrow={quiz.subjectId?.name || 'QUIZ'} title={quiz.title} description={`${quiz.questions.length} questions · ${quiz.durationMinutes} minutes`} action={<div className="heading-actions"><button className="button button-ghost" disabled={Boolean(analytics?.submissions)} title={analytics?.submissions ? 'A quiz with submitted attempts cannot be edited.' : undefined} onClick={onEdit}>Edit quiz</button><button className="button button-ghost" onClick={onBack}>← Back to quizzes</button></div>} />
    {analytics && <div className="result-summary"><div><span>Submissions</span><strong>{analytics.submissions}</strong></div><div><span>Class average</span><strong>{analytics.averageMarks} / {analytics.questions.reduce((sum, _, index) => sum + (quiz.questions[index]?.marks || 0), 0)} <small>({analytics.averagePercentage}%)</small></strong></div><div><span>Pass rate</span><strong>{analytics.passRate}%</strong></div></div>}
    {analytics?.questions.length ? <section className="table-card analytics-card"><div className="table-heading"><div><h3>Question performance</h3><p>Correct response rate among students who answered.</p></div></div><div className="question-analytics">{analytics.questions.map((item, index) => <div className="analytics-row" key={item.questionId}><div className="analytics-question"><span>Q{index + 1}</span><strong>{item.prompt}</strong><small>{capitalize(item.difficulty)} · {item.answered} responses</small></div><div className="analytics-bar"><i style={{ width: `${item.correctRate}%` }} /></div><strong className="analytics-percent">{item.correctRate}%</strong></div>)}</div></section> : null}
    <section className="table-card"><div className="table-heading"><div><h3>Student results</h3><p>{attempts.filter(attempt => attempt.submittedAt).length} submissions</p></div><button className="button button-ghost button-small" onClick={() => downloadCsv(quiz.title, attempts)}>↓ Export CSV</button></div>
      {loading ? <div className="empty-inline"><span className="spinner" /> Loading results…</div> : attempts.length ? <div className="table-scroll"><table><thead><tr><th>Student</th><th>Email</th><th>Submitted</th><th>Score</th><th>Result</th></tr></thead><tbody>{attempts.map(attempt => {
        const total = quiz.questions.reduce((sum, question) => sum + question.marks, 0)
        const score = attempt.obtainedMarks ?? 0
        return <tr key={attempt._id}><td><div className="table-user"><div className="user-avatar tiny">{initials(attempt.studentId?.name || 'S')}</div>{attempt.studentId?.name || 'Student'}</div></td><td>{attempt.studentId?.email || '—'}</td><td>{attempt.submittedAt ? new Date(attempt.submittedAt).toLocaleString() : 'In progress'}</td><td>{attempt.submittedAt ? `${score} / ${total}` : '—'}</td><td><span className={attempt.submittedAt && score >= quiz.passingMarks ? 'result-badge passed' : 'result-badge pending'}>{attempt.submittedAt ? score >= quiz.passingMarks ? 'Passed' : 'Needs review' : 'In progress'}</span></td></tr>
      })}</tbody></table></div> : <EmptyState title="No submissions yet" text="Student attempts and scores will appear here." />}
    </section>
  </>
}

function AdminQuizzes({ quizzes }: Parameters<typeof PageContent>[0]) {
  return <>
    <PageHeading eyebrow="ASSESSMENTS" title="All quizzes" description="Monitor every assessment created in your institution." />
    <div className="table-card"><div className="table-heading"><div><h3>Quiz directory</h3><p>{quizzes.length} quizzes across all classes</p></div></div>
      {quizzes.length ? <div className="table-scroll"><table><thead><tr><th>Quiz</th><th>Subject</th><th>Teacher</th><th>Questions</th><th>Schedule</th><th>Status</th></tr></thead><tbody>{quizzes.map(quiz => <tr key={quiz._id}><td><strong>{quiz.title}</strong></td><td>{quiz.subjectId?.name || '—'}</td><td>{quiz.teacherId?.name || '—'}</td><td>{quiz.questions.length}</td><td>{quiz.startsAt ? new Date(quiz.startsAt).toLocaleString() : 'Anytime'}{quiz.endsAt ? ` – ${new Date(quiz.endsAt).toLocaleString()}` : ''}</td><td><span className={`result-badge ${quiz.status === 'published' ? 'passed' : 'pending'}`}>{capitalize(quiz.status)}</span></td></tr>)}</tbody></table></div> : <EmptyState title="No assessments yet" text="Teacher-created quizzes will appear here." />}
    </div>
  </>
}

function AdminResults({ quizzes, onError }: Parameters<typeof PageContent>[0]) {
  const [quizId, setQuizId] = useState('')
  const [attempts, setAttempts] = useState<Attempt[]>([])
  const [loading, setLoading] = useState(false)
  const quiz = quizzes.find(item => item._id === quizId)
  useEffect(() => {
    if (!quizId) { setAttempts([]); return }
    setLoading(true)
    api<Attempt[]>(`/quizzes/${quizId}/attempts`)
      .then(setAttempts)
      .catch(error => onError(getError(error)))
      .finally(() => setLoading(false))
  }, [quizId, onError])
  return <>
    <PageHeading eyebrow="REPORTING" title="Results & reports" description="Review quiz submissions across teachers and classes." />
    <div className="report-filter"><label>Select a quiz<select value={quizId} onChange={event => setQuizId(event.target.value)}><option value="">Choose an assessment…</option>{quizzes.map(item => <option key={item._id} value={item._id}>{item.title} · {item.subjectId?.name}</option>)}</select></label>{quiz && <button className="button button-ghost button-small" onClick={() => downloadCsv(quiz.title, attempts)}>↓ Export CSV</button>}</div>
    {quiz && <div className="table-card"><div className="table-heading"><div><h3>{quiz.title}</h3><p>{attempts.filter(attempt => attempt.submittedAt).length} submitted attempts</p></div></div>{loading ? <div className="empty-inline">Loading results…</div> : attempts.length ? <div className="table-scroll"><table><thead><tr><th>Student</th><th>Email</th><th>Submitted</th><th>Score</th><th>Status</th></tr></thead><tbody>{attempts.map(attempt => {
      const total = quiz.questions.reduce((sum, question) => sum + question.marks, 0)
      const score = attempt.obtainedMarks ?? 0
      return <tr key={attempt._id}><td>{attempt.studentId?.name || 'Student'}</td><td>{attempt.studentId?.email || '—'}</td><td>{attempt.submittedAt ? new Date(attempt.submittedAt).toLocaleString() : 'In progress'}</td><td>{attempt.submittedAt ? `${score} / ${total} (${total ? Math.round(score / total * 100) : 0}%)` : '—'}</td><td>{attempt.submittedAt ? score >= quiz.passingMarks ? 'Passed' : 'Below pass mark' : 'In progress'}</td></tr>
    })}</tbody></table></div> : <EmptyState title="No attempts found" text="Student results will appear after a quiz attempt." />}</div>}
  </>
}

function QuestionBankPage({ subjects, onNotice, onError }: Parameters<typeof PageContent>[0]) {
  const [questions, setQuestions] = useState<BankQuestion[]>([])
  const [editing, setEditing] = useState<BankQuestion | null>(null)
  const [busy, setBusy] = useState(false)
  const [difficultyFilter, setDifficultyFilter] = useState('all')
  const [subjectFilter, setSubjectFilter] = useState('all')
  const [questionType, setQuestionType] = useState<'multiple-choice' | 'true-false'>('multiple-choice')
  const [options, setOptions] = useState(['', '', '', ''])
  const [correctOption, setCorrectOption] = useState(0)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      setQuestions(await api<BankQuestion[]>('/question-bank'))
    } catch (error) {
      onError(getError(error))
    } finally {
      setLoading(false)
    }
  }, [onError])
  useEffect(() => { void refresh() }, [refresh])

  async function addQuestion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setBusy(true)
    try {
      await api(editing ? `/question-bank/${editing._id}` : '/question-bank', {
        method: editing ? 'PATCH' : 'POST',
        body: JSON.stringify({
          prompt: form.get('prompt'),
          subjectId: form.get('subjectId'),
          topic: form.get('topic'),
          difficulty: form.get('difficulty'),
          questionType,
          options,
          correctOption,
        }),
      })
      event.currentTarget.reset()
      setQuestionType('multiple-choice')
      setOptions(['', '', '', ''])
      setCorrectOption(0)
      setEditing(null)
      await refresh()
      onNotice(editing ? 'Question changes saved.' : 'Question added to your bank.')
    } catch (error) {
      onError(getError(error))
    } finally {
      setBusy(false)
    }
  }

  async function removeQuestion(question: BankQuestion) {
    if (!window.confirm('Remove this question from your question bank? Existing quizzes are not changed.')) return
    try {
      await api(`/question-bank/${question._id}`, { method: 'DELETE' })
      if (editing?._id === question._id) setEditing(null)
      await refresh()
      onNotice('Question removed from the bank.')
    } catch (error) {
      onError(getError(error))
    }
  }

  const visible = questions.filter(question =>
    (difficultyFilter === 'all' || question.difficulty === difficultyFilter)
    && (subjectFilter === 'all' || question.subjectId?._id === subjectFilter))

  return <>
    <PageHeading eyebrow="REUSABLE CONTENT" title="Question bank" description="Organize reusable questions by subject, topic and difficulty." />
    <div className="bank-layout">
      <form className="subject-form bank-form" key={editing?._id || 'new-question'} onSubmit={addQuestion}>
        <div className="form-section-title"><span>{editing ? '✎' : '＋'}</span><div><h3>{editing ? 'Edit question' : 'Add a question'}</h3><p>Save an item for future quizzes.</p></div></div>
        <label>Question<textarea name="prompt" rows={3} required defaultValue={editing?.prompt} placeholder="Write a clear question…" /></label>
        <label>Subject<select name="subjectId" required defaultValue={editing?.subjectId?._id || ''}><option value="" disabled>Select a subject</option>{subjects.map(subject => <option key={subject._id} value={subject._id}>{subject.name}</option>)}</select></label>
        <label>Topic<input name="topic" defaultValue={editing?.topic} placeholder="e.g. Cell structure" /></label>
        <label>Difficulty<select name="difficulty" defaultValue={editing?.difficulty || 'medium'}><option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option></select></label>
        <label>Type<select value={questionType} onChange={event => { const next = event.target.value as typeof questionType; setQuestionType(next); setOptions(next === 'true-false' ? ['True', 'False'] : ['', '', '', '']); setCorrectOption(0) }}><option value="multiple-choice">Multiple choice</option><option value="true-false">True / False</option></select></label>
        <div className="bank-options"><span>Answer options <small>Select the correct answer</small></span>{options.map((option, index) => <label className={correctOption === index ? 'option-edit correct' : 'option-edit'} key={index}><input type="radio" name="bank-correct-option" checked={correctOption === index} onChange={() => setCorrectOption(index)} aria-label={`Mark option ${index + 1} correct`} /><span>{String.fromCharCode(65 + index)}</span><input value={option} onChange={event => setOptions(current => current.map((value, i) => i === index ? event.target.value : value))} placeholder={`Option ${index + 1}`} required /></label>)}</div>
        <div className="bank-form-actions"><button className="button button-primary" disabled={busy || !subjects.length}>{busy ? 'Saving…' : editing ? 'Save changes' : 'Save question'}</button>{editing && <button type="button" className="button button-ghost" onClick={() => { setEditing(null); setQuestionType('multiple-choice'); setOptions(['', '', '', '']); setCorrectOption(0) }}>Cancel</button>}</div>
      </form>
      <div className="bank-list-panel"><div className="table-heading"><div><h3>Saved questions</h3><p>{visible.length} of {questions.length} questions</p></div></div>
        <div className="bank-filters"><select value={subjectFilter} onChange={event => setSubjectFilter(event.target.value)}><option value="all">All subjects</option>{subjects.map(subject => <option key={subject._id} value={subject._id}>{subject.name}</option>)}</select><select value={difficultyFilter} onChange={event => setDifficultyFilter(event.target.value)}><option value="all">All difficulty</option><option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option></select></div>
        {loading ? <div className="empty-inline">Loading question bank…</div> : visible.length ? <div className="bank-question-list">{visible.map(question => <article className="bank-question" key={question._id}><div className="bank-question-head"><div className="bank-tags"><span className="subject-pill">{question.subjectId?.code}</span><span className={`difficulty-tag ${question.difficulty}`}>{capitalize(question.difficulty)}</span><span className="type-tag">{question.questionType === 'true-false' ? 'True / False' : 'Multiple choice'}</span></div><div className="bank-actions"><button className="table-link" onClick={() => { setEditing(question); setQuestionType(question.questionType); setOptions([...question.options]); setCorrectOption(question.correctOption) }}>Edit</button><button className="icon-button" title="Delete question" onClick={() => void removeQuestion(question)}>×</button></div></div><h4>{question.prompt}</h4><div className="bank-answer-options">{question.options.map((option, index) => <span className={index === question.correctOption ? 'bank-answer correct' : 'bank-answer'} key={index}>{String.fromCharCode(65 + index)}. {option}{index === question.correctOption && ' ✓'}</span>)}</div>{question.topic && <small className="bank-topic">{question.topic}</small>}</article>)}</div> : <EmptyState title="No saved questions found" text="Add questions here to reuse them in future quizzes." />}
      </div>
    </div>
  </>
}

function TeacherResults(props: Parameters<typeof PageContent>[0]) {
  return <>
    <PageHeading eyebrow="PERFORMANCE" title="Class results" description="Track submissions and open an assessment to review scores." />
    <div className="table-card"><div className="table-heading"><div><h3>Quiz performance</h3><p>{props.quizzes.length} assessments</p></div></div>
      {props.quizzes.length ? <div className="table-scroll"><table><thead><tr><th>Quiz</th><th>Subject</th><th>Questions</th><th>Duration</th><th>Status</th><th></th></tr></thead><tbody>{props.quizzes.map(quiz => <tr key={quiz._id}><td><strong>{quiz.title}</strong></td><td>{quiz.subjectId?.name}</td><td>{quiz.questions.length}</td><td>{quiz.durationMinutes} min</td><td><span className={`result-badge ${quiz.status === 'published' ? 'passed' : 'pending'}`}>{capitalize(quiz.status)}</span></td><td><button className="table-link" onClick={() => props.onSelectView('quizzes')}>Open quizzes →</button></td></tr>)}</tbody></table></div> : <EmptyState title="No quizzes to report on" text="Create and publish an assessment to see class performance." />}
    </div>
  </>
}

function StudentResults({ attempts }: Parameters<typeof PageContent>[0]) {
  const completed = attempts.filter(attempt => attempt.submittedAt)
  return <>
    <PageHeading eyebrow="YOUR PROGRESS" title="My results" description="Every attempt is a chance to learn a little more." />
    <div className="result-summary"><div><span>Completed quizzes</span><strong>{completed.length}</strong></div><div><span>Average score</span><strong>{completed.length ? `${Math.round(completed.reduce((sum, item) => { const total = item.quizId?.questions.reduce((quizSum, question) => quizSum + question.marks, 0) || 0; return sum + (total ? (item.obtainedMarks || 0) / total * 100 : 0) }, 0) / completed.length)}%` : '—'}</strong></div><div><span>In progress</span><strong>{attempts.length - completed.length}</strong></div></div>
    <div className="table-card"><div className="table-heading"><div><h3>Attempt history</h3><p>Your submitted quizzes and scores.</p></div></div>
      {attempts.length ? <div className="table-scroll"><table><thead><tr><th>Quiz</th><th>Subject</th><th>Date</th><th>Score</th><th>Status</th></tr></thead><tbody>{attempts.map(attempt => {
        const quiz = attempt.quizId
        const total = quiz?.questions.reduce((sum, question) => sum + question.marks, 0) || 0
        return <tr key={attempt._id}><td><strong>{quiz?.title || 'Quiz'}</strong></td><td>{quiz?.subjectId?.name || '—'}</td><td>{attempt.submittedAt ? new Date(attempt.submittedAt).toLocaleDateString() : 'In progress'}</td><td>{attempt.submittedAt ? `${attempt.obtainedMarks} / ${total} (${total ? Math.round((attempt.obtainedMarks || 0) / total * 100) : 0}%)` : '—'}</td><td><span className={`result-badge ${attempt.submittedAt ? 'passed' : 'pending'}`}>{attempt.submittedAt ? 'Submitted' : 'In progress'}</span></td></tr>
      })}</tbody></table></div> : <EmptyState title="Your story starts with your first quiz" text="Completed quizzes and results will show up here." />}
    </div>
  </>
}

function PeoplePage({ users, subjects, onRefresh, onNotice, onError }: Parameters<typeof PageContent>[0]) {
  const [showForm, setShowForm] = useState(false)
  const [busy, setBusy] = useState(false)
  async function createUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setBusy(true)
    try {
      await api('/users', { method: 'POST', body: JSON.stringify({
        name: form.get('name'), email: form.get('email'), password: form.get('password'),
        role: form.get('role'), subjectIds: form.getAll('subjectIds'),
        department: form.get('department'), semester: form.get('semester'),
      }) })
      await onRefresh()
      setShowForm(false)
      onNotice('Account created successfully.')
    } catch (error) {
      onError(getError(error))
    } finally {
      setBusy(false)
    }
  }
  async function toggleUser(target: User) {
    try {
      await api(`/users/${target._id}`, { method: 'PATCH', body: JSON.stringify({ active: !target.active }) })
      await onRefresh()
      onNotice(`${target.name}’s account is now ${target.active ? 'inactive' : 'active'}.`)
    } catch (error) {
      onError(getError(error))
    }
  }
  return <>
    <PageHeading eyebrow="DIRECTORY" title="People" description="Manage account access across your institution." action={<button className="button button-primary" onClick={() => setShowForm(value => !value)}>{showForm ? '× Cancel' : '＋ Add person'}</button>} />
    {showForm && <form className="inline-form user-create-form" onSubmit={createUser}><div className="inline-form-title"><h3>Create an account</h3><p>Set up a teacher, student or administrator.</p></div>
      <label>Full name<input name="name" required placeholder="Full name" /></label><label>Email<input name="email" required type="email" placeholder="name@school.edu" /></label><label>Temporary password<input name="password" required type="password" minLength={8} placeholder="At least 8 characters" /></label><label>Role<select name="role" defaultValue="student"><option value="student">Student</option><option value="teacher">Teacher</option><option value="admin">Admin</option></select></label>
      <label>Department<input name="department" placeholder="e.g. Computer Science" /></label><label>Semester<input name="semester" placeholder="e.g. Semester 1" /></label>
      <label className="field-span">Subjects for this student <select name="subjectIds" multiple size={Math.min(subjects.length || 2, 4)}>{subjects.map(subject => <option key={subject._id} value={subject._id}>{subject.name}</option>)}</select><small>Optional. Hold Ctrl to select multiple.</small></label>
      <button className="button button-primary" disabled={busy}>{busy ? 'Creating…' : 'Create account'}</button>
    </form>}
    <div className="table-card"><div className="table-heading"><div><h3>All accounts</h3><p>{users.length} people in your workspace</p></div><div className="role-legend"><span><i className="legend-dot admin-dot" /> Admin</span><span><i className="legend-dot teacher-dot" /> Teacher</span><span><i className="legend-dot student-dot" /> Student</span></div></div>
      <div className="table-scroll"><table><thead><tr><th>Person</th><th>Role</th><th>Department / semester</th><th>Subjects</th><th>Status</th><th></th></tr></thead><tbody>{users.map(person => <tr key={person._id}><td><div className="table-user"><div className="user-avatar tiny">{initials(person.name)}</div><div><strong>{person.name}</strong><small>{person.email}</small></div></div></td><td><span className={`role-pill ${person.role}`}>{capitalize(person.role)}</span></td><td>{[person.department, person.semester].filter(Boolean).join(' · ') || '—'}</td><td>{person.role === 'student' ? <StudentSubjectEditor key={`${person._id}-${person.subjectIds?.map(subject => subject._id).join(',') || ''}`} person={person} subjects={subjects} onUpdated={onRefresh} onNotice={onNotice} onError={onError} /> : '—'}</td><td><span className={`account-status ${person.active ? 'active' : 'inactive'}`}><i />{person.active ? 'Active' : 'Inactive'}</span></td><td><button className="table-link" onClick={() => void toggleUser(person)}>{person.active ? 'Deactivate' : 'Activate'}</button></td></tr>)}</tbody></table></div>
    </div>
  </>
}

function StudentSubjectEditor({ person, subjects, onUpdated, onNotice, onError }: {
  person: User
  subjects: Subject[]
  onUpdated: () => Promise<void>
  onNotice: (message: string) => void
  onError: (message: string) => void
}) {
  const [selectedIds, setSelectedIds] = useState((person.subjectIds || []).map(subject => subject._id))
  const [busy, setBusy] = useState(false)
  async function save() {
    setBusy(true)
    try {
      await api(`/users/${person._id}`, { method: 'PATCH', body: JSON.stringify({ subjectIds: selectedIds }) })
      await onUpdated()
      onNotice(`Subjects updated for ${person.name}.`)
    } catch (error) {
      onError(getError(error))
    } finally {
      setBusy(false)
    }
  }
  return <div className="subject-assignment"><select multiple size={2} value={selectedIds} onChange={event => setSelectedIds(Array.from(event.target.selectedOptions, option => option.value))} aria-label={`Subjects assigned to ${person.name}`}>{subjects.map(subject => <option key={subject._id} value={subject._id}>{subject.code}</option>)}</select><button className="table-link" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save'}</button></div>
}

function SubjectsPage({ subjects, onRefresh, onNotice, onError }: Parameters<typeof PageContent>[0]) {
  const [busy, setBusy] = useState(false)
  async function addSubject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setBusy(true)
    try {
      await api('/subjects', { method: 'POST', body: JSON.stringify({ name: form.get('name'), code: form.get('code'), semester: form.get('semester'), department: form.get('department') }) })
      event.currentTarget.reset()
      await onRefresh()
      onNotice('Subject added to your catalog.')
    } catch (error) {
      onError(getError(error))
    } finally {
      setBusy(false)
    }
  }
  async function removeSubject(subject: Subject) {
    if (!window.confirm(`Remove ${subject.name} from the catalog? Existing quizzes will retain their subject record.`)) return
    try {
      await api(`/subjects/${subject._id}`, { method: 'DELETE' })
      await onRefresh()
      onNotice('Subject removed.')
    } catch (error) {
      onError(getError(error))
    }
  }
  return <>
    <PageHeading eyebrow="ACADEMIC CATALOG" title="Subjects" description="Keep your courses and class structure organized." />
    <div className="subject-layout"><form className="subject-form" onSubmit={addSubject}><div className="form-section-title"><span>＋</span><div><h3>Add a subject</h3><p>Build your institution’s course catalog.</p></div></div><label>Subject name<input name="name" required placeholder="e.g. Computer Science" /></label><label>Subject code<input name="code" required placeholder="e.g. CS101" /></label><label>Department <input name="department" placeholder="e.g. Computing" /></label><label>Semester <input name="semester" placeholder="e.g. Semester 1" /></label><button className="button button-primary" disabled={busy}>{busy ? 'Adding…' : 'Add subject'}</button></form>
      <div className="subject-list-panel"><div className="table-heading"><div><h3>Course catalog</h3><p>{subjects.length} subjects</p></div></div>{subjects.length ? <div className="subject-list">{subjects.map(subject => <div className="subject-row" key={subject._id}><div className="subject-icon">{subject.code.slice(0, 2)}</div><div><strong>{subject.name}</strong><span>{subject.code}{subject.department ? ` · ${subject.department}` : ''}{subject.semester ? ` · ${subject.semester}` : ''}</span></div><button className="icon-button remove-subject" title={`Remove ${subject.name}`} onClick={() => void removeSubject(subject)}>×</button></div>)}</div> : <EmptyState title="No subjects yet" text="Add the first subject to start building your catalog." />}</div>
    </div>
  </>
}

function QuizRunner({ session, onExit, onSubmit }: { session: QuizSession; onExit: () => void; onSubmit: () => Promise<void> }) {
  const { attempt, quiz } = session
  const [responses, setResponses] = useState<Record<string, number>>(() => Object.fromEntries(attempt.responses.map(response => [response.questionId, response.selectedOption])))
  const [current, setCurrent] = useState(0)
  const [remaining, setRemaining] = useState(Math.max(0, new Date(attempt.expiresAt).getTime() - Date.now()))
  const [saving, setSaving] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [saveError, setSaveError] = useState('')
  const submitted = useRef(false)
  const saveQueue = useRef<Promise<void>>(Promise.resolve())
  const currentQuestion = quiz.questions[current]
  const questionId = currentQuestion?._id || ''
  const answered = useMemo(() => Object.keys(responses).length, [responses])

  useEffect(() => {
    const timer = window.setInterval(() => setRemaining(Math.max(0, new Date(attempt.expiresAt).getTime() - Date.now())), 1000)
    return () => window.clearInterval(timer)
  }, [attempt.expiresAt])

  const saveResponses = useCallback(async (values: Record<string, number>) => {
    const request = saveQueue.current.then(async () => {
      setSaving(true)
      setSaveError('')
      try {
        await api(`/attempts/${attempt._id}/responses`, {
          method: 'PUT',
          body: JSON.stringify({ responses: Object.entries(values).map(([id, selectedOption]) => ({ questionId: id, selectedOption })) }),
        })
      } catch (error) {
        setSaveError(getError(error))
      } finally {
        setSaving(false)
      }
    })
    saveQueue.current = request
    await request
  }, [attempt._id])

  useEffect(() => {
    if (!Object.keys(responses).length) return
    const timeout = window.setTimeout(() => void saveResponses(responses), 450)
    return () => window.clearTimeout(timeout)
  }, [responses, saveResponses])

  useEffect(() => {
    if (remaining > 0 || submitted.current) return
    submitted.current = true
    setSubmitting(true)
    void saveResponses(responses).then(onSubmit).catch(() => { submitted.current = false }).finally(() => setSubmitting(false))
  }, [remaining, onSubmit, responses, saveResponses])

  function selectAnswer(option: number) {
    setResponses(value => ({ ...value, [questionId]: option }))
  }

  async function submit() {
    if (submitted.current || submitting) return
    submitted.current = true
    setSubmitting(true)
    try {
      await saveResponses(responses)
      await onSubmit()
    } catch {
      submitted.current = false
    } finally {
      setSubmitting(false)
    }
  }

  const minutes = Math.floor(remaining / 60_000)
  const seconds = Math.floor((remaining % 60_000) / 1000)
  if (submitting) return <div className="submit-screen"><div className="submit-check">✓</div><h1>Submitting your quiz…</h1><p>Your answers are being saved and scored.</p></div>

  return <main className="quiz-runner">
    <header className="runner-topbar"><a className="brand" href="#" onClick={event => event.preventDefault()}><span className="brand-mark">Q</span> quizly</a><div className="runner-title"><span>{quiz.subjectId?.name}</span><strong>{quiz.title}</strong></div><div className={remaining < 60_000 ? 'timer urgent' : 'timer'}><span>◷</span><div><small>TIME REMAINING</small><strong>{String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')}</strong></div></div></header>
    <div className="runner-layout">
      <aside className="question-sidebar"><div className="question-nav-title"><div><strong>Questions</strong><span>{answered} of {quiz.questions.length} answered</span></div><span className="progress-count">{answered}/{quiz.questions.length}</span></div><div className="question-nav-grid">{quiz.questions.map((question, index) => <button key={question._id || index} onClick={() => setCurrent(index)} className={`${index === current ? 'current ' : ''}${responses[question._id || ''] !== undefined ? 'answered' : ''}`}>{String(index + 1).padStart(2, '0')}</button>)}</div><div className="runner-legend"><span><i className="legend-current" />Current</span><span><i className="legend-answered" />Answered</span><span><i className="legend-unanswered" />Unanswered</span></div><div className="save-indicator"><span className={saveError ? 'save-dot failed' : 'save-dot'} />{saveError || (saving ? 'Saving your answers…' : 'Your progress is saved automatically')}</div></aside>
      <section className="question-stage"><div className="question-stage-top"><span className="eyebrow">{quiz.subjectId?.code || 'QUIZ'} · QUESTION {String(current + 1).padStart(2, '0')} OF {quiz.questions.length}</span><span className="marks-tag">{currentQuestion?.marks} {currentQuestion?.marks === 1 ? 'mark' : 'marks'}</span></div><div className="question-content"><h1>{currentQuestion?.prompt}</h1><p>Choose one answer from the options below.</p><div className="answer-options">{currentQuestion?.options.map((option, index) => <button key={index} className={responses[questionId] === index ? 'answer-option selected' : 'answer-option'} onClick={() => selectAnswer(index)}><span className="answer-letter">{String.fromCharCode(65 + index)}</span><span>{option}</span><span className="answer-radio">{responses[questionId] === index && <i />}</span></button>)}</div></div><div className="question-controls"><button className="button button-ghost" disabled={current === 0} onClick={() => setCurrent(value => value - 1)}>← Previous</button><span>{saving ? 'Saving…' : 'Answers save automatically'}</span>{current < quiz.questions.length - 1 ? <button className="button button-primary" onClick={() => setCurrent(value => value + 1)}>Next question <span>→</span></button> : <button className="button button-primary" onClick={() => void submit()}>Submit quiz <span>→</span></button>}</div></section>
    </div>
    <div className="runner-bottom"><button className="exit-quiz" onClick={() => window.confirm('Leave this quiz? Your saved progress will be available when you return.') && onExit()}>← Leave quiz</button><button className="finish-link" onClick={() => void submit()}>Finish quiz and submit →</button></div>
  </main>
}

function PageHeading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: ReactNode }) {
  return <div className="page-heading"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>{action}</div>
}

function EmptyState({ title, text, action, onAction }: { title: string; text: string; action?: string; onAction?: () => void }) {
  return <div className="empty-state"><div className="empty-icon">✳</div><h3>{title}</h3><p>{text}</p>{action && onAction && <button className="button button-primary button-small" onClick={onAction}>{action} <span>→</span></button>}</div>
}

function downloadCsv(title: string, attempts: Attempt[]) {
  const rows = [['Student', 'Email', 'Submitted at', 'Score']]
  attempts.forEach(attempt => rows.push([
    attempt.studentId?.name || '',
    attempt.studentId?.email || '',
    attempt.submittedAt ? new Date(attempt.submittedAt).toISOString() : 'In progress',
    attempt.obtainedMarks === null ? '' : String(attempt.obtainedMarks),
  ]))
  const csv = rows.map(row => row.map(value => `"${value.replaceAll('"', '""')}"`).join(',')).join('\r\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-results.csv`
  link.click()
  URL.revokeObjectURL(url)
}

function initials(name: string) {
  return name.split(/\s+/).map(part => part[0]).join('').slice(0, 2).toUpperCase()
}

function capitalize(value: Role | string) {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function toLocalInput(value?: string | null) {
  if (!value) return ''
  const date = new Date(value)
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}

export default App
