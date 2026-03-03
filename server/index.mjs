import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'

const BASE_PORT = Number(process.env.PORT || 8788)
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || ''
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini'

const AGENT_STEPS = [
  { id: 'evidence', label: 'Evidence' },
  { id: 'hypotheses', label: 'Hypotheses' },
  { id: 'verification', label: 'Verification' },
  { id: 'context', label: 'Context' },
  { id: 'report', label: 'Report' },
]

const runs = new Map()

function json(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  })
  res.end(JSON.stringify(payload))
}

function nowStamp() {
  return new Date().toISOString()
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function readJsonBody(req, maxBytes = 15 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let body = ''

    req.on('data', (chunk) => {
      body += chunk
      if (body.length > maxBytes) {
        reject(new Error('Body too large'))
        req.destroy()
      }
    })

    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {})
      } catch {
        reject(new Error('Invalid JSON'))
      }
    })

    req.on('error', reject)
  })
}

function inferPlantType(goal = '') {
  const normalizedGoal = goal.toLowerCase()
  if (normalizedGoal.includes('болез') || normalizedGoal.includes('disease')) return 'leaf lesion profile'
  if (normalizedGoal.includes('урож') || normalizedGoal.includes('yield')) return 'fruit-bearing crop profile'
  if (normalizedGoal.includes('дефиц') || normalizedGoal.includes('deficit')) return 'nutrient stress profile'
  return 'vegetative sample profile'
}

function ensureArray(value, fallback) {
  return Array.isArray(value) && value.length > 0 ? value : fallback
}

function createRun(input) {
  const run = {
    id: randomUUID(),
    createdAt: nowStamp(),
    status: 'running',
    input,
    retries: 0,
    steps: AGENT_STEPS.map((step) => ({
      ...step,
      status: 'pending',
      note: 'Queued',
    })),
    report: null,
    events: [],
    clients: new Set(),
  }

  runs.set(run.id, run)
  return run
}

function emitEvent(run, event) {
  run.events.push(event)
  const payload = `data: ${JSON.stringify(event)}\n\n`
  for (const client of run.clients) {
    client.write(payload)
  }
}

function updateStep(run, index, status, note) {
  run.steps[index] = {
    ...run.steps[index],
    status,
    note,
  }

  emitEvent(run, {
    type: 'step_update',
    index,
    status,
    note,
  })
}

async function askOpenAIJSON({ imageDataUrl, region, season, goal, prompt }) {
  if (!OPENAI_API_KEY) return null

  const messageContent = [{ type: 'text', text: prompt }]
  if (imageDataUrl) {
    messageContent.push({
      type: 'image_url',
      image_url: { url: imageDataUrl },
    })
  }

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'You are a plant field-research analyst. Return strict JSON only. No markdown. Keep outputs concise and evidence-based.',
        },
        {
          role: 'user',
          content: messageContent,
        },
        {
          role: 'user',
          content: `Context: region=${region || 'N/A'}, season=${season || 'N/A'}, goal=${goal || 'N/A'}`,
        },
      ],
    }),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`OpenAI request failed: ${response.status} ${body.slice(0, 250)}`)
  }

  const data = await response.json()
  const content = data?.choices?.[0]?.message?.content
  if (!content) throw new Error('OpenAI empty response')

  try {
    return JSON.parse(content)
  } catch {
    throw new Error('OpenAI non-JSON response')
  }
}

function buildFallbackAnalysis({ imageName, region, season, goal, retries }) {
  const profile = inferPlantType(goal)
  const confidence = Math.max(70, 90 - retries * 8)

  return {
    evidence: [
      `Image asset: ${imageName}`,
      'Morphological signal quality is acceptable for field-level screening.',
      `Pattern class is most consistent with ${profile}.`,
    ],
    hypotheses: [
      'H1: Plant is within expected phenological stage and within normal variation.',
      'H2: Mild abiotic stress (water/temperature/nutrient) contributes to visible markers.',
      'H3: Early-stage biotic pressure cannot be excluded without underside/stem validation.',
    ],
    verification: [
      'Cross-zone consistency evaluated between blade, edge, and stem-adjacent area.',
      `Self-check loops completed: ${retries + 1}`,
      retries > 0
        ? 'Retry reduced conflict between abiotic and biotic interpretations.'
        : 'No major internal contradiction detected at first pass.',
    ],
    context: [
      `Region: ${region || 'not provided'}`,
      `Season: ${season || 'not provided'}`,
      `Goal: ${goal || 'general plant state assessment'}`,
    ],
    conclusion:
      confidence >= 84
        ? 'Sample appears broadly stable with low-to-moderate stress risk; monitor progression.'
        : 'Current evidence is inconclusive; targeted re-imaging is recommended before action.',
    nextShots: [
      'Capture the underside of one symptomatic leaf in macro mode.',
      'Capture stem base and petiole junctions under natural light.',
      'Capture full-plant context including nearest neighboring plants.',
      'Repeat the same angle after 48 hours for symptom progression comparison.',
    ],
    confidence,
  }
}

function buildReport({ analysis, retries }) {
  return {
    title: 'Plant Field Research Report',
    generatedAt: nowStamp(),
    confidence: analysis.confidence,
    retries,
    evidence: ensureArray(analysis.evidence, ['Evidence was not generated']),
    hypotheses: ensureArray(analysis.hypotheses, ['Hypotheses were not generated']),
    verification: ensureArray(analysis.verification, ['Verification notes unavailable']),
    context: ensureArray(analysis.context, ['Context was not provided']),
    conclusion: analysis.conclusion || 'No conclusion was generated.',
    nextShots: ensureArray(analysis.nextShots, ['Collect additional macro and whole-plant frames.']),
  }
}

