// Minimal GTFS-realtime protobuf reader: only the TripUpdate fields we need.
// (Avoids pulling in protobufjs; the schema is tiny and stable.)
// Files in api/_lib are not deployed as routes by Vercel.
//
// FeedMessage      { 1 header { 3 timestamp }, 2 entity[] }
// FeedEntity       { 3 trip_update }
// TripUpdate       { 1 trip { 1 trip_id, 5 route_id }, 3 vehicle { 1 id }, 2 stop_time_update[] }
// StopTimeUpdate   { 4 stop_id, 2 arrival { 2 time }, 3 departure { 2 time }, 5 schedule_relationship }

const text = new TextDecoder();

function varint(buf, i) {
  // Multiply instead of bit-shifting so values above 2^31 (int64 times) stay exact.
  let result = 0;
  let mul = 1;
  let b;
  do {
    b = buf[i++];
    result += (b & 0x7f) * mul;
    mul *= 128;
  } while (b & 0x80);
  return [result, i];
}

// Yields [fieldNumber, value] for varint (number) and length-delimited (Uint8Array) fields.
function* fields(buf) {
  let i = 0;
  while (i < buf.length) {
    let key;
    [key, i] = varint(buf, i);
    const field = Math.floor(key / 8);
    const wire = key % 8;
    if (wire === 0) {
      let v;
      [v, i] = varint(buf, i);
      yield [field, v];
    } else if (wire === 2) {
      let len;
      [len, i] = varint(buf, i);
      yield [field, buf.subarray(i, i + len)];
      i += len;
    } else if (wire === 1) {
      i += 8;
    } else if (wire === 5) {
      i += 4;
    } else {
      throw new Error(`Unsupported protobuf wire type ${wire}`);
    }
  }
}

function eventTime(buf) {
  for (const [f, v] of fields(buf)) if (f === 2) return v;
  return null;
}

const SKIPPED = 1;

export function extractArrivals(buf, { stopId, routes }) {
  let feedTimestamp = null;
  const arrivals = [];

  for (const [f, v] of fields(buf)) {
    if (f === 1) {
      for (const [hf, hv] of fields(v)) if (hf === 3) feedTimestamp = hv;
      continue;
    }
    if (f !== 2) continue;

    for (const [ef, tu] of fields(v)) {
      if (ef !== 3) continue;
      let route = null;
      let trip = null;
      let vehicle = null;
      const updates = [];

      for (const [tf, tv] of fields(tu)) {
        if (tf === 1) {
          for (const [df, dv] of fields(tv)) {
            if (df === 1) trip = text.decode(dv);
            else if (df === 5) route = text.decode(dv);
          }
        } else if (tf === 3) {
          for (const [vf, vv] of fields(tv)) if (vf === 1) vehicle = text.decode(vv);
        } else if (tf === 2) {
          updates.push(tv);
        }
      }
      if (!routes.has(route)) continue;

      for (const stu of updates) {
        let stop = null;
        let arr = null;
        let dep = null;
        let rel = 0;
        for (const [sf, sv] of fields(stu)) {
          if (sf === 4) stop = text.decode(sv);
          else if (sf === 2) arr = eventTime(sv);
          else if (sf === 3) dep = eventTime(sv);
          else if (sf === 5) rel = sv;
        }
        const time = arr ?? dep;
        if (stop === stopId && rel !== SKIPPED && time) {
          arrivals.push({ route, trip, vehicle, arrival: time });
        }
      }
    }
  }

  arrivals.sort((a, b) => a.arrival - b.arrival);
  return { feedTimestamp, arrivals };
}
