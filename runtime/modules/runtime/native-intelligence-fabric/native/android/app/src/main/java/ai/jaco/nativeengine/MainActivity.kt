package ai.jaco.nativeengine

import android.Manifest
import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.text.InputType
import android.widget.*
import android.view.View
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

/** Native controls for the existing engine; Aura remains the only IDE and agent UI. */
class MainActivity : Activity() {
    private val executor = Executors.newSingleThreadExecutor()
    private val handler = Handler(Looper.getMainLooper())
    private val preferences by lazy { getSharedPreferences("workspace", MODE_PRIVATE) }
    private val client by lazy { NativeEngineClient { SessionToken.get(this) } }
    private lateinit var status: TextView
    private lateinit var message: TextView
    private lateinit var modelList: Spinner
    private lateinit var backendList: Spinner
    private lateinit var modelId: EditText
    private lateinit var hash: EditText
    private lateinit var port: EditText
    private lateinit var progress: ProgressBar
    private val controls = mutableListOf<Button>()
    private var ids = emptyList<String>()
    private var busy = false
    private var resumed = false
    private var pendingId = ""
    private var pendingHash = ""
    private var paired = false
    private var autoPairPending = true
    private val backends = listOf("auto", "npu", "gpu", "cpu")
    private val polling = object : Runnable {
        override fun run() { if (!resumed) return; if (!busy) refresh(); handler.postDelayed(this, 15000) }
    }
    override fun onCreate(state: Bundle?) {
        super.onCreate(state)
        SessionToken.get(this)
        render(state)
        try { startForegroundService(Intent(this, JacoNativeEngineService::class.java)) }
        catch (_: Exception) { message.setText(R.string.engine_start_failed) }
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 7)
        }
    }
    override fun onResume() { super.onResume(); resumed = true; handler.post(polling) }
    override fun onPause() { resumed = false; handler.removeCallbacks(polling); super.onPause() }
    override fun onDestroy() { handler.removeCallbacksAndMessages(null); executor.shutdownNow(); super.onDestroy() }
    override fun onSaveInstanceState(out: Bundle) {
        out.putString("id", modelId.text.toString()); out.putString("hash", hash.text.toString())
        out.putString("pendingId", pendingId); out.putString("pendingHash", pendingHash)
        super.onSaveInstanceState(out)
    }
    private fun render(state: Bundle?) {
        val scale = resources.displayMetrics.density
        val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding((20*scale).toInt(), (24*scale).toInt(), (20*scale).toInt(), (24*scale).toInt()) }
        fun label(text: String, size: Float = 16f): TextView = TextView(this).apply { this.text = text; textSize = size; setTextIsSelectable(true); setPadding(0, 18, 0, 12); root.addView(this) }
        fun field(hint: String, value: String): EditText = EditText(this).apply { this.hint = hint; setText(value); isSingleLine = true; root.addView(this) }
        fun button(title: String, action: () -> Unit) = Button(this).apply { text = title; minHeight = (48*scale).toInt(); setOnClickListener { action() }; root.addView(this); controls.add(this) }
        label("JACO · Android", 26f)
        label("Aura för projekt, samtal och agenter. Lokal modellmotor på din telefon.")
        status = label("Kontrollerar motortjänsten…")
        message = label("")
        message.accessibilityLiveRegion = android.view.View.ACCESSIBILITY_LIVE_REGION_POLITE
        progress = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply { isIndeterminate = true; visibility = android.view.View.GONE; root.addView(this) }
        button("Uppdatera status") { refresh() }
        label("Arbetsyta", 21f)
        port = field("Lokal JACO-port", preferences.getInt("runtimePort", 3000).toString()).apply { inputType = InputType.TYPE_CLASS_NUMBER }
        button("Öppna Aura") {
            val selectedPort = runtimePort() ?: return@button
            preferences.edit().putInt("runtimePort", selectedPort).apply()
            try { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("http://127.0.0.1:$selectedPort"))) }
            catch (_: Exception) { message.setText(R.string.browser_unavailable) }
        }
        button("Anslut till JACO igen") { pair() }
        label("Samma Aura-historik, projekt, agentplaner, bilagor, MCP och skills som i den lokala arbetsytan. JACO behöver vara startat i Termux.")
        label("Lokala modeller", 21f)
        modelList = Spinner(this).apply { contentDescription = "Installerad lokal modell"; root.addView(this) }
        backendList = Spinner(this).apply {
            contentDescription = "Önskad beräkningsmotor"
            adapter = ArrayAdapter(this@MainActivity, android.R.layout.simple_spinner_dropdown_item, backends)
            setSelection(backends.indexOf(preferences.getString("backend", "auto")).coerceAtLeast(0)); root.addView(this)
        }
        modelList.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
            override fun onItemSelected(parent: AdapterView<*>?, view: View?, position: Int, id: Long) { ids.getOrNull(position)?.let { preferences.edit().putString("model", it).apply() } }
            override fun onNothingSelected(parent: AdapterView<*>?) {}
        }
        backendList.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
            override fun onItemSelected(parent: AdapterView<*>?, view: View?, position: Int, id: Long) { preferences.edit().putString("backend", backends[position]).apply() }
            override fun onNothingSelected(parent: AdapterView<*>?) {}
        }
        label("Auto provar NPU, GPU och CPU. Status visar den motor som faktiskt laddats. Valet nedan är en inställning, inte bevis på en laddad modell.")
        button("Ladda vald modell") {
            val id = ids.getOrNull(modelList.selectedItemPosition) ?: run { message.setText(R.string.import_first); return@button }
            val backend = backends[backendList.selectedItemPosition]
            preferences.edit().putString("model", id).putString("backend", backend).apply()
            runTask("Verifierar filen och laddar $id…") {
                val receipt = client.call("model.load", JSONObject().put("modelId", id).put("backend", backend), 180000) as JSONObject
                check(receipt.optBoolean("loaded") && receipt.optString("modelId") == id) { "Modelladdningen kunde inte verifieras" }
                "Modellen laddades. Uppdaterad status visar verklig motor."
            }
        }
        button("Frigör modellens minne") { runTask("Frigör modellen…") {
            val receipt = client.call("model.unload") as JSONObject
            check(receipt.optBoolean("unloaded")) { "Avlastningen kunde inte verifieras" }
            "Modellen avlastades från minnet."
        } }
        button("Ta bort vald modellkopia från appen") {
            val id = ids.getOrNull(modelList.selectedItemPosition) ?: return@button
            runTask("Tar bort $id från appens lagring…") {
                val result = client.call("model.remove", JSONObject().put("modelId", id)) as JSONObject
                check(result.optBoolean("removed")) { "Modellen kunde inte tas bort" }
                "Modellkopian togs bort. Originalfilen finns kvar."
            }
        }
        label("Importera .litertlm från telefonen", 21f)
        modelId = field("Modell-ID, till exempel min-kodmodell", state?.getString("id").orEmpty())
        hash = field("Förväntad SHA-256 från modellutgivaren", state?.getString("hash").orEmpty())
        pendingId = state?.getString("pendingId").orEmpty(); pendingHash = state?.getString("pendingHash").orEmpty()
        button("Välj modellfil") {
            val id = modelId.text.toString().trim(); val expected = hash.text.toString().trim()
            try { ModelStore(this).pathFor(id); require(expected.matches(Regex("[a-fA-F0-9]{64}"))) }
            catch (_: Exception) { message.setText(R.string.invalid_model_input); return@button }
            pendingId = id; pendingHash = expected
            @Suppress("DEPRECATION")
            startActivityForResult(Intent(Intent.ACTION_OPEN_DOCUMENT).apply { type = "*/*"; addCategory(Intent.CATEGORY_OPENABLE); addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION) }, 42)
        }
        label("Filen kopieras till appens privata lagring och verifieras innan den visas som installerad. Originalet ändras inte. Endast LiteRT-LM-modeller stöds, inte GGUF.")
        val advanced = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; visibility = android.view.View.GONE }
        button("Visa / dölj Android och återställning") { advanced.visibility = if (advanced.visibility == android.view.View.GONE) android.view.View.VISIBLE else android.view.View.GONE }
        root.addView(advanced)
        fun advancedButton(title: String, action: () -> Unit) { advanced.addView(Button(this).apply { text = title; minHeight = (48*scale).toInt(); setOnClickListener { action() }; controls.add(this) }) }
        advanced.addView(TextView(this).apply { text = "Android kräver ett uttryckligt godkännande för tillgänglighetsstyrning. Det behövs bara för att styra andra appar, inte för Aura eller lokala modeller."; setTextIsSelectable(true) })
        advancedButton("Öppna tillgänglighetsinställningar") { startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)) }
        advancedButton("Kopiera återställningstoken") {
            (getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText("JACO native token", SessionToken.get(this)))
            message.setText(R.string.recovery_token_copied)
        }
        advancedButton("Rotera token") {
            SessionToken.rotate(this); paired = false
            // The running server resolves the current token for every request. No restart race.
            pair()
        }
        setContentView(ScrollView(this).apply { isFillViewport = true; fitsSystemWindows = true; addView(root) })
    }
    private fun runtimePort(): Int? {
        val value = port.text.toString().toIntOrNull()
        if (value == null || value !in 1..65535) { message.setText(R.string.invalid_runtime_port); return null }
        return value
    }
    private fun runTask(label: String, task: () -> String) {
        if (isDestroyed) return
        if (busy) { message.setText(R.string.wait_for_operation); return }
        busy = true; controls.forEach { it.isEnabled = false }; message.text = label; progress.visibility = android.view.View.VISIBLE
        executor.execute {
            val outcome = try { task() } catch (_: NativeOutcomeUnknownException) { "Svaret kunde inte bekräftas. Uppdatera status innan du försöker igen; motorn kan fortfarande arbeta." }
            catch (_: java.net.SocketTimeoutException) { "Svaret kunde inte bekräftas. Uppdatera status innan du försöker igen; motorn kan fortfarande arbeta." }
            catch (error: Exception) { "Åtgärden misslyckades: ${error.message?.take(240) ?: error.javaClass.simpleName}" }
            runOnUiThread { if (!isDestroyed) { busy = false; controls.forEach { it.isEnabled = true }; progress.visibility = android.view.View.GONE; message.text = outcome; if (resumed) refresh() } }
        }
    }
    private fun refresh() {
        if (busy || isDestroyed) return
        busy = true
        executor.execute {
            var rows: JSONArray? = null
            val observation = try {
                val health = client.call("health") as JSONObject
                rows = client.call("models.list") as JSONArray
                val loaded = health.optBoolean("healthy", false)
                val model = if (loaded) health.optString("modelId") else "ingen modell laddad"
                val backend = if (loaded) health.optString("backend") else "ej observerad"
                "Lokal motortjänst: svarar\nModell: $model\nBeräkningsmotor: $backend\nJACO-parning: ${if (paired) "verifierad i denna session" else "inte verifierad i denna session"}"
            } catch (_: Exception) { "Motortjänsten kunde inte kontrolleras. Tidigare modellval är sparat men bekräftar inte att en modell är laddad." }
            runOnUiThread { if (!isDestroyed) {
                busy = false; status.text = observation
                if (rows != null) {
                    val savedModel = preferences.getString("model", "")
                    ids = (0 until rows.length()).map { rows.getJSONObject(it).getString("id") }
                    modelList.adapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, if (ids.isEmpty()) listOf("Ingen modell installerad") else ids)
                    modelList.setSelection(ids.indexOf(savedModel).coerceAtLeast(0))
                }
                if (autoPairPending && resumed) { autoPairPending = false; pair() }
            } }
        }
    }
    private fun pair() {
        val selectedPort = runtimePort() ?: return
        preferences.edit().putInt("runtimePort", selectedPort).apply()
        runTask("Ansluter till JACO…") {
            paired = false
            val base = "http://127.0.0.1:$selectedPort"
            val challenge = postJson("$base/api/startup/native/pair/challenge", JSONObject()).getJSONObject("challenge")
            val result = postJson("$base/api/startup/native/pair/complete", JSONObject().put("id", challenge.getString("id")).put("nonce", challenge.getString("nonce")).put("token", SessionToken.get(this)))
            check(result.optBoolean("success", false)) { "Parningen kunde inte verifieras" }
            paired = true; "JACO-parningen verifierades. Öppna Aura för att fortsätta med ditt projekt."
        }
    }
    @Deprecated("Platform document picker callback")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != 42 || resultCode != RESULT_OK) return
        val uri = data?.data ?: return
        if (uri.scheme != "content") { message.setText(R.string.use_document_picker); return }
        val id = pendingId; val expected = pendingHash
        runTask("Kopierar och verifierar modellfilen…") {
            var lastUpdate = 0L
            contentResolver.openInputStream(uri)?.use { input ->
                ModelStore(this).importModel(id, input, expected) { bytes ->
                    val now = System.currentTimeMillis()
                    if (now - lastUpdate > 500) { lastUpdate = now; runOnUiThread { if (!isDestroyed) message.text = getString(R.string.import_progress_mb, bytes / (1024*1024)) } }
                }
            } ?: error("Filen kunde inte öppnas")
            preferences.edit().putString("model", id.removeSuffix(".litertlm")).apply()
            "Modellen är kopierad och SHA-256 verifierad. Välj Ladda vald modell för att använda den."
        }
    }
    private fun postJson(url: String, payload: JSONObject): JSONObject {
        val connection = (URL(url).openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"; connectTimeout = 2500; readTimeout = 4000; doOutput = true; instanceFollowRedirects = false
            setRequestProperty("Content-Type", "application/json")
        }
        try {
            connection.outputStream.use { it.write(payload.toString().toByteArray(Charsets.UTF_8)) }
            check(connection.responseCode in 200..299) { "JACO är inte tillgängligt på vald port (HTTP ${connection.responseCode})" }
            return JSONObject(connection.inputStream.bufferedReader().use { it.readText() })
        } finally { connection.disconnect() }
    }
}
