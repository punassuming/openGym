// Tests for lib/tonal.js — the portable ToneGet parser.
//
// All data here is small inline synthetic data, written to mirror the real
// ToneGet v3.1 shape (never a committed export or sample file — see the
// no-data rule in lib/tonal.js). Numbers mirror the analytics scaffold's
// synthetic sample where they overlap: Strength Score 480 -> 498, Tonal
// 1RM 113 -> 116 on mov-001, overall mean ROM 0.916.
import { describe, expect, it } from 'vitest'
import {
  canonicalExerciseName, isTonalExport, resolveTonalTitle,
  parseTonalAliases, parseTonalStrength, mergeTonalStrength,
  tonalStrengthTrend, parseToneGet, crossCheckVolume,
  tonalOneRmCurve, romTrend,
} from './tonal.js'

const EXPORT = {
  version: '3.0',
  exportedAt: '2026-09-23T10:00:00Z',
  exportedWith: 'ToneGet v3.1.0',
  user: { firstName: 'Synthetic', lastName: 'Sample' },
  profile: { totalWorkouts: 3, totalVolume: 11008 },
  workouts: [
    {
      id: 'act-001', beginTime: '2026-09-09T08:00:00Z', workoutType: 'PROGRAM',
      workoutId: 'tmpl-001', totalVolume: 3510, totalReps: 46,
      workoutSetActivity: [
        { movementId: 'mov-001', weight: 85, repCount: 10, oneRepMax: 113, rangeOfMotion: 0.94, velAtMaxConPower: 1.2, weightAtMaxConPower: 70, romWeight: 85 },
        { movementId: 'mov-001', weight: 85, repCount: 10, oneRepMax: 113, rangeOfMotion: 0.94 },
        { movementId: 'mov-001', weight: 85, repCount: 10, oneRepMax: 113, rangeOfMotion: 0.93 },
        { movementId: 'mov-002', weight: 60, repCount: 8, oneRepMax: 75, rangeOfMotion: 0.88 },
        { movementId: 'mov-002', weight: 60, repCount: 8, oneRepMax: 75, rangeOfMotion: 0.88 },
      ],
    },
    {
      id: 'act-002', beginTime: '2026-09-16T08:00:00Z', workoutType: 'ON_DEMAND',
      workoutId: 'tmpl-002', totalVolume: 4098, totalReps: 54,
      workoutSetActivity: [
        { movementId: 'mov-001', weight: 87, repCount: 10, oneRepMax: 116, rangeOfMotion: 0.95 },
        { movementId: 'mov-001', weight: 87, repCount: 10, oneRepMax: 116, rangeOfMotion: 0.95 },
        { movementId: 'mov-001', weight: 87, repCount: 10, oneRepMax: 116, rangeOfMotion: 0.94 },
        { movementId: 'mov-002', weight: 62, repCount: 8, oneRepMax: 78, rangeOfMotion: 0.89 },
        { movementId: 'mov-002', weight: 62, repCount: 8, oneRepMax: 78, rangeOfMotion: 0.89 },
        { movementId: 'mov-002', weight: 62, repCount: 8, oneRepMax: 78, rangeOfMotion: 0.89 },
      ],
    },
    {
      id: 'act-003', beginTime: '2026-09-23T08:00:00Z', workoutType: 'Custom',
      workoutId: 'tmpl-custom-001', totalVolume: 3400, totalReps: 40,
      workoutSetActivity: [
        { movementId: 'mov-003', weight: 85, repCount: 10, oneRepMax: 113, rangeOfMotion: 0.92 },
        { movementId: 'mov-003', weight: 85, repCount: 10, oneRepMax: 113, rangeOfMotion: 0.92 },
        { movementId: 'mov-003', weight: 85, repCount: 10, oneRepMax: 113, rangeOfMotion: 0.91 },
        { movementId: 'mov-003', weight: 85, repCount: 10, oneRepMax: 113, rangeOfMotion: 0.91 },
      ],
    },
  ],
  activityNames: { 'act-001': 'Full Body Strength', 'act-002': 'Upper Body Burn', 'act-003': 'My Custom Leg Day' },
  workoutCatalog: {
    'tmpl-001': { id: 'tmpl-001', title: 'Full Body Strength', workoutType: 'PROGRAM' },
    'tmpl-002': { id: 'tmpl-002', title: 'Upper Body Burn', workoutType: 'ON_DEMAND' },
    'tmpl-custom-001': { id: 'tmpl-custom-001', title: 'My Custom Leg Day', workoutType: 'Custom' },
  },
  customWorkouts: { 'tmpl-custom-001': { id: 'tmpl-custom-001', title: 'My Custom Leg Day', workoutType: 'Custom' } },
  strengthScoreHistory: [
    { date: '2026-09-09', overall: 480, upper: 505, lower: 440, core: 395 },
    { date: '2026-09-16', overall: 490, upper: 510, lower: 445, core: 396 },
    { date: '2026-09-23', overall: 498, upper: 512, lower: 445, core: 398 },
  ],
  currentStrengthScores: {
    parsed: {
      regions: { Overall: 498, Upper: 512, Lower: 445, Core: 398 },
      muscles: {
        Chest: { score: 523, region: 'Upper', updatedAt: '2026-09-23T08:00:00Z' },
        Back: { score: 498, region: 'Upper', updatedAt: '2026-09-23T08:00:00Z' },
        Legs: { score: 460, region: 'Lower', updatedAt: '2026-09-23T08:00:00Z' },
      },
    },
    raw: [
      { strengthBodyRegion: 'Overall', score: 498, familyActivity: [] },
      { strengthBodyRegion: 'Upper', score: 512, familyActivity: [{ strengthFamily: 'Chest', score: 523, updatedAt: '2026-09-23T08:00:00Z' }, { strengthFamily: 'Back', score: 498, updatedAt: '2026-09-23T08:00:00Z' }] },
      { strengthBodyRegion: 'Lower', score: 445, familyActivity: [{ strengthFamily: 'Legs', score: 460, updatedAt: '2026-09-23T08:00:00Z' }] },
      { strengthBodyRegion: 'Core', score: 398, familyActivity: [] },
    ],
  },
}

