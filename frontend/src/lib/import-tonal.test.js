// Tests for lib/import-tonal.js — the openGym adapter over lib/tonal.js.
//
// All data here is small inline synthetic data in the real ToneGet v3.1
// shape (never a committed export or sample file — see the no-data rule).
// Counts mirror the analytics scaffold's synthetic sample: 3 workouts,
// 15 sets, Strength Score 480 -> 498.
import { describe, expect, it } from 'vitest'
import { parseTonal, parseTonalText, parseTonalFile, mergeTonal, gunzipText } from './import-tonal.js'
import { importId } from './import-csv.js'

const ALIASES = {
  'mov-001': { exercise: 'Chest Press', category: 'Chest' },
  'mov-002': { exercise: 'Seated Row', category: 'Back' },
  // mov-003 deliberately unaliased.
}

const sets = (mid, w, reps, rm, rom, extra = {}) => ({ movementId: mid, weight: w, repCount: reps, oneRepMax: rm, rangeOfMotion: rom, ...extra })
const EXPORT = {
  version: '3.0', exportedAt: '2026-09-23T10:00:00Z', exportedWith: 'ToneGet v3.1.0',
  profile: { totalWorkouts: 3, totalVolume: 11008 },
  workouts: [
    {
      id: 'act-001', beginTime: '2026-09-09T08:00:00Z', workoutType: 'PROGRAM',
      workoutId: 'tmpl-001', totalVolume: 3510, totalReps: 46,
      workoutSetActivity: [
        sets('mov-001', 85, 10, 113, 0.94, { velAtMaxConPower: 1.2, weightAtMaxConPower: 70, romWeight: 85 }),
        sets('mov-001', 85, 10, 113, 0.94),
        sets('mov-001', 85, 10, 113, 0.93),
        sets('mov-002', 60, 8, 75, 0.88),
        sets('mov-002', 60, 8, 75, 0.88),
      ],
    },
    {
      id: 'act-002', beginTime: '2026-09-16T08:00:00Z', workoutType: 'ON_DEMAND',
      workoutId: 'tmpl-002', totalVolume: 4098, totalReps: 54,
      workoutSetActivity: [
        sets('mov-001', 87, 10, 116, 0.95),
        sets('mov-001', 87, 10, 116, 0.95),
        sets('mov-001', 87, 10, 116, 0.94),
        sets('mov-002', 62, 8, 78, 0.89),
        sets('mov-002', 62, 8, 78, 0.89),
        sets('mov-002', 62, 8, 78, 0.89),
      ],
    },
    {
      id: 'act-003', beginTime: '2026-09-23T08:00:00Z', workoutType: 'Custom',
      workoutId: 'tmpl-custom-001', totalVolume: 3400, totalReps: 40,
      workoutSetActivity: [
        sets('mov-003', 85, 10, 113, 0.92),
        sets('mov-003', 85, 10, 113, 0.92),
        sets('mov-003', 85, 10, 113, 0.91),
        sets('mov-003', 85, 10, 113, 0.91),
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
  },
}

const base = customEx => ({ workouts: [], customEx, bodyweight: [], exWeights: {}, routines: [], tonalStrength: null, tonalCatalog: {} })

describe('parseTonal', () => {
  it('parses 3 workouts, 15 sets, with titles, types and Tonal totals', () => {
    const p = parseTonal(EXPORT, { unit: 'lb', customEx: [], aliases: ALIASES })
    expect(p.error).toBeUndefined()
    expect(p.source).toBe('Tonal')
    expect(p.workouts).toHaveLength(3)
    expect(p.sets).toBe(15)
    expect(p.workouts.map(w => [w.d, w.name, w.workoutType])).toEqual([
      ['2026-09-09', 'Full Body Strength', 'PROGRAM'],
      ['2026-09-16', 'Upper Body Burn', 'ON_DEMAND'],
      ['2026-09-23', 'My Custom Leg Day', 'Custom'],
    ])
    expect(p.workouts.map(w => [w.tonalTotalVolume, w.tonalTotalReps, w.tonalVolumeMismatch])).toEqual([
      [3510, 46, false], [4098, 54, false], [3400, 40, false],
    ])
    expect(p.workouts.map(w => w.tonalId)).toEqual(['act-001', 'act-002', 'act-003'])
    expect(p.from).toBe('2026-09-09')
    expect(p.to).toBe('2026-09-23')
    expect(p.fileUnit).toBe('lb')
  })

  it('converts lb to kg in a kg profile, keeping 1RM in step', () => {
    const p = parseTonal(EXPORT, { unit: 'kg', customEx: [], aliases: ALIASES })
    expect(p.converted).toBe(true)
    const set = p.workouts[0].entries[0].sets[0]
    expect(set.w).toBe(38.56) // 85 lb
    expect(set.tonalOneRepMax).toBe(51.26) // 113 lb
    expect(set.rangeOfMotion).toBe(0.94)
    expect(set.r).toBe(10)
    // The recomputed volume is in the profile unit, from the converted sets.
    // Each set weight is rounded to the hundredth first (openGym's
    // roundWeight), so the volume is 38.56*10*3 + 27.22*8*2 = 1592.32,
    // not the unrounded 3510 * 0.45359237 = 1592.11.
    expect(p.workouts[0].vol).toBeCloseTo(1592.32, 2)
  })

  it('keeps per-set Tonal fields first-class, and --full fields verbatim in tonalExtra', () => {
    const p = parseTonal(EXPORT, { unit: 'lb', customEx: [], aliases: ALIASES })
    const set = p.workouts[0].entries[0].sets[0]
    expect(set.tonalOneRepMax).toBe(113)
    expect(set.rangeOfMotion).toBe(0.94)
    expect(set.tonalExtra).toEqual({ velAtMaxConPower: 1.2, weightAtMaxConPower: 70, romWeight: 85 })
    expect(set.rpe).toBeUndefined()
    expect(set.rir).toBeUndefined()
    // A set with no --full fields has no tonalExtra at all (blank, not empty).
    expect(p.workouts[0].entries[0].sets[1].tonalExtra).toBeUndefined()
    expect(p.fullOnlyFieldsSeen).toBe(3)
  })

  it('identifies exercises by canonical name, never by catalogue id', () => {
    const p = parseTonal(EXPORT, { unit: 'lb', customEx: [], aliases: ALIASES })
    const chestId = importId('im', 'Tonal|chest press')
    expect(p.workouts[0].entries.map(e => e.id)).toContain(chestId)
    const chest = p.customEx.find(c => c.id === chestId)
    expect(chest.n).toBe('chest press')
    expect(chest.bp).toBe('chest')
    // Unresolved movements land as their movementId, flagged, never guessed.
    expect(p.tonalUnresolved).toEqual(['mov-003'])
    expect(p.unmatchedNames).toEqual(['mov-003'])
    const mov3 = p.customEx.find(c => c.tonalMovementId === 'mov-003')
    expect(mov3).toBeTruthy()
    expect(mov3.n).toBe('mov-003')
  })

  it('equipment is an attribute, not a separate exercise', () => {
    const aliased = {
      ...EXPORT,
      workouts: [{
        id: 'act-9', beginTime: '2026-09-09T08:00:00Z', workoutType: 'PROGRAM',
        workoutSetActivity: [sets('mov-9', 50, 8, 66, 0.9)],
      }],
    }
    const p = parseTonal(aliased, {
      unit: 'lb', customEx: [],
      aliases: { 'mov-9': { exercise: 'Barbell Bench Press', category: 'Chest' } },
    })
    expect(p.workouts[0].entries).toHaveLength(1)
    const ex = p.customEx[0]
    expect(ex.n).toBe('bench press')
    expect(ex.eq).toBe('barbell')
  })

  it('carries Strength Score and catalog, and refuses a malformed file', () => {
    const p = parseTonal(EXPORT, { unit: 'lb', customEx: [], aliases: ALIASES })
    expect(p.tonalStrength.history.map(h => h.overall)).toEqual([480, 490, 498, 498])
    expect(p.tonalStrength.current.muscles).toHaveLength(3)
    expect(p.tonalCatalog['tmpl-custom-001'].isCustom).toBe(true)
    expect(parseTonal({ foo: 1 })).toEqual({ error: 'unrecognised' })
    expect(parseTonalText('')).toEqual({ error: 'empty' })
    expect(parseTonalText('not json')).toEqual({ error: 'unrecognised' })
    expect(parseTonal({ version: '3.0', workouts: [{ id: 'x', beginTime: '2026-09-09', workoutSetActivity: [] }] }))
      .toEqual({ error: 'format', app: 'Tonal' })
    expect(parseTonalText(JSON.stringify(EXPORT), { unit: 'lb', aliases: ALIASES }).workouts).toHaveLength(3)
  })
})

describe('mergeTonal', () => {
  it('merges once, and a re-import adds nothing', () => {
    const parsed = parseTonal(EXPORT, { unit: 'lb', customEx: [], aliases: ALIASES })
    const S = base([])
    const first = mergeTonal(S, parsed)
    expect(first).toEqual({ added: 3, skipped: 0, strengthHistory: 4, strengthMuscles: 3, catalog: 3, aliasesAdded: 0 })
    expect(S.workouts).toHaveLength(3)
    expect(S.tonalStrength.history.map(h => h.overall)).toEqual([480, 490, 498, 498])
    expect(S.tonalCatalog['tmpl-001'].title).toBe('Full Body Strength')
    const second = mergeTonal(S, parsed)
    expect(second.added).toBe(0)
    expect(second.skipped).toBe(3)
    expect(S.workouts).toHaveLength(3)
    expect(S.customEx).toHaveLength(3) // chest press, seated row, mov-003
  })

  it('records source names as aliases on the canonical exercise', () => {
    const aliases = {
      'mov-001': { ...ALIASES['mov-001'], gym: 'Home / Tonal', equipment: 'Tonal', source: 'tonal', sourceName: 'Tonal Chest Press' },
      'mov-002': { ...ALIASES['mov-002'], gym: 'Home / Tonal', equipment: 'Tonal', source: 'tonal', sourceName: 'Tonal Seated Row' },
    }
    const parsed = parseTonal(EXPORT, { unit: 'lb', customEx: [], aliases })
    expect(parsed.tonalAliases.map(a => [a.aliasName, a.gym])).toEqual([
      ['Tonal Chest Press', 'Home / Tonal'], ['Tonal Seated Row', 'Home / Tonal'],
    ])
    const S = base([])
    const res = mergeTonal(S, parsed)
    expect(res.aliasesAdded).toBe(2)
    const chestId = importId('im', 'Tonal|chest press')
    expect(S.exAliases[chestId]).toEqual(['Tonal Chest Press'])
    // A re-import records nothing twice.
    expect(mergeTonal(S, parsed).aliasesAdded).toBe(0)
  })

  it('keeps two Tonal sessions on the same day as two workouts', () => {
    const twoADay = structuredClone(EXPORT)
    twoADay.workouts[1].beginTime = '2026-09-09T18:00:00Z'
    const parsed = parseTonal(twoADay, { unit: 'lb', customEx: [], aliases: ALIASES })
    const S = base([])
    mergeTonal(S, parsed)
    expect(S.workouts.filter(w => w.d === '2026-09-09')).toHaveLength(2)
  })

  it('reuses a custom exercise the user already has for that canonical name', () => {
    const own = { id: 'mine', n: 'chest press', custom: true, eq: 'custom', tg: '', desc: '', bp: 'chest' }
    const S = base([own])
    const parsed = parseTonal(EXPORT, { unit: 'lb', customEx: S.customEx, aliases: ALIASES })
    mergeTonal(S, parsed)
    const chestEntries = S.workouts.flatMap(w => w.entries).filter(e => e.id === 'mine')
    expect(chestEntries.length).toBeGreaterThan(0)
    expect(S.customEx).toHaveLength(3) // mine + seated row + mov-003, no duplicate chest press
  })
})

describe('parseTonalFile (.json.gz)', () => {
  it('round-trips a gzipped export', async () => {
    if (typeof CompressionStream === 'undefined' || typeof DecompressionStream === 'undefined') {
      const r = await gunzipText(new Uint8Array([0x1f, 0x8b, 0, 0]).buffer)
      expect(r.error).toBe('gzip-unsupported')
      return
    }
    const text = JSON.stringify(EXPORT)
    const gz = await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer()
    const parsed = await parseTonalFile(gz, { unit: 'lb', aliases: ALIASES })
    expect(parsed.workouts).toHaveLength(3)
    expect(parsed.sets).toBe(15)
    const plain = await parseTonalFile(new TextEncoder().encode(text).buffer, { unit: 'lb', aliases: ALIASES })
    expect(plain.workouts).toHaveLength(3)
  })
})
