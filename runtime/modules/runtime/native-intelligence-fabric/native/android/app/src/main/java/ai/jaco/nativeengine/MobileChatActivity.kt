package ai.jaco.nativeengine

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.text.InputType
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.Executors

/**
 * On-device chat backed by the existing authenticated LiteRT-LM engine.
 * This is NOT a second Aura runtime: projects, missions, memory and approvals
 * remain owned by Windows Aura and are accessed using the existing JACO Link.
 */
class MobileChatActivity : Activity() {
    private val worker = Executors.newSingleThreadExecutor()
    private val client by lazy { NativeEngineClient(token = { SessionToken.get(this) }) }
    private val preferences by lazy { getSharedPreferences("workspace", MODE_PRIVATE) }
    private val transcript = mutableListOf<Pair<String, String>>()
    private lateinit var status: TextView
    private lateinit var composer: EditText
    private lateinit var sendButton: Button
    private lateinit var loadButton: Button
    private lateinit var historyView: LinearLayout
    private lateinit var scroller: ScrollView
    private var busy = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE)
        render()
        savedInstanceState?.getStringArrayList("chat")?.forEach { encoded ->
            try {
                val row = JSONObject(encoded)
                val role = row.optString("role")
                val content = row.optString("content")
                if (role in listOf("user", "assistant") && content.isNotEmpty()) append(role, content)
            } catch (_: Exception) { /* A corrupt display row is not an authorization or model state. */ }
        }
        refreshStatus()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        outState.putStringArrayList("chat", ArrayList(transcript.takeLast(12).map { (role, text) ->
            JSONObject().put("role", role).put("content", text.take(4000)).toString()
        }))
        super.onSaveInstanceState(outState)
    }

    override fun onDestroy() {
        worker.shutdown()
        super.onDestroy()
    }

    private fun render() {
        val dp = resources.displayMetrics.density
        val inset = (16 * dp).toInt()
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(inset, inset, inset, inset)
            fitsSystemWindows = true
        }
        root.addView(TextView(this).apply {
            text = "JACO · Pixel"
            textSize = 25f
            setPadding(0, 0, 0, inset / 2)
        })
        root.addView(TextView(this).apply {
            text = "Lokal AI kör på telefonen. Aura Remote ansluter separat till samma Aura på Windows."
            textSize = 14f
            setTextIsSelectable(true)
        })
        val choices = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        loadButton = Button(this).apply {
            text = "Ladda modell"
            setOnClickListener { loadSelectedModel() }
        }
        choices.addView(loadButton, LinearLayout.LayoutParams(0, -2, 1f))
        choices.addView(Button(this).apply {
            text = "Aura Remote"
            setOnClickListener { openRemoteAura() }
        }, LinearLayout.LayoutParams(0, -2, 1f))
        root.addView(choices)
        status = TextView(this).apply {
            text = "Kontrollerar lokal modell…"
            textSize = 13f
            setTextIsSelectable(true)
            accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE
        }
        root.addView(status)
        scroller = ScrollView(this).apply { isFillViewport = true }
        historyView = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(0, inset / 2, 0, inset / 2)
        }
        scroller.addView(historyView)
        root.addView(scroller, LinearLayout.LayoutParams(-1, 0, 1f))
        val inputRow = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        composer = EditText(this).apply {
            hint = "Fråga din lokala AI…"
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
            minLines = 2
            maxLines = 5
        }
        inputRow.addView(composer, LinearLayout.LayoutParams(0, -2, 1f))
        sendButton = Button(this).apply {
            text = "Skicka"
            setOnClickListener { send() }
        }
        inputRow.addView(sendButton)
        root.addView(inputRow)
        root.addView(TextView(this).apply {
            text = "Offlinechatten lagras inte i Aura och kan inte köra verktyg. Modellhantering finns på föregående skärm."
            textSize = 12f
            setPadding(0, inset / 3, 0, 0)
        })
        setContentView(root)
    }

    private fun append(role: String, content: String) {
        transcript.add(role to content)
        historyView.addView(TextView(this).apply {
            text = (if (role == "user") "Du" else "Lokal AI") + "\n" + content
            textSize = 16f
            setTextIsSelectable(true)
            setPadding(8, 10, 8, 18)
        })
        scroller.post { scroller.fullScroll(View.FOCUS_DOWN) }
    }

    private fun setBusy(value: Boolean) {
        busy = value
        sendButton.isEnabled = !value
        loadButton.isEnabled = !value
    }

    private fun refreshStatus() {
        if (busy) return
        worker.execute {
            val text = try {
                val result = client.call("health") as JSONObject
                if (result.optBoolean("healthy")) {
                    "Lokal modell: " + result.optString("modelId") + " · backend " + result.optString("backend")
                } else {
                    "Ingen modell laddad. Importera och välj modell på föregående skärm."
                }
            } catch (_: Exception) {
                "Lokal motortjänst svarar inte. Öppna JACO Android och kontrollera tjänstens status."
            }
            runOnUiThread { if (!isDestroyed && !busy) status.text = text }
        }
    }

    private fun loadSelectedModel() {
        if (busy) return
        val id = preferences.getString("model", null)
        val backend = preferences.getString("backend", "auto") ?: "auto"
        if (id.isNullOrBlank()) {
            status.text = "Välj och importera en verifierad .litertlm-modell i JACO Android först."
            return
        }
        setBusy(true)
        status.text = "Verifierar och laddar vald modell…"
        worker.execute {
            val outcome = try {
                val result = client.call(
                    "model.load",
                    JSONObject().put("modelId", id).put("backend", backend),
                    180000
                ) as JSONObject
                if (result.optBoolean("loaded") && result.optString("modelId") == id) {
                    "Laddad modell: " + id + " · backend " + result.optString("backend")
                } else "Modelladdningen kunde inte verifieras."
            } catch (_: NativeOutcomeUnknownException) {
                "Okänt utfall efter anslutningsavbrott. Kontrollera modellstatus före nytt försök."
            } catch (e: Exception) {
                "Kunde inte ladda modellen: " + (e.message ?: "okänt fel").take(200)
            }
            runOnUiThread { if (!isDestroyed) {
                setBusy(false)
                status.text = outcome
            } }
        }
    }

    private fun send() {
        if (busy) return
        val question = composer.text.toString().trim()
        if (question.isEmpty()) return
        val requestText = try { LocalChatPrompt.compose(transcript, question) }
            catch (_: IllegalArgumentException) {
                status.text = "Meddelandet måste innehålla 1–4000 tecken."
                return
            }
        composer.setText("")
        append("user", question)
        setBusy(true)
        status.text = "Modellen bearbetar frågan lokalt…"
        worker.execute {
            var answer: String? = null
            val note = try {
                val messages = JSONArray()
                    .put(JSONObject().put("role", "system").put("content",
                        "Du är JACO:s lokala mobilassistent. Var tydlig med osäkerhet. " +
                        "Du har inte åtkomst till Auras minne, projekt eller verktyg."))
                    .put(JSONObject().put("role", "user").put("content", requestText))
                val result = client.call(
                    "completion.create",
                    JSONObject().put("request", JSONObject().put("messages", messages)),
                    120000
                ) as JSONObject
                answer = result.optString("text").ifBlank { "(Modellen returnerade ingen text.)" }
                if ((result.optJSONArray("toolCalls")?.length() ?: 0) > 0) {
                    "Modellen föreslog verktygsanrop; inga sådana har utförts."
                } else "Lokal inferens slutförd."
            } catch (_: NativeOutcomeUnknownException) {
                "Okänt utfall: inget automatiskt omförsök. Kontrollera motorn innan du skickar igen."
            } catch (e: Exception) {
                "Kunde inte generera svar: " + (e.message ?: "okänt fel").take(200)
            }
            runOnUiThread { if (!isDestroyed) {
                answer?.let { append("assistant", it) }
                status.text = note
                setBusy(false)
            } }
        }
    }

    private fun openRemoteAura() {
        try {
            // Chrome handles Google sign-in, session cookies and JACO Link device pairing.
            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://jacocode.com/link/remote.html")))
        } catch (_: Exception) {
            status.text = "Webbläsare saknas. Aura Remote kräver JACO Link på Windows."
        }
    }
}
