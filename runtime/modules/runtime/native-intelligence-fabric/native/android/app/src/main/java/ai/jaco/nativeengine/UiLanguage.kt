package ai.jaco.nativeengine

import android.content.Context
import android.content.res.Configuration
import java.util.Locale

/** UI language is independent from the model's prompt language. New installs use English. */
object UiLanguage {
    private const val PREFERENCES = "workspace"
    private const val KEY = "uiLanguage"

    fun selected(context: Context): String =
        if (context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE).getString(KEY, "en") == "sv") "sv" else "en"

    fun select(context: Context, language: String) {
        require(language == "en" || language == "sv")
        context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE).edit().putString(KEY, language).apply()
    }

    fun wrap(context: Context): Context {
        val configuration = Configuration(context.resources.configuration)
        configuration.setLocale(Locale.forLanguageTag(selected(context)))
        return context.createConfigurationContext(configuration)
    }
}
