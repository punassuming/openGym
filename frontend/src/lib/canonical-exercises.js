// Canonical exercises — muscle-group-first, Material UI app.
//
// Portable, dependency-free. This is the taxonomy from
// ~/workspace/fitness-analytics/CANONICAL-EXERCISES.md (draft Nov 8, 2026,
// from Rich's direction), as code. It is the seed list, not the final list —
// extend by muscle group, never by adding name variants.
//
// Principle: one canonical exercise per movement pattern + primary muscle.
// Equipment / position / machine is an attribute of a SET and of an ALIAS,
// never a separate exercise. No nine barbell bicep curls: "Barbell Curl",
// "Dumbbell Curl", "Cable Curl" and "Tonal Curl" are all one canonical
// exercise — Curl — logged under different aliases.
//
// The openGym fork uses this module only for lookup (primary muscle for
// the muscle map, canonical id for the exercise). The UI target is NOT
// openGym's custom dark UI: Material UI (Material 3) — Jetpack Compose
// Material 3 on Android, or Flutter Material 3 cross-platform — with
// screens Today (log sets), Exercise (by muscle group), History / Charts,
// Body (weight), and muscle-group navigation as the primary organisation.
// No videos; a canonical exercise shows at most a short text description.
// No catalogue media is in the repo (user decision Nov 8: code only,
// data downloaded separately and imported at runtime).
//
// Open decisions for Rich (see CANONICAL-EXERCISES.md): canonical
// granularity (e.g. Incline Chest Press separate from Chest Press?),
// muscle-group splits (Legs as one group, or Quads/Hamstrings/Glutes/
// Calves first-class?), Push/Pull/Legs as routine vs exercise groupings,
// alias scope (proposed: gym + equipment + source, in one record).
//
// Answered Nov 8, 2026 (recorded in the taxonomy draft):
//   Q1 YES — Incline Chest Press IS separate from Chest Press: the angle
//     changes muscle emphasis enough to be its own canonical. Flat vs
//     Machine stays one exercise. Decline Chest Press is assumed separate
//     by the same rule and marked provisional below — flag for confirmation.
//   Q2 Legs is split: Quads, Hamstrings, Glutes, Calves are first-class
//     muscle groups, not one "Legs" group. (Legs survives only as a routine
//     grouping in COMPOUND_GROUPINGS.)
//   Q3 still open: Push/Pull/Legs as routine groupings, or as exercise
//     groupings too?
//   Multi-muscle handling: a compound exercise carries one primary muscle
//     plus secondary muscles (e.g. Deadlift primary Hamstrings, secondary
//     Glutes + Back + Quads). Whether a compound ever needs TWO primaries
//     (Deadlift Hamstrings/Glutes) is flagged for confirmation.

// Top-level muscle groups. Compound groupings (Push / Pull / Legs /
// Full Body) cut across these and are routine groupings, not exercises
// (Q3 open: whether they are exercise groupings too).
export const MUSCLE_GROUPS = [
  { id: 'chest', name: 'Chest', muscles: ['Chest'] },
  { id: 'back', name: 'Back', muscles: ['Lats', 'Upper Back', 'Traps'] },
  { id: 'shoulders', name: 'Shoulders', muscles: ['Front Delts', 'Side Delts', 'Rear Delts'] },
  { id: 'arms', name: 'Arms', muscles: ['Biceps', 'Triceps', 'Forearms'] },
  { id: 'quads', name: 'Quads', muscles: ['Quads'] },
  { id: 'hamstrings', name: 'Hamstrings', muscles: ['Hamstrings'] },
  { id: 'glutes', name: 'Glutes', muscles: ['Glutes', 'Adductors'] },
  { id: 'calves', name: 'Calves', muscles: ['Calves'] },
  { id: 'core', name: 'Core', muscles: ['Abs', 'Obliques', 'Lower Back'] },
]

export const COMPOUND_GROUPINGS = ['Push', 'Pull', 'Legs', 'Full Body']

