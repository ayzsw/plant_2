import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'

const AGENT_STEPS = [
  { id: 'evidence', label: 'Evidence', detail: 'Сбор наблюдаемых признаков с изображения' },
  { id: 'hypotheses', label: 'Hypotheses', detail: 'Формирование кандидатов вида/болезни/дефицита' },
  { id: 'verification', label: 'Verification', detail: 'Проверка гипотез на внутренних критериях' },
  { id: 'context', label: 'Context', detail: 'Учет региона, сезона и цели исследования' },
  { id: 'report', label: 'Report', detail: 'Сборка итогового научного отчета' },
]

function toMarkdown(report) {
  if (!report) return ''

  const listSection = (title, items) => `## ${title}\n${items.map((item) => `- ${item}`).join('\n')}`

  return [
    `# ${report.title}`,
    `Generated: ${report.generatedAt}`,
    `Confidence: ${report.confidence}%`,
    '',
    listSection('Evidence', report.evidence),
    '',
    listSection('Hypotheses', report.hypotheses),
    '',
    listSection('Verification', report.verification),
    '',
    listSection('Context', report.context),
    '',
    '## Conclusion',
    report.conclusion,
    '',
    listSection('What to Photograph Next', report.nextShots),
    '',
  ].join('\n')
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(new Error('Unable to read image'))
    reader.readAsDataURL(file)
  })
}