const ALIASES = {
  'mov-001': { exercise: 'Chest Press', category: 'Chest' },
  'mov-002': { exercise: 'Seated Row', category: 'Back' },
  // mov-003 deliberately unaliased: its name must stay unresolved.
}

describe('canonicalExerciseName', () => {
  it('strips equipment into an attribute, keeping one identity', () => {
    expect(canonicalExerciseName('Barbell Bench Press')).toEqual({ name: 'Bench Press', equipment: 'barbell' })
    expect(canonicalExerciseName('Dumbbell Bench Press')).toEqual({ name: 'Bench Press', equipment: 'dumbbell' })
    expect(canonicalExerciseName('Bench Press (Barbell)')).toEqual({ name: 'Bench Press', equipment: 'barbell' })
    expect(canonicalExerciseName('Chest Press')).toEqual({ name: 'Chest Press', equipment: null })
    expect(canonicalExerciseName('')).toEqual({ name: '', equipment: null })
  })
})

describe('isTonalExport / resolveTonalTitle', () => {
  it('recognises a ToneGet export and nothing else', () => {
    expect(isTonalExport(EXPORT)).toBe(true)
    expect(isTonalExport({ workouts: [{ beginTime: '2026-09-09', workoutSetActivity: [] }] })).toBe(true)
    expect(isTonalExport({ workouts: [] })).toBe(false)
    expect(isTonalExport({ foo: 1 })).toBe(false)
    expect(isTonalExport(null)).toBe(false)
  })

  it('resolves titles: workoutTitle, then catalog, then activityNames', () => {
    const catalog = EXPORT.workoutCatalog
    expect(resolveTonalTitle({ workoutTitle: 'Own Title', workoutId: 'tmpl-001', id: 'act-001' }, catalog, EXPORT.activityNames)).toBe('Own Title')
    expect(resolveTonalTitle({ workoutId: 'tmpl-001', id: 'act-001' }, catalog, EXPORT.activityNames)).toBe('Full Body Strength')
    expect(resolveTonalTitle({ id: 'act-002' }, {}, EXPORT.activityNames)).toBe('Upper Body Burn')
    expect(resolveTonalTitle({ id: 'nope' }, {}, EXPORT.activityNames)).toBe('')
  })
})

describe('parseTonalAliases', () => {
  it('reads the CSV shape and passes objects through', () => {
    expect(parseTonalAliases('movement_id,exercise,category\nmov-001,Chest Press,Chest\nmov-002,Seated Row,Back\n'))
      .toEqual({
        'mov-001': { exercise: 'Chest Press', category: 'Chest', gym: '', equipment: '', sourceName: '', source: '', notes: '' },
        'mov-002': { exercise: 'Seated Row', category: 'Back', gym: '', equipment: '', source: '', sourceName: '', notes: '' },
      })
    expect(parseTonalAliases(ALIASES)).toBe(ALIASES)
    expect(parseTonalAliases(null)).toEqual({})
  })

  it('reads the full alias record: gym, equipment, source name, source, notes', () => {
    const csv = 'movement_id,exercise,category,gym,equipment,source_name,source,notes\n'
      + 'mov-001,Chest Press,Chest,Home / Tonal,Tonal,Tonal Chest Press,tonal,\n'
      + 'mov-002,Row,Back,Village Health Clubs Ocotillo,machine,Seated Machine Row,fitnotes,stack in 5 lb steps\n'
    expect(parseTonalAliases(csv)).toEqual({
      'mov-001': { exercise: 'Chest Press', category: 'Chest', gym: 'Home / Tonal', equipment: 'Tonal', sourceName: 'Tonal Chest Press', source: 'tonal', notes: '' },
      'mov-002': { exercise: 'Row', category: 'Back', gym: 'Village Health Clubs Ocotillo', equipment: 'machine', sourceName: 'Seated Machine Row', source: 'fitnotes', notes: 'stack in 5 lb steps' },
    })
  })
})

