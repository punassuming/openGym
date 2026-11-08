// Import a Tonal history (ToneGet JSON / .json.gz) into openGym.
//
// This is the thin openGym adapter over lib/tonal.js, which does the real
// parsing into a neutral model. Everything Tonal-specific that is NOT an
// openGym concept lives in tonal.js; this file only translates the neutral
// model into openGym workouts / custom exercises / store fields, converts
// lb to the profile unit, and merges.
//
// NO DATA IN THE REPO: nothing here bundles an export, a sample file or
// catalogue data. The file is supplied by the user at import time (Settings
// → Data & backup → Import from another app, or a .json.gz picked there);
// tests use small inline synthetic objects, never a committed file.
//
// Identity: a Tonal movement is identified by its CANONICAL NAME, not by
// an openGym catalogue id. Tonal's export carries only a movementId, so the
// alias map (movementId -> canonical name + category, user-supplied) is
// the one mapping that matters; without it the movement lands as a custom
// exercise named by its movementId, flagged name-unresolved. If the
// exercise list were pruned to ~200 canonical movements, nothing here
// changes: no catalogue id is stored anywhere, and the same canonical name
// still groups the same history. Equipment is an attribute (the custom
// exercise's `eq`, from canonicalExerciseName), not a separate exercise.
//
// Per-set Tonal fields: `tonalOneRepMax` and `rangeOfMotion` are first-class
// on the set; `--full` power/tempo/ROM-weight fields ride in `tonalExtra`
// verbatim and are shown only in a per-set details view — they are NEVER
// mapped into RPE/RIR. A manually logged set has none of these fields
// (blank, not 0, not estimated). Tonal's `weight` is the set weight;
// baseWeight is never used as the weight (see lib/tonal.js).
//
// Re-import idempotence: a workout is deduped by its Tonal activity id
// (`tonalId`), not by its date — two Tonal sessions on one day stay two
// workouts, and importing the same file twice adds nothing.

import { importId, priorCustom, bpFromName, parseWhen, roundWeight } from './import-csv.js'
import { completedVolumeOf, isWarmupRow } from './workout-model.js'
import {
  isTonalExport, parseToneGet, parseTonalStrength, parseTonalAliases,
  canonicalExerciseName, crossCheckVolume, mergeTonalStrength,
} from './tonal.js'
import { findCanonical, canonicalIdFor } from './canonical-exercises.js'

export { isTonalExport, mergeTonalStrength }

const LB_TO_KG = 0.45359237
const nameKey = n => String(n || '').toLowerCase().replace(/\s+/g, ' ').trim()

// Alias category -> the dataset body part, via the same name rules the CSV
// importer uses (a category is a word like "Chest" or "Legs").
const bpOfCategory = category => bpFromName(String(category || '').toLowerCase()) || null

/**
 * Decompress a .json.gz payload (ArrayBuffer / Uint8Array) to text.
 * Uses DecompressionStream where the runtime has it (all modern browsers,
 * Node 18+); where it does not exist the caller gets a clear
 * 'gzip-unsupported' error instead of a corrupt import.
 */
export async function gunzipText(input) {
  if (typeof DecompressionStream === 'undefined') return { error: 'gzip-unsupported' }
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
  try {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
    return { text: await new Response(stream).text() }
  } catch {
    return { error: 'unrecognised' }
  }
}

/** Parse a ToneGet payload: a JSON string, or a .json.gz ArrayBuffer/Uint8Array. */
export async function parseTonalFile(input, opts = {}) {
  if (typeof input === 'string') return parseTonalText(input, opts)
  const buf = input instanceof ArrayBuffer ? input : input?.buffer instanceof ArrayBuffer ? input.buffer : null
  if (!buf) return { error: 'unrecognised' }
  const bytes = new Uint8Array(buf)
  // Gzip magic bytes 1f 8b; a plain JSON file starts with '{' or '['.
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    const unzipped = await gunzipText(bytes)
    if (unzipped.error) return { error: unzipped.error }
    return parseTonalText(unzipped.text, opts)
  }
  return parseTonalText(new TextDecoder().decode(bytes), opts)
}

/** Parse ToneGet JSON text. Errors: 'empty', 'unrecognised', or { error: 'format', app: 'Tonal' }. */
export function parseTonalText(text, opts = {}) {
  const s = String(text ?? '')
  if (!s.trim()) return { error: 'empty' }
  let data
  try { data = JSON.parse(s) } catch { return { error: 'unrecognised' } }
  return parseTonal(data, opts)
}

/**
 * Parse a ToneGet export object into openGym workouts.
 * Returns the same shape as lib/import-csv.js parseWorkoutRows (kind,
 * source, workouts, customEx, matched, matchedSets, created,
 * unmatchedNames, sets, skipped, warmups, fileUnit, mixedUnits, converted,
 * rpeSets, rirSets, from, to) plus Tonal extras: tonalStrength,
 * tonalCatalog, tonalUnresolved, tonalWorkoutsMeta, fullOnlyFieldsSeen.
 * A file that looks like ToneGet but has no readable sets is refused with
 * { error: 'format', app: 'Tonal' } rather than half-imported.
 */
