package ai.jaco.nativeengine

import android.Manifest
import android.app.Activity
import android.app.AlertDialog
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
import android.os.PersistableBundle
import android.provider.Settings
import android.text.Editable
import android.text.TextWatcher
import android.text.InputType
import android.widget.*
import android.view.View
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

/** Native setup and engine controls; Aura remains the only workspace and agent UI. */
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
    private lateinit var address: EditText
    private lateinit var progress: ProgressBar
    private val controls = mutableListOf<Button>()
    private var ids = emptyList<String>()
    private var busy = false
    private var resumed = false
    private var pendingId = ""
    private var pendingHash = ""
    @Volatile private var paired = false
    private val backends = listOf("auto", "npu", "gpu", "cpu")
    private val polling = object : Runnable {
        override fun run() { if (!resumed) return; if (!busy) refresh(); handler.postDelayed(this, 15000) }
    }

    override fun attachBaseContext(base: Context) { super.attachBaseContext(UiLanguage.wrap(base)) }
    override fun onCreate(state: Bundle?) {
        super.onCreate(state)
        render(state)
        // Approval persists across launches; first launch never starts an engine or asks for permissions.
        if (preferences.getBoolean("engineApproved", false)) startApprovedEngine()
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
        fun button(title: Int, action: () -> Unit) = Button(this).apply { setText(title); minHeight = (48*scale).toInt(); setOnClickListener { action() }; root.addView(this); controls.add(this) }
        label(getString(R.string.app_title), 26f)
        label(getString(R.string.app_description))
        label(getString(R.string.language))
        root.addView(Spinner(this).apply {
            adapter = ArrayAdapter(this@MainActivity, android.R.layout.simple_spinner_dropdown_item, listOf("English", "Svenska"))
            contentDescription = getString(R.string.language)
            setSelection(if (UiLanguage.selected(this@MainActivity) == "sv") 1 else 0)
            onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
                override fun onItemSelected(parent: AdapterView<*>?, view: View?, position: Int, id: Long) {
                    val selected = if (position == 1) "sv" else "en"
                    if (selected != UiLanguage.selected(this@MainActivity)) { UiLanguage.select(this@MainActivity, selected); recreate() }
                }
                override fun onNothingSelected(parent: AdapterView<*>?) {}
            }
        })
        status = label(getString(R.string.checking_engine))
        message = label("").apply { accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE }
        progress = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply { isIndeterminate = true; visibility = View.GONE; root.addView(this) }
        button(R.string.refresh_status) { refresh() }

        label(getString(R.string.workspace), 21f)
        val previousPort = preferences.getInt("runtimePort", 3000)
        address = field(getString(R.string.runtime_address), preferences.getString("runtimeUrl", "http://127.0.0.1:$previousPort").orEmpty()).apply {
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
            addTextChangedListener(object : TextWatcher {
                override fun beforeTextChanged(text: CharSequence?, start: Int, count: Int, after: Int) {}
                override fun onTextChanged(text: CharSequence?, start: Int, before: Int, count: Int) { paired = false }
                override fun afterTextChanged(text: Editable?) {}
            })
        }
        button(R.string.check_connection) { connect(open = false) }
        button(R.string.open_aura) { connect(open = true) }
        button(R.string.providers_and_tools) { connect(open = true) }
        label(getString(R.string.workspace_description))
        button(R.string.runtime_setup) { showRuntimeSetup() }

        label(getString(R.string.local_ai), 21f)
        button(R.string.enable_engine) {
            AlertDialog.Builder(this).setTitle(R.string.enable_engine_title).setMessage(R.string.enable_engine_description)
                .setNegativeButton(R.string.cancel, null).setPositiveButton(R.string.allow) { _, _ ->
                    preferences.edit().putBoolean("engineApproved", true).apply()
                    if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                        requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 7)
                    }
                    startApprovedEngine()
                }.show()
        }
        button(R.string.stop_engine) {
            preferences.edit().putBoolean("engineApproved", false).apply(); paired = false
            stopService(Intent(this, JacoNativeEngineService::class.java)); message.setText(R.string.engine_stopped)
            handler.postDelayed({ if (resumed && !isDestroyed) refresh() }, 500)
        }
        button(R.string.pair_engine) { pair() }
        modelList = Spinner(this).apply { contentDescription = getString(R.string.installed_model); root.addView(this) }
        backendList = Spinner(this).apply {
            contentDescription = getString(R.string.preferred_backend)
            adapter = ArrayAdapter(this@MainActivity, android.R.layout.simple_spinner_dropdown_item, backends.map { if (it == "auto") "Auto" else it.uppercase(java.util.Locale.ROOT) })
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
        label(getString(R.string.backend_description))
        button(R.string.load_model) {
            if (!engineApproved()) return@button
            val id = ids.getOrNull(modelList.selectedItemPosition) ?: run { message.setText(R.string.import_first); return@button }
            val backend = backends[backendList.selectedItemPosition]
            preferences.edit().putString("model", id).putString("backend", backend).apply()
            runTask(getString(R.string.loading_model, id)) {
                val receipt = client.call("model.load", JSONObject().put("modelId", id).put("backend", backend), 180000) as JSONObject
                check(receipt.optBoolean("loaded") && receipt.optString("modelId") == id) { getString(R.string.model_load_unverified) }
                getString(R.string.model_loaded)
            }
        }
        button(R.string.unload_model) { runTask(getString(R.string.unloading_model)) {
            val receipt = client.call("model.unload") as JSONObject
            check(receipt.optBoolean("unloaded")) { getString(R.string.model_unload_unverified) }
            getString(R.string.model_unloaded)
        } }
        button(R.string.remove_model) {
            val id = ids.getOrNull(modelList.selectedItemPosition) ?: return@button
            runTask(getString(R.string.removing_model, id)) {
                val result = client.call("model.remove", JSONObject().put("modelId", id)) as JSONObject
                check(result.optBoolean("removed")) { getString(R.string.model_remove_unverified) }
                getString(R.string.model_removed)
            }
        }
        label(getString(R.string.import_title), 21f)
        modelId = field(getString(R.string.model_id_hint), state?.getString("id").orEmpty())
        hash = field(getString(R.string.model_hash_hint), state?.getString("hash").orEmpty())
        pendingId = state?.getString("pendingId").orEmpty(); pendingHash = state?.getString("pendingHash").orEmpty()
        button(R.string.choose_model_file) {
            val id = modelId.text.toString().trim(); val expected = hash.text.toString().trim()
            try { ModelStore(this).pathFor(id); require(expected.matches(Regex("[a-fA-F0-9]{64}"))) }
            catch (_: Exception) { message.setText(R.string.invalid_model_input); return@button }
            pendingId = id; pendingHash = expected
            @Suppress("DEPRECATION")
            startActivityForResult(Intent(Intent.ACTION_OPEN_DOCUMENT).apply { type = "*/*"; addCategory(Intent.CATEGORY_OPENABLE); addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION) }, 42)
        }
        label(getString(R.string.import_description))
        val advanced = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; visibility = View.GONE }
        button(R.string.advanced_settings) { advanced.visibility = if (advanced.visibility == View.GONE) View.VISIBLE else View.GONE }
        root.addView(advanced)
        fun advancedButton(title: Int, action: () -> Unit) { advanced.addView(Button(this).apply { setText(title); minHeight = (48*scale).toInt(); setOnClickListener { action() }; controls.add(this) }) }
        advanced.addView(TextView(this).apply { setText(R.string.accessibility_description); setTextIsSelectable(true) })
        advancedButton(R.string.open_accessibility) { startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)) }
        advancedButton(R.string.copy_recovery_token) {
            val clip = ClipData.newPlainText(getString(R.string.recovery_token_label), SessionToken.get(this))
            clip.description.extras = PersistableBundle().apply { putBoolean("android.content.extra.IS_SENSITIVE", true) }
            (getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(clip)
            message.setText(R.string.recovery_token_copied)
        }
        advancedButton(R.string.rotate_token) {
            SessionToken.rotate(this); paired = false
            // The running engine resolves the current token for each request.
            pair()
        }
        setContentView(ScrollView(this).apply { isFillViewport = true; fitsSystemWindows = true; addView(root) })
    }

    private fun showRuntimeSetup() {
        AlertDialog.Builder(this).setTitle(R.string.runtime_setup).setMessage(R.string.runtime_setup_steps)
            .setPositiveButton(R.string.open_termux) { _, _ ->
                val launch = packageManager.getLaunchIntentForPackage("com.termux")
                if (launch != null) startActivity(launch)
                else openBrowser("https://github.com/termux/termux-app#installation")
            }
            .setNeutralButton(R.string.get_runtime) { _, _ -> openBrowser("https://github.com/Rick84444/JACO-CODE/releases") }
            .setNegativeButton(R.string.done, null).show()
    }
    private fun openBrowser(url: String) {
        try { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) }
        catch (_: Exception) { message.setText(R.string.browser_unavailable) }
    }
    private fun startApprovedEngine() {
        try { startForegroundService(Intent(this, JacoNativeEngineService::class.java)); message.setText(R.string.engine_start_requested) }
        catch (_: Exception) { message.setText(R.string.engine_start_failed) }
    }
    private fun engineApproved(): Boolean {
        if (preferences.getBoolean("engineApproved", false)) return true
        message.setText(R.string.engine_consent_required); return false
    }
    private fun runtimeAddress(): RuntimeAddress? {
        return try { RuntimeAddress.parse(address.text.toString()) }
        catch (_: Exception) { message.setText(R.string.invalid_runtime_address); null }
    }
    private fun connect(open: Boolean) {
        val selected = runtimeAddress() ?: return
        preferences.edit().putString("runtimeUrl", selected.baseUrl).apply()
        runTask(getString(R.string.checking_runtime), afterSuccess = { if (open) openBrowser(selected.baseUrl) }) {
            val identity = RuntimeConnection().probe(selected)
            getString(R.string.runtime_verified, identity.version, selected.baseUrl)
        }
    }
    private fun runTask(label: String, afterSuccess: (() -> Unit)? = null, task: () -> String) {
        if (isDestroyed) return
        if (busy) { message.setText(R.string.wait_for_operation); return }
        busy = true; controls.forEach { it.isEnabled = false }; message.text = label; progress.visibility = View.VISIBLE
        executor.execute {
            var succeeded = false
            val outcome = try { task().also { succeeded = true } }
            catch (_: NativeOutcomeUnknownException) { getString(R.string.outcome_unknown) }
            catch (_: java.net.SocketTimeoutException) { getString(R.string.outcome_unknown) }
            catch (_: Exception) { getString(R.string.operation_failed) }
            runOnUiThread { if (!isDestroyed) {
                busy = false; controls.forEach { it.isEnabled = true }; progress.visibility = View.GONE; message.text = outcome
                if (succeeded) afterSuccess?.invoke()
                if (resumed) refresh()
            } }
        }
    }
    private fun refresh() {
        if (busy || isDestroyed) return
        busy = true
        executor.execute {
            var rows: JSONArray? = null
            val observation = try {
                val health = client.call("health") as JSONObject
                check(health.optString("product") == "JACO Native Engine" && health.optBoolean("serviceHealthy", false)) { "NATIVE_IDENTITY_MISMATCH" }
                rows = client.call("models.list") as JSONArray
                val loaded = health.optBoolean("healthy", false)
                val model = if (loaded) health.optString("modelId") else getString(R.string.no_model_loaded)
                val backend = if (loaded) health.optString("backend").uppercase(java.util.Locale.ROOT) else getString(R.string.not_observed)
                getString(R.string.engine_observation, model, backend, getString(if (paired) R.string.pair_verified else R.string.pair_unverified))
            } catch (_: Exception) { getString(R.string.engine_unavailable) }
            runOnUiThread { if (!isDestroyed) {
                busy = false; status.text = observation
                val observedRows = rows
                if (observedRows != null) {
                    val savedModel = preferences.getString("model", "")
                    ids = (0 until observedRows.length()).map { observedRows.getJSONObject(it).getString("id") }
                    modelList.adapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, if (ids.isEmpty()) listOf(getString(R.string.no_model_installed)) else ids)
                    modelList.setSelection(ids.indexOf(savedModel).coerceAtLeast(0))
                }
            } }
        }
    }
    private fun pair() {
        if (!engineApproved()) return
        val selected = runtimeAddress() ?: return
        if (!selected.isLoopback) { message.setText(R.string.local_pairing_only); return }
        preferences.edit().putString("runtimeUrl", selected.baseUrl).apply()
        runTask(getString(R.string.pairing_runtime)) {
            paired = false
            RuntimeConnection().probe(selected)
            val challenge = postJson("${selected.baseUrl}/api/startup/native/pair/challenge", JSONObject()).getJSONObject("challenge")
            val result = postJson("${selected.baseUrl}/api/startup/native/pair/complete", JSONObject().put("id", challenge.getString("id")).put("nonce", challenge.getString("nonce")).put("token", SessionToken.get(this)))
            check(result.optBoolean("success", false)) { getString(R.string.pairing_unverified) }
            paired = true; getString(R.string.pairing_verified)
        }
    }
    @Deprecated("Platform document picker callback")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != 42 || resultCode != RESULT_OK) return
        val uri = data?.data ?: return
        if (uri.scheme != "content") { message.setText(R.string.use_document_picker); return }
        val id = pendingId; val expected = pendingHash
        runTask(getString(R.string.importing_model)) {
            var lastUpdate = 0L
            contentResolver.openInputStream(uri)?.use { input ->
                ModelStore(this).importModel(id, input, expected) { bytes ->
                    val now = System.currentTimeMillis()
                    if (now - lastUpdate > 500) { lastUpdate = now; runOnUiThread { if (!isDestroyed) message.text = getString(R.string.import_progress_mb, bytes / (1024*1024)) } }
                }
            } ?: error(getString(R.string.file_unavailable))
            preferences.edit().putString("model", id.removeSuffix(".litertlm")).apply()
            getString(R.string.model_imported)
        }
    }
    private fun postJson(url: String, payload: JSONObject): JSONObject {
        // Called only after RuntimeAddress validation, identity observation and the loopback guard.
        val connection = (URL(url).openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"; connectTimeout = 2500; readTimeout = 4000; doOutput = true; instanceFollowRedirects = false
            setRequestProperty("Content-Type", "application/json")
        }
        try {
            connection.outputStream.use { it.write(payload.toString().toByteArray(Charsets.UTF_8)) }
            check(connection.responseCode in 200..299) { "RUNTIME_NOT_AVAILABLE" }
            val response = connection.inputStream.bufferedReader().use { reader ->
                val text = StringBuilder()
                val buffer = CharArray(2048)
                while (true) {
                    val count = reader.read(buffer)
                    if (count < 0) break
                    require(text.length + count <= 16384) { "RUNTIME_RESPONSE_TOO_LARGE" }
                    text.append(buffer, 0, count)
                }
                text.toString()
            }
            return JSONObject(response)
        } finally { connection.disconnect() }
    }
}