describe('parseTonalStrength', () => {
  it('parses history and the current muscle breakdown', () => {
    const s = parseTonalStrength(EXPORT)
    expect(s.history.filter(h => h.kind === 'history').map(h => h.overall)).toEqual([480, 490, 498])
    expect(s.current.regions).toEqual({ Overall: 498, Upper: 512, Lower: 445, Core: 398 })
    expect(s.current.muscles.map(m => [m.muscle, m.score, m.region])).toEqual([
      ['Back', 498, 'Upper'], ['Chest', 523, 'Upper'], ['Legs', 460, 'Lower'],
    ])
    expect(s.skipped).toEqual({})
  })

  it('reads the raw list shape too, and tolerates a missing section', () => {
    const rawOnly = { exportedAt: '2026-09-23T10:00:00Z', currentStrengthScores: EXPORT.currentStrengthScores.raw }
    const s = parseTonalStrength(rawOnly)
    expect(s.current.regions.Overall).toBe(498)
    expect(s.current.muscles.find(m => m.muscle === 'Chest').score).toBe(523)
    expect(parseTonalStrength({}).history).toEqual([])
    expect(parseTonalStrength({}).current).toBeNull()
  })

  it('trend is 480 -> 498', () => {
    const t = tonalStrengthTrend(parseTonalStrength(EXPORT))
    expect(t.from).toBe(480)
    expect(t.to).toBe(498)
    expect(t.deltaOverall).toBe(18)
    expect(t.points).toHaveLength(4) // 3 history + 1 current snapshot
  })

  it('merge unions by date+kind and by muscle, later winning', () => {
    const a = parseTonalStrength(EXPORT)
    const b = parseTonalStrength({
      exportedAt: '2026-09-30T10:00:00Z',
      strengthScoreHistory: [{ date: '2026-09-30', overall: 500, upper: 514, lower: 446, core: 399 }],
      currentStrengthScores: { parsed: { regions: { Overall: 500, Upper: 514, Lower: 446, Core: 399 }, muscles: { Chest: { score: 525, region: 'Upper', updatedAt: '2026-09-30T08:00:00Z' } } } },
    })
    const m = mergeTonalStrength(a, b)
    expect(m.history.map(h => h.overall)).toEqual([480, 490, 498, 498, 500, 500])
    expect(m.current.regions.Overall).toBe(500)
    expect(m.current.muscles.find(x => x.muscle === 'Chest').score).toBe(525)
    expect(m.current.muscles.find(x => x.muscle === 'Back').score).toBe(498)
    expect(mergeTonalStrength(null, a).history).toEqual(a.history)
  })
})

