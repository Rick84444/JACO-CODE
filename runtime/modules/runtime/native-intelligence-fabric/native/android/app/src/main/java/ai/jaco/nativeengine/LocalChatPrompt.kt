package ai.jaco.nativeengine

/** Context for an explicitly local, non-Aura conversation.
 * The existing native RPC supports one user turn; we bound and assemble recent
 * turns in the prompt, rather than pretending it provides persistent model state.
 */
internal object LocalChatPrompt {
    fun compose(history: List<Pair<String, String>>, next: String): String {
        require(next.isNotBlank() && next.length <= 4000) { "INVALID_LOCAL_PROMPT" }
        val recent = history.takeLast(8)
        if (recent.isEmpty()) return next
        return buildString {
            appendLine("Konversation hittills (lokal tillfällig kontext):")
            recent.forEach { (role, content) ->
                append(if (role == "user") "Användare: " else "Assistent: ")
                appendLine(content.take(850))
            }
            appendLine()
            appendLine("Senaste användarmeddelande:")
            append(next)
        }
    }
}
