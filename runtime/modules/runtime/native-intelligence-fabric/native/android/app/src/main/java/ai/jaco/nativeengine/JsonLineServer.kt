package ai.jaco.nativeengine

import kotlinx.coroutines.*
import kotlinx.coroutines.sync.Semaphore
import kotlinx.serialization.json.*
import java.io.BufferedReader
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.security.MessageDigest
import java.util.concurrent.ConcurrentHashMap

internal fun readRequestLine(reader: BufferedReader, maxChars: Int = 1_048_576): String? {
    val line = StringBuilder()
    while (true) {
        val char = reader.read()
        if (char == -1) return if (line.isEmpty()) null else line.toString()
        if (char == '\n'.code) return line.toString().removeSuffix("\r")
        require(line.length < maxChars) { "NATIVE_REQUEST_TOO_LARGE" }
        line.append(char.toChar())
    }
}

class JsonLineServer(
    private val port: Int,
    private val token: () -> String,
    private val handler: suspend (String, JsonObject) -> JsonElement
) : AutoCloseable {
    private var server: ServerSocket? = null
    private var job: Job? = null
    private val slots = Semaphore(8)
    private val sockets = ConcurrentHashMap.newKeySet<Socket>()
    fun start(scope: CoroutineScope) {
        server = ServerSocket(port, 16, InetAddress.getByName("127.0.0.1"))
        job = scope.launch(Dispatchers.IO) {
            while (isActive) {
                val socket = try { server?.accept() ?: break } catch (_: java.net.SocketException) { break }
                if (!slots.tryAcquire()) { socket.close(); continue }
                sockets.add(socket)
                launch {
                    try {
                        socket.use { s ->
                            s.soTimeout = 10000
                            var id = "unknown"
                            val response = try {
                                val line = readRequestLine(s.getInputStream().bufferedReader()) ?: return@use
                                val request = try { Json.parseToJsonElement(line).jsonObject } catch (_: Exception) { error("NATIVE_REQUEST_INVALID") }
                                val supplied = request["token"]?.jsonPrimitive?.contentOrNull.orEmpty()
                                require(MessageDigest.isEqual(supplied.toByteArray(), token().toByteArray())) { "unauthorized" }
                                id = request["id"]?.jsonPrimitive?.contentOrNull ?: "unknown"
                                val method = request["method"]?.jsonPrimitive?.contentOrNull ?: error("method required")
                                val params = request["params"]?.jsonObject ?: buildJsonObject { }
                                buildJsonObject { put("id", id); put("result", handler(method, params)) }
                            } catch (cancelled: CancellationException) { throw cancelled }
                            catch (error: Exception) {
                                buildJsonObject { put("id", id); put("error", buildJsonObject { put("message", (error.message ?: error.javaClass.simpleName).take(500)) }) }
                            }
                            s.getOutputStream().bufferedWriter().apply { write(response.toString()); newLine(); flush() }
                        }
                    } catch (_: java.io.IOException) { /* Disconnected clients do not replay a tool or inference. */ }
                    finally { sockets.remove(socket); slots.release() }
                }
            }
        }
    }
    override fun close() { job?.cancel(); server?.close(); server = null; sockets.forEach { it.close() }; sockets.clear() }
}