export function parseTonal(data, { unit = 'kg', customEx = [], aliases = {} } = {}) {
  if (!isTonalExport(data)) return { error: 'unrecognised' }
  const parsed = parseToneGet(data, { aliases })
  if (!parsed.workouts.length) return { error: 'empty' }
  const totalSets = parsed.sets
  if (totalSets === 0 || parsed.workouts.every(w => !w.sets.length)) {
    return { error: 'format', app: 'Tonal' }
  }

  const toProfile = lb => {
    if (lb == null) return null
    return unit === 'lb' ? roundWeight(lb) : roundWeight(lb * LB_TO_KG)
  }
  const created = new Map()
  const unmatched = new Set()
  const resolved = new Map()
  const aliasMap = parseTonalAliases(aliases)
  let matched = 0
  let matchedSets = 0
  let warmups = 0
  let sets = 0

  const workouts = parsed.workouts.map(w => {
    const when = parseWhen(w.date + (w.startMs ? 'T' + new Date(w.startMs).toISOString().slice(11, 19) : ''))
    const d = when?.d || w.date
    const start = when?.t ?? 18 * 3600000
    const entriesById = new Map()
    for (const s of w.sets) {
      sets++
      if (s.warmup) warmups++
      // Identity is the canonical name, never a catalogue id. The custom
      // exercise id is a deterministic hash of that name, so the same
      // movement imported on two devices (or after a catalogue prune)
      // is the same exercise.
      const key = nameKey(s.exercise)
      let id = resolved.get(key)
      if (id === undefined) {
        const alias = aliasMap[s.movementId]
        const mine = priorCustom(customEx, importId('im', 'Tonal|' + key), s.exercise)
        if (mine) { id = mine.id; matched++ }
        else {
          id = importId('im', 'Tonal|' + key)
          if (!created.has(key)) {
            const canon = canonicalExerciseName(s.exercise)
            const taxonomy = findCanonical(s.exercise)
            created.set(key, {
              id, n: s.exercise.toLowerCase(), custom: true,
              // Equipment came off the source name in tonal.js (s.equipment)
              // — the canonical name no longer carries it, so read it here.
              eq: s.equipment || canon.equipment || 'custom', tg: '', desc: '',
              // Canonical identity for the muscle-group model: the slug
              // (e.g. "chest_press") is what the leaner Material UI app
              // will group by. The openGym id above is only the local key.
              canonical: taxonomy?.id || canonicalIdFor(s.exercise),
              bp: bpFromName(taxonomy?.primary || '') || bpOfCategory(s.category) || bpFromName(s.exercise.toLowerCase()) || 'upper legs',
              ...(s.movementId ? { tonalMovementId: s.movementId } : {}),
            })
            if (!alias) unmatched.add(s.exercise)
          }
        }
        resolved.set(key, id)
      }
      if (s.movementId && !parsed.unresolvedMovementIds.includes(s.movementId)) matchedSets++
      const set = {
        w: toProfile(s.weightLb) ?? 0,
        r: s.reps || 0,
        done: true,
        ...(s.warmup ? { phase: 'warmup' } : {}),
        ...(s.oneRepMaxLb != null ? { tonalOneRepMax: toProfile(s.oneRepMaxLb) } : {}),
        ...(s.rangeOfMotion != null ? { rangeOfMotion: s.rangeOfMotion } : {}),
        ...(Object.keys(s.extra).length ? { tonalExtra: s.extra } : {}),
        ...(s.baseWeightPresent ? { tonalBaseWeightPresent: true } : {}),
      }
      if (!entriesById.has(id)) entriesById.set(id, [])
      entriesById.get(id).push(set)
    }
    const entries = [...entriesById.entries()].map(([id, ss]) => {
      const mx = Math.max(0, ...ss.filter(x => !isWarmupRow(x)).map(x => x.w || 0))
      return { id, sets: ss, topW: mx || null }
    })
    const base = new Date(d + 'T00:00:00').getTime()
    const cross = crossCheckVolume(w)
    const workout = {
      id: importId('iw', JSON.stringify(['Tonal', w.id, d, start, entries.map(e => [e.id, e.sets])])),
      tonalId: w.id || null,
      d, start: base + start, end: base + start,
      routineId: null, name: w.title || 'Imported', entries, prs: [],
      workoutType: w.type || null,
      tonalTotalVolume: w.totalVolume ?? null,
      tonalTotalReps: w.totalReps ?? null,
      tonalVolumeMismatch: cross.mismatch,
    }
    workout.vol = entries.reduce((a, e) => a + e.sets.reduce((b, s) => b + (isWarmupRow(s) ? 0 : completedVolumeOf(s)), 0), 0)
    return workout
  })

  const dates = workouts.map(w => w.d).sort()
  return {
    kind: 'workouts', source: 'Tonal', workouts,
    customEx: [...created.values()],
    matched,
    matchedIds: [...resolved.values()],
    matchedSets, created: created.size,
    unmatchedNames: [...unmatched].sort(),
    sets, skipped: Object.values(parsed.skipped).reduce((a, b) => a + b, 0),
    warmups, fileUnit: 'lb', mixedUnits: false, converted: unit !== 'lb',
    rpeSets: 0, rirSets: 0,
    from: dates[0] || null, to: dates[dates.length - 1] || null,
    tonalStrength: parsed.strength,
    tonalCatalog: parsed.catalog,
    // Alias records, with the canonical exercise resolved to its openGym
    // id. mergeTonal records these into S.exAliases (openGym's own
    // exercise-id -> [alias names] map), so the source name survives as an
    // alias — gym / equipment / source — and a later import from the same
    // gym resolves the same canonical exercise without a new alias file.
    tonalAliases: (parsed.tonalAliases || []).map(a => ({
      ...a, exerciseId: resolved.get(nameKey(a.exercise)) || null,
    })),
    tonalUnresolved: parsed.unresolvedMovementIds,
    tonalWorkoutsMeta: parsed.workouts.map(w => ({
      tonalId: w.id || null, date: w.date, title: w.title, type: w.type,
      totalVolume: w.totalVolume ?? null, totalReps: w.totalReps ?? null,
      nSets: w.sets.length,
    })),
    fullOnlyFieldsSeen: parsed.fullOnlyFieldsSeen,
    unmappedSetFields: parsed.unmappedSetFields,
    unmappedWorkoutFields: parsed.unmappedWorkoutFields,
  }
}

