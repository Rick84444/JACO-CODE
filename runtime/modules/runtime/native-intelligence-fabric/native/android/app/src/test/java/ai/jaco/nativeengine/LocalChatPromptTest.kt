package ai.jaco.nativeengine

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class LocalChatPromptTest {
    @Test fun firstTurnUsesUnmodifiedQuestion() {
        assertEquals("Hej Aura", LocalChatPrompt.compose(emptyList(), "Hej Aura"))
    }
    @Test fun historyIncludesRecentTurnsAndCurrentQuestion() {
        val prompt = LocalChatPrompt.compose(listOf("user" to "En fråga", "assistant" to "Ett svar"), "Ny fråga")
        assertTrue(prompt.contains("Användare: En fråga"))
        assertTrue(prompt.contains("Assistent: Ett svar"))
        assertTrue(prompt.endsWith("Ny fråga"))
    }
    @Test fun boundsOldContext() {
        val h = (1..20).map { "user" to "Meddelande" + it }
        val prompt = LocalChatPrompt.compose(h, "senaste")
        assertTrue(!prompt.contains("Meddelande1\n"))
        assertTrue(prompt.contains("Meddelande20"))
    }
    @Test(expected = IllegalArgumentException::class)
    fun rejectsOversizedPrompt() {
        LocalChatPrompt.compose(emptyList(), "x".repeat(4001))
    }
}
