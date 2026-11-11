// Tests for lib/canonical-exercises.js — the muscle-group-first taxonomy.
// The seed list is the draft in ~/workspace/fitness-analytics/
// CANONICAL-EXERCISES.md; these tests pin it so a later extension is a
// deliberate change, not drift.
import { describe, expect, it } from 'vitest'
import {
  MUSCLE_GROUPS, COMPOUND_GROUPINGS, CANONICAL_EXERCISES,
  canonicalIdFor, findCanonical, makeAliasRecord, resolveCanonical,
  exercisesForGroup,
} from './canonical-exercises.js'

describe('taxonomy shape', () => {
  it('has nine muscle groups — Legs split into Quads / Hamstrings / Glutes / Calves', () => {
    expect(MUSCLE_GROUPS.map(g => g.id)).toEqual(['chest', 'back', 'shoulders', 'arms', 'quads', 'hamstrings', 'glutes', 'calves', 'core'])
    expect(COMPOUND_GROUPINGS).toEqual(['Push', 'Pull', 'Legs', 'Full Body'])
  })

  it('list is the 36 canonical exercises: 14 starters + 22 approved Nov 10, 2026', () => {
    expect(CANONICAL_EXERCISES.map(e => e.id)).toEqual([
      'chest_press', 'incline_chest_press', 'decline_chest_press', 'cable_fly',
      'curl', 'triceps_extension', 'hip_adduction',
      'row', 'shoulder_press', 'lateral_raise', 'squat', 'deadlift',
      'calf_raise', 'crunch',
      'plank_core_stability', 'lunge', 'pull_up', 'plyometric', 'chop_rotation',
      'hip_thrust', 'warmup_mobility', 'push_up', 'leg_raise', 'full_body',
      'shoulder_stability', 'step_up', 'glute_kickback', 'leg_curl', 'carry',
      'reverse_fly', 'front_raise', 'back_extension', 'cardio', 'shrug',
      'leg_extension', 'upright_row',
    ])
    // Nov 10, 2026: Plank + Core Stability merged into one canonical;
    // Hip Stability is gone (mobility folded into Warm-Up, loaded
    // kickbacks into Glute Kickback); no splits anywhere else.
    expect(findCanonical('Plank / Core Stability').id).toBe('plank_core_stability')
    expect(findCanonical('Plank')).toBeNull()
    expect(findCanonical('Core Stability')).toBeNull()
    expect(findCanonical('Hip Stability')).toBeNull()
    expect(findCanonical('Warm-Up / Mobility').nonLift).toBe(true)
    expect(findCanonical('Plyometric').nonLift).toBe(true)
    expect(findCanonical('Cardio').nonLift).toBe(true)
    expect(findCanonical('Chest Press').nonLift).toBeUndefined()
    // Q1: Incline is its own canonical (angle changes emphasis); Flat vs
    // Machine stays one exercise. Decline is assumed separate by the same
    // rule and marked provisional, pending confirmation.
    expect(findCanonical('Incline Chest Press').id).toBe('incline_chest_press')
    expect(findCanonical('Decline Chest Press').provisional).toBe(true)
    expect(findCanonical('Incline Chest Press').provisional).toBeUndefined()
    expect(findCanonical('Chest Press').provisional).toBeUndefined()
    // One canonical exercise per pattern + primary muscle; equipment is
    // never part of the identity.
    expect(CANONICAL_EXERCISES.filter(e => e.name.toLowerCase().includes('barbell'))).toEqual([])
    expect(CANONICAL_EXERCISES.filter(e => e.name.toLowerCase().includes('dumbbell'))).toEqual([])
  })

  it('every canonical exercise names its muscles and pattern', () => {
    for (const e of CANONICAL_EXERCISES) {
      expect(e.primary).toBeTruthy()
      expect(Array.isArray(e.secondary)).toBe(true)
      expect(['push', 'pull', 'squat', 'hinge', 'lunge', 'carry', 'hold', 'rotation', 'compound', 'isolation']).toContain(e.pattern)
      expect(typeof e.compound).toBe('boolean')
      expect(MUSCLE_GROUPS.some(g => g.id === e.group)).toBe(true)
    }
    // The collapse the taxonomy buys: Bench Press 16 variants -> Chest Press.
    expect(findCanonical('Chest Press').primary).toBe('Chest')
    expect(findCanonical('chest_press').secondary).toEqual(['Shoulders', 'Triceps'])
    expect(findCanonical('Curl').primary).toBe('Biceps')
    expect(findCanonical('Deadlift').pattern).toBe('hinge')
    expect(findCanonical('No Such Exercise')).toBeNull()
    expect(canonicalIdFor('Seated Machine Chest Press')).toBe('seated_machine_chest_press')
  })

  it('groups list their canonical exercises', () => {
    expect(exercisesForGroup('chest').map(e => e.id)).toEqual(['chest_press', 'incline_chest_press', 'decline_chest_press', 'cable_fly', 'push_up'])
    expect(exercisesForGroup('quads').map(e => e.id)).toEqual(['squat', 'lunge', 'plyometric', 'step_up', 'leg_extension'])
    expect(exercisesForGroup('hamstrings').map(e => e.id)).toEqual(['deadlift', 'leg_curl'])
    expect(exercisesForGroup('glutes').map(e => e.id)).toEqual(['hip_adduction', 'hip_thrust', 'glute_kickback'])
    expect(exercisesForGroup('calves').map(e => e.id)).toEqual(['calf_raise'])
    expect(exercisesForGroup('back').map(e => e.id)).toEqual(['row', 'pull_up', 'shrug'])
    expect(exercisesForGroup('shoulders').map(e => e.id)).toEqual(['shoulder_press', 'lateral_raise', 'shoulder_stability', 'reverse_fly', 'front_raise', 'upright_row'])
    expect(exercisesForGroup('core').map(e => e.id)).toEqual(['crunch', 'plank_core_stability', 'chop_rotation', 'warmup_mobility', 'leg_raise', 'full_body', 'carry', 'back_extension', 'cardio'])
    // Deadlift is a multi-muscle compound: one primary + secondaries.
    expect(findCanonical('Deadlift')).toEqual(expect.objectContaining({
      primary: 'Hamstrings', secondary: ['Glutes', 'Back', 'Quads'],
    }))
  })
})

