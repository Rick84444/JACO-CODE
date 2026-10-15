plugins {
  id("com.android.application") version "8.9.1" apply false
  // litertlm-android 0.14.0 is compiled with Kotlin 2.3; older compilers cannot read its metadata.
  kotlin("android") version "2.3.0" apply false
}
