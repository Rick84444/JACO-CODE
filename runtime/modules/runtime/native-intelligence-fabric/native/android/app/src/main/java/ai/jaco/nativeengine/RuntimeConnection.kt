package ai.jaco.nativeengine

import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL

/** Only a local runtime receives the native engine token. A remote hub opens in the browser. */
class RuntimeAddress private constructor(val baseUrl: String, val isLoopback: Boolean) {
    companion object {
        fun parse(value: String): RuntimeAddress {
            val text = value.trim()
            require(text.isNotEmpty() && text.length <= 2048 && !text.any { it <= ' ' }) { "RUNTIME_ADDRESS_INVALID" }
            val uri = URI(text)
            val host = uri.host?.lowercase() ?: error("RUNTIME_ADDRESS_INVALID")
            val local = host in setOf("127.0.0.1", "localhost", "[::1]", "::1")
            require(uri.scheme == "https" || (uri.scheme == "http" && local)) { "RUNTIME_HTTPS_REQUIRED" }
            require(uri.rawUserInfo == null && uri.rawQuery == null && uri.rawFragment == null) { "RUNTIME_ADDRESS_INVALID" }
            require(uri.rawPath.isNullOrEmpty() || uri.rawPath == "/") { "RUNTIME_ADDRESS_INVALID" }
            require(uri.port == -1 || uri.port in 1..65535) { "RUNTIME_ADDRESS_INVALID" }
            return RuntimeAddress(uri.toASCIIString().removeSuffix("/"), local)
        }
    }
}

data class RuntimeIdentity(val version: String, val releaseId: String)

class RuntimeConnection(private val connectionFor: (URL) -> HttpURLConnection = { it.openConnection() as HttpURLConnection }) {
    companion object {
        private const val MAX_IDENTITY_BYTES = 16384

        fun validateIdentity(identity: JSONObject): RuntimeIdentity {
            val version = identity.optString("version")
            require(identity.opt("success") == true && identity.optString("product") in setOf("JACO Autonomus IDE", "JACO Autonomous IDE")) { "RUNTIME_IDENTITY_MISMATCH" }
            require(identity.optString("canonicalGui") == "JACO Autonomous IDE") { "RUNTIME_IDENTITY_MISMATCH" }
            require(version.matches(Regex("[0-9]+\\.[0-9]+\\.[0-9]+(?:[-+][A-Za-z0-9.-]+)?"))) { "RUNTIME_IDENTITY_MISMATCH" }
            require(identity.optString("releaseId") == "jaco-code-$version") { "RUNTIME_IDENTITY_MISMATCH" }
            require(identity.optString("relayProtocol") == "JACO-SEMANTIC-RELAY/1") { "RUNTIME_IDENTITY_MISMATCH" }
            return RuntimeIdentity(version, identity.getString("releaseId"))
        }
    }

    /** Read-only, bounded identity observation. No redirects, credential discovery, or TLS overrides. */
    fun probe(address: RuntimeAddress): RuntimeIdentity {
        val connection = connectionFor(URL("${address.baseUrl}/api/runtime/identity")).apply {
            requestMethod = "GET"
            connectTimeout = 2500
            readTimeout = 4000
            instanceFollowRedirects = false
            setRequestProperty("Accept", "application/json")
        }
        try {
            require(connection.responseCode == 200) { "RUNTIME_NOT_AVAILABLE" }
            require(connection.contentType?.substringBefore(';')?.trim()?.lowercase() == "application/json") { "RUNTIME_IDENTITY_MISMATCH" }
            val body = connection.inputStream.use { input ->
                val output = ByteArrayOutputStream()
                val buffer = ByteArray(2048)
                while (true) {
                    val count = input.read(buffer)
                    if (count < 0) break
                    require(output.size() + count <= MAX_IDENTITY_BYTES) { "RUNTIME_IDENTITY_TOO_LARGE" }
                    output.write(buffer, 0, count)
                }
                output.toByteArray()
            }
            return validateIdentity(JSONObject(body.toString(Charsets.UTF_8)))
        } finally {
            connection.disconnect()
        }
    }
}
