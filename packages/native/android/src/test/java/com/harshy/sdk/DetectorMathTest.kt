package com.harshy.sdk

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class DetectorMathTest {
  private fun loc(
    t: Double,
    lat: Double = 59.437,
    lon: Double = 24.753,
    speedMps: Double? = 8.0,
  ): LocationSample {
    return LocationSample(t = t, lat = lat, lon = lon, speedMps = speedMps, accuracyM = 5.0)
  }

  @Test
  fun harshBandsSplitAtMediumAndHeavy() {
    assertEquals("norm", harshLevel(2.4, 2.5))
    assertEquals("light", harshLevel(2.5, 2.5))
    assertEquals("medium", harshLevel(3.75, 2.5))
    assertEquals("heavy", harshLevel(5.0, 2.5))
    assertEquals("light", harshEventLevel(1.0, 2.5))
  }

  @Test
  fun liveLevelsStayNormWhenStopped() {
    val levels = liveHarshLevels(
      moving = false,
      longitudinal = 6.0,
      lateral = 6.0,
      yawRateRadps = 2.0,
      config = DetectorConfig.DEFAULT,
    )
    assertEquals("norm", levels.accelLevel)
    assertEquals("norm", levels.brakeLevel)
    assertEquals("norm", levels.cornerLevel)
    assertEquals("norm", levels.swerveLevel)
  }

  @Test
  fun liveLevelsMapSignedLongitudinal() {
    val accel = liveHarshLevels(true, 4.0, 0.0, 0.0, DetectorConfig.DEFAULT)
    assertEquals("medium", accel.accelLevel)
    assertEquals("norm", accel.brakeLevel)
    val brake = liveHarshLevels(true, -6.5, 0.0, 0.0, DetectorConfig.DEFAULT)
    assertEquals("norm", brake.accelLevel)
    assertEquals("heavy", brake.brakeLevel)
  }

  @Test
  fun rejectsCoarseNetworkLikeFixWithoutCountingTowardReset() {
    val coarse = LocationSample(
      t = 500.0,
      lat = 59.4425032,
      lon = 24.8530124,
      speedMps = null,
      accuracyM = null,
    )
    assertTrue(isCoarseNetworkLikeFix(coarse))
    val decision = shouldAcceptDriveFix(loc(0.0), coarse, 0)
    assertFalse(decision.accept)
    assertEquals(0, decision.rejects)
  }

  @Test
  fun acceptsGnssQualityFixThatOmitsSpeed() {
    val gnss = loc(t = 500.0, lat = 59.4425032, lon = 24.8530124, speedMps = null)
    assertFalse(isCoarseNetworkLikeFix(gnss))
    val decision = shouldAcceptDriveFix(null, gnss, 0)
    assertTrue(decision.accept)
  }

  @Test
  fun acceptsAfterEnoughImplausibleSteps() {
    val far = LocationSample(
      t = 732.0,
      lat = 59.439530612345,
      lon = 24.868772123456,
      speedMps = 8.0,
      accuracyM = 5.0,
    )
    assertFalse(isCoarseNetworkLikeFix(far))
    var rejects = 0
    var last = DriveFixDecision(accept = false, rejects = 0)
    val anchor = loc(0.0, lat = 59.44803481455892, lon = 24.862493975088, speedMps = 4.42)
    assertFalse(isPlausibleDriveStep(anchor, far))
    repeat(DRIVE_FIX_RESET_AFTER) {
      last = shouldAcceptDriveFix(anchor, far, rejects)
      rejects = last.rejects
    }
    assertTrue(last.accept)
    assertEquals(0, last.rejects)
  }

  @Test
  fun overlappingKinematicEventsShareAWindow() {
    val brake = DrivingEvent(
      id = "a",
      type = EVENT_HARSH_BRAKE,
      t = 1_000.0,
      peak = 4.0,
      severity = 0.2,
      level = "light",
      lat = null,
      lon = null,
      speedMps = null,
    )
    val corner = DrivingEvent(
      id = "b",
      type = EVENT_HARSH_CORNER,
      t = 1_400.0,
      peak = 4.0,
      severity = 0.2,
      level = "light",
      lat = null,
      lon = null,
      speedMps = null,
    )
    assertTrue(eventsOverlap(brake, corner, now = 2_000.0, windowMs = 1_500.0))
    tagCompoundOverlaps(listOf(brake), incoming = corner, now = 2_000.0, windowMs = 1_500.0)
    assertTrue(brake.overlaps.contains(EVENT_HARSH_CORNER))
    assertTrue(corner.overlaps.contains(EVENT_HARSH_BRAKE))
  }

  @Test
  fun prefersReportedCourseThenInfersFromDisplacement() {
    val from = LocationSample(t = 0.0, lat = 32.0853, lon = 34.7818, accuracyM = 5.0)
    val east = LocationSample(t = 1000.0, lat = 32.0853, lon = 34.7818 + 0.0002, accuracyM = 5.0)
    val inferred = derivedCourseDeg(from, east)!!
    assertTrue(inferred > 80.0 && inferred < 100.0)
    assertEquals(12.0, derivedCourseDeg(from, east.copy(courseDeg = 12.0))!!, 0.001)
    assertEquals(null, derivedCourseDeg(null, east))
  }
}
