// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { importFromApp } from './sheets.jsx'
import { fmtDateRange } from './lib/format.js'

// The import summary's date range said "Sun, 3 Feb – Sun, 21 Dec" for a history that ran over
// two years: without the year, a span across a new year read as a few months.
const HEAD = 'Date,Exercise,Weight,Reps'
const csv = (...days) => [HEAD, ...days.map(d => `${d},Bench Press,60,5`)].join('\n')
let root, host

async function summaryFor(text) {
  const file = new File([text], 'export.csv', { type: 'text/csv' })
  importFromApp(file)
  for (let i = 0; i < 50 && !useUI.getState().sheets.length; i++) await new Promise(r => setTimeout(r, 5))
  const sheet = useUI.getState().sheets.at(-1)
  expect(sheet).toBeTruthy()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root.render(sheet.render(() => {})))
  return host.querySelector('.muted.small').textContent
}

describe('the import summary’s dates', () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    useUI.setState({ sheets: [], toasts: [] })
    useStore.setState(s => ({ S: { ...s.S, unit: 'kg', workouts: [], bodyweight: [] } }))
  })
  afterEach(() => { if (root) act(() => root.unmount()); root = null; document.body.innerHTML = '' })

  it('carry the year when the history spans two years', async () => {
    const text = await summaryFor(csv('2025-02-03', '2026-01-21'))
    expect(text).toContain('2025')
    expect(text).toContain('2026')
  })

  it('carry the year for a range that is not this year', () => {
    const now = new Date('2026-09-28T12:00:00')
    expect(fmtDateRange('2024-03-01', '2024-05-01', false, now)).toContain('2024')
    expect(fmtDateRange('2026-03-01', '2026-05-01', false, now)).not.toContain('2026')
    expect(fmtDateRange('2026-03-01', '2026-03-01', false, now)).not.toContain('–')
  })
})

// QA 10-06: the summary never said how many rows it had left out, and every count read "1 workouts
// imported", "1 sets bring an RPE".
describe('the import summary’s counts', () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    useUI.setState({ sheets: [], toasts: [], toastMsg: '' })
    useStore.setState(s => ({ S: { ...s.S, unit: 'kg', workouts: [], bodyweight: [], wc: { ...s.S.wc, effort: 'rpe' } } }))
  })
  afterEach(() => { if (root) act(() => root.unmount()); root = null; document.body.innerHTML = '' })
  const lines = () => [...host.querySelectorAll('.small.dim')].map(d => d.textContent)

  it('says how many rows were skipped, singular and plural, and nothing when none were', async () => {
    await summaryFor([HEAD, '2026-01-02,Bench Press,60,5', 'not a date,Bench Press,60,5'].join('\n'))
    expect(lines()).toContain('1 row skipped (couldn’t read it)')
    act(() => root.unmount()); document.body.innerHTML = ''; useUI.setState({ sheets: [] })
    await summaryFor([HEAD, '2026-01-02,Bench Press,60,5', 'nope,Bench Press,60,5', '2026-01-03,,60,5'].join('\n'))
    expect(lines()).toContain('2 rows skipped (couldn’t read them)')
    act(() => root.unmount()); document.body.innerHTML = ''; useUI.setState({ sheets: [] })
    await summaryFor(csv('2026-01-02'))
    expect(lines().some(l => /skipped/.test(l))).toBe(false)
  })

  it('counts one workout and one rated set in the singular', async () => {
    await summaryFor(['Date,Workout Name,Exercise Name,Set Order,Weight,Reps,Seconds,RPE', '2026-01-02 10:00:00,Push,Bench Press (Barbell),1,60,5,0,8'].join('\n'))
    expect(lines().join(' ')).toMatch(/\b1 set brings an RPE with it\./)
    const importBtn = [...host.querySelectorAll('button')].find(b => b.textContent === 'Import')
    act(() => importBtn.click())
    expect(useUI.getState().toastMsg).toBe('1 workout imported')
  })
})

// 1.4.4 (#862): Liftosaur's JSON brings its programs, which arrive as routines beside the history.
describe('the import summary with routines', () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    useUI.setState({ sheets: [], toasts: [], toastMsg: '' })
    useStore.setState(s => ({ S: { ...s.S, unit: 'kg', workouts: [], routines: [], customEx: [], bodyweight: [] } }))
  })
  afterEach(() => { if (root) act(() => root.unmount()); root = null; document.body.innerHTML = '' })

  const liftosaur = JSON.stringify({
    version: '1', settings: {}, stats: {},
    history: [{ vtype: 'history_record', id: 1, date: '2026-04-02T16:00:00.000Z', startTime: Date.parse('2026-04-02T16:00:00.000Z'), programId: 'p', programName: 'Basic', day: 1, dayName: 'A',
      entries: [{ vtype: 'history_entry', id: 'e', index: 0, exercise: { id: 'squat' }, warmupSets: [], sets: [{ vtype: 'set', index: 0, id: 's', completedReps: 5, completedWeight: { value: 100, unit: 'kg' }, isCompleted: true }] }] }],
    programs: [{ vtype: 'program', id: 'p', name: 'Basic', planner: { vtype: 'planner', name: 'Basic', weeks: [{ name: 'Week 1', days: [
      { name: 'A', exerciseText: 'Squat / 3x5 / 100kg / progress: lp(2.5kg)' }, { name: 'B', exerciseText: 'Deadlift / 1x5 / 140kg' }] }] } }],
  })

  it('shows the routines, says the script stays a note, and imports both', async () => {
    const file = new File([liftosaur], 'liftosaur.json', { type: 'application/json' })
    importFromApp(file)
    for (let i = 0; i < 50 && !useUI.getState().sheets.length; i++) await new Promise(r => setTimeout(r, 5))
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    act(() => root.render(useUI.getState().sheets.at(-1).render(() => {})))
    expect(host.querySelector('h3').textContent).toBe('Import from Liftosaur')
    expect(host.textContent).toContain('Routines')
    expect(host.textContent).toContain('Liftoscript progressions come along as notes on the exercises.')
    const importBtn = [...host.querySelectorAll('button')].find(b => b.textContent === 'Import')
    act(() => importBtn.click())
    expect(useUI.getState().toastMsg).toBe('1 workout imported · 2 routines imported')
    const S = useStore.getState().S
    expect(S.routines.map(r => r.name)).toEqual(['Basic · A', 'Basic · B'])
    expect(S.routines[0].ex[0]).toMatchObject({ id: '0043', sets: 3, reps: 5, weight: 100, note: 'progress: lp(2.5kg)' })
  })

  it('says so when a file looks like an app’s export and does not read as one', async () => {
    importFromApp(new File(['Date (yyyy/mm/dd),Workout,Exercise,Set 1 (Reps)\n2026/02/03,1,Squat,5'], 'sl.csv', { type: 'text/csv' }))
    for (let i = 0; i < 50 && !useUI.getState().toastMsg; i++) await new Promise(r => setTimeout(r, 5))
    expect(useUI.getState().toastMsg).toBe('This looks like a StrongLifts export, but we couldn’t read it. Nothing was imported.')
    expect(useUI.getState().sheets).toHaveLength(0)
  })
})

