package ai.jaco.nativeengine

import kotlinx.coroutines.*
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test
import java.net.Socket
import java.net.ServerSocket

class JsonLineServerTest {
    @Test fun requestFramingIsBounded() {
        assertNull(readRequestLine("".reader().buffered(), 4))
        assertEquals("test", readRequestLine("test\r\n".reader().buffered(), 5))
        try { readRequestLine("12345\n".reader().buffered(), 4); fail() } catch (error: IllegalArgumentException) { assertEquals("NATIVE_REQUEST_TOO_LARGE", error.message) }
    }
    @Test fun actualLoopbackRequestsAreAuthenticatedAndErrorsRetainRequestIdentity() = runBlocking {
        val port = ServerSocket(0).use { it.localPort }; var calls = 0; var token = "fixture-native-token"
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
        val server = JsonLineServer(port, { token }) { method, _ -> calls++; check(method == "health") { "UNKNOWN_METHOD" }; buildJsonObject { put("healthy", true) } }
        server.start(scope)
        try {
            fun request(secret: String, method: String = "health"): JsonObject = Socket("127.0.0.1", port).use { socket ->
                socket.soTimeout = 3000
                val payload = buildJsonObject { put("id", "observed-id"); put("token", secret); put("method", method) }
                socket.getOutputStream().bufferedWriter().apply { write(payload.toString()); newLine(); flush() }
                Json.parseToJsonElement(socket.getInputStream().bufferedReader().readLine()).jsonObject
            }
            assertTrue(request("wrong").containsKey("error")); assertEquals(0, calls)
            assertEquals("observed-id", request(token)["id"]!!.jsonPrimitive.content); assertEquals(1, calls)
            val failure = request(token, "unknown"); assertEquals("observed-id", failure["id"]!!.jsonPrimitive.content); assertTrue(failure.containsKey("error"))
            token = "rotated-native-token"
            assertTrue(request("fixture-native-token").containsKey("error")); assertTrue(request(token).containsKey("result"))
        } finally { server.close(); scope.cancel() }
    }
    @Test fun launcherClientUsesTheActualAuthenticatedServer() = runBlocking {
        val port = ServerSocket(0).use { it.localPort }
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
        val server = JsonLineServer(port, { "fixture-client-token" }) { _, _ -> buildJsonObject { put("loaded", true) } }
        server.start(scope)
        try {
            val result = NativeEngineClient(port) { "fixture-client-token" }.call("model.load") as org.json.JSONObject
            assertTrue(result.getBoolean("loaded"))
            try { NativeEngineClient(port) { "wrong-token" }.call("model.load"); fail() }
            catch (error: IllegalStateException) { assertEquals("unauthorized", error.message) }
        } finally { server.close(); scope.cancel() }
    }
    @Test fun lostReplyAfterDispatchIsUnknownAndNeverRetried() {
        val server = ServerSocket(0); var received = 0
        val worker = Thread {
            server.accept().use { socket -> socket.getInputStream().bufferedReader().readLine(); received++ }
            server.close()
        }.apply { start() }
        try {
            try { NativeEngineClient(server.localPort) { "fixture-client-token" }.call("model.unload"); fail() }
            catch (error: NativeOutcomeUnknownException) { assertEquals("NATIVE_OUTCOME_UNKNOWN", error.message) }
            worker.join(3000); assertFalse(worker.isAlive); assertEquals(1, received)
        } finally { server.close(); worker.join(3000) }
    }

}