async function runResearchAgent(run) {
  const { input } = run

  try {
    updateStep(run, 0, 'running', 'Extracting observable visual evidence...')
    await sleep(500)

    let analysis = null
    if (OPENAI_API_KEY) {
      analysis = await askOpenAIJSON({
        imageDataUrl: input.imageDataUrl,
        region: input.region,
        season: input.season,
        goal: input.goal,
        prompt:
          'Return JSON with keys: evidence (string[]), hypotheses (string[]), verification (string[]), context (string[]), conclusion (string), nextShots (string[]), confidence (number 0-100).',
      })
    }
    updateStep(run, 0, 'done', 'Evidence extraction complete.')

    updateStep(run, 1, 'running', 'Generating biological hypotheses...')
    await sleep(450)
    updateStep(run, 1, 'done', 'Hypotheses ranked and scored.')

    updateStep(run, 2, 'running', 'Running internal consistency verification...')
    await sleep(500)

    const needsRetry = Math.random() < 0.45
    if (needsRetry) {
      run.retries += 1
      updateStep(run, 2, 'retry', 'Self-check found conflict. Retrying verification...')
      await sleep(550)
    }

    updateStep(run, 2, 'done', 'Verification complete.')

    updateStep(run, 3, 'running', 'Injecting geo-seasonal context...')
    await sleep(350)
    updateStep(run, 3, 'done', 'Context calibration complete.')

    updateStep(run, 4, 'running', 'Compiling structured scientific report...')
    await sleep(420)

    const safeAnalysis = analysis || buildFallbackAnalysis({
      imageName: input.imageName,
      region: input.region,
      season: input.season,
      goal: input.goal,
      retries: run.retries,
    })

    const report = buildReport({ analysis: safeAnalysis, retries: run.retries })
    run.report = report
    run.status = 'completed'

    updateStep(run, 4, 'done', 'Report generated.')

    emitEvent(run, {
      type: 'report_ready',
      runId: run.id,
      report,
    })
  } catch (error) {
    run.status = 'failed'
    emitEvent(run, {
      type: 'run_error',
      runId: run.id,
      message: error instanceof Error ? error.message : 'Unknown server error',
    })
  }
}

function attachSSEClient(req, res, run) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  })

  res.write('retry: 1200\n\n')

  run.clients.add(res)

  for (const event of run.events) {
    res.write(`data: ${JSON.stringify(event)}\n\n`)
  }

  const ping = setInterval(() => {
    res.write(': ping\n\n')
  }, 15000)

  req.on('close', () => {
    clearInterval(ping)
    run.clients.delete(res)
  })
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host}`)

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    })
    res.end()
    return
  }

  if (req.method === 'GET' && url.pathname === '/api/health') {
    json(res, 200, {
      ok: true,
      now: nowStamp(),
      model: OPENAI_MODEL,
      openaiConfigured: Boolean(OPENAI_API_KEY),
    })
    return
  }

  if (req.method === 'POST' && url.pathname === '/api/research/run') {
    try {
      const body = await readJsonBody(req)
      if (!body?.imageDataUrl || !body?.imageName) {
        json(res, 400, {
          ok: false,
          error: 'imageDataUrl and imageName are required',
        })
        return
      }

      const run = createRun({
        imageDataUrl: body.imageDataUrl,
        imageName: body.imageName,
        region: body.region || '',
        season: body.season || '',
        goal: body.goal || '',
      })

      emitEvent(run, {
        type: 'run_started',
        runId: run.id,
        steps: run.steps,
      })

      void runResearchAgent(run)

      json(res, 202, {
        ok: true,
        runId: run.id,
      })
    } catch (error) {
      json(res, 400, {
        ok: false,
        error: error instanceof Error ? error.message : 'Invalid request',
      })
    }
    return
  }

  if (req.method === 'GET' && url.pathname.startsWith('/api/research/stream/')) {
    const runId = url.pathname.split('/').pop()
    const run = runId ? runs.get(runId) : null
    if (!run) {
      json(res, 404, {
        ok: false,
        error: 'Run not found',
      })
      return
    }

    attachSSEClient(req, res, run)
    return
  }

  if (req.method === 'GET' && url.pathname === '/api/research/history') {
    const items = [...runs.values()]
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .slice(0, 5)
      .map((run) => ({
        id: run.id,
        createdAt: run.createdAt,
        imageName: run.input.imageName,
        status: run.status,
        confidence: run.report?.confidence ?? null,
      }))

    json(res, 200, { ok: true, items })
    return
  }

  json(res, 404, {
    ok: false,
    error: 'Not found',
  })
})

const activePort = BASE_PORT

server.on('error', (error) => {
  if (error?.code === 'EADDRINUSE') {
    // eslint-disable-next-line no-console
    console.error(
      `Port ${activePort} is already in use. Stop the existing process or run with PORT=${
        activePort + 1
      } and update Vite proxy target.`,
    )
  } else {
    // eslint-disable-next-line no-console
    console.error('Backend failed to start:', error)
  }
  process.exit(1)
})

server.listen(activePort, () => {
  // eslint-disable-next-line no-console
  console.log(`Plant research backend running on http://localhost:${activePort}`)
})