/**
 * Merge a parsed Tonal import into state. Workouts dedupe by Tonal activity
 * id (`tonalId`), not by date — two sessions on one day stay two workouts,
 * and re-importing the same file adds nothing. Strength Score merges by
 * (date, kind) and muscle name (lib/tonal.js mergeTonalStrength); the
 * catalog merges by template id. Custom exercises are shared by name with
 * the ones already here, as mergeImport does.
 * Returns { added, skipped, strengthHistory, strengthMuscles, catalog }.
 */
export function mergeTonal(S, parsed) {
  S.customEx = S.customEx || []
  S.workouts = S.workouts || []
  S.exWeights = S.exWeights || {}
  const exIdMap = {}
  for (const c of parsed.customEx || []) {
    const same = S.customEx.find(x => x.id !== c.id && nameKey(x.n) === nameKey(c.n))
    if (same) exIdMap[c.id] = same.id
  }
  const haveIds = new Set(S.workouts.map(w => w.tonalId || w.id).filter(Boolean))
  const fresh = parsed.workouts.filter(w => !haveIds.has(w.tonalId || w.id))
    .map(w => ({ ...w, entries: w.entries.map(e => (exIdMap[e.id] ? { ...e, id: exIdMap[e.id] } : e)) }))
  const used = new Set(fresh.flatMap(w => w.entries.map(e => e.id)))
  const known = new Set(S.customEx.map(c => c?.id))
  const customs = (parsed.customEx || []).filter(c => used.has(c.id) && !known.has(c.id))
  S.customEx = [...S.customEx, ...customs]
  S.workouts = [...S.workouts, ...fresh].sort((a, b) => (a.d === b.d ? (a.start || 0) - (b.start || 0) : a.d < b.d ? -1 : 1))
  fresh.forEach(w => w.entries.forEach(e => {
    const mx = Math.max(0, ...e.sets.map(s => s.w || 0), e.topW || 0)
    if (mx > 0) { const cur = S.exWeights[e.id]; if (!cur || w.d >= cur.d) S.exWeights[e.id] = { w: mx, d: w.d } }
  }))
  const before = S.tonalStrength || null
  S.tonalStrength = parsed.tonalStrength ? mergeTonalStrength(before, parsed.tonalStrength) : before
  S.tonalCatalog = { ...(S.tonalCatalog || {}), ...(parsed.tonalCatalog || {}) }
  // Alias layer: the source name (e.g. "Tonal Chest Press" at Home / Tonal)
  // is kept as an alias on the canonical exercise, never as a new exercise.
  // S.exAliases is openGym's own shape: exercise id -> [alias names].
  let aliasesAdded = 0
  const exAliases = { ...(S.exAliases || {}) }
  for (const a of parsed.tonalAliases || []) {
    if (!a?.aliasName || !a.exerciseId) continue
    const id = exIdMap[a.exerciseId] || a.exerciseId
    const list = [...(exAliases[id] || [])]
    if (!list.some(x => String(x).toLowerCase() === a.aliasName.toLowerCase())) {
      list.push(a.aliasName)
      aliasesAdded++
    }
    exAliases[id] = list
  }
  if (aliasesAdded) S.exAliases = exAliases
  return {
    added: fresh.length,
    skipped: parsed.workouts.length - fresh.length,
    strengthHistory: (S.tonalStrength?.history || []).length,
    strengthMuscles: (S.tonalStrength?.current?.muscles || []).length,
    catalog: Object.keys(S.tonalCatalog || {}).length,
    aliasesAdded,
  }
}

/** Re-exported for callers that only need the strength parser. */
export { parseTonalStrength }
