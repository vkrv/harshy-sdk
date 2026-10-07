package com.harshy.sdk

/** Compact GPS sample: keeps time, position, speed, accuracy and road RMS. Matches `@harshy/core`. */
fun compactLocationSample(sample: LocationSample): LocationSample {
  return sample.copy(altitudeM = null, courseDeg = null, altitudeAccuracyM = null)
}

/** Session without raw IMU and with compact location samples. Matches `compactSessionExport` in `@harshy/core`. */
fun compactSessionExport(session: SessionExport): SessionExport {
  return session.copy(
    location = session.location.map(::compactLocationSample),
    imu = emptyList(),
  )
}
