plugins { id("com.android.application"); kotlin("android") }
android {
  namespace = "ai.jaco.nativeengine"
  compileSdk = 36
  defaultConfig { applicationId = "ai.jaco.nativeengine"; minSdk = 26; targetSdk = 36; versionCode = 15; versionName = "0.22.0" }
  buildTypes {
    debug { versionNameSuffix = "-preview" }
    release { isMinifyEnabled = false }
  }
  buildFeatures { buildConfig = true }
  compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
}
kotlin { compilerOptions { jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17) } }
dependencies {
  implementation("com.google.ai.edge.litertlm:litertlm-android:0.14.0")
  implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
  implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.8.1")
  testImplementation("junit:junit:4.13.2")
  testImplementation("org.json:json:20240303")
}