describe('parseToneGet', () => {
  it('parses 3 workouts, 15 sets, titles, types and totals', () => {
    const p = parseToneGet(EXPORT, { aliases: ALIASES })
    expect(p.workouts).toHaveLength(3)
    expect(p.sets).toBe(15)
    expect(p.workouts.map(w => [w.date, w.title, w.type])).toEqual([
      ['2026-09-09', 'Full Body Strength', 'PROGRAM'],
      ['2026-09-16', 'Upper Body Burn', 'ON_DEMAND'],
      ['2026-09-23', 'My Custom Leg Day', 'Custom'],
    ])
    expect(p.workouts.map(w => [w.totalVolume, w.totalReps])).toEqual([[3510, 46], [4098, 54], [3400, 40]])
    expect(p.catalog['tmpl-custom-001'].isCustom).toBe(true)
    expect(p.catalog['tmpl-001'].isCustom).toBe(false)
    expect(p.customWorkouts).toEqual(['tmpl-custom-001'])
    expect(p.profile).toEqual({ totalWorkouts: 3, totalVolume: 11008 })
  })

  it('maps sets to canonical names, keeps 1RM/ROM, preserves --full fields', () => {
    const p = parseToneGet(EXPORT, { aliases: ALIASES })
    const first = p.workouts[0].sets[0]
    expect(first.exercise).toBe('Chest Press')
    expect(first.category).toBe('Chest')
    expect(first.weightLb).toBe(85)
    expect(first.reps).toBe(10)
    expect(first.oneRepMaxLb).toBe(113)
    expect(first.rangeOfMotion).toBe(0.94)
    // --full fields are preserved verbatim in extra, not dropped or mapped.
    expect(first.extra).toEqual({ velAtMaxConPower: 1.2, weightAtMaxConPower: 70, romWeight: 85 })
    expect(p.fullOnlyFieldsSeen).toBe(3)
    expect(p.unmappedSetFields).toEqual({ velAtMaxConPower: 1, weightAtMaxConPower: 1, romWeight: 1 })
    // Overall mean ROM across all 15 sets is 0.916.
    const roms = p.workouts.flatMap(w => w.sets.map(s => s.rangeOfMotion))
    expect(Math.round(roms.reduce((a, b) => a + b, 0) / roms.length * 1000) / 1000).toBe(0.916)
  })

  it('preserves the source name as an alias, never as a separate exercise', () => {
    const withNames = structuredClone(EXPORT)
    const aliases = {
      'mov-001': { ...ALIASES['mov-001'], gym: 'Home / Tonal', equipment: 'Tonal', source: 'tonal', sourceName: 'Tonal Chest Press' },
      'mov-002': { ...ALIASES['mov-002'], gym: 'Home / Tonal', equipment: 'Tonal', source: 'tonal', sourceName: 'Tonal Seated Row' },
    }
    const p = parseToneGet(withNames, { aliases })
    expect(p.workouts[0].sets[0].alias).toEqual({
      canonicalId: 'chest_press', exercise: 'Chest Press',
      aliasName: 'Tonal Chest Press',
      gym: 'Home / Tonal', equipment: 'Tonal', source: 'tonal',
      sourceKey: 'mov-001', notes: '',
    })
    expect(p.tonalAliases).toHaveLength(2)
    expect(p.tonalAliases.map(a => a.sourceKey)).toEqual(['mov-001', 'mov-002'])
    // mov-003 has no alias at all: no alias record, still unresolved.
    expect(p.workouts[2].sets[0].alias).toBeNull()
  })

  it('leaves unaliased movements unresolved, never inventing a name', () => {
    const p = parseToneGet(EXPORT, { aliases: ALIASES })
    expect(p.unresolvedMovementIds).toEqual(['mov-003'])
    expect(p.workouts[2].sets[0].exercise).toBe('mov-003')
    expect(p.workouts[2].sets[0].movementId).toBe('mov-003')
  })

  it('does not use baseWeight as the weight', () => {
    const withBase = structuredClone(EXPORT)
    withBase.workouts[0].workoutSetActivity[0].baseWeight = 42
    const p = parseToneGet(withBase, { aliases: ALIASES })
    expect(p.workouts[0].sets[0].weightLb).toBe(85)
    expect(p.workouts[0].sets[0].baseWeightPresent).toBe(true)
  })

  it('cross-check flags a Tonal total that does not match the sets', () => {
    const p = parseToneGet(EXPORT, { aliases: ALIASES })
    // Workout 1: sets sum to 85*10*3 + 60*8*2 = 3510 — matches Tonal's total.
    expect(crossCheckVolume(p.workouts[0])).toEqual({ tonalTotal: 3510, recomputedLb: 3510, diff: 0, mismatch: false })
    const tampered = { ...p.workouts[0], totalVolume: 9999 }
    expect(crossCheckVolume(tampered).mismatch).toBe(true)
    expect(crossCheckVolume({ ...p.workouts[0], totalVolume: null }).mismatch).toBe(false)
  })

  it('1RM curve 113 -> 116 and ROM trend for mov-001', () => {
    const p = parseToneGet(EXPORT, { aliases: ALIASES })
    expect(tonalOneRmCurve(p.workouts, 'mov-001').map(x => [x.date, x.oneRepMax])).toEqual([
      ['2026-09-09', 113], ['2026-09-16', 116],
    ])
    expect(romTrend(p.workouts, 'mov-001')).toEqual([
      { date: '2026-09-09', meanRom: 0.937, n: 3 },
      { date: '2026-09-16', meanRom: 0.947, n: 3 },
    ])
    expect(tonalOneRmCurve(p.workouts, 'mov-999')).toEqual([])
  })

  it('refuses a file with no readable sets, and counts skipped rows', () => {
    const bad = { version: '3.0', workouts: [{ id: 'x', beginTime: 'not-a-date', workoutSetActivity: [] }] }
    const p = parseToneGet(bad)
    expect(p.workouts).toHaveLength(0)
    expect(p.skipped['workout missing date']).toBe(1)
  })
})
