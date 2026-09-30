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
      imu = emptyList(),
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
}
