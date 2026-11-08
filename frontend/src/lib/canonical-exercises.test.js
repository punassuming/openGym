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

  it('seed list is the 14 canonical exercises: 12 starters + Incline / Decline Chest Press', () => {
    expect(CANONICAL_EXERCISES.map(e => e.id)).toEqual([
      'chest_press', 'incline_chest_press', 'decline_chest_press', 'cable_fly',
      'curl', 'triceps_extension', 'hip_adduction',
      'row', 'shoulder_press', 'lateral_raise', 'squat', 'deadlift',
      'calf_raise', 'crunch',
    ])
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
      expect(['push', 'pull', 'squat', 'hinge', 'isolation']).toContain(e.pattern)
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
    expect(exercisesForGroup('chest').map(e => e.id)).toEqual(['chest_press', 'incline_chest_press', 'decline_chest_press', 'cable_fly'])
    expect(exercisesForGroup('quads').map(e => e.id)).toEqual(['squat'])
    expect(exercisesForGroup('hamstrings').map(e => e.id)).toEqual(['deadlift'])
    expect(exercisesForGroup('glutes').map(e => e.id)).toEqual(['hip_adduction'])
    expect(exercisesForGroup('calves').map(e => e.id)).toEqual(['calf_raise'])
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
      'mov-7': { exercise: 'Hip Thrust', category: 'Glutes', source: 'tonal' },
    })
    expect(canonical.id).toBe('hip_thrust')
    expect(canonical.name).toBe('Hip Thrust')
    expect(canonical.primary).toBe('Glutes')
  })
})
