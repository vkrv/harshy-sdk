package com.harshy.sdk

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ConfigMapsTest {
  @Test
  fun nullOrEmptyMapKeepsTheBase() {
    assertEquals(DetectorConfig.DEFAULT, detectorConfigFromMap(null))
    assertEquals(DetectorConfig.DEFAULT, detectorConfigFromMap(emptyMap()))
  }

  @Test
  fun appliesKnownKeysAndAcceptsAnyNumberType() {
    val config = detectorConfigFromMap(mapOf("harshBrakeMps2" to 3.5, "cooldownMs" to 4000, "harshMediumX" to 1.25f))
    assertEquals(3.5, config.harshBrakeMps2, 0.0)
    assertEquals(4000.0, config.cooldownMs, 0.0)
    assertEquals(1.25, config.harshMediumX, 0.0)
    assertEquals(DetectorConfig.DEFAULT.harshAccelMps2, config.harshAccelMps2, 0.0)
  }

  @Test
  fun ignoresUnknownKeysAndInvalidValues() {
    val config = detectorConfigFromMap(
      mapOf(
        "notAKey" to 1.0,
        "harshAccelMps2" to "3",
        "harshBrakeMps2" to -1.0,
        "minSpeedMps" to Double.NaN,
        "impactVerticalMax" to 1.5,
      ),
    )
    assertEquals(DetectorConfig.DEFAULT, config)
  }

  @Test
  fun zeroIsAllowedOnlyWhereTheSchemaAllowsIt() {
    val config = detectorConfigFromMap(mapOf("minSpeedMps" to 0, "harshCornerMps2" to 0))
    assertEquals(0.0, config.minSpeedMps, 0.0)
    assertEquals(DetectorConfig.DEFAULT.harshCornerMps2, config.harshCornerMps2, 0.0)
  }

  @Test
  fun speedingCanBeSetAndSwitchedOff() {
    val on = detectorConfigFromMap(mapOf("speedingMps" to 22.0))
    assertEquals(22.0, on.speedingMps!!, 0.0)
    assertNull(detectorConfigFromMap(mapOf("speedingMps" to null), base = on).speedingMps)
    assertEquals(22.0, detectorConfigFromMap(mapOf("speedingMps" to 0), base = on).speedingMps!!, 0.0)
  }

  @Test
  fun layersOnTheGivenBase() {
    val base = DetectorConfig.DEFAULT.copy(harshAccelMps2 = 2.0)
    val config = detectorConfigFromMap(mapOf("harshBrakeMps2" to 4.0), base)
    assertEquals(2.0, config.harshAccelMps2, 0.0)
    assertEquals(4.0, config.harshBrakeMps2, 0.0)
  }

  @Test
  fun updatesScoreWeightsFromANestedMap() {
    val config = detectorConfigFromMap(mapOf("score" to mapOf("harshBrake" to 10, "refDistanceKm" to -1.0)))
    assertEquals(10.0, config.score.harshBrake, 0.0)
    assertEquals(DetectorConfig.DEFAULT.score.refDistanceKm, config.score.refDistanceKm, 0.0)
  }

  @Test
  fun captureOptionsAreClampedAndLayered() {
    val base = NativeStartOptions(imuHz = 25, locationIntervalMs = 1_000L, background = false)
    assertEquals(base, nativeStartOptionsFromMap(null, base))
    val parsed = nativeStartOptionsFromMap(mapOf("imuHz" to 500, "locationIntervalMs" to 50, "background" to true), base)
    assertEquals(100, parsed.imuHz)
    assertEquals(200L, parsed.locationIntervalMs)
    assertEquals(false, parsed.background)
    assertEquals(41, nativeStartOptionsFromMap(mapOf("imuHz" to 40.7), base).imuHz)
    assertEquals(1_000L, nativeStartOptionsFromMap(mapOf("locationIntervalMs" to "fast"), base).locationIntervalMs)
  }
}