// movement_pattern: push / pull / squat / hinge / lunge / carry / hold /
// rotation / isolation. `compound` is true when the movement trains
// several muscle groups as its grouping, not as a name variant.
export const CANONICAL_EXERCISES = [
  { id: 'chest_press', name: 'Chest Press', group: 'chest', primary: 'Chest', secondary: ['Shoulders', 'Triceps'], pattern: 'push', compound: true },
  // Q1: angle changes emphasis enough to be its own canonical. Flat vs
  // Machine stays one exercise (Chest Press above).
  { id: 'incline_chest_press', name: 'Incline Chest Press', group: 'chest', primary: 'Chest', secondary: ['Shoulders', 'Triceps'], pattern: 'push', compound: true },
  // Assumed separate by the same rule as Incline — provisional, confirm with Rich.
  { id: 'decline_chest_press', name: 'Decline Chest Press', group: 'chest', primary: 'Chest', secondary: ['Shoulders', 'Triceps'], pattern: 'push', compound: true, provisional: true },
  { id: 'cable_fly', name: 'Cable Fly', group: 'chest', primary: 'Chest', secondary: ['Shoulders'], pattern: 'isolation', compound: false },
  { id: 'curl', name: 'Curl', group: 'arms', primary: 'Biceps', secondary: ['Forearms'], pattern: 'isolation', compound: false },
  { id: 'triceps_extension', name: 'Triceps Extension', group: 'arms', primary: 'Triceps', secondary: [], pattern: 'isolation', compound: false },
  { id: 'hip_adduction', name: 'Hip Adduction', group: 'glutes', primary: 'Glutes', secondary: ['Adductors', 'Quads'], pattern: 'isolation', compound: false },
  { id: 'row', name: 'Row', group: 'back', primary: 'Lats', secondary: ['Upper Back', 'Biceps'], pattern: 'pull', compound: true },
  { id: 'shoulder_press', name: 'Shoulder Press', group: 'shoulders', primary: 'Shoulders', secondary: ['Triceps'], pattern: 'push', compound: true },
  { id: 'lateral_raise', name: 'Lateral Raise', group: 'shoulders', primary: 'Shoulders', secondary: [], pattern: 'isolation', compound: false },
  { id: 'squat', name: 'Squat', group: 'quads', primary: 'Quads', secondary: ['Glutes', 'Hamstrings'], pattern: 'squat', compound: true },
  { id: 'deadlift', name: 'Deadlift', group: 'hamstrings', primary: 'Hamstrings', secondary: ['Glutes', 'Back', 'Quads'], pattern: 'hinge', compound: true },
  { id: 'calf_raise', name: 'Calf Raise', group: 'calves', primary: 'Calves', secondary: [], pattern: 'isolation', compound: false },
  { id: 'crunch', name: 'Crunch', group: 'core', primary: 'Abs', secondary: ['Obliques'], pattern: 'isolation', compound: false },
]

/** Canonical id for a name: "Chest Press" -> "chest_press". */
export const canonicalIdFor = name => String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')

const byId = new Map(CANONICAL_EXERCISES.map(e => [e.id, e]))
const byName = new Map(CANONICAL_EXERCISES.map(e => [e.name.toLowerCase(), e]))

/** Find a canonical exercise by id, name, or slug — or null if not in the seed list. */
export function findCanonical(name) {
  if (!name) return null
  return byId.get(canonicalIdFor(name)) || byName.get(String(name).toLowerCase().trim()) || null
}

/**
 * An alias record: the standardized canonical exercise, exposed so the
 * user can say "at this gym, it's this specific equipment name".
 *   canonicalId — e.g. "chest_press"
 *   aliasName — the name as it appears at that gym / in that source, kept
 *     verbatim (e.g. "Seated Machine Chest Press", "Tonal Chest Press").
 *     Source spelling is kept, not silently fixed.
 *   gym — e.g. "Village Health Clubs Ocotillo", "Home / Tonal"
 *   equipment — e.g. machine, barbell, dumbbell, cable, Tonal
 *   source — fitnotes / tonal / progression / manual
 *   sourceKey — the source's own key for the movement (Tonal movementId,
 *     FitNotes exercise name), so a re-import resolves the same alias.
 *   notes — e.g. weight-stack steps, plate increments at that machine.
 * Creating an alias never creates a new canonical exercise.
 */
export function makeAliasRecord({ canonicalId, aliasName, gym = '', equipment = '', source = '', sourceKey = '', notes = '' }) {
  return {
    canonicalId: String(canonicalId || ''),
    aliasName: String(aliasName || ''),
    gym: String(gym || ''),
    equipment: String(equipment || ''),
    source: String(source || ''),
    sourceKey: String(sourceKey || ''),
    notes: String(notes || ''),
  }
}

/**
 * Resolve a source movement to its canonical exercise.
 * `aliasMap` is keyed by the source's own key (Tonal movementId, FitNotes
 * exercise name) and holds alias records (or the older short form
 * { exercise, category }). Returns { canonical, alias } — canonical is the
 * taxonomy record when the alias's exercise is in the seed list, else a
 * minimal record built from the alias name (the seed list is extendable;
 * an unknown name is still one canonical exercise, not a catalogue entry).
 * With no alias, both are null: the caller must not invent a name.
 */
export function resolveCanonical(sourceKey, aliasMap = {}) {
  const alias = aliasMap?.[sourceKey]
  if (!alias) return { canonical: null, alias: null }
  const exercise = alias.exercise || alias.canonicalId || ''
  const record = makeAliasRecord({
    canonicalId: canonicalIdFor(exercise),
    aliasName: alias.sourceName || alias.aliasName || '',
    gym: alias.gym || '',
    equipment: alias.equipment || '',
    source: alias.source || '',
    sourceKey: String(sourceKey || ''),
    notes: alias.notes || '',
  })
  const known = findCanonical(exercise)
  const canonical = known || (exercise ? {
    id: record.canonicalId, name: exercise, group: '', primary: alias.category || '', secondary: [], pattern: '', compound: false,
  } : null)
  return { canonical, alias: record }
}

/** Canonical exercises for one muscle group, in seed order. */
export function exercisesForGroup(groupId) {
  return CANONICAL_EXERCISES.filter(e => e.group === groupId)
}
