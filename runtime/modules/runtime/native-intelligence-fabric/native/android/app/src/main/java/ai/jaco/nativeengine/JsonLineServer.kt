package ai.jaco.nativeengine

import kotlinx.coroutines.*
import kotlinx.serialization.json.*
import java.net.InetAddress
import java.net.ServerSocket

class JsonLineServer(
    private val port: Int,
    private val token: () -> String,
    private val handler: suspend (String, JsonObject) -> JsonElement
) : AutoCloseable {
    private var server: ServerSocket? = null
    private var job: Job? = null
    fun start(scope: CoroutineScope) {
        server = ServerSocket(port, 16, InetAddress.getByName("127.0.0.1"))
        job = scope.launch(Dispatchers.IO) {
            while (isActive) {
                val socket = server?.accept() ?: break
                launch {
                    socket.use { s ->
                        val reader=s.getInputStream().bufferedReader(); val writer=s.getOutputStream().bufferedWriter()
                        val line=reader.readLine() ?: return@use
                        val response = try {
                            val request=Json.parseToJsonElement(line).jsonObject
                            if (request["token"]?.jsonPrimitive?.contentOrNull != token()) error("unauthorized")
                            val id=request["id"]?.jsonPrimitive?.contentOrNull ?: "unknown"
                            val method=request["method"]?.jsonPrimitive?.contentOrNull ?: error("method required")
                            val params=request["params"]?.jsonObject ?: buildJsonObject { }
                            buildJsonObject { put("id",id); put("result",handler(method,params)) }
                        } catch (t: Throwable) {
                            buildJsonObject { put("error",buildJsonObject { put("message",t.message ?: t.javaClass.simpleName) }) }
                        }
                        writer.write(response.toString()); writer.newLine(); writer.flush()
                    }
                }
            }
        }
    }
    override fun close() { job?.cancel(); server?.close(); server=null }
}