// Tonal (ToneGet) history: workouts + sets, Strength Score, and movements
// the file does not name — only a movement id.
describe('the import summary for Tonal', () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    useUI.setState({ sheets: [], toasts: [], toastMsg: '' })
    useStore.setState(s => ({ S: { ...s.S, unit: 'kg', workouts: [], customEx: [], bodyweight: [], tonalStrength: null, tonalCatalog: {} } }))
  })
  afterEach(() => { if (root) act(() => root.unmount()); root = null; document.body.innerHTML = '' })

  const tonal = JSON.stringify({
    version: '3.0', exportedAt: '2026-09-16T10:00:00Z', exportedWith: 'ToneGet v3.1.0',
    workouts: [
      { id: 'act-001', beginTime: '2026-09-09T08:00:00Z', workoutType: 'PROGRAM', workoutId: 'tmpl-001',
        totalVolume: 3510, totalReps: 46,
        workoutSetActivity: [
          { movementId: 'mov-001', weight: 85, repCount: 10, oneRepMax: 113, rangeOfMotion: 0.94 },
          { movementId: 'mov-002', weight: 60, repCount: 8, oneRepMax: 75, rangeOfMotion: 0.88 },
        ] },
      { id: 'act-002', beginTime: '2026-09-16T08:00:00Z', workoutType: 'ON_DEMAND', workoutId: 'tmpl-002',
        totalVolume: 4098, totalReps: 54,
        workoutSetActivity: [
          { movementId: 'mov-001', weight: 87, repCount: 10, oneRepMax: 116, rangeOfMotion: 0.95 },
          { movementId: 'mov-002', weight: 62, repCount: 8, oneRepMax: 78, rangeOfMotion: 0.89 },
        ] },
    ],
    activityNames: { 'act-001': 'Full Body Strength', 'act-002': 'Upper Body Burn' },
    workoutCatalog: {
      'tmpl-001': { id: 'tmpl-001', title: 'Full Body Strength', workoutType: 'PROGRAM' },
      'tmpl-002': { id: 'tmpl-002', title: 'Upper Body Burn', workoutType: 'ON_DEMAND' },
    },
    strengthScoreHistory: [
      { date: '2026-09-09', overall: 480, upper: 505, lower: 440, core: 395 },
      { date: '2026-09-16', overall: 490, upper: 510, lower: 445, core: 396 },
    ],
    currentStrengthScores: { parsed: { regions: { Overall: 490, Upper: 510, Lower: 445, Core: 396 }, muscles: {} } },
  })

  it('shows the Strength Score range and the unnamed movements, and imports by Tonal id', async () => {
    const file = new File([tonal], 'tonal_workouts_20260916_100000.json', { type: 'application/json' })
    importFromApp(file)
    for (let i = 0; i < 50 && !useUI.getState().sheets.length; i++) await new Promise(r => setTimeout(r, 5))
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    act(() => root.render(useUI.getState().sheets.at(-1).render(() => {})))
    expect(host.querySelector('h3').textContent).toBe('Import from Tonal')
    expect(host.textContent).toContain('Tonal Strength Score')
    expect(host.textContent).toContain('480 → 490')
    expect(host.textContent).toContain('Movements without a name')
    expect(host.textContent).toContain('Tonal movements without a name')
    const importBtn = [...host.querySelectorAll('button')].find(b => b.textContent === 'Import')
    act(() => importBtn.click())
    expect(useUI.getState().toastMsg).toBe('2 workouts imported')
    const S = useStore.getState().S
    expect(S.workouts).toHaveLength(2)
    expect(S.workouts.map(w => w.tonalId)).toEqual(['act-001', 'act-002'])
    expect(S.tonalStrength.history.map(h => h.overall)).toEqual([480, 490, 490])
    expect(Object.keys(S.tonalCatalog)).toEqual(['tmpl-001', 'tmpl-002'])
    // A re-import adds nothing: dedupe is by Tonal id, not by day.
    importFromApp(file)
    for (let i = 0; i < 50 && !useUI.getState().sheets.length; i++) await new Promise(r => setTimeout(r, 5))
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    act(() => root.render(useUI.getState().sheets.at(-1).render(() => {})))
    const again = [...host.querySelectorAll('button')].find(b => b.textContent === 'Nothing new to import')
    expect(again).toBeTruthy()
  })
})
