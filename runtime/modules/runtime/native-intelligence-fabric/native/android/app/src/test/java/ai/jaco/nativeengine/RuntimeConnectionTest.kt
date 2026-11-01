package ai.jaco.nativeengine

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.SocketException
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference

class RuntimeConnectionTest {
    private fun identity() = JSONObject()
        .put("success", true)
        .put("product", "JACO Autonomus IDE")
        .put("version", "0.22.0")
        .put("releaseId", "jaco-code-0.22.0")
        .put("canonicalGui", "JACO Autonomous IDE")
        .put("relayProtocol", "JACO-SEMANTIC-RELAY/1")

    private fun reject(action: () -> Unit) {
        try { action(); fail("Expected the untrusted input to be rejected") }
        catch (_: IllegalArgumentException) {}
        catch (_: IllegalStateException) {}
        catch (_: java.net.URISyntaxException) {}
    }

    @Test fun onlyLoopbackCanUseHttpAndAddressesCannotCarryCredentials() {
        for (value in listOf("http://127.0.0.1:3000", "http://localhost:3000/", "http://[::1]:3000")) {
            assertTrue(RuntimeAddress.parse(value).isLoopback)
        }
        val hub = RuntimeAddress.parse("https://hub.example.invalid/")
        assertFalse(hub.isLoopback)
        assertEquals("https://hub.example.invalid", hub.baseUrl)
        for (value in listOf(
            "http://hub.example.invalid", "http://127.0.0.1.example.invalid", "https://user:secret@hub.example.invalid",
            "https://hub.example.invalid/path", "https://hub.example.invalid?token=secret", "https://hub.example.invalid#secret",
            "http://127.0.0.1:0", "http://127.0.0.1:65536", "file:///data/local", "https://hub.example.invalid\n/header"
        )) reject { RuntimeAddress.parse(value) }
    }

    @Test fun onlyCanonicalWorkspaceIdentityPasses() {
        assertEquals("jaco-code-0.22.0", RuntimeConnection.validateIdentity(identity()).releaseId)
        for ((key, wrong) in listOf(
            "success" to false, "success" to "true", "product" to "Another service", "releaseId" to "jaco-code-0.21.0",
            "canonicalGui" to "JACO Autonomous IDE (substrate)", "relayProtocol" to "HTTP", "version" to "unknown"
        )) reject { RuntimeConnection.validateIdentity(identity().put(key, wrong)) }
        reject { RuntimeConnection.validateIdentity(JSONObject().put("success", true)) }
    }

    @Test fun probeReadsActualJsonIdentityAndNeverFollowsARedirect() {
        val redirected = AtomicInteger()
        val server = ServerSocket().apply { bind(InetSocketAddress("127.0.0.1", 0)); soTimeout = 250 }
        val mode = AtomicReference("identity")
        val running = AtomicBoolean(true)
        val fixtureError = AtomicReference<Throwable?>()
        val worker = Thread {
            while (running.get()) {
                val accepted = try { server.accept() }
                catch (_: java.net.SocketTimeoutException) { continue }
                catch (error: SocketException) { if (running.get()) fixtureError.set(error); break }
                try { accepted.use { socket ->
                    socket.soTimeout = 3000
                    val input = socket.getInputStream().bufferedReader()
                    val request = input.readLine().orEmpty()
                    val headers = generateSequence { input.readLine() }.takeWhile { it.isNotEmpty() }.take(100).toList()
                    assertFalse(headers.any { it.startsWith("Authorization:", ignoreCase = true) })
                    val unexpected = request.startsWith("GET /unexpected ")
                    if (unexpected) redirected.incrementAndGet()
                    val selected = mode.get()
                    val body = when (selected) {
                        "html" -> "<html>JACO</html>".toByteArray()
                        "large" -> ByteArray(17000) { ' '.code.toByte() }
                        else -> identity().toString().toByteArray()
                    }
                    val status = if (unexpected) "500 Internal Server Error" else if (selected == "redirect") "302 Found" else "200 OK"
                    val type = if (selected == "html") "text/html" else "application/json; charset=utf-8"
                    val location = if (selected == "redirect") "Location: /unexpected\r\n" else ""
                    socket.getOutputStream().apply {
                        write("HTTP/1.1 $status\r\nContent-Type: $type\r\nContent-Length: ${body.size}\r\nConnection: close\r\n$location\r\n".toByteArray(Charsets.UTF_8))
                        write(body); flush()
                    }
                } } catch (error: Throwable) { fixtureError.set(error); break }
            }
        }.apply { isDaemon = true; start() }
        try {
            val address = RuntimeAddress.parse("http://127.0.0.1:${server.localPort}")
            assertEquals("0.22.0", RuntimeConnection().probe(address).version)
            for (testMode in listOf("redirect", "html", "large")) { mode.set(testMode); reject { RuntimeConnection().probe(address) } }
            assertEquals(0, redirected.get())
        } finally {
            running.set(false); server.close(); worker.join(3000)
            assertFalse(worker.isAlive)
            fixtureError.get()?.let { throw it }
        }
    }
}
