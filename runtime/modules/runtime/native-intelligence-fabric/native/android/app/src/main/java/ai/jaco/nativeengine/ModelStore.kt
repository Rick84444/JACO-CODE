package ai.jaco.nativeengine

import android.content.Context
import java.io.File
import java.io.FileOutputStream
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.security.MessageDigest
import java.util.UUID

/** App-private model ownership. Installation never replaces an existing model. */
class ModelStore(private val root: File, private val connectionFor: (URL) -> HttpURLConnection = { it.openConnection() as HttpURLConnection }) {
    constructor(context: Context) : this(File(context.filesDir, "models"))
    init { root.mkdirs() }
    companion object { private val lock = Any(); private const val MAX_BYTES = 16L * 1024 * 1024 * 1024 }
    fun pathFor(id: String): File {
        val name = id.removeSuffix(".litertlm")
        require(name.matches(Regex("[A-Za-z0-9][A-Za-z0-9._-]{0,119}"))) { "INVALID_MODEL_ID" }
        return File(root, "$name.litertlm")
    }
    fun list(): List<Map<String, Any>> = synchronized(lock) {
        root.listFiles()?.filter { it.isFile && it.name.endsWith(".litertlm") }?.sortedBy { it.name }?.map { file ->
            // Catalog refreshes do not rehash multi-gigabyte models. Loading verifies the bytes.
            val receipt = File(file.path + ".sha256").takeIf { it.isFile }?.readText()?.trim().orEmpty()
            mapOf("id" to file.name.removeSuffix(".litertlm"), "path" to file.absolutePath,
                "sizeBytes" to file.length(), "sha256" to receipt)
        } ?: emptyList()
    }
    fun sha256(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input -> val buf = ByteArray(1024 * 1024); while (true) { val n = input.read(buf); if (n < 0) break; digest.update(buf, 0, n) } }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }
    fun verify(id: String): File = synchronized(lock) {
        val file = pathFor(id); require(file.isFile) { "MODEL_NOT_INSTALLED" }
        val receipt = File(file.path + ".sha256")
        require(receipt.isFile && sha256(file).equals(receipt.readText().trim(), true)) { "MODEL_INTEGRITY_UNVERIFIED: reimport with its expected SHA-256" }
        file
    }
    private fun expected(value: String) { require(value.matches(Regex("[a-fA-F0-9]{64}"))) { "A full SHA-256 is required" } }
    private fun allowed(uri: URI): Boolean {
        val host = uri.host.orEmpty().lowercase()
        return uri.scheme == "https" && uri.userInfo == null && (host == "huggingface.co" || host.endsWith(".huggingface.co") || host.endsWith(".hf.co"))
    }
    private fun copy(input: InputStream, part: File, append: Boolean, progress: (Long) -> Unit) {
        FileOutputStream(part, append).use { out ->
            var total = if (append) part.length() else 0L; val buf = ByteArray(1024 * 1024)
            while (true) {
                if (Thread.currentThread().isInterrupted) throw InterruptedException("MODEL_IMPORT_CANCELLED")
                val n = input.read(buf); if (n < 0) break
                total += n; require(total <= MAX_BYTES) { "MODEL_SIZE_LIMIT_16GB" }
                require(root.usableSpace > n + 1024 * 1024) { "MODEL_STORAGE_FULL" }
                out.write(buf, 0, n); progress(total)
            }
            out.fd.sync()
        }
    }
    private fun promote(id: String, part: File, hash: String): Map<String, Any> {
        val target = pathFor(id); require(!target.exists()) { "MODEL_ALREADY_INSTALLED" }
        val digest = sha256(part)
        require(digest.equals(hash, true)) { part.delete(); "Model SHA-256 mismatch" }
        require(part.length() > 0) { "MODEL_EMPTY" }
        val receipt = File(target.path + ".sha256")
        // Receipt is durable before the model becomes visible. A crash cannot expose unverified bytes.
        FileOutputStream(receipt).use { it.write(digest.toByteArray()); it.fd.sync() }
        Files.move(part.toPath(), target.toPath(), StandardCopyOption.ATOMIC_MOVE)
        return mapOf("id" to target.name.removeSuffix(".litertlm"), "path" to target.absolutePath, "sizeBytes" to target.length(), "sha256" to digest)
    }
    fun importModel(id: String, input: InputStream, expectedSha256: String, progress: (Long) -> Unit = {}): Map<String, Any> = synchronized(lock) {
        expected(expectedSha256); val target = pathFor(id); require(!target.exists()) { "MODEL_ALREADY_INSTALLED" }
        // No import can be active while this shared lock is held. Recover disk space
        // from a previous process death without touching resumable HTTPS downloads.
        root.listFiles()?.filter { it.name.matches(Regex("\\.[a-f0-9-]{36}\\.import")) }?.forEach { require(it.delete()) { "MODEL_IMPORT_CLEANUP_FAILED" } }
        val part = File(root, ".${UUID.randomUUID()}.import")
        try { copy(input, part, false, progress); promote(id, part, expectedSha256) } finally { part.delete() }
    }
    fun install(id: String, sourceUrl: String, expectedSha256: String): Map<String, Any> = synchronized(lock) {
        expected(expectedSha256); val target = pathFor(id); require(!target.exists()) { "MODEL_ALREADY_INSTALLED" }
        require(allowed(URI(sourceUrl))) { "Model source host is not approved" }
        val part = File(target.path + ".part"); val identity = File(target.path + ".download")
        val requestKey = sourceUrl + "\n" + expectedSha256.lowercase()
        if (!identity.isFile || identity.readText() != requestKey) { part.delete(); identity.writeText(requestKey) }
        var current = URL(sourceUrl); var redirects = 0
        while (true) {
            require(allowed(current.toURI())) { "Model source host is not approved" }
            val offset = if (part.isFile) part.length() else 0L
            val connection = connectionFor(current).apply {
                instanceFollowRedirects = false; connectTimeout = 15000; readTimeout = 60000
                setRequestProperty("User-Agent", "JACO-Native-Engine/0.13")
                if (offset > 0) setRequestProperty("Range", "bytes=$offset-")
            }
            try {
                val code = connection.responseCode
                if (code in 300..399) { require(redirects++ < 8) { "Too many model download redirects" }; current = URL(current, connection.getHeaderField("Location") ?: error("Redirect missing Location")); continue }
                if (code == 416 && offset > 0) {
                    // The complete file may have arrived just before the process stopped.
                    val result = promote(id, part, expectedSha256); identity.delete(); return@synchronized result
                }
                require(code == 200 || code == 206) { "Model download HTTP $code" }
                if (code == 206) require(offset > 0 && connection.getHeaderField("Content-Range")?.startsWith("bytes $offset-") == true) { "MODEL_RANGE_MISMATCH" }
                connection.inputStream.use { copy(it, part, code == 206) {} }
                break
            } finally { connection.disconnect() }
        }
        val result = promote(id, part, expectedSha256); identity.delete(); result
    }
    fun remove(id: String): Boolean = synchronized(lock) {
        val file = pathFor(id); val removed = file.delete()
        if (removed) { File(file.path + ".sha256").delete(); File(file.path + ".part").delete(); File(file.path + ".download").delete() }
        removed
    }
}
