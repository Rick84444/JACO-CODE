package ai.jaco.nativeengine

import android.content.Context
import com.google.ai.edge.litertlm.*
import kotlinx.serialization.json.JsonObject

class DescriptorTool(private val spec:String): OpenApiTool {
    override fun getToolDescriptionJsonString():String=spec
    override fun execute(paramsJsonString:String):String=error("JACO governance executes tools outside the model runtime")
}
// LiteRT-LM 0.14 returns tool-call arguments as a map; JACO forwards them as a JSON string.
private fun argumentsJson(arguments: Any?): String = when (arguments) {
    null -> "{}"
    is String -> arguments
    is Map<*, *> -> org.json.JSONObject(arguments).toString()
    else -> arguments.toString()
}
data class NativeCompletionResult(val text:String,val toolCalls:List<Pair<String,String>>)

class LiteRtEngineHost(private val context: Context) : AutoCloseable {
    private var engine: Engine? = null;private var modelId: String? = null;private var backendName: String? = null
    @Synchronized fun load(modelId: String, modelPath: String, backend: String) {
        require(backend.lowercase() in listOf("auto", "npu", "gpu", "cpu")) { "INVALID_BACKEND" }
        close();val candidates=if(backend.lowercase()=="auto") listOf("npu","gpu","cpu") else listOf(backend.lowercase());var last:Throwable?=null
        for(candidate in candidates){var created:Engine?=null;try{val selected=when(candidate){"npu"->Backend.NPU(nativeLibraryDir=context.applicationInfo.nativeLibraryDir);"gpu"->Backend.GPU();else->Backend.CPU()};created=Engine(EngineConfig(modelPath=modelPath,backend=selected,cacheDir=context.cacheDir.absolutePath));created.initialize();engine=created;this.modelId=modelId;backendName=candidate;return}catch(t:Throwable){last=t;created?.close();engine=null}}
        throw IllegalStateException("No LiteRT-LM backend could load model",last)
    }
    @Synchronized fun complete(system:String?,prompt:String,toolSpecs:List<JsonObject>,temperature:Double?):NativeCompletionResult {
        val active=engine?:error("No model loaded")
        val tools=toolSpecs.map{spec->
            val name=spec["name"]?.toString()?.trim('"')?:"tool";val description=spec["description"]?.toString()?:"\"JACO tool\"";val parameters=spec["inputSchema"]?.toString()?:"{\"type\":\"object\",\"properties\":{}}";val openApi="{\"name\":\"$name\",\"description\":$description,\"parameters\":$parameters}";tool(DescriptorTool(openApi))
        }
        val config=ConversationConfig(systemInstruction=system?.takeIf{it.isNotBlank()}?.let{Contents.of(it)},tools=tools,automaticToolCalling=false,samplerConfig=temperature?.let{SamplerConfig(topK=40,topP=0.95,temperature=it)})
        // LiteRT-LM 0.14: a reply is a list of typed contents; JACO returns its text parts.
        active.createConversation(config).use{conversation->val msg=conversation.sendMessage(prompt);val text=msg.contents.contents.filterIsInstance<Content.Text>().joinToString(""){it.text};return NativeCompletionResult(text,msg.toolCalls.map{it.name to argumentsJson(it.arguments)})}
    }
    @Synchronized fun status():Map<String,Any?> = mapOf("healthy" to (engine!=null),"modelId" to modelId,"backend" to backendName)
    @Synchronized override fun close(){engine?.close();engine=null;modelId=null;backendName=null}
}
