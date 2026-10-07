package com.harshy.engine

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.json.JSONObject
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

  @Test
  fun clockOffsetAndBootCountRoundTrip() {
    val meta = TripJournal.Meta(
      sessionId = "trip-c",
      startedAtMs = 5L,
      imuHz = 25,
      locationIntervalMs = 1_000L,
      background = false,
      clockOffsetMs = 1_699_999_000_000L,
      bootCount = 42,
    )
    val parsed = tripJournalMetaFromJson(JSONObject(tripJournalMetaToJson(meta).toString()))!!
    assertEquals(1_699_999_000_000L, parsed.clockOffsetMs)
    assertEquals(42, parsed.bootCount)
  }

  @Test
  fun olderJournalsWithoutClockFieldsStillParse() {
    val json = JSONObject().put("active", true).put("sessionId", "trip-d").put("startedAtMs", 7L)
    val parsed = tripJournalMetaFromJson(json)!!
    assertNull(parsed.clockOffsetMs)
    assertNull(parsed.bootCount)
  }

  @Test
  fun restoreReusesTheClockOffsetOnlyWithinTheSameBoot() {
    val meta = TripJournal.Meta("trip-e", 1L, 25, 1_000L, false, clockOffsetMs = 123L, bootCount = 7)
    assertEquals(123L, restoredClockOffsetMs(meta, currentBootCount = 7))
    assertNull(restoredClockOffsetMs(meta, currentBootCount = 8))
    assertNull(restoredClockOffsetMs(meta, currentBootCount = null))
    assertNull(restoredClockOffsetMs(meta.copy(bootCount = null), currentBootCount = 7))
    assertNull(restoredClockOffsetMs(meta.copy(clockOffsetMs = null), currentBootCount = 7))
  }
}
