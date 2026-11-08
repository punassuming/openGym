// Tonal (ToneGet) data — portable, dependency-free.
//
// This module knows nothing about openGym: no catalogue ids, no media, no
// store shape. It parses a ToneGet export (v3.1) into a neutral model that
// any app — openGym today, a leaner tracker tomorrow — can adapt. The
// openGym-specific adapter lives in lib/import-tonal.js, which is the only
// file that knows openGym's workout/set shapes.
//
// Real format — ToneGet v3.1.0 (curlrequests/toneget), verified Nov 8, 2026:
//   file: tonal_workouts_YYYYMMDD_HHMMSS.json.gz (a .json is saved alongside)
//   top level: version, exportedAt, exportedWith, user, profile,
//     workouts, activityNames, workoutCatalog, customWorkouts,
//     strengthScoreHistory, currentStrengthScores
//   workout: id, beginTime, workoutType (PROGRAM / ON_DEMAND / QUICK_FIT /
//     LIVE / MOVEMENT / ASSESSMENT / Custom), workoutTitle, totalVolume,
//     totalReps, workoutId (template id -> workoutCatalog),
//     workoutSetActivity: [{ movementId, weight, repCount, oneRepMax,
//     rangeOfMotion, ... }]
//   strengthScoreHistory: [{ date, overall, upper, lower, core }]
//   currentStrengthScores: { raw: [{ strengthBodyRegion, score,
//     familyActivity: [{ strengthFamily, score, updatedAt }] }],
//     parsed: { regions: { Overall, Upper, Lower, Core },
//       muscles: { Chest: { score, region, updatedAt } } } }
//
// NO DATA IN THE REPO: this module bundles no export, no sample file and no
// catalogue data. It only ever reads a file the user supplies at import
// time. Tests use small inline synthetic objects, never a committed file.
//
// Movement names are NOT in the export — only movementId. Nothing here
// invents a name: a movement stays its movementId until an alias map
// (movementId -> canonical exercise name + category) resolves it. See
// parseTonalAliases() and the example alias file in the analytics scaffold
// (tonal_movement_aliases.csv — NOT committed to this repo).
//
// baseWeight: the per-cable baseWeight caveat came from a DIFFERENT Tonal
// sessions.json source, NOT ToneGet. In ToneGet the set field is `weight`.
// baseWeight is never used as the weight here; if it shows up in a file it
// is preserved verbatim in the set's extra fields and flagged, not applied.
//
// Canonical exercises: identity is the canonical *name*, not a catalogue
// id. Similar movements that differ only by equipment ("Barbell Bench
// Press", "Dumbbell Bench Press") canonicalise to one exercise —
// "Bench Press" — with the equipment kept as an attribute, not a separate
// exercise. That is what makes this portable to a tracker whose exercise
// list is ~200 canonical movements instead of thousands of qualified
// catalogue entries: the only mapping a Tonal import needs is
// movementId -> canonical name, and that lives in the alias map, not in
// any catalogue.

// Set keys mapped explicitly. Everything else on a set goes into `extra`
// verbatim — never silently dropped.
export const KNOWN_SET_KEYS = new Set([
  'movementId', 'movementID', 'movementName', 'name', 'exercise', 'weight',
  'weight_lbs', 'weightLb', 'totalWeight', 'baseWeight',
  'repCount', 'reps', 'oneRepMax', 'one_rep_max',
  'rangeOfMotion', 'range_of_motion', 'duration', 'duration_sec',
  'durationSec', 'isWarmup', 'warmup', 'pr', 'prs',
  'category', 'muscle', 'muscleGroup',
])
// --full-only keys ToneGet's trim list removes (so their presence proves a
// --full export). Kept in `extra` like any other unmapped key.
export const FULL_ONLY_KEYS = new Set([
  'beginTimeMCB', 'endTimeMCB', 'romWeightMode', 'romWeight',
  'romWeightFrac', 'isoModeSpeed', 'dualMotorReps',
  'suggestedResistanceLevel', 'offMachineModifiedWeight',
  'userWeightPounds', 'meanMaxPos', 'velAtMaxConPower',
  'weightAtMaxConPower', 'inchesUpdated', 'powerUpdated',
  'triggeredFeedback',
])

