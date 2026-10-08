package com.harshy.sdk

import com.harshy.engine.parseTripTrigger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class TripAnalyzerTest {
  private val gravityUp = Vec3(0.0, 0.0, 9.81)
  private val quiet = DetectorConfig(
    harshAccelMps2 = 50.0,
    harshBrakeMps2 = 50.0,
    harshCornerMps2 = 50.0,
  )

  private fun shift(lat: Double, lon: Double, bearingDeg: Double, distanceM: Double): Pair<Double, Double> {
    val earth = 6_371_000.0
    val heading = Math.toRadians(bearingDeg)
    val lat1 = Math.toRadians(lat)
    val lon1 = Math.toRadians(lon)
    val ang = distanceM / earth
    val lat2 = Math.asin(Math.sin(lat1) * Math.cos(ang) + Math.cos(lat1) * Math.sin(ang) * Math.cos(heading))
    val lon2 = lon1 + Math.atan2(
      Math.sin(heading) * Math.sin(ang) * Math.cos(lat1),
      Math.cos(ang) - Math.sin(lat1) * Math.sin(lat2),
    )
    return Math.toDegrees(lat2) to Math.toDegrees(lon2)
  }

  private fun at(t: Double, speedMps: Double, courseDeg: Double, lat: Double, lon: Double): LocationSample {
    return LocationSample(t = t, lat = lat, lon = lon, speedMps = speedMps, courseDeg = courseDeg, accuracyM = 4.0)
  }

  private fun loc(t: Double, speedMps: Double, courseDeg: Double = 0.0): LocationSample {
    return LocationSample(
      t = t,
      lat = 32.0,
      lon = 34.0 + t / 10_000_000.0,
      speedMps = speedMps,
      courseDeg = courseDeg,
      accuracyM = 5.0,
    )
  }

  private fun restImu(t: Double): ImuSample {
    return ImuSample(
      t = t,
      accel = gravityUp,
      linearAccel = Vec3(0.0, 0.0, 0.0),
      gravity = gravityUp,
    )
  }

  private fun pulseImu(t: Double, linear: Vec3): ImuSample {
    return ImuSample(
      t = t,
      accel = Vec3(linear.x + gravityUp.x, linear.y + gravityUp.y, linear.z + gravityUp.z),
      linearAccel = linear,
      gravity = gravityUp,
    )
  }

  private fun horizontalPulse(t0: Double, peak: Double = 40.0): List<ImuSample> {
    val dt = 40.0
    val samples = mutableListOf<ImuSample>()
    for (i in 0 until 4) {
      samples.add(pulseImu(t0 + i * dt, Vec3(peak, 0.0, 0.0)))
    }
    samples.add(restImu(t0 + 4 * dt))
    return samples
  }

  @Test
  fun impactDirectionLabels() {
    assertEquals("Front", impactDirectionLabel("front"))
    assertEquals("Direction unknown", impactDirectionLabel(null))
    assertTrue(isPossibleImpact(DrivingEvent(
      id = "x",
      type = POSSIBLE_IMPACT_TYPE,
      t = 0.0,
      peak = 1.0,
      severity = 0.0,
      level = "light",
      lat = null,
      lon = null,
      speedMps = null,
    )))
  }

  @Test
  fun emitsFrontImpactAfterSpeedDrop() {
    val imu = mutableListOf(restImu(1800.0))
    imu.addAll(horizontalPulse(3000.0))
    imu.add(restImu(4000.0))
    val session = analyzeTrip(
      location = listOf(loc(2000.0, 15.0), loc(4500.0, 5.0)),
      imu = imu,
      sessionId = "impact",
      startedAtMs = 0.0,
      endedAtMs = 5000.0,
      device = DeviceInfo("android", "test"),
      config = quiet,
    )
    val event = session.events.find { it.type == POSSIBLE_IMPACT_TYPE }
    assertEquals("front", event?.impactDirection)
    assertEquals(1, session.metrics.eventCounts[POSSIBLE_IMPACT_TYPE])
    assertEquals(0.0, session.metrics.points, 0.001)
    assertEquals(100.0, session.metrics.score, 0.001)
  }

  @Test
  fun ignoresVerticalPothole() {
    val session = analyzeTrip(
      location = listOf(loc(2000.0, 15.0), loc(4500.0, 15.0)),
      imu = listOf(
        restImu(1800.0),
        pulseImu(3000.0, Vec3(0.0, 0.0, 40.0)),
        pulseImu(3040.0, Vec3(0.0, 0.0, 40.0)),
        pulseImu(3080.0, Vec3(0.0, 0.0, 40.0)),
        restImu(3120.0),
      ),
      sessionId = "pothole",
      startedAtMs = 0.0,
      endedAtMs = 5000.0,
      device = DeviceInfo("android", "test"),
      config = quiet,
    )
    assertFalse(session.events.any { it.type == POSSIBLE_IMPACT_TYPE })
  }

  @Test
  fun flagsHarshBrakeFromGps() {
    val session = analyzeTrip(
      location = listOf(loc(2000.0, 20.0), loc(3000.0, 10.0)),
      imu = emptyList(),
      sessionId = "brake",
      startedAtMs = 0.0,
      endedAtMs = 4000.0,
      device = DeviceInfo("android", "test"),
      config = DetectorConfig.DEFAULT,
    )
    assertTrue(session.events.any { it.type == EVENT_HARSH_BRAKE })
  }

  @Test
  fun doesNotSwerveFromHandheldGyroWhenStopped() {
    val twist = ImuSample(
      t = 1100.0,
      accel = gravityUp,
      linearAccel = Vec3(0.0, 0.0, 0.0),
      gyro = Vec3(0.0, 0.0, 2.0),
      gravity = gravityUp,
    )
    val session = analyzeTrip(
      location = listOf(loc(0.0, 0.0, 0.0), loc(1000.0, 0.0, 90.0)),
      imu = listOf(twist),
      sessionId = "handheld",
      startedAtMs = 0.0,
      endedAtMs = 2000.0,
      device = DeviceInfo("android", "test"),
      config = DetectorConfig.DEFAULT,
    )
    assertFalse(session.events.any { it.type == EVENT_SWERVE })
  }

  @Test
  fun emitsGpsSwerveWhenMoving() {
    val start = 59.46 to 24.82
    val mid = shift(start.first, start.second, 0.0, 6.0)
    val peak = shift(mid.first, mid.second, 26.0, 6.0)
    val settle = shift(peak.first, peak.second, 26.0, 6.0)
    val session = analyzeTrip(
      location = listOf(
        at(0.0, 6.0, 0.0, start.first, start.second),
        at(1000.0, 6.0, 0.0, mid.first, mid.second),
        at(2000.0, 6.0, 26.0, peak.first, peak.second),
        at(3000.0, 6.0, 26.0, settle.first, settle.second),
      ),
      imu = listOf(
        ImuSample(
          t = 1500.0,
          accel = gravityUp,
          linearAccel = Vec3(0.0, 0.0, 0.0),
          gyro = Vec3(0.0, 0.0, 0.55),
          gravity = gravityUp,
        ),
      ),
      sessionId = "swerve",
      startedAtMs = 0.0,
      endedAtMs = 4000.0,
      device = DeviceInfo("android", "test"),
      config = DetectorConfig.DEFAULT,
    )
    assertTrue(session.events.any { it.type == EVENT_SWERVE })
    assertFalse(session.events.any { it.type == EVENT_HARSH_CORNER })
  }

  @Test
  fun ignoresPathOnlyYawSpike() {
    val start = 59.46 to 24.82
    val mid = shift(start.first, start.second, 0.0, 6.0)
    val peak = shift(mid.first, mid.second, 26.0, 6.0)
    val settle = shift(peak.first, peak.second, 26.0, 6.0)
    val session = analyzeTrip(
      location = listOf(
        at(0.0, 6.0, 0.0, start.first, start.second),
        at(1000.0, 6.0, 0.0, mid.first, mid.second),
        at(2000.0, 6.0, 26.0, peak.first, peak.second),
        at(3000.0, 6.0, 26.0, settle.first, settle.second),
      ),
      imu = emptyList(),
      sessionId = "path-swerve",
      startedAtMs = 0.0,
      endedAtMs = 4000.0,
      device = DeviceInfo("android", "test"),
      config = DetectorConfig.DEFAULT,
    )
    assertFalse(session.events.any { it.type == EVENT_SWERVE })
  }

  @Test
  fun ignoresChipBearingOnAStraightRoad() {
    val start = 59.46078 to 24.81843
    val mid = shift(start.first, start.second, 240.0, 3.0)
    val end = shift(mid.first, mid.second, 244.0, 4.4)
    val session = analyzeTrip(
      location = listOf(
        at(0.0, 0.0, 240.0, start.first, start.second),
        at(1000.0, 3.38, 240.0, mid.first, mid.second),
        at(2000.0, 4.44, 28.0, end.first, end.second),
      ),
      imu = emptyList(),
      sessionId = "straight",
      startedAtMs = 0.0,
      endedAtMs = 3000.0,
      device = DeviceInfo("android", "test"),
      config = DetectorConfig.DEFAULT,
    )
    assertFalse(session.events.any { it.type == EVENT_HARSH_CORNER || it.type == EVENT_SWERVE })
  }

  @Test
  fun emitsPhoneHandheldWhenPickedUpWhileMoving() {
    val gravitySide = Vec3(9.81, 0.0, 0.0)
    val imu = mutableListOf<ImuSample>()
    var t = 0.0
    while (t <= 2000.0) {
      imu.add(restImu(t))
      t += 40.0
    }
    for (i in 0 until 5) {
      imu.add(
        ImuSample(
          t = 2500.0 + i * 80.0,
          accel = gravitySide,
          linearAccel = Vec3(0.0, 0.0, 0.0),
          gyro = Vec3(0.0, 2.0, 0.0),
          gravity = gravitySide,
        ),
      )
    }
    imu.add(
      ImuSample(
        t = 3200.0,
        accel = gravitySide,
        linearAccel = Vec3(0.0, 0.0, 0.0),
        gravity = gravitySide,
      ),
    )
    imu.add(restImu(4200.0))
    imu.add(restImu(4600.0))
    imu.add(restImu(5000.0))
    imu.add(restImu(5400.0))
    val session = analyzeTrip(
      location = listOf(loc(0.0, 12.0), loc(2000.0, 12.0), loc(4000.0, 12.0), loc(6000.0, 12.0)),
      imu = imu,
      sessionId = "phone",
      startedAtMs = 0.0,
      endedAtMs = 6000.0,
      device = DeviceInfo("android", "test"),
      config = quiet,
    )
    val event = session.events.find { it.type == PHONE_HANDHELD_TYPE }
    assertTrue(isPhoneHandheld(event!!))
    assertTrue(event.endT != null)
    assertEquals(1, session.metrics.eventCounts[PHONE_HANDHELD_TYPE])
    assertEquals(0.0, session.metrics.points, 0.001)
    assertEquals(100.0, session.metrics.score, 0.001)
  }

  @Test
  fun dropsGpsTeleportFromSession() {
    val analyzer = TripAnalyzer(
      quiet,
      "teleport",
      0.0,
      DeviceInfo(platform = "android", model = "test"),
    )
    analyzer.pushLocation(
      LocationSample(
        t = 0.0,
        lat = 59.44803481455892,
        lon = 24.862493975088,
        speedMps = 4.42,
        accuracyM = null,
      ),
    )
    analyzer.pushLocation(
      LocationSample(
        t = 732.0,
        lat = 59.4395306,
        lon = 24.868772,
        speedMps = null,
        accuracyM = null,
      ),
    )
    analyzer.pushLocation(
      LocationSample(
        t = 1000.0,
        lat = 59.448089925572276,
        lon = 24.862447874620557,
        speedMps = 8.6,
        accuracyM = 5.0,
      ),
    )
    val session = analyzer.finalize(2000.0)
    assertEquals(2, session.location.size)
    assertFalse(session.location.any { it.lat == 59.4395306 })
    assertTrue(session.metrics.distanceM < 50.0)
  }

  @Test
  fun dropsCoarseNetworkLikeFixWithoutSpeed() {
    val analyzer = TripAnalyzer(
      quiet,
      "coarse",
      0.0,
      DeviceInfo(platform = "android", model = "test"),
    )
    analyzer.pushLocation(loc(0.0, 5.0))
    analyzer.pushLocation(
      LocationSample(
        t = 500.0,
        lat = 59.4425032,
        lon = 24.8530124,
        speedMps = null,
        accuracyM = null,
      ),
    )
    analyzer.pushLocation(loc(1000.0, 5.1))
    val session = analyzer.finalize(2000.0)
    assertEquals(2, session.location.size)
    assertFalse(session.location.any { it.speedMps == null })
  }

  @Test
  fun keepsAccurateGnssFixWithoutSpeed() {
    val analyzer = TripAnalyzer(
      quiet,
      "gnss",
      0.0,
      DeviceInfo(platform = "android", model = "test"),
    )
    analyzer.pushLocation(loc(0.0, 5.0))
    analyzer.pushLocation(
      LocationSample(
        t = 500.0,
        lat = 32.0,
        lon = 34.0 + 500.0 / 10_000_000.0,
        speedMps = null,
        accuracyM = 8.0,
      ),
    )
    val session = analyzer.finalize(1000.0)
    assertEquals(2, session.location.size)
    assertTrue(session.location.last().speedMps != null)
  }

  @Test
  fun fillsLiveHeadingAndGForceWhenGnssOmitsBearing() {
    val analyzer = TripAnalyzer(
      DetectorConfig.DEFAULT,
      "fused-course",
      0.0,
      DeviceInfo(platform = "android", model = "test"),
    )
    val lonPerM = 1.0 / (111_320.0 * kotlin.math.cos(Math.toRadians(32.0)))
    fun east(t: Double): LocationSample {
      return LocationSample(
        t = t,
        lat = 32.0,
        lon = 34.0 + 8.0 * (t / 1000.0) * lonPerM,
        speedMps = 8.0,
        courseDeg = null,
        accuracyM = 8.0,
      )
    }
    var metrics = analyzer.pushLocation(east(0.0)).metrics
    var t = 4000.0
    while (t <= 16_000.0) {
      metrics = analyzer.pushLocation(east(t)).metrics
      t += 4000.0
    }
    val heading = metrics.headingDeg
    assertTrue(heading != null && heading > 80.0 && heading < 100.0)
    assertTrue(metrics.longitudinalAccelMps2 != null)
    assertTrue(metrics.lateralAccelMps2 != null)
  }

  @Test
  fun sessionJsonIncludesSdkVersion() {
    val session = analyzeTrip(
      location = listOf(loc(0.0, 5.0)),
      imu = emptyList(),
      sessionId = "sdk-ver",
      startedAtMs = 0.0,
      endedAtMs = 1000.0,
      device = DeviceInfo("android", "test"),
    )
    assertEquals(HARSHY_SDK_VERSION, session.sdkVersion)
    val json = session.toJsonObject()
    assertEquals(HARSHY_SDK_VERSION, json.getInt("sdkVersion"))
    val sample = json.getJSONArray("location").getJSONObject(0)
    assertFalse(sample.has("altitudeM"))
    assertFalse(sample.has("altitudeAccuracyM"))
    assertFalse(sample.has("roadRmsMps2"))
    assertFalse(json.getJSONObject("config").has("speedingMps"))
  }

  @Test
  fun opensSpeedingSpanWhenMappedLimitIsHeld() {
    val analyzer = TripAnalyzer(
      DetectorConfig(harshAccelMps2 = 20.0, harshBrakeMps2 = 20.0, harshCornerMps2 = 20.0),
      "road-limit",
      0.0,
      DeviceInfo(platform = "android", model = "test"),
    )
    val limit = 50.0 / 3.6
    val speed = 57.0 / 3.6
    fun sample(t: Double, velocity: Double): LocationSample {
      return loc(t, velocity).copy(speedLimitMps = limit)
    }
    assertTrue(analyzer.pushLocation(sample(0.0, speed)).newEvents.none { it.type == EVENT_SPEEDING })
    assertTrue(analyzer.pushLocation(sample(1000.0, speed)).newEvents.none { it.type == EVENT_SPEEDING })
    val opened = analyzer.pushLocation(sample(2000.0, speed)).newEvents.filter { it.type == EVENT_SPEEDING }
    assertEquals(1, opened.size)
    assertEquals(0.0, opened[0].t, 0.001)
    assertEquals(limit, opened[0].speedLimitMps ?: -1.0, 0.001)
    val closed = analyzer.pushLocation(sample(3000.0, 10.0)).newEvents.filter { it.type == EVENT_SPEEDING }
    assertEquals(1, closed.size)
    assertEquals(3000.0, closed[0].endT ?: -1.0, 0.001)
    val json = analyzer.finalize(3000.0).toJsonObject()
    val event = json.getJSONArray("events").getJSONObject(0)
    assertEquals("speeding", event.getString("type"))
    assertTrue(event.has("speedLimitMps"))
    val stored = json.getJSONArray("location").getJSONObject(0)
    assertTrue(stored.has("speedLimitMps"))
  }

  @Test
  fun sessionJsonIncludesTrigger() {
    val session = analyzeTrip(
      location = listOf(loc(0.0, 5.0)),
      imu = emptyList(),
      sessionId = "auto-1",
      startedAtMs = 0.0,
      endedAtMs = 1000.0,
      device = DeviceInfo("android", "test"),
      trigger = "auto",
    )
    assertEquals("auto", session.trigger)
    assertEquals("auto", parseTripTrigger(session.trigger))
  }

  @Test
  fun sessionJsonIncludesCapture() {
    val session = analyzeTrip(
      location = listOf(loc(0.0, 5.0)),
      imu = emptyList(),
      sessionId = "cap-1",
      startedAtMs = 0.0,
      endedAtMs = 1000.0,
      device = DeviceInfo("android", "test"),
      trigger = "auto",
      capture = NativeStartOptions(imuHz = 25, locationIntervalMs = 1000, background = false, trigger = "auto"),
    )
    val json = session.toJsonObject()
    val capture = json.getJSONObject("capture")
    assertEquals(25, capture.getInt("imuHz"))
    assertEquals(1000L, capture.getLong("locationIntervalMs"))
    assertFalse(capture.getBoolean("background"))
    assertEquals("auto", capture.getString("trigger"))
  }

  @Test
  fun sessionJsonOmitsCaptureWhenAbsent() {
    val session = analyzeTrip(
      location = listOf(loc(0.0, 5.0)),
      imu = emptyList(),
      sessionId = "cap-2",
      startedAtMs = 0.0,
      endedAtMs = 1000.0,
      device = DeviceInfo("android", "test"),
    )
    assertFalse(session.toJsonObject().has("capture"))
  }

  @Test
  fun recordsOneGentleAccelThenWaits() {
    val analyzer = TripAnalyzer(
      DetectorConfig.DEFAULT,
      "smooth",
      0.0,
      DeviceInfo("android", "test"),
    )
    for (step in 0..6) {
      analyzer.pushLocation(loc(step * 1000.0, 10.0 + step))
    }
    val session = analyzer.finalize(7000.0)
    assertEquals(1, session.events.count { it.type == EVENT_SMOOTH_ACCEL })
    assertEquals(2.0, session.metrics.points, 0.001)
    assertEquals(100.0, session.metrics.score, 0.001)
  }

  @Test
  fun paysTwoForTheFirstTenCleanKilometresAndOneAfter() {
    val analyzer = TripAnalyzer(
      DetectorConfig.DEFAULT,
      "clean-km",
      0.0,
      DeviceInfo("android", "test"),
    )
    var lat = 59.4
    var lon = 24.8
    analyzer.pushLocation(at(0.0, 12.0, 0.0, lat, lon))
    for (step in 1..930) {
      val next = shift(lat, lon, 0.0, 12.0)
      lat = next.first
      lon = next.second
      analyzer.pushLocation(at(step * 1000.0, 12.0, 0.0, lat, lon))
    }
    val session = analyzer.finalize(930_000.0)
    val kilometres = session.events.filter { it.type == EVENT_SMOOTH_KM }
    assertEquals(11, kilometres.size)
    assertEquals(2.0, kilometres[0].peak, 0.001)
    assertEquals(2.0, kilometres[9].peak, 0.001)
    assertEquals(1.0, kilometres[10].peak, 0.001)
    assertEquals(21.0, session.metrics.points, 0.001)
    assertEquals(100.0, session.metrics.score, 0.001)
    assertFalse(session.events.any { it.type.startsWith("harsh_") })
  }

  @Test
  fun recordsGradualAccelAfterLongHold() {
    val analyzer = TripAnalyzer(
      DetectorConfig.DEFAULT,
      "creep",
      0.0,
      DeviceInfo("android", "test"),
    )
    for (step in 0..8) {
      analyzer.pushLocation(loc(step * 1000.0, 8.0 + step * 0.3))
    }
    assertEquals(0, analyzer.getEvents().count { it.type == EVENT_SMOOTH_ACCEL })
    analyzer.pushLocation(loc(9000.0, 8.0 + 9 * 0.3))
    val credits = analyzer.getEvents().filter { it.type == EVENT_SMOOTH_ACCEL }
    assertEquals(1, credits.size)
    assertTrue(credits[0].peak >= 0.2 && credits[0].peak < 0.5)
    assertEquals(1.0, analyzer.getMetrics().points, 0.001)
  }

  @Test
  fun doesNotScorePathOnlyZigZagGpsAsHarshCornersAtTripStart() {
    val analyzer = TripAnalyzer(
      DetectorConfig.DEFAULT,
      "start-zigzag",
      0.0,
      DeviceInfo("android", "test"),
    )
    var lat = 59.4287
    var lon = 24.7667
    val headings = listOf(190.0, 261.0, 183.0, 215.0, 207.0, 222.0, 198.0, 205.0, 195.0, 202.0, 198.0)
    val speed = 8.5
    analyzer.pushLocation(
      LocationSample(t = 0.0, lat = lat, lon = lon, speedMps = speed, courseDeg = null, accuracyM = 12.0),
    )
    headings.forEachIndexed { step, heading ->
      val next = shift(lat, lon, heading, speed)
      lat = next.first
      lon = next.second
      analyzer.pushLocation(
        LocationSample(
          t = (step + 1) * 1000.0,
          lat = lat,
          lon = lon,
          speedMps = speed,
          courseDeg = null,
          accuracyM = 12.0 + (step % 3) * 2.0,
        ),
      )
    }
    assertFalse(analyzer.getEvents().any { it.type == EVENT_HARSH_CORNER })
  }

  @Test
  fun doesNotScoreZigZagGpsWhenChipCourseEchoesThePolyline() {
    val analyzer = TripAnalyzer(
      DetectorConfig.DEFAULT,
      "chip-echo-zigzag",
      0.0,
      DeviceInfo("android", "test"),
    )
    var lat = 59.4578
    var lon = 24.8249
    val headings = listOf(100.0, 85.0, 103.0, 100.0, 101.0, 90.0, 83.0, 72.0, 69.0, 76.0, 63.0, 76.0, 71.0)
    val speed = 11.5
    analyzer.pushLocation(
      LocationSample(t = 0.0, lat = lat, lon = lon, speedMps = speed, courseDeg = headings[0], accuracyM = 6.0),
    )
    for (step in 1 until headings.size) {
      val heading = headings[step]
      val next = shift(lat, lon, heading, speed)
      lat = next.first
      lon = next.second
      analyzer.pushLocation(
        LocationSample(
          t = step * 1000.0,
          lat = lat,
          lon = lon,
          speedMps = speed,
          courseDeg = heading,
          accuracyM = 6.0,
        ),
      )
    }
    assertFalse(analyzer.getEvents().any { it.type == EVENT_HARSH_CORNER })
  }

  @Test
  fun stillScoresSustainedPathOnlyTurnAsHarshCornerWhenAccuracyIsGood() {
    val analyzer = TripAnalyzer(
      DetectorConfig.DEFAULT,
      "path-arc",
      0.0,
      DeviceInfo("android", "test"),
    )
    var lat = 59.4
    var lon = 24.8
    val speed = 10.0
    var heading = 0.0
    analyzer.pushLocation(
      LocationSample(t = 0.0, lat = lat, lon = lon, speedMps = speed, courseDeg = null, accuracyM = 5.0),
    )
    for (step in 1..8) {
      heading += 25.0
      val next = shift(lat, lon, heading, speed)
      lat = next.first
      lon = next.second
      analyzer.pushLocation(
        LocationSample(
          t = step * 1000.0,
          lat = lat,
          lon = lon,
          speedMps = speed,
          courseDeg = null,
          accuracyM = 5.0,
        ),
      )
    }
    assertTrue(analyzer.getEvents().any { it.type == EVENT_HARSH_CORNER })
  }

  private fun mounted(
    t: Double,
    x: Double,
    y: Double = 0.0,
    z: Double = 0.0,
    gravity: Vec3 = Vec3(0.0, 0.0, 9.8),
    gyro: Vec3 = Vec3(0.0, 0.0, 0.0),
  ): ImuSample {
    return ImuSample(
      t = t,
      accel = Vec3(x + gravity.x, y + gravity.y, z + gravity.z),
      linearAccel = Vec3(x, y, z),
      gyro = gyro,
      gravity = gravity,
    )
  }

  @Test
  fun countsAHarshBrakeThatArrivesAlreadyStopped() {
    val analyzer = TripAnalyzer(DetectorConfig.DEFAULT, "stop-brake", 0.0, DeviceInfo("android", "test"))
    val entry = 15.0 / 3.6
    val lat = 59.4
    val lon = 24.8
    analyzer.pushLocation(at(0.0, entry, 0.0, lat, lon))
    val next = shift(lat, lon, 0.0, entry / 2.0)
    analyzer.pushLocation(at(1000.0, 0.0, 0.0, next.first, next.second))
    val brakes = analyzer.getEvents().filter { it.type == EVENT_HARSH_BRAKE }
    assertEquals(1, brakes.size)
    assertEquals(entry, brakes[0].peak, 1e-5)
  }

  @Test
  fun ignoresAReportedStopWhileThePathIsStillRolling() {
    val analyzer = TripAnalyzer(DetectorConfig.DEFAULT, "false-stop", 0.0, DeviceInfo("android", "test"))
    val lat = 59.4
    val lon = 24.8
    analyzer.pushLocation(at(0.0, 10.0, 0.0, lat, lon))
    val next = shift(lat, lon, 0.0, 10.0)
    analyzer.pushLocation(at(1000.0, 0.0, 0.0, next.first, next.second))
    assertFalse(analyzer.getEvents().any { it.type == EVENT_HARSH_BRAKE })
  }

  @Test
  fun stillCountsAHarshBrakeWhileTheCarIsMoving() {
    val analyzer = TripAnalyzer(DetectorConfig.DEFAULT, "moving-brake", 0.0, DeviceInfo("android", "test"))
    val lat = 59.4
    val lon = 24.8
    analyzer.pushLocation(at(0.0, 20.0, 0.0, lat, lon))
    val next = shift(lat, lon, 0.0, 17.0)
    analyzer.pushLocation(at(1000.0, 14.0, 0.0, next.first, next.second))
    val brakes = analyzer.getEvents().filter { it.type == EVENT_HARSH_BRAKE }
    assertEquals(1, brakes.size)
    assertEquals(6.0, brakes[0].peak, 1e-5)
  }

  @Test
  fun ignoresACrawlWobbleThatDoesNotDropTwoMps() {
    val analyzer = TripAnalyzer(
      DetectorConfig.DEFAULT.copy(harshBrakeMps2 = 1.0, minSpeedMps = 2.0),
      "crawl",
      0.0,
      DeviceInfo("android", "test"),
    )
    val lat = 59.4
    val lon = 24.8
    analyzer.pushLocation(at(0.0, 3.0, 0.0, lat, lon))
    val next = shift(lat, lon, 0.0, 2.25)
    analyzer.pushLocation(at(1000.0, 1.5, 0.0, next.first, next.second))
    assertFalse(analyzer.getEvents().any { it.type == EVENT_HARSH_BRAKE })
  }

  @Test
  fun recordsAMountedImuBrakeWhenTheGpsStepStaysUnderTheBar() {
    val analyzer = TripAnalyzer(DetectorConfig.DEFAULT, "imu-brake", 0.0, DeviceInfo("android", "test"))
    var lat = 59.4
    var lon = 24.8
    analyzer.pushLocation(at(0.0, 10.0, 0.0, lat, lon))
    var next = shift(lat, lon, 0.0, 9.0)
    analyzer.pushLocation(at(1000.0, 8.0, 0.0, next.first, next.second))
    analyzer.pushImu(mounted(1000.0, -3.0))
    lat = next.first
    lon = next.second
    next = shift(lat, lon, 0.0, 7.8)
    analyzer.pushLocation(at(2000.0, 7.6, 0.0, next.first, next.second))
    for (t in listOf(2000.0, 2100.0, 2200.0, 2300.0)) {
      analyzer.pushImu(mounted(t, -4.0))
    }
    val brakes = analyzer.getEvents().filter { it.type == EVENT_HARSH_BRAKE }
    assertEquals(1, brakes.size)
    assertTrue(brakes[0].peak >= 3.0)
  }

  @Test
  fun doesNotScoreAnImuBrakeThatIsVerticalTooShortOrAfterThePhoneTilts() {
    val analyzer = TripAnalyzer(DetectorConfig.DEFAULT, "imu-brake-quiet", 0.0, DeviceInfo("android", "test"))
    var lat = 59.4
    var lon = 24.8
    analyzer.pushLocation(at(0.0, 10.0, 0.0, lat, lon))
    var next = shift(lat, lon, 0.0, 9.0)
    analyzer.pushLocation(at(1000.0, 8.0, 0.0, next.first, next.second))
    analyzer.pushImu(mounted(1000.0, -3.0))
    lat = next.first
    lon = next.second
    next = shift(lat, lon, 0.0, 7.8)
    analyzer.pushLocation(at(2000.0, 7.6, 0.0, next.first, next.second))
    for (t in listOf(2000.0, 2100.0)) {
      analyzer.pushImu(mounted(t, -4.0))
    }
    assertFalse(analyzer.getEvents().any { it.type == EVENT_HARSH_BRAKE })
    for (t in listOf(3000.0, 3100.0, 3200.0, 3300.0)) {
      analyzer.pushImu(mounted(t, 0.0, z = 6.0))
    }
    assertFalse(analyzer.getEvents().any { it.type == EVENT_HARSH_BRAKE })
    val tilted = Vec3(9.8, 0.0, 0.0)
    for (t in listOf(4000.0, 4100.0, 4200.0, 4300.0)) {
      analyzer.pushImu(mounted(t, 0.0, y = -4.0, gravity = tilted))
    }
    assertFalse(analyzer.getEvents().any { it.type == EVENT_HARSH_BRAKE })
  }

  @Test
  fun doesNotScoreAnImuBrakeWhileThePhoneIsInHand() {
    val analyzer = TripAnalyzer(DetectorConfig.DEFAULT, "imu-brake-hand", 0.0, DeviceInfo("android", "test"))
    var lat = 59.4
    var lon = 24.8
    analyzer.pushLocation(at(0.0, 10.0, 0.0, lat, lon))
    var next = shift(lat, lon, 0.0, 9.0)
    analyzer.pushLocation(at(1000.0, 8.0, 0.0, next.first, next.second))
    analyzer.pushImu(mounted(1000.0, -3.0))
    lat = next.first
    lon = next.second
    next = shift(lat, lon, 0.0, 8.0)
    analyzer.pushLocation(at(2000.0, 8.0, 0.0, next.first, next.second))
    var t = 2200.0
    while (t <= 3100.0) {
      analyzer.pushImu(mounted(t, 0.0))
      t += 100.0
    }
    val tilted = Vec3(9.8, 0.0, 0.0)
    val gyro = Vec3(2.0, 0.0, 0.0)
    t = 3200.0
    while (t <= 3700.0) {
      analyzer.pushImu(mounted(t, 0.0, gravity = tilted, gyro = gyro))
      t += 100.0
    }
    t = 3800.0
    while (t <= 4200.0) {
      analyzer.pushImu(mounted(t, 0.0, y = -4.0, gravity = tilted, gyro = gyro))
      t += 100.0
    }
    assertTrue(analyzer.getEvents().any { it.type == PHONE_HANDHELD_TYPE })
    assertFalse(analyzer.getEvents().any { it.type == EVENT_HARSH_BRAKE })
  }
}