describe('alias model', () => {
  it('keeps the gym/equipment/source on the alias, not on the exercise', () => {
    const alias = makeAliasRecord({
      canonicalId: 'chest_press',
      aliasName: 'Seated Machine Chest Press',
      gym: 'Village Health Clubs Ocotillo',
      equipment: 'machine',
      source: 'fitnotes',
      sourceKey: 'Seated Machine Chest Press',
      notes: 'stack in 5 lb steps',
    })
    expect(alias).toEqual({
      canonicalId: 'chest_press',
      aliasName: 'Seated Machine Chest Press',
      gym: 'Village Health Clubs Ocotillo',
      equipment: 'machine',
      source: 'fitnotes',
      sourceKey: 'Seated Machine Chest Press',
      notes: 'stack in 5 lb steps',
    })
  })

  it('resolves a Tonal movementId to its canonical exercise via the alias map', () => {
    const aliasMap = {
      'mov-001': {
        exercise: 'Chest Press', category: 'Chest',
        gym: 'Home / Tonal', equipment: 'Tonal', source: 'tonal',
        sourceName: 'Tonal Chest Press',
      },
    }
    const { canonical, alias } = resolveCanonical('mov-001', aliasMap)
    expect(canonical.id).toBe('chest_press')
    expect(canonical.primary).toBe('Chest')
    expect(canonical.secondary).toEqual(['Shoulders', 'Triceps'])
    expect(alias.aliasName).toBe('Tonal Chest Press')
    expect(alias.gym).toBe('Home / Tonal')
    expect(alias.sourceKey).toBe('mov-001')
  })

  it('resolves a FitNotes exercise name the same way', () => {
    const aliasMap = {
      'Seated Machine Chest Press': {
        exercise: 'Chest Press', category: 'Chest',
        gym: 'Village Health Clubs Ocotillo', equipment: 'machine',
        source: 'fitnotes', sourceName: 'Seated Machine Chest Press',
      },
    }
    const { canonical, alias } = resolveCanonical('Seated Machine Chest Press', aliasMap)
    expect(canonical.id).toBe('chest_press')
    expect(alias.aliasName).toBe('Seated Machine Chest Press')
    expect(alias.gym).toBe('Village Health Clubs Ocotillo')
  })

  it('never invents a canonical exercise for an unaliased source key', () => {
    expect(resolveCanonical('mov-999', {})).toEqual({ canonical: null, alias: null })
    expect(resolveCanonical('mov-999', { 'mov-001': { exercise: 'Chest Press' } }))
      .toEqual({ canonical: null, alias: null })
  })

  it('an alias whose exercise is not yet in the seed list still yields one canonical exercise', () => {
    const { canonical } = resolveCanonical('mov-7', {
      'mov-7': { exercise: 'Kettlebell Swing', category: 'Glutes', source: 'tonal' },
    })
    expect(canonical.id).toBe('kettlebell_swing')
    expect(canonical.name).toBe('Kettlebell Swing')
    expect(canonical.primary).toBe('Glutes')
  })

  it('Hip Thrust now resolves to the approved canonical, with its alias intact', () => {
    const { canonical, alias } = resolveCanonical('mov-7', {
      'mov-7': { exercise: 'Hip Thrust / Glute Bridge', category: 'Glutes', source: 'tonal', sourceName: 'Barbell Hip Thrust', gym: 'Home / Tonal', equipment: 'Tonal' },
    })
    expect(canonical.id).toBe('hip_thrust')
    expect(canonical.primary).toBe('Glutes')
    expect(alias.aliasName).toBe('Barbell Hip Thrust')
  })
})
