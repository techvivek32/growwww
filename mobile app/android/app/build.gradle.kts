import java.util.Properties
import java.io.FileInputStream

plugins {
    id("com.android.application")
    id("kotlin-android")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

// Release signing credentials, read from android/key.properties — which is
// gitignored. The build falls back to unsigned rather than silently signing
// with the debug key: an APK signed with the debug key installs and runs, so
// the mistake is invisible until Play rejects it or an update refuses to
// install over it.
val keystoreProperties = Properties()
val keystorePropertiesFile = rootProject.file("key.properties")
val hasReleaseKey = keystorePropertiesFile.exists()
if (hasReleaseKey) {
    keystoreProperties.load(FileInputStream(keystorePropertiesFile))
}

// Push notifications, on the same terms as the signing key above: present and
// it works, absent and the build still succeeds without it.
//
// The google-services plugin ABORTS the build when google-services.json is
// missing, so applying it unconditionally would mean this app could not be
// compiled at all until somebody created a Firebase project. The Dart side
// matches this: Firebase.initializeApp() is allowed to fail, and the app
// falls back to its in-app notification feed. Drop the file in at
// android/app/google-services.json and the next build wires itself up.
val hasFirebase = file("google-services.json").exists()
if (hasFirebase) {
    apply(plugin = "com.google.gms.google-services")
    logger.lifecycle("[mnha] google-services.json found — push notifications enabled")
} else {
    logger.lifecycle("[mnha] no google-services.json — building without push")
}

android {
    namespace = "com.mnhafinancials.app"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
        // Required by flutter_local_notifications, which uses java.time to
        // schedule and format notifications. Without it the build fails at
        // checkReleaseAarMetadata rather than at compile time, so the error
        // names the AAR and not the API that needs it.
        isCoreLibraryDesugaringEnabled = true
    }

    kotlinOptions {
        jvmTarget = JavaVersion.VERSION_17.toString()
    }

    defaultConfig {
        applicationId = "com.mnhafinancials.app"
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    signingConfigs {
        if (hasReleaseKey) {
            create("release") {
                keyAlias = keystoreProperties["keyAlias"] as String
                keyPassword = keystoreProperties["keyPassword"] as String
                // rootProject.file, not file(): key.properties lives in
                // android/, so its storeFile path is relative to android/ —
                // while file() here would resolve against android/app/.
                storeFile = rootProject.file(keystoreProperties["storeFile"] as String)
                storePassword = keystoreProperties["storePassword"] as String
            }
        }
    }

    buildTypes {
        release {
            if (hasReleaseKey) {
                signingConfig = signingConfigs.getByName("release")
            }
            // Shrink and strip. The app is small, but an obfuscated release is
            // the default expectation for anything holding a trading session.
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
        }
    }
}

flutter {
    source = "../.."
}

dependencies {
    // The backport that core library desugaring above rewrites java.time (and
    // friends) onto, for devices below API 26.
    coreLibraryDesugaring("com.android.tools:desugar_jdk_libs:2.1.5")
}