export const TONAL_WORKOUT_TYPES = [
  'PROGRAM', 'ON_DEMAND', 'QUICK_FIT', 'LIVE', 'MOVEMENT', 'ASSESSMENT', 'Custom',
]

const first = (d, ...keys) => {
  for (const k of keys) if (d && d[k] != null) return d[k]
  return undefined
}
const num = v => {
  const n = parseFloat(v)
  return Number.isFinite(n) ? n : null
}
const int = v => {
  const n = num(v)
  return n == null ? null : Math.round(n)
}

/** "2026-09-09T08:00:00Z" / "2026-09-09" -> "2026-09-09", or null. */
export function tonalDate(v) {
  const m = String(v ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return null
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
  if (d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) return null
  return `${m[1]}-${m[2]}-${m[3]}`
}

// Equipment words: a qualifier on a movement, never the movement itself.
// "Barbell Bench Press" and "Dumbbell Bench Press" are the same canonical
// exercise ("Bench Press") done with different equipment.
const EQUIPMENT = [
  ['ez barbell', 'ez barbell'], ['barbell', 'barbell'], ['dumbbell', 'dumbbell'],
  ['kettlebell', 'kettlebell'], ['cable', 'cable'], ['smith', 'smith'],
  ['machine', 'machine'], ['lever', 'lever'], ['band', 'band'],
  ['bodyweight', 'bodyweight'], ['body weight', 'bodyweight'],
]

/**
 * A movement name -> its canonical exercise identity.
 * Returns { name, equipment }: the name with equipment qualifiers stripped
 * (leading equipment word, or a parenthetical "(Barbell)" / "(Machine)"),
 * and the equipment found, or null. The canonical name is the identity:
 * two names that canonicalise alike are the same exercise.
 * A name that is only an equipment word, or empty, canonicalises to itself.
 */
export function canonicalExerciseName(name) {
  let s = String(name || '').trim().replace(/\s+/g, ' ')
  if (!s) return { name: '', equipment: null }
  let equipment = null
  // Parenthetical equipment first: "Bench Press (Barbell)" -> "Bench Press".
  s = s.replace(/\(([^)]*)\)/g, (_, inner) => {
    const k = inner.trim().toLowerCase()
    const hit = EQUIPMENT.find(([word]) => k === word || k.startsWith(word + ' '))
    if (hit && !equipment) equipment = hit[1]
    return hit ? '' : `(${inner})`
  }).replace(/\s+/g, ' ').trim()
  // Leading equipment word: "Barbell Bench Press" -> "Bench Press".
  const lower = s.toLowerCase()
  for (const [word, eq] of EQUIPMENT) {
    if (lower === word) { return { name: s, equipment: equipment || eq } }
    if (lower.startsWith(word + ' ')) {
      s = s.slice(word.length).trim()
      equipment = equipment || eq
      break
    }
  }
  return { name: s, equipment }
}

/** True when `data` looks like a ToneGet export (or the legacy generic shape). */
export function isTonalExport(data) {
  if (!data || typeof data !== 'object') return false
  const workouts = Array.isArray(data) ? data : data.workouts
  if (!Array.isArray(workouts) || !workouts.length) return false
  if (Array.isArray(data)) return workouts.some(w => w && typeof w === 'object' && (Array.isArray(w.workoutSetActivity) || Array.isArray(w.movements) || Array.isArray(w.exercises)))
  const toneget = data.version != null || data.exportedWith != null || data.workoutCatalog != null
    || data.strengthScoreHistory != null || data.currentStrengthScores != null
  if (toneget) return true
  return workouts.some(w => w && typeof w === 'object' && (Array.isArray(w.workoutSetActivity) || Array.isArray(w.movements) || Array.isArray(w.exercises)))
}

/** workoutTitle, else catalog[workoutId].title, else activityNames[id]. */
export function resolveTonalTitle(workout, catalog = {}, activityNames = {}) {
  const title = first(workout, 'workoutTitle', 'title', 'name', 'workoutName')
  if (title) return String(title)
  const wid = workout?.workoutId
  if (wid && catalog?.[wid]?.title) return String(catalog[wid].title)
  const id = workout?.id
  if (id && activityNames?.[id]) return String(activityNames[id])
  return ''
}

/**
 * Alias map text (CSV) -> { movementId: alias record }.
 * Columns (by header name when present, else positionally):
 *   movement_id, exercise, category, gym, equipment, source_name, source, notes
 * The 3-column form (movement_id, exercise, category) still reads.
 * Also accepts an already-parsed object in the same shape, returned as-is.
 * Alias record shape (see lib/canonical-exercises.js makeAliasRecord):
 *   { exercise (canonical name), category, gym, equipment,
 *     sourceName (the name as it appears in the source — kept verbatim),
 *     source, notes }. The alias file is user-supplied, never bundled:
 * see the example in the analytics scaffold (tonal_movement_aliases.csv
 * — not in this repo).
 */
export function parseTonalAliases(input) {
  if (!input) return {}
  if (typeof input === 'object') return input
  const out = {}
  const lines = String(input).split(/\r?\n/).filter(l => l.trim())
  if (!lines.length) return out
  const head = lines[0].toLowerCase()
  const hasHeader = /movement/.test(head)
  const cols = hasHeader ? head.split(',').map(c => c.trim()) : ['movement_id', 'exercise', 'category', 'gym', 'equipment', 'source_name', 'source', 'notes']
  const idx = name => cols.findIndex(c => c === name || c === name.replace('_', ''))
  const rows = hasHeader ? lines.slice(1) : lines
  for (const line of rows) {
    const cells = line.split(',').map(c => c.trim())
    const get = (...names) => {
      for (const n of names) { const i = idx(n); if (i >= 0 && cells[i]) return cells[i] }
      return ''
    }
    const mid = get('movement_id', 'movementid')
    if (!mid) continue
    out[mid] = {
      exercise: get('exercise', 'canonical', 'canonical_exercise'),
      category: get('category'),
      gym: get('gym'),
      equipment: get('equipment'),
      sourceName: get('source_name', 'sourcename', 'alias_name', 'aliasname'),
      source: get('source'),
      notes: get('notes'),
    }
  }
  return out
}

function strengthHistory(data, exportedAt) {
  const rows = []
  const skipped = {}
  const hist = data?.strengthScoreHistory
  if (hist == null) return { rows, skipped }
  if (!Array.isArray(hist)) { skipped['strengthScoreHistory not a list'] = 1; return { rows, skipped } }
  for (const entry of hist) {
    if (!entry || typeof entry !== 'object') { skipped['strength history entry not an object'] = (skipped['strength history entry not an object'] || 0) + 1; continue }
    let date = tonalDate(first(entry, 'date', 'createdAt', 'timestamp', 'beginTime', 'recordedAt', 'updatedAt', 'scoreDate', 'dateTime'))
    if (!date) date = tonalDate(exportedAt)
    if (!date) { skipped['strength history entry missing date'] = (skipped['strength history entry missing date'] || 0) + 1; continue }
    rows.push({
      date, kind: 'history',
      overall: num(first(entry, 'overall', 'Overall')),
      upper: num(first(entry, 'upper', 'Upper')),
      lower: num(first(entry, 'lower', 'Lower')),
      core: num(first(entry, 'core', 'Core')),
    })
  }
  return { rows, skipped }
}

function currentStrength(data, exportedAt) {
  const date = tonalDate(exportedAt) || ''
  const regions = {}
  const muscles = {}
  const skipped = {}
  const cur = data?.currentStrengthScores
  if (cur == null || cur === {} || cur === []) return { regions, muscles, date, skipped }
  if (typeof cur === 'object' && cur.parsed && typeof cur.parsed === 'object') {
    const parsed = cur.parsed
    if (parsed.regions && typeof parsed.regions === 'object') {
      for (const [k, v] of Object.entries(parsed.regions)) regions[String(k)] = num(v)
    }
    if (parsed.muscles && typeof parsed.muscles === 'object') {
      for (const [name, m] of Object.entries(parsed.muscles)) {
        if (m && typeof m === 'object') muscles[String(name)] = { score: num(m.score), region: String(m.region || ''), updatedAt: String(m.updatedAt || '') }
        else muscles[String(name)] = { score: num(m), region: '', updatedAt: '' }
      }
    }
  } else {
    const raw = Array.isArray(cur) ? cur : Array.isArray(cur?.raw) ? cur.raw : null
    if (!raw) { skipped['currentStrengthScores unrecognised shape'] = 1; return { regions, muscles, date, skipped } }
    for (const region of raw) {
      if (!region || typeof region !== 'object') continue
      const rname = String(region.strengthBodyRegion || '')
      if (rname) regions[rname] = num(region.score)
      for (const m of region.familyActivity || []) {
        if (!m || typeof m !== 'object' || !m.strengthFamily) continue
        muscles[String(m.strengthFamily)] = { score: num(m.score), region: rname, updatedAt: String(m.updatedAt || '') }
      }
    }
  }
  return { regions, muscles, date, skipped }
}

/**
 * Strength Score, parsed once for every consumer.
 * Returns { history: [{ date, kind: 'history'|'current', overall, upper, lower, core }],
 *   current: { regions, muscles: [{ muscle, region, score, updatedAt }], exportedAt } | null,
 *   skipped }.
 * `history` holds the dated entries; the current snapshot is appended to it
 * as kind 'current' (dated at the export) so a trend line can include it.
 * A muscle with no Tonal score is absent here, never 0.
 */
export function parseTonalStrength(data) {
  const exportedAt = data?.exportedAt
  const { rows, skipped: hSkip } = strengthHistory(data, exportedAt)
  const { regions, muscles, date, skipped: cSkip } = currentStrength(data, exportedAt)
  const skipped = { ...hSkip, ...cSkip }
  const history = [...rows]
  let current = null
  if (Object.keys(regions).length) {
    current = {
      regions,
      muscles: Object.keys(muscles).sort().map(name => ({ muscle: name, ...muscles[name] })),
      exportedAt: exportedAt || null,
    }
    history.push({
      date: date || rows[rows.length - 1]?.date || '',
      kind: 'current',
      overall: regions.Overall ?? null,
      upper: regions.Upper ?? null,
      lower: regions.Lower ?? null,
      core: regions.Core ?? null,
    })
  }
  history.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  return { history, current, skipped }
}

/**
 * Merge two parsed strength states (e.g. two devices' copies, or a fresh
 * import over an old one). History unions by (date, kind), the later copy
 * winning a conflict; muscles union by muscle name, the later updatedAt
 * winning; current is whichever copy was exported later.
 */
export function mergeTonalStrength(a, b) {
  const A = a || { history: [], current: null }
  const B = b || { history: [], current: null }
  const byKey = new Map()
  for (const row of [...(A.history || []), ...(B.history || [])]) {
    if (!row || !row.date) continue
    byKey.set(`${row.date}|${row.kind || 'history'}`, row)
  }
  const history = [...byKey.values()].sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0))
  const muscles = new Map()
  for (const m of [...(A.current?.muscles || []), ...(B.current?.muscles || [])]) {
    if (!m?.muscle) continue
    const prev = muscles.get(m.muscle)
    if (!prev || String(m.updatedAt || '') >= String(prev.updatedAt || '')) muscles.set(m.muscle, m)
  }
  const aAt = A.current?.exportedAt || ''
  const bAt = B.current?.exportedAt || ''
  const current = bAt >= aAt && B.current ? B.current : A.current || B.current || null
  const mergedCurrent = current
    ? { ...current, muscles: [...muscles.values()].sort((x, y) => (x.muscle < y.muscle ? -1 : 1)) }
    : null
  return { history, current: mergedCurrent }
}

/** Strength Score trend: { from, to, deltaOverall, points } (dates sorted). */
export function tonalStrengthTrend(strength) {
  const points = [...(strength?.history || [])]
    .filter(p => p && p.date && p.overall != null)
    .sort((a, b) => (a.date < b.date ? -1 : 1))
  if (!points.length) return { from: null, to: null, deltaOverall: null, points: [] }
  return {
    from: points[0].overall, to: points[points.length - 1].overall,
    deltaOverall: points[points.length - 1].overall - points[0].overall,
    points,
  }
}

/**
 * Parse a ToneGet export into the neutral model.
 * Returns { workouts, strength, catalog, customWorkouts, profile,
 *   sets, skipped, unmappedSetFields, unmappedWorkoutFields,
 *   fullOnlyFieldsSeen, unresolvedMovementIds }.
 * Each workout: { id, date, startMs, title, type, totalVolume, totalReps,
 *   sets: [{ movementId, exercise, category, equipment, weightLb, reps,
 *   oneRepMaxLb, rangeOfMotion, warmup, pr, extra, baseWeightPresent,
 *   alias }] }. `alias` is the alias record for the movement (canonicalId,
 *   aliasName, gym, equipment, source, sourceKey, notes) when the alias
 *   map resolved it, else null. `tonalAliases` on the result lists the
 *   alias records actually used, one per movement.
 * `exercise` is the alias's canonical name when the alias map resolves the
 * movementId, else the movementId itself (flagged in
 * `unresolvedMovementIds` and on the set). Weights stay in lb here — the
 * adapter converts to the profile unit. Nothing is dropped: unmapped set
 * fields land verbatim in `extra`, unmapped workout fields in
 * `workoutExtra`, and both are counted.
 */
export function parseToneGet(data, { aliases = {} } = {}) {
  const aliasMap = parseTonalAliases(aliases)
  const exportedAt = data?.exportedAt
  const catalogRaw = data?.workoutCatalog && typeof data.workoutCatalog === 'object' ? data.workoutCatalog : {}
  const activityNames = data?.activityNames && typeof data.activityNames === 'object' ? data.activityNames : {}
  const customRaw = data?.customWorkouts && typeof data.customWorkouts === 'object' ? data.customWorkouts : {}
  const customIds = new Set(Object.keys(customRaw))

  const catalog = {}
  for (const [tid, entry] of Object.entries(catalogRaw)) {
    if (entry && typeof entry === 'object') {
      catalog[String(tid)] = { title: String(entry.title || ''), workoutType: String(entry.workoutType || ''), isCustom: customIds.has(String(tid)) }
    }
  }
  for (const [tid, entry] of Object.entries(customRaw)) {
    if (!catalog[tid] && entry && typeof entry === 'object') {
      catalog[String(tid)] = { title: String(entry.title || ''), workoutType: String(entry.workoutType || ''), isCustom: true }
    }
  }

  const strength = parseTonalStrength(data)
  const workouts = []
  const skipped = { ...strength.skipped }
  const unmappedSetFields = {}
  const unmappedWorkoutFields = {}
  const unresolved = new Set()
  let sets = 0
  let fullOnlyFieldsSeen = 0

  const rawWorkouts = Array.isArray(data) ? data : Array.isArray(data?.workouts) ? data.workouts : []
  for (const w of rawWorkouts) {
    if (!w || typeof w !== 'object') { skipped['workout not an object'] = (skipped['workout not an object'] || 0) + 1; continue }
    const date = tonalDate(first(w, 'beginTime', 'date', 'timestamp', 'startTime', 'createdAt', 'start_time', 'workoutDate'))
    if (!date) { skipped['workout missing date'] = (skipped['workout missing date'] || 0) + 1; continue }
    const title = resolveTonalTitle(w, catalogRaw, activityNames)
    const type = String(first(w, 'workoutType', 'type') || '')
    const startMs = Date.parse(first(w, 'beginTime') || date) || null
    const knownW = new Set(['id', 'beginTime', 'date', 'timestamp', 'startTime', 'createdAt', 'start_time', 'workoutDate', 'workoutType', 'type', 'workoutTitle', 'title', 'name', 'workoutName', 'totalVolume', 'totalReps', 'workoutId', 'workoutSetActivity', 'movements', 'exercises', 'sets', 'items', 'deletedAt'])
    const workoutExtra = {}
    for (const [k, v] of Object.entries(w)) {
      if (!knownW.has(k)) { workoutExtra[k] = v; unmappedWorkoutFields[k] = (unmappedWorkoutFields[k] || 0) + 1 }
    }

    const out = {
      id: String(w.id || ''), date, startMs, title, type,
      totalVolume: num(first(w, 'totalVolume')),
      totalReps: int(first(w, 'totalReps')),
      sets: [], workoutExtra,
    }

    const setList = w.workoutSetActivity
    if (Array.isArray(setList)) {
      setList.forEach((s, idx) => {
        if (!s || typeof s !== 'object') return
        sets++
        const mid = String(first(s, 'movementId', 'movementID') || '')
        if (!mid) { skipped['set missing movementId'] = (skipped['set missing movementId'] || 0) + 1; return }
        const weightLb = num(first(s, 'weight'))
        const baseWeightPresent = s.baseWeight != null
        const reps = int(first(s, 'repCount', 'reps'))
        const durationSec = num(first(s, 'duration_sec', 'duration', 'durationSec'))
        if (reps == null && durationSec == null) { skipped['set with no reps/duration'] = (skipped['set with no reps/duration'] || 0) + 1; return }
        const alias = aliasMap[mid]
        let exercise, category, equipment, aliasRecord
        if (alias?.exercise) {
          const c = canonicalExerciseName(alias.exercise)
          exercise = c.name
          equipment = alias.equipment || c.equipment
          category = alias.category || ''
          // The source name is preserved as an alias (gym / equipment /
          // source), never as a separate exercise. The alias name is the
          // name as it appears in the source; without one there is nothing
          // to record — the movementId is the source key, not a name.
          aliasRecord = {
            canonicalId: exercise.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''),
            exercise,
            aliasName: alias.sourceName || alias.aliasName || '',
            gym: alias.gym || '',
            equipment: equipment || '',
            source: alias.source || 'tonal',
            sourceKey: mid,
            notes: alias.notes || '',
          }
        } else {
          exercise = mid
          category = ''
          equipment = null
          aliasRecord = null
          unresolved.add(mid)
        }
        const extra = {}
        for (const [k, v] of Object.entries(s)) {
          if (!KNOWN_SET_KEYS.has(k)) {
            extra[k] = v
            unmappedSetFields[k] = (unmappedSetFields[k] || 0) + 1
            if (FULL_ONLY_KEYS.has(k)) fullOnlyFieldsSeen++
          }
        }
        out.sets.push({
          movementId: mid, exercise, category, equipment,
          weightLb, reps, durationSec,
          oneRepMaxLb: num(first(s, 'oneRepMax')),
          rangeOfMotion: num(first(s, 'rangeOfMotion')),
          warmup: Boolean(first(s, 'isWarmup', 'warmup')),
          pr: Boolean(first(s, 'pr')) || Boolean(first(s, 'prs')),
          extra, baseWeightPresent, setIndex: idx,
          alias: aliasRecord,
        })
      })
      workouts.push(out)
      continue
    }

    // Legacy generic shape (movements/exercises/sets) — not ToneGet, kept
    // so an older sessions file still reads. baseWeight is used here as a
    // fallback ONLY for this shape, and flagged on the set.
    let moved = false
    for (const k of ['movements', 'exercises', 'sets', 'items']) {
      const v = w[k]
      if (!Array.isArray(v)) continue
      moved = true
      for (const mv of v) {
        if (!mv || typeof mv !== 'object') continue
        const name = first(mv, 'name', 'movementName', 'exercise', 'movement') || title
        if (!name) { skipped['movement missing name'] = (skipped['movement missing name'] || 0) + 1; continue }
        const cat = first(mv, 'category', 'muscle', 'muscleGroup') || ''
        const mvSets = Array.isArray(mv.sets) ? mv.sets : (('reps' in mv || 'weight' in mv) ? [mv] : [])
        mvSets.forEach((s, idx) => {
          if (!s || typeof s !== 'object') return
          sets++
          let weightLb = num(first(s, 'weight_lbs', 'weightLb', 'weight', 'totalWeight'))
          let baseWeightPresent = false
          if (weightLb == null) {
            weightLb = num(first(s, 'baseWeight'))
            baseWeightPresent = weightLb != null
          }
          const reps = int(first(s, 'reps'))
          const durationSec = num(first(s, 'duration_sec', 'duration', 'durationSec'))
          if (reps == null && durationSec == null) { skipped['set with no reps/duration'] = (skipped['set with no reps/duration'] || 0) + 1; return }
          const c = canonicalExerciseName(String(name))
          out.sets.push({
            movementId: '', exercise: c.name, category: String(cat), equipment: c.equipment,
            weightLb, reps, durationSec,
            oneRepMaxLb: num(first(s, 'oneRepMax')),
            rangeOfMotion: num(first(s, 'rangeOfMotion')),
            warmup: Boolean(first(s, 'isWarmup', 'warmup')),
            pr: Boolean(first(s, 'pr')) || Boolean(first(s, 'prs')),
            extra: {}, baseWeightPresent, setIndex: idx,
            alias: null,
          })
        })
      }
      break
    }
    if (moved) workouts.push(out)
    else skipped['workout with no workoutSetActivity or movements'] = (skipped['workout with no workoutSetActivity or movements'] || 0) + 1
  }

  return {
    workouts, strength, catalog,
    customWorkouts: Object.keys(customRaw),
    profile: data?.profile && typeof data.profile === 'object'
      ? { totalWorkouts: data.profile.totalWorkouts ?? null, totalVolume: data.profile.totalVolume ?? null }
      : null,
    exportedAt: exportedAt || null,
    sets, skipped, unmappedSetFields, unmappedWorkoutFields,
    fullOnlyFieldsSeen, unresolvedMovementIds: [...unresolved].sort(),
    // Alias records actually used (one per movement, only where the alias
    // map gave the movement a source name). The adapter records these so
    // the next import from the same gym resolves the same alias.
    tonalAliases: [...new Map(
      workouts.flatMap(w => w.sets).filter(s => s.alias?.aliasName).map(s => [s.alias.sourceKey, s.alias]),
    ).values()],
  }
}

/**
 * Tonal's own total for a workout vs the total recomputed from its sets
 * (Σ weight × reps, work sets only, in lb). A mismatch is usually a
 * per-cable / dual-cable weight — which is exactly why both numbers must
 * stay visible. Returns { tonalTotal, recomputedLb, diff, mismatch }.
 * `mismatch` is true when the two differ by more than rounding (0.5 lb).
 */
export function crossCheckVolume(workout) {
  const tonalTotal = workout?.totalVolume
  const recomputedLb = (workout?.sets || []).reduce((a, s) => a + (s.warmup ? 0 : (s.weightLb || 0) * (s.reps || 0)), 0)
  if (tonalTotal == null) return { tonalTotal: null, recomputedLb, diff: null, mismatch: false }
  const diff = Math.round((tonalTotal - recomputedLb) * 100) / 100
  return { tonalTotal, recomputedLb, diff, mismatch: Math.abs(diff) > 0.5 }
}

/** Per-movement Tonal 1RM curve: [{ date, oneRepMax, weight, reps }], by date. */
export function tonalOneRmCurve(workouts, movementId) {
  const points = []
  for (const w of workouts || []) {
    const set = (w.sets || []).filter(s => s.movementId === movementId && s.oneRepMaxLb != null)
    if (!set.length) continue
    const best = set.reduce((a, b) => (b.oneRepMaxLb > a.oneRepMaxLb ? b : a))
    points.push({ date: w.date, oneRepMax: best.oneRepMaxLb, weight: best.weightLb, reps: best.reps })
  }
  return points.sort((a, b) => (a.date < b.date ? -1 : 1))
}

/** Per-movement mean ROM per session: [{ date, meanRom, n }], by date. */
export function romTrend(workouts, movementId) {
  const points = []
  for (const w of workouts || []) {
    const roms = (w.sets || []).filter(s => s.movementId === movementId && s.rangeOfMotion != null).map(s => s.rangeOfMotion)
    if (!roms.length) continue
    const mean = roms.reduce((a, b) => a + b, 0) / roms.length
    points.push({ date: w.date, meanRom: Math.round(mean * 1000) / 1000, n: roms.length })
  }
  return points.sort((a, b) => (a.date < b.date ? -1 : 1))
}
