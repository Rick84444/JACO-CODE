package ai.jaco.nativeengine

import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.ByteArrayInputStream
import java.io.IOException
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

class ModelStoreTest {
    @get:Rule val temporary = TemporaryFolder()
    private fun hash(value: ByteArray) = MessageDigest.getInstance("SHA-256").digest(value).joinToString("") { "%02x".format(it) }
    private fun refused(fragment: String, action: () -> Unit) {
        try { action(); fail("Expected $fragment") } catch (error: IllegalArgumentException) { assertTrue(error.message.orEmpty(), error.message.orEmpty().contains(fragment)) }
    }
    @Test fun importsAreDurableAndTamperFailsBeforeLoading() {
        val root = temporary.newFolder(); val store = ModelStore(root); val data = "real copied bytes".toByteArray()
        val imported = store.importModel("local-code", data.inputStream(), hash(data))
        assertEquals(hash(data), imported["sha256"])
        assertArrayEquals(data, ModelStore(root).verify("local-code").readBytes())
        assertEquals(listOf("local-code"), store.list().map { it["id"] })
        store.pathFor("local-code").writeText("changed")
        refused("MODEL_INTEGRITY_UNVERIFIED") { store.verify("local-code") }
        // A catalog read exposes the stored receipt without an expensive/invented new hash.
        assertEquals(hash(data), store.list().single()["sha256"])
    }
    @Test fun invalidHashOrInterruptedImportPublishesNothingAndNeverReplacesExistingModel() {
        val root = temporary.newFolder(); val store = ModelStore(root); val data = "test".toByteArray()
        refused("SHA-256 mismatch") { store.importModel("bad", data.inputStream(), "0".repeat(64)) }
        assertEquals(emptyList<Map<String, Any>>(), store.list()); assertTrue(root.listFiles()!!.isEmpty())
        val interrupted = object : InputStream() { var count = 0; override fun read(): Int = if (count++ < 4) 'x'.code else throw IOException("fixture interrupted") }
        try { store.importModel("broken", interrupted, hash(data)); fail() } catch (_: IOException) {}
        assertTrue(root.listFiles()!!.isEmpty())
        store.importModel("saved", data.inputStream(), hash(data))
        refused("MODEL_ALREADY_INSTALLED") { store.importModel("saved.litertlm", "other".byteInputStream(), hash(data)) }
        assertArrayEquals(data, store.verify("saved").readBytes())
        assertTrue(store.remove("saved")); assertTrue(root.listFiles()!!.isEmpty())
    }
    @Test fun idsDoNotAliasPathsAndUnverifiedLegacyModelsCannotLoad() {
        val store = ModelStore(temporary.newFolder())
        for (id in listOf("", "../a", "/escape", ".hidden", "a/b", "a b", "a:b", "a\\b")) refused("INVALID_MODEL_ID") { store.pathFor(id) }
        store.pathFor("legacy").writeText("legacy")
        refused("MODEL_INTEGRITY_UNVERIFIED") { store.verify("legacy") }
    }
    private open class Reply(url: URL, private val code: Int, private val bytes: ByteArray, private val range: String? = null) : HttpURLConnection(url) {
        override fun connect() {}
        override fun disconnect() {}
        override fun usingProxy() = false
        override fun getResponseCode() = code
        override fun getInputStream(): InputStream = ByteArrayInputStream(bytes)
        override fun getHeaderField(name: String): String? = if (name == "Content-Range") range else null
    }
    @Test fun resumedDownloadAppendsInsteadOfTruncatingAndRejectsWrongRange() {
        val root = temporary.newFolder(); val url = "https://huggingface.co/fixture/model.litertlm"; val data = "prefix-suffix".toByteArray()
        val expected = hash(data); val part = java.io.File(root, "test.litertlm.part"); part.writeText("prefix-")
        java.io.File(root, "test.litertlm.download").writeText(url + "\n" + expected)
        val store = ModelStore(root) { address -> object : Reply(address, 206, "suffix".toByteArray(), "bytes 7-12/13") {
            override fun getResponseCode(): Int { assertEquals("bytes=7-", getRequestProperty("Range")); return super.getResponseCode() }
        } }
        store.install("test", url, expected)
        assertArrayEquals(data, store.verify("test").readBytes())
        val otherPart = java.io.File(root, "other.litertlm.part"); otherPart.writeText("prefix-")
        java.io.File(root, "other.litertlm.download").writeText(url + "\n" + expected)
        val wrong = ModelStore(root) { address -> Reply(address, 206, "suffix".toByteArray(), "bytes 0-5/13") }
        refused("MODEL_RANGE_MISMATCH") { wrong.install("other", url, expected) }
        assertEquals("prefix-", otherPart.readText()); assertFalse(store.pathFor("other").exists())
    }
    @Test fun ignoredRangeRestartsCleanlyAndDifferentDownloadIdentityDiscardsOldPartial() {
        val root = temporary.newFolder(); val url = "https://huggingface.co/fixture/model.litertlm"; val data = "whole file".toByteArray(); val expected = hash(data)
        java.io.File(root, "test.litertlm.part").writeText("old")
        java.io.File(root, "test.litertlm.download").writeText(url + "\n" + expected)
        val store = ModelStore(root) { address -> Reply(address, 200, data) }
        store.install("test", url, expected); assertArrayEquals(data, store.verify("test").readBytes())
        java.io.File(root, "next.litertlm.part").writeText("unrelated")
        java.io.File(root, "next.litertlm.download").writeText("different identity")
        val next = ModelStore(root) { address -> object : Reply(address, 200, data) {
            override fun getResponseCode(): Int { assertNull(getRequestProperty("Range")); return super.getResponseCode() }
        } }
        next.install("next", url, expected); assertArrayEquals(data, next.verify("next").readBytes())
    }
    @Test fun unapprovedSourcesAreRefusedBeforeOpeningConnection() {
        val store = ModelStore(temporary.newFolder()) { error("Must not open an unapproved connection") }
        for (url in listOf("http://huggingface.co/model", "https://evil.test/model", "https://huggingface.co.evil.test/model", "https://user:pass@huggingface.co/model")) {
            refused("not approved") { store.install("test", url, "a".repeat(64)) }
        }
    }
    @Test fun processDeathLeavesNoVisibleModelAndNextImportReclaimsAbandonedCopy() {
        val root = temporary.newFolder(); val abandoned = java.io.File(root, ".00000000-0000-0000-0000-000000000000.import").apply { writeText("incomplete") }
        val partial = java.io.File(root, "download.litertlm.part").apply { writeText("resume me") }
        val store = ModelStore(root); assertTrue(store.list().isEmpty())
        val bytes = "verified".toByteArray(); store.importModel("next", bytes.inputStream(), hash(bytes))
        assertFalse(abandoned.exists()); assertTrue(partial.exists()); assertEquals("next", store.list().single()["id"])
    }
    @Test fun completeDownloadSurvivesDeathBeforePromotion() {
        val root = temporary.newFolder(); val url = "https://huggingface.co/fixture/model.litertlm"; val bytes = "complete download".toByteArray(); val expected = hash(bytes)
        java.io.File(root, "ready.litertlm.part").writeBytes(bytes)
        java.io.File(root, "ready.litertlm.download").writeText(url + "\n" + expected)
        val store = ModelStore(root) { address -> Reply(address, 416, ByteArray(0)) }
        store.install("ready", url, expected); assertArrayEquals(bytes, store.verify("ready").readBytes())
        assertFalse(java.io.File(root, "ready.litertlm.download").exists())
    }
}
