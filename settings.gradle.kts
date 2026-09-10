pluginManagement {
    repositories {
        mavenLocal()
        gradlePluginPortal()
    }
}

rootProject.name = "recovery-agent"
include(":state-authority")

val functionCatalogCheckout = file("../function-catalog")
if (functionCatalogCheckout.resolve("settings.gradle.kts").isFile) {
    includeBuild(functionCatalogCheckout)
}

val tavallDiCheckout = file("../tavall-di")
if (tavallDiCheckout.resolve("settings.gradle.kts").isFile) {
    includeBuild(tavallDiCheckout)
}

val tavallLoggingCheckout = file("../tavall-logging")
if (tavallLoggingCheckout.resolve("settings.gradle.kts").isFile) {
    includeBuild(tavallLoggingCheckout)
}
