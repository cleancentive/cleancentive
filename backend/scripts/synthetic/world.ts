// World builder: turns a LayerSpec into bundle rows + images.
//
// Generates a plausible ~18-month history: users join on an adoption ramp, form
// teams, run recurring cleanups, and log spots (picks) with mixed detection
// outcomes. All rows are emitted in dependency order with timestamps drawn from
// the spec window (never the wall clock). Forward/circular user FKs
// (active_team_id / active_cleanup_date_id / avatar_email_id) are left NULL so the
// bundle imports cleanly in BOTH replace and merge mode (merge does not defer FKs).

import { Rng } from './prng';
import { mintId, uploadIdFor, slug } from './ids';
import {
  type LayerSpec,
  type CitySpec,
  FIRST_NAMES,
  LAST_NAMES,
  CLEANUP_LOCATION_NAMES,
  TEAM_MESSAGE_SUBJECTS,
  CLEANUP_MESSAGE_SUBJECTS,
  messageBody,
} from './spec';
import { CATEGORY_MAP, BRANDABLE_OBJECTS, type TacoImage } from './taco';
import type { LabelResolver } from './labels';
import { writeSpotImage } from './images';
import type { BundleWriter } from './bundle';

const DAY = 86_400_000;
const SOURCE_MODEL = 'gpt-4o-mini';

const DRINK_BRANDS = ['Coca-Cola', 'Pepsi', 'Red Bull', 'S.Pellegrino', 'Mezzo Mix', 'Bud Light', 'Tango'];

const FEEDBACK_TEXTS = [
  'Die Karte lädt auf dem Handy manchmal langsam.',
  'Könnt ihr eine Statistik pro Team hinzufügen?',
  'Super App! Macht richtig Spass beim Sammeln.',
  'Beim Hochladen mehrerer Fotos hängt es kurz.',
  'Wäre cool, Cleanups als Kalender zu exportieren.',
  'Die Gewichtsangabe stimmt nicht immer ganz.',
];

const RESPONSE_TEXTS = [
  'Danke für die Rückmeldung — wir schauen uns das an!',
  'Guter Punkt, steht auf unserer Liste.',
  'Das sollte jetzt behoben sein, bitte nochmals testen.',
  'Danke! Freut uns, dass es Spass macht.',
];

const FEEDBACK_CATEGORIES = ['bug', 'suggestion', 'question'] as const;
const FEEDBACK_STATUSES = ['new', 'acknowledged', 'in_progress', 'resolved'] as const;
const SPOT_STATUSES = ['completed', 'failed', 'queued', 'processing'] as const;

const iso = (ms: number): string => new Date(ms).toISOString();
const round = (n: number, d = 2): number => {
  const f = 10 ** d;
  return Math.round(n * f) / f;
};
const normalizeName = (name: string): string => name.trim().replace(/\s+/g, ' ').toLowerCase();
const atHour = (ms: number, hour: number): number => {
  const d = new Date(ms);
  d.setUTCHours(hour, 0, 0, 0);
  return d.getTime();
};

export interface BuildDeps {
  spec: LayerSpec;
  resolver: LabelResolver;
  taco: TacoImage[];
  writer: BundleWriter;
  imagesRoot: string;
  noImages: boolean;
  downscaleMaxPx: number | null;
  log: (msg: string) => void;
}

export interface BuildStats {
  imagesWritten: number;
}

interface GenUser {
  id: string;
  nickname: string;
  fullName: string;
  joinedMs: number;
  activity: number;
  city: CitySpec;
}

interface GenDate {
  id: string;
  startMs: number;
  endMs: number;
  lat: number;
  lng: number;
}

interface GenCleanup {
  id: string;
  dates: GenDate[];
}

export async function buildWorld(deps: BuildDeps): Promise<BuildStats> {
  const { spec, resolver, taco, writer, log } = deps;
  const startMs = Date.parse(spec.window.start);
  const endMs = Date.parse(spec.window.end);

  // --- labels (emit mode only; empty in --labels-from mode) ---
  for (const row of resolver.labelRows) writer.write('labels', row);
  for (const row of resolver.translationRows) writer.write('label_translations', row);

  const cityNames = spec.cities.map((c) => c.name);
  const cityWeights = spec.cities.map((c) => c.weight);
  const cityByName = new Map(spec.cities.map((c) => [c.name, c]));

  // --- users + emails (+ first user is a steward/admin) ---
  const usersRng = Rng.stream(spec.seed, 'users');
  const users: GenUser[] = [];
  for (let i = 0; i < spec.counts.users; i++) {
    const id = mintId('user', `${spec.layerId}:user:${i}`);
    const first = usersRng.pick(FIRST_NAMES);
    const last = usersRng.pick(LAST_NAMES);
    const fullName = `${first} ${last}`;
    const nickname = `${first}${usersRng.bool(0.4) ? last[0] : ''}`;
    const joinedMs = usersRng.dateInWindow(startMs, endMs - 14 * DAY, 1.6);
    const lastLoginMs = usersRng.dateInWindow(joinedMs, endMs, 2);
    const activity = usersRng.weighted([0.4, 1, 2.5, 5], [0.3, 0.4, 0.2, 0.1]);
    const city = cityByName.get(usersRng.weighted(cityNames, cityWeights)) ?? spec.cities[0];
    users.push({ id, nickname, fullName, joinedMs, activity, city });

    writer.write('users', {
      id,
      nickname,
      full_name: fullName,
      last_login: iso(lastLoginMs),
      active_team_id: null,
      active_cleanup_date_id: null,
      avatar_email_id: null,
      uploaded_avatar_key: null,
      uploaded_avatar_updated_at: null,
      calendar_feed_last_fetched_at: null,
      created_at: iso(joinedMs),
      updated_at: iso(lastLoginMs),
      created_by: null,
      updated_by: null,
    });

    writer.write('user_emails', {
      id: mintId('user_email', `${id}:0`),
      email: `${slug(first)}.${slug(last)}${i}@${spec.layerId}.example.org`,
      is_selected_for_login: true,
      calendar_emails_enabled: false,
      user_id: id,
      created_at: iso(joinedMs),
      updated_at: iso(joinedMs),
      created_by: id,
      updated_by: id,
    });
  }

  if (users.length > 0) {
    const steward = users[0];
    writer.write('admins', {
      id: mintId('admin', steward.id),
      user_id: steward.id,
      created_at: iso(steward.joinedMs),
      updated_at: iso(steward.joinedMs),
      created_by: steward.id,
      updated_by: steward.id,
    });
  }

  // --- teams + memberships + messages + email patterns ---
  const teamsRng = Rng.stream(spec.seed, 'teams');
  const userTeams = new Map<string, string[]>();
  for (const teamSpec of spec.teams) {
    const id = mintId('team', `${spec.layerId}:team:${slug(teamSpec.name)}`);
    const createdMs = startMs + teamsRng.int(0, 20) * DAY;
    const memberCount = Math.min(users.length, teamSpec.members ?? Math.max(3, Math.round(users.length * 0.5)));
    const chosen = teamsRng.shuffle(users).slice(0, memberCount);
    const organizerCount = Math.min(memberCount, teamSpec.organizers ?? 1);
    const organizerIds = new Set(chosen.slice(0, organizerCount).map((u) => u.id));

    writer.write('teams', {
      id,
      name: teamSpec.name,
      name_normalized: normalizeName(teamSpec.name),
      description: teamSpec.description ?? '',
      system_key: null,
      archived_at: null,
      archived_by: null,
      custom_css: null,
      is_unlisted: teamSpec.isUnlisted ?? false,
      created_at: iso(createdMs),
      updated_at: iso(createdMs),
      created_by: chosen[0]?.id ?? null,
      updated_by: chosen[0]?.id ?? null,
    });

    for (const u of chosen) {
      const role = organizerIds.has(u.id) ? 'organizer' : 'member';
      const joinedMs = Math.max(createdMs, u.joinedMs);
      writer.write('team_memberships', {
        id: mintId('team_membership', `${id}:${u.id}`),
        team_id: id,
        user_id: u.id,
        role,
        created_at: iso(joinedMs),
        updated_at: iso(joinedMs),
        created_by: u.id,
        updated_by: u.id,
      });
      const list = userTeams.get(u.id) ?? [];
      list.push(id);
      userTeams.set(u.id, list);
    }

    const organizerArr = [...organizerIds];
    const msgCount = teamsRng.int(2, 5);
    for (let m = 0; m < msgCount; m++) {
      const author = teamsRng.pick(organizerArr.length ? organizerArr : chosen.map((u) => u.id));
      const tMs = teamsRng.dateInWindow(createdMs, endMs, 1.2);
      writer.write('team_messages', {
        id: mintId('team_message', `${id}:${m}`),
        team_id: id,
        author_user_id: author,
        audience: teamsRng.bool(0.8) ? 'members' : 'organizers',
        subject: teamsRng.pick(TEAM_MESSAGE_SUBJECTS),
        body: messageBody(teamsRng),
        created_at: iso(tMs),
        updated_at: iso(tMs),
        created_by: author,
        updated_by: author,
      });
    }

    if (teamsRng.bool(0.5)) {
      writer.write('team_email_patterns', {
        id: mintId('team_email_pattern', `${id}:0`),
        team_id: id,
        email_pattern: `*@${slug(teamSpec.name)}.example.org`,
        created_at: iso(createdMs),
        updated_at: iso(createdMs),
        created_by: chosen[0]?.id ?? null,
        updated_by: chosen[0]?.id ?? null,
      });
    }
  }

  // --- cleanups + dates + participants + messages ---
  const cleanupsRng = Rng.stream(spec.seed, 'cleanups');
  const userCleanups = new Map<string, GenCleanup[]>();
  for (const cSpec of spec.cleanups) {
    const id = mintId('cleanup', `${spec.layerId}:cleanup:${slug(cSpec.name)}`);
    const createdMs = startMs + cleanupsRng.int(0, 30) * DAY;
    const city = cityByName.get(cSpec.city ?? '') ?? spec.cities[0];

    writer.write('cleanups', {
      id,
      name: cSpec.name,
      name_normalized: normalizeName(cSpec.name),
      description: cSpec.description ?? '',
      archived_at: null,
      archived_by: null,
      created_at: iso(createdMs),
      updated_at: iso(createdMs),
      created_by: null,
      updated_by: null,
    });

    const dateCount = cSpec.dates ?? 4;
    const dates: GenDate[] = [];
    for (let d = 0; d < dateCount; d++) {
      const startAt = atHour(cleanupsRng.dateInWindow(createdMs, endMs, 1), 9 + cleanupsRng.int(0, 7));
      const endAt = startAt + (2 + cleanupsRng.int(0, 1)) * 3_600_000;
      const { lat, lng } = cleanupsRng.geoInBox(city.box);
      const gd: GenDate = { id: mintId('cleanup_date', `${id}:${d}`), startMs: startAt, endMs: endAt, lat, lng };
      dates.push(gd);
      writer.write('cleanup_dates', {
        id: gd.id,
        cleanup_id: id,
        start_at: iso(startAt),
        end_at: iso(endAt),
        latitude: lat,
        longitude: lng,
        location_name: cleanupsRng.pick(CLEANUP_LOCATION_NAMES),
        recurrence_id: null,
        created_at: iso(createdMs),
        updated_at: iso(createdMs),
        created_by: null,
        updated_by: null,
      });
    }

    const partCount = Math.min(
      users.length,
      Math.max(Math.min(4, users.length), Math.round(users.length * cleanupsRng.float(0.4, 0.7))),
    );
    const chosen = cleanupsRng.shuffle(users).slice(0, partCount);
    const organizerIds = new Set(chosen.slice(0, Math.max(1, Math.round(partCount * 0.2))).map((u) => u.id));
    const gc: GenCleanup = { id, dates };

    for (const u of chosen) {
      const role = organizerIds.has(u.id) ? 'organizer' : 'member';
      const pMs = Math.max(createdMs, u.joinedMs);
      writer.write('cleanup_participants', {
        id: mintId('cleanup_participant', `${id}:${u.id}`),
        cleanup_id: id,
        user_id: u.id,
        role,
        email_sequence: cleanupsRng.int(0, 3),
        last_email_sent_at: null,
        last_email_method: null,
        created_at: iso(pMs),
        updated_at: iso(pMs),
        created_by: u.id,
        updated_by: u.id,
      });
      const list = userCleanups.get(u.id) ?? [];
      list.push(gc);
      userCleanups.set(u.id, list);
    }

    const organizerArr = [...organizerIds];
    const msgCount = cleanupsRng.int(1, 4);
    for (let m = 0; m < msgCount; m++) {
      const author = cleanupsRng.pick(organizerArr.length ? organizerArr : chosen.map((u) => u.id));
      const tMs = cleanupsRng.dateInWindow(createdMs, endMs, 1.2);
      writer.write('cleanup_messages', {
        id: mintId('cleanup_message', `${id}:${m}`),
        cleanup_id: id,
        author_user_id: author,
        audience: cleanupsRng.bool(0.85) ? 'members' : 'organizers',
        subject: cleanupsRng.pick(CLEANUP_MESSAGE_SUBJECTS),
        body: messageBody(cleanupsRng),
        created_at: iso(tMs),
        updated_at: iso(tMs),
        created_by: author,
        updated_by: author,
      });
    }
  }

  // --- spots + detected_items + spot_edits ---
  let imagesWritten = 0;
  const activityWeights = users.map((u) => u.activity);
  for (let i = 0; i < spec.counts.spots; i++) {
    const rng = Rng.stream(spec.seed, `spot:${i}`);
    const user = rng.weighted(users, activityWeights);
    const spotId = mintId('spot', `${spec.layerId}:spot:${i}`);
    const uploadId = uploadIdFor(spotId);

    // When + where, optionally tied to a cleanup the user participates in.
    const cleanupsOfUser = userCleanups.get(user.id) ?? [];
    let cleanupId: string | null = null;
    let cleanupDateId: string | null = null;
    let capturedMs: number;
    let lat: number;
    let lng: number;
    if (cleanupsOfUser.length > 0 && rng.bool(0.35)) {
      const c = rng.pick(cleanupsOfUser);
      const date = rng.pick(c.dates);
      cleanupId = c.id;
      cleanupDateId = date.id;
      capturedMs = date.startMs + rng.int(0, Math.max(1, date.endMs - date.startMs));
      lat = round(date.lat + rng.float(-0.0015, 0.0015), 6);
      lng = round(date.lng + rng.float(-0.0015, 0.0015), 6);
    } else {
      capturedMs = rng.dateInWindow(Math.max(startMs, user.joinedMs), endMs, 1.5);
      const g = rng.geoInBox(user.city.box);
      lat = g.lat;
      lng = g.lng;
    }

    const teamsOfUser = userTeams.get(user.id) ?? [];
    const teamId = teamsOfUser.length > 0 && rng.bool(0.6) ? rng.pick(teamsOfUser) : null;

    const status = rng.weighted(SPOT_STATUSES, [0.8, 0.08, 0.07, 0.05]);
    const pickedUp = rng.bool(0.85);
    const pickSessionId = pickedUp ? mintId('pick_session', `${user.id}:${Math.floor(capturedMs / DAY)}`) : null;

    // Image (verbatim copy + thumbnail), keyed exactly like the app stores them.
    const imageKey = `spots/${spotId}/original-${uploadId}.jpg`;
    const thumbnailKey = `spots/${spotId}/thumbnail-${uploadId}.jpg`;
    const tacoImg = rng.pick(taco);
    let sha256: string | null = null;
    let mimeType = 'image/jpeg';
    let originalBytes = 0;
    let thumbnailBytes = 0;
    if (!deps.noImages) {
      const res = await writeSpotImage({
        srcAbsPath: tacoImg.absPath,
        imagesRoot: deps.imagesRoot,
        imageKey,
        thumbnailKey,
        downscaleMaxPx: deps.downscaleMaxPx,
      });
      sha256 = res.sha256;
      mimeType = res.mimeType;
      originalBytes = res.originalBytes;
      thumbnailBytes = res.thumbnailBytes;
      imagesWritten += res.filesWritten;
    }

    // Detected objects from the TACO image's annotation categories.
    const objects = rng
      .shuffle(tacoImg.categoryIds)
      .slice(0, 6)
      .map((catId) => CATEGORY_MAP[catId])
      .filter((m): m is NonNullable<typeof m> => Boolean(m))
      .map((m) => {
        const brand = m.object && BRANDABLE_OBJECTS.has(m.object) && rng.bool(0.3) ? rng.pick(DRINK_BRANDS) : null;
        return {
          category: m.object,
          material: m.material,
          brand,
          weightGrams: round(m.weightG * rng.float(0.7, 1.3), 1),
          confidence: round(rng.float(0.55, 0.98), 2),
        };
      });
    if (status === 'completed' && objects.length === 0) {
      objects.push({
        category: null,
        material: null,
        brand: null,
        weightGrams: round(rng.float(5, 30), 1),
        confidence: round(rng.float(0.55, 0.9), 2),
      });
    }

    let detectionStartedAt: string | null = null;
    let detectionCompletedAt: string | null = null;
    let processingError: string | null = null;
    let detectionRaw: Record<string, unknown> | null = null;
    if (status === 'completed') {
      const startedMs = capturedMs + rng.int(2, 30) * 1000;
      detectionStartedAt = iso(startedMs);
      detectionCompletedAt = iso(startedMs + rng.int(3, 40) * 1000);
      detectionRaw = { objects, notes: null, model: SOURCE_MODEL };
    } else if (status === 'processing') {
      detectionStartedAt = iso(capturedMs + rng.int(2, 30) * 1000);
    } else if (status === 'failed') {
      detectionStartedAt = iso(capturedMs + rng.int(2, 30) * 1000);
      processingError = rng.pick(['Detection timed out', 'Upstream model error', 'Image could not be processed']);
    }

    writer.write('spots', {
      id: spotId,
      user_id: user.id,
      team_id: teamId,
      cleanup_id: cleanupId,
      cleanup_date_id: cleanupDateId,
      latitude: lat,
      longitude: lng,
      location_accuracy_meters: round(rng.float(3, 30), 1),
      captured_at: iso(capturedMs),
      mime_type: mimeType,
      image_key: imageKey,
      thumbnail_key: thumbnailKey,
      upload_id: uploadId,
      processing_status: status,
      detection_started_at: detectionStartedAt,
      detection_completed_at: detectionCompletedAt,
      processing_error: processingError,
      detection_raw: detectionRaw,
      original_size_bytes: originalBytes,
      thumbnail_size_bytes: thumbnailBytes,
      original_purged_at: null,
      picked_up: pickedUp,
      pick_session_id: pickSessionId,
      image_sha256: sha256,
      subject_kind: 'litter',
      created_at: iso(capturedMs),
      updated_at: detectionCompletedAt ?? iso(capturedMs),
      created_by: user.id,
      updated_by: user.id,
    });

    if (status === 'completed') {
      for (let k = 0; k < objects.length; k++) {
        const o = objects[k];
        writer.write('detected_items', {
          id: mintId('detected_item', `${spotId}:${k}`),
          spot_id: spotId,
          object_label_id: resolver.idFor('object', o.category),
          material_label_id: resolver.idFor('material', o.material),
          brand_label_id: resolver.idFor('brand', o.brand),
          match_confidence: null,
          human_verified: rng.bool(0.1),
          weight_grams: o.weightGrams,
          confidence: o.confidence,
          source_model: SOURCE_MODEL,
          created_at: detectionCompletedAt,
          updated_at: detectionCompletedAt,
          created_by: user.id,
          updated_by: user.id,
        });
      }

      // Occasional human edit to the audit trail.
      if (rng.bool(0.06)) {
        const editMs = Date.parse(detectionCompletedAt as string) + rng.int(1, 14) * DAY;
        const edit = rng.pick([
          { field: 'picked_up', oldValue: String(!pickedUp), newValue: String(pickedUp) },
          { field: 'weight_grams', oldValue: '10', newValue: '15' },
        ]);
        writer.write('spot_edits', {
          id: mintId('spot_edit', `${spotId}:0`),
          spot_id: spotId,
          field_changed: edit.field,
          old_value: edit.oldValue,
          new_value: edit.newValue,
          created_by: user.id,
          created_at: iso(editMs),
        });
      }
    }
  }

  // --- feedback + responses ---
  if (spec.feedback?.count && users.length > 0) {
    const fRng = Rng.stream(spec.seed, 'feedback');
    const steward = users[0];
    for (let i = 0; i < spec.feedback.count; i++) {
      const u = fRng.pick(users);
      const id = mintId('feedback', `${spec.layerId}:feedback:${i}`);
      const createdMs = fRng.dateInWindow(startMs, endMs, 1.3);
      const status = fRng.pick(FEEDBACK_STATUSES);
      writer.write('feedback', {
        id,
        category: fRng.pick(FEEDBACK_CATEGORIES),
        description: fRng.pick(FEEDBACK_TEXTS),
        status,
        contact_email: null,
        user_id: u.id,
        guest_id: null,
        error_context: null,
        created_at: iso(createdMs),
        updated_at: iso(createdMs),
        created_by: u.id,
        updated_by: u.id,
      });
      if (status !== 'new' && fRng.bool(0.7)) {
        const rMs = createdMs + fRng.int(1, 10) * DAY;
        writer.write('feedback_responses', {
          id: mintId('feedback_response', `${id}:0`),
          feedback_id: id,
          message: fRng.pick(RESPONSE_TEXTS),
          is_from_steward: true,
          created_at: iso(rMs),
          updated_at: iso(rMs),
          created_by: steward.id,
          updated_by: steward.id,
        });
      }
    }
  }

  log(`Generated ${spec.counts.users} users, ${spec.teams.length} teams, ${spec.cleanups.length} cleanups, ${spec.counts.spots} spots`);
  return { imagesWritten };
}
