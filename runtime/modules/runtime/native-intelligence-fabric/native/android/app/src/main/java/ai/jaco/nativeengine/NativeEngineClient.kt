package ai.jaco.nativeengine

import org.json.JSONObject
import org.json.JSONException
import java.io.IOException
import java.net.InetSocketAddress
import java.net.Socket
import java.util.UUID

class NativeOutcomeUnknownException(cause: Exception) : IOException("NATIVE_OUTCOME_UNKNOWN", cause)

/** The launcher uses exactly the same authenticated transport as the Termux adapter. */
class NativeEngineClient(private val port: Int = 37621, private val token: () -> String) {
    fun call(method: String, params: JSONObject = JSONObject(), timeoutMs: Int = 8000): Any {
        val id = UUID.randomUUID().toString()
        var dispatched = false
        try {
            Socket().use { socket ->
                socket.connect(InetSocketAddress("127.0.0.1", port), 2000); socket.soTimeout = timeoutMs
                val request = JSONObject().put("id", id).put("token", token()).put("method", method).put("params", params)
                socket.getOutputStream().bufferedWriter().apply { dispatched = true; write(request.toString()); newLine(); flush() }
                val line = readRequestLine(socket.getInputStream().bufferedReader()) ?: throw IOException("NATIVE_CONNECTION_CLOSED")
                val response = JSONObject(line)
                if (response.has("error")) error(response.getJSONObject("error").optString("message", "NATIVE_ERROR"))
                if (response.optString("id") != id) throw IOException("NATIVE_RESPONSE_ID_MISMATCH")
                return response.get("result")
            }
        } catch (error: Exception) {
            // A lost reply is not proof that loading/unloading failed. Never replay it.
            if (dispatched && (error is IOException || error is JSONException || error is IllegalArgumentException)) throw NativeOutcomeUnknownException(error)
            throw error
        }
    }
}
