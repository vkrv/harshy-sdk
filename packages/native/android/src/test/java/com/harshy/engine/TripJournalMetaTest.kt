package com.harshy.engine

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class TripJournalMetaTest {
  @Test
  fun missingTriggerIsManual() {
    val meta = tripJournalMetaFromFields(
      active = true,
      sessionId = "trip-a",
      startedAtMs = 1L,
      imuHz = 25,
      locationIntervalMs = 500L,
      background = true,
      trigger = null,
    )!!
    assertEquals("manual", meta.trigger)
  }

  @Test
  fun autoTriggerRoundTrips() {
    val meta = TripJournal.Meta(
      sessionId = "trip-b",
      startedAtMs = 9L,
      imuHz = 50,
      locationIntervalMs = 500L,
      background = true,
      trigger = "auto",
    )
    val payload = tripJournalMetaPayload(meta)
    assertEquals("auto", payload["trigger"])
    val parsed = tripJournalMetaFromFields(
      active = payload["active"] as Boolean,
      sessionId = payload["sessionId"] as String,
      startedAtMs = payload["startedAtMs"] as Long,
      imuHz = payload["imuHz"] as Int,
      locationIntervalMs = payload["locationIntervalMs"] as Long,
      background = payload["background"] as Boolean,
      trigger = payload["trigger"] as String,
    )!!
    assertEquals("auto", parsed.trigger)
    assertEquals("trip-b", parsed.sessionId)
  }

  @Test
  fun junkTriggerIsManual() {
    assertEquals("manual", parseTripTrigger("watch"))
    assertEquals("auto", parseTripTrigger("auto"))
    assertNull(
      tripJournalMetaFromFields(
        active = false,
        sessionId = "x",
        startedAtMs = 0L,
        imuHz = 25,
        locationIntervalMs = 500L,
        background = true,
        trigger = null,
      ),
    )
  }
}
