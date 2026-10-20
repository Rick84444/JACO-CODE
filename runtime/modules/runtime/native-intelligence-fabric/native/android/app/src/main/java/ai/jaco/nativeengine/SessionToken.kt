package ai.jaco.nativeengine

import android.content.Context
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.security.keystore.StrongBoxUnavailableException
import android.util.Base64
import java.security.KeyStore
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Stores the Termux/native bridge token encrypted with Android Keystore.
 * StrongBox is requested where supported and transparently falls back to the
 * device Keystore when unavailable. The plaintext token is never persisted.
 */
object SessionToken {
    private const val PREF = "jaco-native-engine"
    private const val KEY = "session-token-v2"
    private const val ALIAS = "jaco-native-engine-session-key"

    private fun store(): KeyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }

    private fun generate(strongBox: Boolean): SecretKey {
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        val builder = KeyGenParameterSpec.Builder(
            ALIAS,
            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
        ).setBlockModes(KeyProperties.BLOCK_MODE_GCM)
         .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
         .setRandomizedEncryptionRequired(true)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P && strongBox) builder.setIsStrongBoxBacked(true)
        generator.init(builder.build())
        return generator.generateKey()
    }

    private fun key(): SecretKey {
        val ks = store()
        (ks.getKey(ALIAS, null) as? SecretKey)?.let { return it }
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) generateWithStrongBoxFallback() else generate(false)
    }

    @android.annotation.TargetApi(28)
    private fun generateWithStrongBoxFallback(): SecretKey =
        try { generate(true) } catch (_: StrongBoxUnavailableException) { generate(false) }

    private fun encrypt(value: String): String {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key())
        val iv = Base64.encodeToString(cipher.iv, Base64.NO_WRAP)
        val ciphertext = Base64.encodeToString(cipher.doFinal(value.toByteArray(Charsets.UTF_8)), Base64.NO_WRAP)
        return "$iv:$ciphertext"
    }

    private fun decrypt(value: String): String {
        val parts = value.split(':', limit = 2)
        require(parts.size == 2) { "Invalid token envelope" }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP)))
        return cipher.doFinal(Base64.decode(parts[1], Base64.NO_WRAP)).toString(Charsets.UTF_8)
    }

    @Synchronized fun get(context: Context): String {
        val prefs = context.getSharedPreferences(PREF, Context.MODE_PRIVATE)
        val envelope = prefs.getString(KEY, null)
        if (!envelope.isNullOrBlank()) {
            try { return decrypt(envelope) } catch (_: Throwable) { prefs.edit().remove(KEY).apply() }
        }
        return rotate(context)
    }

    @Synchronized fun rotate(context: Context): String {
        val bytes = ByteArray(32).also { SecureRandom().nextBytes(it) }
        val token = Base64.encodeToString(bytes, Base64.NO_WRAP or Base64.URL_SAFE)
        context.getSharedPreferences(PREF, Context.MODE_PRIVATE).edit().putString(KEY, encrypt(token)).apply()
        return token
    }
}