function App() {
  const [imageFile, setImageFile] = useState(null)
  const [imagePreview, setImagePreview] = useState('')
  const [region, setRegion] = useState('')
  const [season, setSeason] = useState('')
  const [goal, setGoal] = useState('')

  const [running, setRunning] = useState(false)
  const [currentStep, setCurrentStep] = useState(-1)
  const [runError, setRunError] = useState('')
  const [stepStates, setStepStates] = useState(() =>
    AGENT_STEPS.map((step) => ({
      ...step,
      status: 'pending',
      note: 'Ожидает запуска',
    })),
  )
  const [report, setReport] = useState(null)
  const [history, setHistory] = useState(() => {
    const saved = localStorage.getItem('plantiz-history-v1')
    if (!saved) return []
    try {
      return JSON.parse(saved)
    } catch {
      return []
    }
  })

  const eventSourceRef = useRef(null)

  const progress = useMemo(() => {
    const done = stepStates.filter((step) => step.status === 'done').length
    return Math.round((done / AGENT_STEPS.length) * 100)
  }, [stepStates])

  const updateStep = (index, patch) => {
    setStepStates((prev) =>
      prev.map((step, i) => {
        if (i !== index) return step
        return { ...step, ...patch }
      }),
    )
  }

  const onFileChange = (event) => {
    const file = event.target.files?.[0]
    if (!file) return

    if (imagePreview) URL.revokeObjectURL(imagePreview)
    setImageFile(file)
    setImagePreview(URL.createObjectURL(file))
  }

  useEffect(() => {
    return () => {
      if (imagePreview) URL.revokeObjectURL(imagePreview)
      if (eventSourceRef.current) eventSourceRef.current.close()
    }
  }, [imagePreview])

  const storeHistory = (entry) => {
    setHistory((prev) => {
      const next = [entry, ...prev].slice(0, 5)
      localStorage.setItem('plantiz-history-v1', JSON.stringify(next))
      return next
    })
  }

  const resetRunState = () => {
    setRunError('')
    setReport(null)
    setCurrentStep(-1)
    setStepStates(
      AGENT_STEPS.map((step) => ({
        ...step,
        status: 'pending',
        note: 'Ожидает запуска',
      })),
    )
  }

  const connectRunStream = (runId) => {
    if (eventSourceRef.current) eventSourceRef.current.close()

    const source = new EventSource(`/api/research/stream/${runId}`)
    eventSourceRef.current = source

    source.onmessage = (event) => {
      const payload = JSON.parse(event.data)

      if (payload.type === 'step_update') {
        setCurrentStep(payload.status === 'done' ? -1 : payload.index)
        updateStep(payload.index, {
          status: payload.status,
          note: payload.note,
        })
        return
      }

      if (payload.type === 'report_ready') {
        setReport(payload.report)
        setRunning(false)
        setCurrentStep(-1)
        source.close()
        eventSourceRef.current = null

        storeHistory({
          id: payload.runId,
          at: payload.report.generatedAt,
          imageName: imageFile?.name || 'unknown',
          confidence: payload.report.confidence,
          region: region || 'N/A',
          season: season || 'N/A',
        })
        return
      }

      if (payload.type === 'run_error') {
        setRunError(payload.message || 'Ошибка сервера во время анализа')
        setRunning(false)
        setCurrentStep(-1)
        source.close()
        eventSourceRef.current = null
      }
    }

    source.onerror = () => {
      if (!running) return
      setRunError('Потеряно соединение с сервером (SSE stream).')
      setRunning(false)
      setCurrentStep(-1)
      source.close()
      eventSourceRef.current = null
    }
  }

  const runAgent = async () => {
    if (!imageFile || running) return

    resetRunState()
    setRunning(true)

    try {
      const imageDataUrl = await fileToDataUrl(imageFile)

      const response = await fetch('/api/research/run', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          imageDataUrl,
          imageName: imageFile.name,
          region,
          season,
          goal,
        }),
      })

      const data = await response.json()
      if (!response.ok || !data.runId) {
        throw new Error(data.error || 'Не удалось запустить агент')
      }

      connectRunStream(data.runId)
    } catch (error) {
      setRunError(error instanceof Error ? error.message : 'Unknown error')
      setRunning(false)
      setCurrentStep(-1)
    }
  }

  const exportMarkdown = () => {
    if (!report) return
    const blob = new Blob([toMarkdown(report)], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)

    const link = document.createElement('a')
    link.href = url
    link.download = `plant-report-${Date.now()}.md`
    link.click()

    URL.revokeObjectURL(url)
  }

  return (
    <main className="page">
      <section className="hero">
        <p className="eyebrow">Multimodal Research Agent</p>
        <h1>Полевые исследования растений</h1>
        <p>
          Загрузите изображение, задайте контекст и запустите агентный анализ по цепочке:
          evidence → hypotheses → verification → context → report.
        </p>
      </section>

      <section className="panel input-panel">
        <h2>Run Setup</h2>
        <div className="upload-wrap">
          <label className="upload-box" htmlFor="image-upload">
            <input id="image-upload" type="file" accept="image/*" onChange={onFileChange} />
            <span>Upload image</span>
            <small>{imageFile ? imageFile.name : 'PNG/JPG/HEIC'}</small>
          </label>
          <div className="preview-box">
            {imagePreview ? <img src={imagePreview} alt="Plant preview" /> : <p>Превью изображения</p>}
          </div>
        </div>

        <div className="inputs-grid">
          <label>
            Region (optional)
            <input
              type="text"
              value={region}
              onChange={(event) => setRegion(event.target.value)}
              placeholder="e.g. California, Central Valley"
            />
          </label>

          <label>
            Season (optional)
            <input
              type="text"
              value={season}
              onChange={(event) => setSeason(event.target.value)}
              placeholder="e.g. Early spring"
            />
          </label>

          <label className="goal-row">
            Goal (optional)
            <input
              type="text"
              value={goal}
              onChange={(event) => setGoal(event.target.value)}
              placeholder="e.g. Detect stress or disease"
            />
          </label>
        </div>

        <div className="actions">
          <button type="button" onClick={runAgent} disabled={!imageFile || running}>
            {running ? 'Agent Running...' : 'Run Agent'}
          </button>
          <span className="progress">Progress: {progress}%</span>
        </div>
        {runError ? <p className="run-error">{runError}</p> : null}
      </section>

      <section className="panel">
        <h2>Agent Timeline</h2>
        <div className="timeline">
          {stepStates.map((step, index) => (
            <article key={step.id} className={`timeline-item ${step.status}`}>
              <header>
                <span>
                  {index + 1}. {step.label}
                </span>
                <strong>
                  {step.status === 'pending' && 'Pending'}
                  {step.status === 'running' && 'Running'}
                  {step.status === 'retry' && 'Self-check retry'}
                  {step.status === 'done' && 'Done'}
                  {step.status === 'failed' && 'Failed'}
                </strong>
              </header>
              <p>{step.detail}</p>
              <small>{step.note}</small>
              {currentStep === index && running ? <div className="live-dot" /> : null}
            </article>
          ))}
        </div>
      </section>

      <section className="panel">
        <h2>Research Report</h2>
        {!report ? (
          <p className="empty">Отчёт появится после завершения запуска агента.</p>
        ) : (
          <div className="report-grid">
            <article className="report-card">
              <h3>Summary</h3>
              <p>
                <strong>Generated:</strong> {report.generatedAt}
              </p>
              <p>
                <strong>Confidence:</strong> {report.confidence}%
              </p>
              <p>
                <strong>Self-check retries:</strong> {report.retries}
              </p>
              <p>{report.conclusion}</p>
            </article>

            <article className="report-card">
              <h3>Evidence</h3>
              <ul>{report.evidence.map((item) => <li key={item}>{item}</li>)}</ul>
            </article>

            <article className="report-card">
              <h3>Hypotheses</h3>
              <ul>{report.hypotheses.map((item) => <li key={item}>{item}</li>)}</ul>
            </article>

            <article className="report-card">
              <h3>Verification</h3>
              <ul>{report.verification.map((item) => <li key={item}>{item}</li>)}</ul>
            </article>

            <article className="report-card">
              <h3>Context</h3>
              <ul>{report.context.map((item) => <li key={item}>{item}</li>)}</ul>
            </article>

            <article className="report-card accent">
              <h3>Что сфоткать ещё</h3>
              <ul>{report.nextShots.map((item) => <li key={item}>{item}</li>)}</ul>
            </article>
          </div>
        )}

        <div className="export-row">
          <button type="button" onClick={exportMarkdown} disabled={!report}>
            Export Markdown
          </button>
          <span>PDF optional: можно добавить через клиентский print-to-pdf.</span>
        </div>
      </section>

      <section className="panel">
        <h2>History (Last 5 Runs)</h2>
        {history.length === 0 ? (
          <p className="empty">История запусков пока пуста.</p>
        ) : (
          <div className="history-list">
            {history.map((item) => (
              <article key={item.id} className="history-item">
                <p>
                  <strong>{item.imageName}</strong>
                </p>
                <p>{item.at}</p>
                <p>Confidence: {item.confidence}%</p>
                <p>
                  {item.region} • {item.season}
                </p>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  )
}

export default App
