# Flutter's engine is reached by reflection from native code; R8 cannot see
# those references and would strip them.
-keep class io.flutter.** { *; }
-keep class io.flutter.plugins.** { *; }

# flutter_secure_storage binds to the Android Keystore through androidx.
-keep class androidx.security.crypto.** { *; }

# Flutter's embedding references Play Core's deferred-component ("split
# install") API unconditionally, but Play Core is not a dependency here and
# this app ships no deferred components. The references are genuinely
# unreachable, so R8 is told not to warn rather than the library being added
# for code that will never run.
-dontwarn com.google.android.play.core.**
-keep class io.flutter.embedding.engine.deferredcomponents.** { *; }

# Keep source line numbers so a release stack trace is still readable, while
# hiding the original file names.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile
